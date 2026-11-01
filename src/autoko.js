// Adapter ke QRIS Gateway satrosdev (https://satrosdev.my.id, dokumentasi ada di halaman utama situs itu).
// SEMUA hal yang spesifik gateway ada di file ini. wallet.js, walletapi.js dan bot tidak perlu diubah.
//
//  AUTOKO_MODE=mock  -> QRIS palsu untuk uji coba lokal (tombol "simulasi bayar" di admin). Tanpa uang sungguhan.
//  AUTOKO_MODE=live  -> memanggil gateway satrosdev.
//  kosong            -> pembayaran otomatis nonaktif.
//
// Env untuk live:
//   AUTOKO_API_KEY      api_token dari gateway. RAHASIA: token yang sama juga dipakai untuk menghitung
//                       tanda tangan webhook, jadi siapa pun yang memegangnya bisa memalsukan pembayaran.
//   PUBLIC_URL          alamat publik HTTPS panel (sudah ada). Webhook dikirim ke PUBLIC_URL + /hook-autoko.
//   AUTOKO_API_URL      (opsional) default https://api.satrosdev.my.id
//   AUTOKO_MAP_FILE     (opsional) default: autoko-orders.json di folder yang sama dengan DATA_FILE.
//   AUTOKO_MAX_PER_HOUR (opsional) default 45. Gateway membatasi 50 order/jam per IP, dan IP yang
//                       melanggar 3x diblokir 1 jam, jadi kita rem sendiri sebelum menyentuh batas itu.
//
// Catatan desain: gateway yang membuat orderId (kita tidak bisa mengirim ID dari wallet). Pemetaan
// "orderId gateway <-> orderId wallet" disimpan di file lokal kecil supaya webhook dan cek status
// bisa dicocokkan ke deposit yang benar, dan tetap utuh setelah panel restart.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

class AutokoError extends Error {
    constructor(message, status = 502) { super(message); this.status = status; }
}

