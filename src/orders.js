// Pesanan key lewat web. Dua jalur pembayaran:
//  1. MANUAL (bawaan): pembeli bayar ke QRIS statis, admin cek mutasi lalu menekan Konfirmasi.
//     Key BARU dibuat saat admin menekan Konfirmasi.
//  2. OTOMATIS (opsional, ORDER_AUTO=1 + Autoko aktif): QRIS dinamis per pesanan. Begitu webhook/pengecekan status
//     Autoko memastikan lunas dengan nominal yang sama, key dibuat sendiri. Kalau gateway gagal, pesanan jatuh ke jalur manual.
// Pesanan juga bisa berupa PERPANJANGAN (renewLicenseId): konfirmasi menambah masa aktif key lama, bukan membuat key baru.
"use strict";
const crypto = require("crypto");

// Paket bawaan. Harga dan status jual bisa diubah dari halaman admin (disimpan di data.json), tidak perlu ubah kode.
// type = jenis key yang dibuat. sellable:false = tidak tampil di /beli (key lama tetap bisa diperpanjang).
const PACKAGES = {
    autostore: { id: "autostore", name: "Starter Cloud", type: "autostore", days: 30, price: 15000, sellable: true },
    autostore90: { id: "autostore90", name: "Pro Cloud", type: "autostore", days: 90, price: 40000, sellable: true },
    autostore365: { id: "autostore365", name: "Enterprise Cloud", type: "autostore", days: 365, price: 125000, sellable: true },
    autostoreLifetime: { id: "autostoreLifetime", name: "Lifetime AutoStore", type: "autostore", days: 0, lifetime: true, price: 250000, sellable: true },
    service: { id: "service", name: "AutoStore Service", type: "service", days: 30, price: 20000, sellable: false },
};
const PRICE_MIN = 1000, PRICE_MAX = 1000000; // batas nominal QRIS otomatis di gateway
const MAX_UNIQUE = 499;              // kode unik nominal: +Rp1 s/d +Rp499
const DAY = 86400000;
const KEY_VISIBLE_MS = DAY;          // key tampil di halaman pembeli selama 24 jam setelah dikonfirmasi
const CLAIMED_HOLD_MS = 2 * DAY;     // pesanan "sudah bayar" menunggu admin sampai 48 jam
const KEEP_FINISHED_MS = 30 * DAY;   // riwayat pesanan selesai disimpan 30 hari
const MAX_PENDING = 40, MAX_PER_CONTACT = 3, RATE_MAX = 20, RATE_WINDOW = 10 * 60e3;
// Batas per pengunjung (IP, sudah di-hash), supaya satu orang tidak menghabiskan jatah semua pembeli lain.
const IP_RATE_MAX = 5, MAX_PENDING_PER_IP = 5, MAX_CLAIMED_PER_IP = 3, MAX_CLAIMED = 60;
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

