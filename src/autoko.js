// Adapter ke Autoko (penyedia QRIS). SEMUA hal yang spesifik Autoko ada di file ini, supaya sisanya
// (wallet, ledger, penarikan) tidak perlu disentuh waktu format API mereka dicocokkan.
//
//  AUTOKO_MODE=mock  -> QRIS palsu untuk uji coba lokal (tombol "simulasi bayar" di admin). Tanpa uang sungguhan.
//  AUTOKO_MODE=live  -> memanggil API Autoko. TERKUNCI sampai LIVE_MAPPED = true (lihat di bawah).
//  kosong            -> pembayaran otomatis nonaktif.
//
// Env untuk live: AUTOKO_API_URL, AUTOKO_API_KEY, AUTOKO_WEBHOOK_SECRET
"use strict";
const crypto = require("crypto");

class AutokoError extends Error {
    constructor(message, status = 502) { super(message); this.status = status; }
}

// >>> Ubah jadi true HANYA setelah tiga fungsi pemetaan di bawah (toCreateRequest, fromCreateResponse,
// >>> fromWebhook) dicocokkan dengan Dokumentasi API Autoko dan sudah dites di menu Sandbox mereka.
const LIVE_MAPPED = false;

const hmacHex = (secret, raw) => crypto.createHmac("sha256", secret).update(raw).digest("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------------- Pemetaan ke format Autoko (ISI DARI DOKUMENTASI) ----------------
// TODO(docs Autoko): nama endpoint, nama field, dan header autentikasi di bawah ini baru PERKIRAAN.
function toCreateRequest({ orderId, amount, expiresAt }) {
    return { path: "/qris/create", body: { order_id: orderId, amount, expired_at: new Date(expiresAt).toISOString() } };
}
function fromCreateResponse(json) {
    // Harus mengembalikan { providerRef, qrString | qrImageUrl }.
    return { providerRef: String(json.id || json.transaction_id || ""), qrString: json.qr_string || json.qris || null, qrImageUrl: json.qr_url || null };
}
function fromWebhook(json) {
    // Harus mengembalikan { orderId, paid: boolean, amount, providerRef }.
    return { orderId: String(json.order_id || ""), paid: ["paid", "success", "completed"].includes(String(json.status || "").toLowerCase()), amount: json.amount != null ? Number(json.amount) : null, providerRef: String(json.id || "") };
}
// TODO(docs Autoko): cara memeriksa status satu transaksi (untuk menangkap webhook yang terlewat).
async function fetchStatus(/* http, orderId */) { throw new AutokoError("Cek status belum diisi (lihat src/autoko.js).", 501); }
// ------------------------------------------------------------------------------------

function createAutoko(env = process.env) {
    const mode = env.AUTOKO_MODE === "mock" ? "mock" : env.AUTOKO_MODE === "live" ? "live" : "off";
    const secret = env.AUTOKO_WEBHOOK_SECRET || "";
    const mockPaid = new Map(); // orderId -> true (hanya mode mock)
    const mockSecret = secret || "mock-webhook-secret";

    if (mode === "live" && !LIVE_MAPPED)
        console.warn("[AUTOKO] AUTOKO_MODE=live tapi adapter belum dicocokkan dengan dokumentasi (LIVE_MAPPED=false). Pembuatan QRIS akan ditolak.");

    async function http(path, body) {
        const base = String(env.AUTOKO_API_URL || "").replace(/\/+$/, "");
        if (!base || !env.AUTOKO_API_KEY) throw new AutokoError("AUTOKO_API_URL / AUTOKO_API_KEY belum diisi.", 503);
        let r;
        try {
            r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.AUTOKO_API_KEY}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
        } catch (e) { throw new AutokoError("Autoko tidak bisa dihubungi: " + (e.name === "TimeoutError" ? "waktu habis" : e.message)); }
        const json = await r.json().catch(() => ({}));
        if (!r.ok) throw new AutokoError(`Autoko menolak permintaan (HTTP ${r.status}).`);
        return json;
    }

    async function createQris({ orderId, amount, expiresAt }) {
        if (mode === "mock") return { providerRef: "mock-" + orderId, qrString: `MOCKQRIS|${orderId}|${amount}`, qrImageUrl: null };
        if (mode !== "live") throw new AutokoError("Pembayaran otomatis belum diaktifkan.", 503);
        if (!LIVE_MAPPED) throw new AutokoError("Adapter Autoko belum disesuaikan dengan dokumentasi API-nya.", 503);
        const { path, body } = toCreateRequest({ orderId, amount, expiresAt });
        const out = fromCreateResponse(await http(path, body));
        if (!out.qrString && !out.qrImageUrl) throw new AutokoError("Autoko tidak mengembalikan QRIS.");
        return out;
    }

    async function getStatus(orderId) {
        if (mode === "mock") return { paid: !!mockPaid.get(orderId) };
        if (mode === "live" && LIVE_MAPPED) return fetchStatus(http, orderId);
        throw new AutokoError("Cek status tidak tersedia.", 501);
    }

    // Memeriksa keaslian webhook lalu mengubahnya ke bentuk standar. Melempar AutokoError(401) kalau palsu.
    function verifyWebhook(rawBody, headers) {
        if (mode === "off" || (mode === "live" && !LIVE_MAPPED)) throw new AutokoError("Webhook tidak aktif.", 503);
        const sig = String(headers["x-webhook-signature"] || headers["x-signature"] || "");
        // TODO(docs Autoko): nama header & cara hitung signature sesuai dokumentasi.
        const key = mode === "mock" ? mockSecret : secret;
        if (!key || !sig || !safeEq(sig, hmacHex(key, rawBody))) throw new AutokoError("Signature tidak valid.", 401);
        let json; try { json = JSON.parse(rawBody.toString("utf8")); } catch { throw new AutokoError("Isi webhook bukan JSON.", 400); }
        return mode === "mock" ? { orderId: String(json.orderId || ""), paid: json.status === "paid", amount: json.amount != null ? Number(json.amount) : null, providerRef: String(json.providerRef || "") } : fromWebhook(json);
    }

    return {
        mode,
        enabled: mode === "mock" || (mode === "live" && LIVE_MAPPED),
        createQris, getStatus, verifyWebhook,
        // Khusus mock: tandai order sudah dibayar (dipakai tombol "simulasi bayar" dan tes).
        mockPay(orderId) { if (mode !== "mock") throw new AutokoError("Hanya untuk mode mock.", 403); mockPaid.set(orderId, true); },
        mockSign: (raw) => hmacHex(mockSecret, raw),
    };
}

module.exports = { createAutoko, AutokoError };