const hmacHex = (secret, raw) => crypto.createHmac("sha256", secret).update(raw).digest("hex");
const sha512Hex = (s) => crypto.createHash("sha512").update(s).digest("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_BASE = "https://api.satrosdev.my.id";
const MIN_AMOUNT = 1000, MAX_AMOUNT = 1000000;   // batas createOrder di gateway
const MAP_TTL_MS = 8 * 24 * 3600e3;              // riwayat gateway hanya 7 hari, jadi pemetaan lebih lama dari itu tidak berguna

// Gateway menjeda pembuatan order setiap hari 22:25 - 00:35 WIB (UTC+7, tanpa DST).
function inPauseWindow(d = new Date()) {
    const m = (d.getUTCHours() * 60 + d.getUTCMinutes() + 420) % 1440;
    return m >= 22 * 60 + 25 || m < 35;
}

// Pemetaan ID disimpan di file (ditulis atomik: tulis ke .tmp lalu rename).
function createOrderMap(file) {
    let data = { byGw: {}, byOrder: {} };
    try {
        const j = JSON.parse(fs.readFileSync(file, "utf8"));
        if (j && typeof j.byGw === "object" && typeof j.byOrder === "object") data = j;
    } catch { /* file belum ada: mulai kosong */ }
    function save() {
        const cut = Date.now() - MAP_TTL_MS;
        for (const [gw, v] of Object.entries(data.byGw)) if (v.t < cut) { delete data.byGw[gw]; delete data.byOrder[v.orderId]; }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
        fs.renameSync(tmp, file);
    }
    return {
        set(gw, orderId, qrisId) { data.byGw[gw] = { orderId, qrisId, t: Date.now() }; data.byOrder[orderId] = gw; save(); },
        byGw: (gw) => (hasOwn(data.byGw, gw) ? data.byGw[gw] : null),
        gwOf: (orderId) => (hasOwn(data.byOrder, orderId) ? data.byOrder[orderId] : null),
    };
}

function createAutoko(env = process.env) {
    const mode = env.AUTOKO_MODE === "mock" ? "mock" : env.AUTOKO_MODE === "live" ? "live" : "off";
    const token = env.AUTOKO_API_KEY || "";
    const base = String(env.AUTOKO_API_URL || DEFAULT_BASE).replace(/\/+$/, "");
    const publicUrl = String(env.PUBLIC_URL || "").replace(/\/+$/, "");
    const hookUrl = publicUrl + "/hook-autoko";
    const configured = !!token && /^https:\/\//i.test(publicUrl);
    const maxPerHour = Number(env.AUTOKO_MAX_PER_HOUR) > 0 ? Number(env.AUTOKO_MAX_PER_HOUR) : 45;

    const mockPaid = new Map(); // orderId -> true (hanya mode mock)
    const mockSecret = env.AUTOKO_WEBHOOK_SECRET || "mock-webhook-secret";

    let map = null;
    if (mode === "live") {
        if (!configured) console.warn("[AUTOKO] AUTOKO_MODE=live tapi AUTOKO_API_KEY kosong atau PUBLIC_URL bukan HTTPS. Pembayaran otomatis nonaktif.");
        else {
            const file = env.AUTOKO_MAP_FILE || path.join(path.dirname(env.DATA_FILE || "./data.json"), "autoko-orders.json");
            map = createOrderMap(file);
        }
    }

    // Rem lokal: maksimal maxPerHour order per jam dan jarak minimal 400 ms antar order (batas gateway 3/detik).
    const createLog = [];
    let lastSlot = 0;
    async function throttle() {
        const now = Date.now();
        while (createLog.length && now - createLog[0] > 3600e3) createLog.shift();
        if (createLog.length >= maxPerHour) throw new AutokoError("Antrean QRIS otomatis sedang penuh. Coba lagi dalam beberapa menit.", 429);
        const slot = Math.max(now, lastSlot + 400);
        lastSlot = slot;
        createLog.push(slot);
        if (slot > now) await sleep(slot - now);
    }

    async function call(p, body) {
        let r;
        try {
            r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
        } catch (e) {
            console.error("[AUTOKO] gateway tidak bisa dihubungi:", e.name === "TimeoutError" ? "waktu habis" : e.message);
            throw new AutokoError("Pembayaran otomatis sedang gangguan. Coba lagi sebentar lagi.", 503);
        }
        const json = await r.json().catch(() => ({}));
        return { status: r.status, json };
    }

    async function createQris({ orderId, amount }) {
        if (mode === "mock") return { providerRef: "mock-" + orderId, qrString: `MOCKQRIS|${orderId}|${amount}`, qrImageUrl: null };
        if (mode !== "live" || !configured) throw new AutokoError("Pembayaran otomatis belum diaktifkan.", 503);

        const amt = Math.round(Number(amount));
        if (!(amt >= MIN_AMOUNT && amt <= MAX_AMOUNT)) throw new AutokoError("Nominal QRIS otomatis harus antara Rp1.000 dan Rp1.000.000.", 400);

        await throttle();
        const { status, json } = await call("/api/v1/client/createOrder", { amount: amt, callBack: true, callBackUrl: hookUrl });
        if (status !== 200 || json.succes !== true || !json.orderId || !json.qrisId) {
            console.error(`[AUTOKO] createOrder gagal: HTTP ${status} ${String(json.message || "").slice(0, 120)}`);
            if (status === 500 && inPauseWindow()) throw new AutokoError("Pembuatan QRIS otomatis dijeda setiap hari pukul 22.25 sampai 00.35 WIB. Coba lagi setelah jam itu.", 503);
            if (status === 401) console.error("[AUTOKO] 401 = token salah, credit habis, atau kena rate limit/blokir IP. Cek credit di gateway.");
            if (status === 503) throw new AutokoError("Semua slot QRIS sedang penuh. Coba lagi beberapa saat lagi.", 503);
            throw new AutokoError("Pembayaran otomatis sedang tidak tersedia. Coba lagi nanti.", 503);
        }
        try { map.set(String(json.orderId), orderId, String(json.qrisId)); }
        catch (e) {
            console.error(`[AUTOKO] GAGAL menyimpan pemetaan order (gateway ${json.orderId}, qrisId ${json.qrisId}):`, e.message);
            throw new AutokoError("Pembayaran otomatis sedang gangguan. Coba lagi sebentar lagi.", 503);
        }
        const qrString = json.qrisString ? String(json.qrisString) : null;
        return { providerRef: String(json.orderId), qrString, qrImageUrl: qrString ? null : (json.qrisUrl ? String(json.qrisUrl) : null) };
    }

    // Dipakai sweep untuk menangkap webhook yang terlewat.
    async function getStatus(orderId) {
        if (mode === "mock") return { paid: !!mockPaid.get(orderId) };
        if (mode !== "live" || !configured) throw new AutokoError("Cek status tidak tersedia.", 501);
        const gw = map.gwOf(orderId);
        if (!gw) return { paid: false, unknown: true };
        const s = await call("/api/v1/client/qrisStatus", { orderId: gw });
        if (s.status === 200 && s.json.succes) return { paid: s.json.paymentStatus === "Success", status: s.json.paymentStatus };
        // Setelah final + 1 menit, order hilang dari qrisStatus (401/503). Datanya masih ada 7 hari di historyOrder.
        if (s.status === 401 || s.status === 503) {
            const h = await call("/api/v1/client/historyOrder", { orderId: gw });
            if (h.status === 200 && h.json.succes) return { paid: h.json.paymentStatus === "Success", status: h.json.paymentStatus, amount: h.json.amount != null ? Number(h.json.amount) : null };
            return { paid: false };
        }
        throw new AutokoError(`Cek status gagal (HTTP ${s.status}).`);
    }

    // Memeriksa keaslian webhook lalu mengubahnya ke bentuk standar. Melempar AutokoError(401) kalau palsu.
    function verifyWebhook(rawBody, headers) {
        if (mode === "off" || (mode === "live" && !configured)) throw new AutokoError("Webhook tidak aktif.", 503);

        if (mode === "mock") {
            const sig = String(headers["x-webhook-signature"] || headers["x-signature"] || "");
            if (!sig || !safeEq(sig, hmacHex(mockSecret, rawBody))) throw new AutokoError("Signature tidak valid.", 401);
            let j; try { j = JSON.parse(rawBody.toString("utf8")); } catch { throw new AutokoError("Isi webhook bukan JSON.", 400); }
            return { orderId: String(j.orderId || ""), paid: j.status === "paid", amount: j.amount != null ? Number(j.amount) : null, providerRef: String(j.providerRef || "") };
        }

        let j; try { j = JSON.parse(rawBody.toString("utf8")); } catch { throw new AutokoError("Isi webhook bukan JSON.", 400); }
        if (!j || typeof j !== "object") throw new AutokoError("Isi webhook bukan JSON.", 400);
        const gw = String(j.orderId ?? ""), st = String(j.paymentStatus ?? ""), amt = String(j.amount ?? "");
        const sig = String(j.signatureKey ?? "").toLowerCase();
        // Tanda tangan gateway: SHA-512(orderId + paymentStatus + amount + api_token). Dihitung ulang di sini.
        if (!gw || !sig || !safeEq(sig, sha512Hex(gw + st + amt + token))) throw new AutokoError("Signature tidak valid.", 401);

        const rec = map.byGw(gw);
        if (!rec) console.warn(`[AUTOKO] webhook sah untuk order gateway ${gw} (qrisId ${String(j.qrisId || "")}) tapi tidak ada di pemetaan lokal. Cek manual.`);
        return { orderId: rec ? rec.orderId : gw, paid: st === "Success", amount: j.amount != null ? Number(j.amount) : null, providerRef: gw };
    }

    return {
        mode,
        enabled: mode === "mock" || (mode === "live" && configured),
        createQris, getStatus, verifyWebhook,
        // Khusus mock: tandai order sudah dibayar (dipakai tombol "simulasi bayar" dan tes).
        mockPay(orderId) { if (mode !== "mock") throw new AutokoError("Hanya untuk mode mock.", 403); mockPaid.set(orderId, true); },
        mockSign: (raw) => hmacHex(mockSecret, raw),
    };
}

module.exports = { createAutoko, AutokoError, _test: { inPauseWindow } };