class OrderError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const rp = (n) => "Rp" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function createOrders({ store, issueLicense, encrypt, decrypt, notify = async () => {}, now = Date.now, ttlMin = 30, publicUrl = "",
                       autoko = null, autoOrders = false, getLicense = () => null, extendLicense = () => { throw new OrderError("Perpanjangan belum didukung.", 501); } }) {
    const ttl = ttlMin * 60e3;
    const all = () => (store.data.orders ||= []);
    const isActive = (o) => o.status === "pending" || o.status === "claimed";
    const rate = [];
    const ipRate = new Map(); // ipKey -> [waktu]

    function sweep() {
        const t = now(); let changed = false;
        for (const o of all()) {
            if ((o.status === "pending" && o.expiresAt <= t) || (o.status === "claimed" && o.claimedAt + CLAIMED_HOLD_MS <= t)) { o.status = "expired"; o.endedAt = t; delete o.qrString; delete o.qrImageUrl; changed = true; }
            if (o.keyEnc && o.keyUntil <= t) { delete o.keyEnc; changed = true; }
        }
        const keep = all().filter((o) => isActive(o) || t - (o.endedAt || o.createdAt) < KEEP_FINISHED_MS);
        if (keep.length !== all().length) { store.data.orders = keep; changed = true; }
        if (changed) store.save();
    }

    const newCode = () => {
        for (;;) {
            const c = "GS-" + Array.from(crypto.randomBytes(5), (b) => ALPHA[b % ALPHA.length]).join("");
            if (!all().some((o) => o.code === c)) return c;
        }
    };

    // Paket gabungan: bawaan + pengaturan admin (store.data.packagePrices).
    const overrides = () => (store.data.packagePrices ||= {});
    function pkgOf(id) {
        const base = PACKAGES[id];
        if (!base) return null;
        const ov = overrides()[id] || {};
        const price = Number.isInteger(ov.price) && ov.price >= PRICE_MIN && ov.price <= PRICE_MAX ? ov.price : base.price;
        return { ...base, price, sellable: typeof ov.sellable === "boolean" ? ov.sellable : base.sellable };
    }
    const packages = ({ sellable = false } = {}) => Object.keys(PACKAGES).map(pkgOf).filter((p) => !sellable || (p.type !== "service" && p.sellable));
    function setPackage(id, { price, sellable } = {}) {
        if (!PACKAGES[id]) throw new OrderError("Paket tidak dikenal.", 404);
        const ov = { ...(overrides()[id] || {}) };
        if (price !== undefined) {
            const p = Number(price);
            if (!Number.isInteger(p) || p < PRICE_MIN || p > PRICE_MAX) throw new OrderError(`Harga harus bilangan bulat Rp${PRICE_MIN.toLocaleString("id-ID")} sampai Rp${PRICE_MAX.toLocaleString("id-ID")}.`);
            ov.price = p;
        }
        if (sellable !== undefined) ov.sellable = !!sellable;
        overrides()[id] = ov; store.save();
        return pkgOf(id);
    }
    const autoEnabled = () => !!(autoOrders && autoko && autoko.enabled);
    const isMock = () => !!(autoko && autoko.mode === "mock");

    function view(o, withKey = false) {
        const v = { id: o.id, code: o.code, type: o.type, packageName: PACKAGES[o.type]?.name || o.type, days: o.days, amount: o.amount, status: o.status, createdAt: o.createdAt, expiresAt: o.expiresAt };
        if (o.lifetime) v.lifetime = true;
        if (o.paymentMethod === "dl") {
            v.paymentMethod = "dl";
            v.amountWL = o.amountWL;
            v.pricePerDL = o.pricePerDL;
        }
        if (o.renewLicenseId) { v.renew = true; if (o.renewedUntil) v.renewedUntil = o.renewedUntil; }
        if (o.auto) {
            v.auto = true;
            if (o.status === "pending") {
                if (o.qrString) v.qrString = o.qrString;
                if (o.qrImageUrl) v.qrImageUrl = o.qrImageUrl;
            }
        }
        if (withKey && o.status === "done" && o.keyEnc && o.keyUntil > now()) {
            try { v.key = decrypt(o.keyEnc).key; v.keyUntil = o.keyUntil; } catch { /* kunci tidak terbaca: abaikan */ }
        }
        return v;
    }

    function owned(id, token) {
        const o = all().find((x) => x.id === String(id));
        if (!o || !token || !same(sha(token), o.tokenHash)) throw new OrderError("Pesanan tidak ditemukan.", 404);
        return o;
    }

    function checkIp(ip, t) {
        if (!ip) return;
        const list = (ipRate.get(ip) || []).filter((x) => x > t - RATE_WINDOW);
        if (list.length >= IP_RATE_MAX) throw new OrderError("Kamu membuat terlalu banyak pesanan dalam waktu singkat. Coba lagi beberapa menit lagi.", 429);
        if (all().filter((o) => o.status === "pending" && o.ipKey === ip).length >= MAX_PENDING_PER_IP)
            throw new OrderError("Kamu masih punya beberapa pesanan yang belum dibayar. Selesaikan atau tunggu kedaluwarsa dulu.", 429);
    }
    const markIp = (ip, t) => { if (!ip) return; const list = (ipRate.get(ip) || []).filter((x) => x > t - RATE_WINDOW); list.push(t); ipRate.set(ip, list); if (ipRate.size > 5000) for (const [k, v] of ipRate) if (!v.some((x) => x > t - RATE_WINDOW)) ipRate.delete(k); };

    function create({ type, name, contact, ip = "" }, opts = {}) {
        sweep();
        const pkg = pkgOf(type);
        if (!pkg || ((!pkg.sellable || pkg.type === "service") && !opts.renewFor)) throw new OrderError("Paket tidak dikenal.");
        const nm = clean(name, 40), ct = clean(contact, 60);
        if (nm && nm.length < 2) throw new OrderError("Nama minimal 2 huruf.");
        if (ct && ct.length < 3) throw new OrderError("Kontak minimal 3 karakter.");
        const t = now();
        while (rate.length && rate[0] <= t - RATE_WINDOW) rate.shift();
        checkIp(ip, t);
        if (rate.length >= RATE_MAX) throw new OrderError("Terlalu banyak pesanan dalam waktu singkat. Coba lagi beberapa menit lagi.", 429);
        const act = all().filter(isActive), pend = act.filter((o) => o.status === "pending");
        if (pend.length >= MAX_PENDING) throw new OrderError("Pesanan sedang ramai. Coba lagi sebentar lagi.", 429);
        if (ct && pend.filter((o) => String(o.contact || "").toLowerCase() === ct.toLowerCase()).length >= MAX_PER_CONTACT)
            throw new OrderError("Kamu masih punya beberapa pesanan yang belum dibayar. Selesaikan atau tunggu kedaluwarsa dulu.", 429);
        let amount = pkg.price;
        if (!opts.pricePerDL) {
            const used = new Set(act.filter(o => o.paymentMethod !== "dl").map(o => o.amount));
            let unique = 0;
            for (let i = 0; i < 80 && !unique; i++) { const u = 1 + crypto.randomInt(MAX_UNIQUE); if (!used.has(pkg.price + u)) unique = u; }
            if (!unique) throw new OrderError("Sistem sedang penuh. Coba lagi sebentar lagi.", 503);
            amount += unique;
        }
        rate.push(t); markIp(ip, t);
        const token = crypto.randomBytes(24).toString("hex");
        const code = newCode();
        const o = { id: crypto.randomBytes(6).toString("hex"), code, type: pkg.id, licType: pkg.type, name: nm || code, contact: ct, days: pkg.days, lifetime: !!pkg.lifetime, price: pkg.price, amount,
                    status: "pending", tokenHash: sha(token), createdAt: t, expiresAt: t + ttl };
        if (opts.pricePerDL) {
            o.paymentMethod = "dl";
            o.pricePerDL = opts.pricePerDL;
            o.amountWL = Math.ceil(pkg.price * 100 / opts.pricePerDL);
        }
        if (ip) o.ipKey = ip;
        if (opts.renewFor) o.renewLicenseId = opts.renewFor;
        all().push(o); store.save();
        return { token, order: view(o) };
    }

    function get(id, token) { sweep(); return view(owned(id, token), true); }

    function claim(id, token) {
        sweep();
        const o = owned(id, token);
        if (o.status === "claimed") return view(o);
        if (o.status === "expired") throw new OrderError("Pesanan sudah kedaluwarsa. Kalau kamu sudah terlanjur membayar, hubungi penjual dan sebutkan kode pesanan " + o.code + ".", 409);
        if (o.status !== "pending") throw new OrderError("Pesanan ini sudah selesai diproses.", 409);
        if (o.auto || o.paymentMethod === "dl") return view(o);
        const claimed = all().filter((x) => x.status === "claimed");
        if (claimed.length >= MAX_CLAIMED || (o.ipKey && claimed.filter((x) => x.ipKey === o.ipKey).length >= MAX_CLAIMED_PER_IP))
            throw new OrderError("Masih ada beberapa pesananmu yang sedang diperiksa. Tunggu konfirmasi penjual dulu.", 429);
        o.status = "claimed"; o.claimedAt = now(); store.save();
        const text = [`💰 Pesanan menunggu dicek`, `Kode: ${o.code}`, `Paket: ${PACKAGES[o.type]?.name} ${o.days} hari`, `Nominal: ${rp(o.amount)}`, `Pembeli: ${o.name} (${o.contact})`,
                      `Cek mutasi DANA, lalu konfirmasi di halaman admin.`, publicUrl ? publicUrl.replace(/\/+$/, "") + "/admin.html" : ""].filter(Boolean).join("\n");
        Promise.resolve(notify({ title: "Pesanan baru menunggu dicek", text, url: publicUrl ? publicUrl.replace(/\/+$/, "") + "/admin.html" : "" })).catch(() => {});
        return view(o);
    }

    const adminView = (o) => {
        const { qrString, qrImageUrl, ...summary } = view(o);
        return { ...summary, name: o.name, contact: o.contact, claimedAt: o.claimedAt || null, confirmedAt: o.confirmedAt || null };
    };
    const RANK = { claimed: 0, pending: 1 };
    function adminList() {
        sweep();
        return [...all()].sort((a, b) => (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2) || b.createdAt - a.createdAt).slice(0, 100).map(adminView);
    }

    function adminFind(id) {
        const o = all().find((x) => x.id === String(id));
        if (!o) throw new OrderError("Pesanan tidak ditemukan.", 404);
        return o;
    }

    function confirm(id) {
        sweep();
        const o = adminFind(id);
        if (o.status === "done") {
            let key = null; try { if (o.keyEnc && o.keyUntil > now()) key = decrypt(o.keyEnc).key; } catch { /* abaikan */ }
            return { order: adminView(o), key, already: true };
        }
        if (o.status === "rejected") throw new OrderError("Pesanan ini sudah ditolak.", 409);
        const t = now();
        if (o.renewLicenseId) {
            // Perpanjangan: tambah masa aktif key lama, tidak ada key baru.
            const until = extendLicense(o.renewLicenseId, o.days);
            o.status = "done"; o.confirmedAt = t; o.endedAt = t; o.renewedUntil = until; delete o.qrString; delete o.qrImageUrl;
            store.save();
            return { order: adminView(o), key: null, renewed: true, expiresAt: until, already: false };
        }
        const key = issueLicense(o.name, o.licType || o.type, o.days, { save: false, lifetime: o.lifetime });
        o.status = "done"; o.confirmedAt = t; o.endedAt = t; o.keyEnc = encrypt({ key }); o.keyUntil = t + KEY_VISIBLE_MS; delete o.qrString; delete o.qrImageUrl;
        store.save(); // satu kali simpan: key dan pesanan berubah bersamaan
        return { order: adminView(o), key, already: false };
    }

    function reject(id) {
        sweep();
        const o = adminFind(id);
        if (o.status === "done") throw new OrderError("Pesanan sudah dikonfirmasi, tidak bisa ditolak.", 409);
        if (o.status !== "rejected") { o.status = "rejected"; o.endedAt = now(); delete o.qrString; delete o.qrImageUrl; store.save(); }
        return { order: adminView(o) };
    }

    // ---------------------------------------------------------------- Perpanjangan (dari panel pembeli)
    function createRenewal({ licenseId, packageId, ip = "" }) {
        const lic = getLicense(licenseId);
        if (!lic) throw new OrderError("Key tidak ditemukan.", 404);
        if (lic.revoked) throw new OrderError("Key ini dinonaktifkan penjual. Hubungi penjual untuk bantuan.", 403);
        const pkg = pkgOf(packageId || lic.type || "autostore");
        if (lic.lifetime || !pkg || pkg.lifetime || pkg.type !== (lic.type || "autostore") || (!pkg.sellable && pkg.id !== (lic.type || "autostore"))) throw new OrderError("Paket perpanjangan tidak tersedia.");
        return create({ type: pkg.id, name: lic.buyer, contact: "perpanjang:" + (lic.keyPrefix || licenseId), ip }, { renewFor: licenseId });
    }
    function renewPackages(licenseType = "autostore") {
        return packages().filter((p) => !p.lifetime && p.type === licenseType && (p.sellable || p.id === licenseType)).map(({ id, name, days, price }) => ({ id, name, days, price }));
    }

    // ---------------------------------------------------------------- QRIS otomatis
    // Dipanggil setelah create(). Kalau gateway gagal, lempar error: pesanan tetap sah dan memakai jalur manual.
    async function upgradeToAuto(id) {
        if (!autoEnabled()) return false;
        const o = all().find((x) => x.id === String(id));
        if (!o || o.status !== "pending" || o.auto || o.paymentMethod === "dl") return false;
        const ref = "KO-" + o.id;
        const q = await autoko.createQris({ orderId: ref, amount: o.price });
        if (!q || (!q.qrString && !q.qrImageUrl)) return false;
        o.auto = true;
        o.autoRef = ref;
        o.amount = o.price;
        if (q.qrString) o.qrString = q.qrString;
        if (q.qrImageUrl) o.qrImageUrl = q.qrImageUrl;
        if (q.providerRef) o.providerRef = q.providerRef;
        store.save();
        return true;
    }
    const ownsRef = (ref) => typeof ref === "string" && ref.startsWith("KO-") && all().some((o) => o.autoRef === ref);

    // Aman dipanggil berulang untuk order yang sama (webhook ganda, retry, sweep).
    function handlePaid({ orderId, amount = null }) {
        const o = all().find((x) => x.autoRef === String(orderId));
        if (!o) return { ok: false, reason: "unknown_order" };
        if (o.status === "done") return { ok: true, duplicate: true };
        const tell = (title, lines) => Promise.resolve(notify({ title, text: [title, ...lines, publicUrl ? publicUrl.replace(/\/+$/, "") + "/admin.html" : ""].filter(Boolean).join("\n"), url: publicUrl ? publicUrl.replace(/\/+$/, "") + "/admin.html" : "" })).catch(() => {});
        if (o.status === "rejected") { tell("⚠️ Pesanan yang sudah ditolak ternyata dibayar", [`Kode: ${o.code}`, `Nominal: ${rp(o.amount)}`, "Tidak diproses otomatis. Cek manual."]); return { ok: false, reason: "rejected" }; }
        if (amount != null && Number(amount) !== o.amount) {
            o.mismatch = Number(amount); store.save();
            tell("⚠️ Nominal pembayaran pesanan tidak cocok", [`Kode: ${o.code}`, `Seharusnya: ${rp(o.amount)}`, `Diterima: ${rp(Number(amount))}`, "Tidak diproses otomatis. Cek manual."]);
            return { ok: false, reason: "amount_mismatch" };
        }
        const r = confirm(o.id);
        tell(o.renewLicenseId ? "✅ Perpanjangan lunas otomatis" : "✅ Pesanan lunas otomatis, key sudah dibuat", [`Kode: ${o.code}`, `Paket: ${PACKAGES[o.type]?.name || o.type} ${o.days} hari`, `Nominal: ${rp(o.amount)}`, `Pembeli: ${o.name}`]);
        return { ok: true, duplicate: false, renewed: !!r.renewed };
    }

    // Menangkap webhook yang terlewat: tanya gateway untuk order otomatis yang belum lunas.
    async function sweepAuto({ limit = 20 } = {}) {
        if (!autoEnabled()) return { checked: 0, paid: 0 };
        sweep();
        const t = now(), out = { checked: 0, paid: 0 };
        const maybe = all().filter((o) => o.auto && o.status !== "done" && o.status !== "rejected" && t - o.createdAt < 2 * 3600e3 && t - o.createdAt > 20e3).slice(0, limit);
        for (const o of maybe) {
            try {
                out.checked++;
                const s = await autoko.getStatus(o.autoRef);
                if (s && s.paid && handlePaid({ orderId: o.autoRef, amount: s.amount ?? null }).ok) out.paid++;
            } catch (e) { if (e.status === 501) break; console.error("[ORDERS] cek status gagal:", e.message); }
        }
        return out;
    }

    // Khusus uji coba (AUTOKO_MODE=mock): pura-pura QRIS pesanan sudah dibayar.
    function mockPay(id) {
        const o = adminFind(id);
        if (!o.autoRef) throw new OrderError("Pesanan ini bukan QRIS otomatis.", 409);
        if (!autoko || autoko.mode !== "mock") throw new OrderError("Hanya tersedia di mode uji coba.", 403);
        autoko.mockPay(o.autoRef);
        return handlePaid({ orderId: o.autoRef });
    }

    return { create, get, claim, adminList, confirm, reject, PACKAGES, sweep, packages, setPackage, createRenewal, renewPackages, upgradeToAuto, handlePaid, ownsRef, sweepAuto, autoEnabled, isMock, mockPay };
}

module.exports = { createOrders, OrderError, PACKAGES, rp };
