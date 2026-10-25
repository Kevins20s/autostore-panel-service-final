// Pesanan key lewat web dengan QRIS manual: pembeli memesan, membayar, lalu admin mengonfirmasi.
// Key BARU dibuat saat admin menekan Konfirmasi, jadi tidak ada jalan mendapat key tanpa persetujuan admin.
"use strict";
const crypto = require("crypto");

// Ubah harga/durasi di sini.
const PACKAGES = {
    autostore: { id: "autostore", name: "AutoStore", days: 30, price: 20000 },
    service: { id: "service", name: "AutoStore Service", days: 30, price: 20000 },
};
const MAX_UNIQUE = 499;              // kode unik nominal: +Rp1 s/d +Rp499
const DAY = 86400000;
const KEY_VISIBLE_MS = DAY;          // key tampil di halaman pembeli selama 24 jam setelah dikonfirmasi
const CLAIMED_HOLD_MS = 2 * DAY;     // pesanan "sudah bayar" menunggu admin sampai 48 jam
const KEEP_FINISHED_MS = 30 * DAY;   // riwayat pesanan selesai disimpan 30 hari
const MAX_PENDING = 40, MAX_PER_CONTACT = 3, RATE_MAX = 20, RATE_WINDOW = 10 * 60e3;
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

class OrderError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const rp = (n) => "Rp" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function createOrders({ store, issueLicense, encrypt, decrypt, notify = async () => {}, now = Date.now, ttlMin = 30, publicUrl = "" }) {
    const ttl = ttlMin * 60e3;
    const all = () => (store.data.orders ||= []);
    const isActive = (o) => o.status === "pending" || o.status === "claimed";
    const rate = [];

    function sweep() {
        const t = now(); let changed = false;
        for (const o of all()) {
            if ((o.status === "pending" && o.expiresAt <= t) || (o.status === "claimed" && o.claimedAt + CLAIMED_HOLD_MS <= t)) { o.status = "expired"; o.endedAt = t; changed = true; }
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

    function view(o, withKey = false) {
        const v = { id: o.id, code: o.code, type: o.type, packageName: PACKAGES[o.type]?.name || o.type, days: o.days, amount: o.amount, status: o.status, createdAt: o.createdAt, expiresAt: o.expiresAt };
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

    function create({ type, name, contact }) {
        sweep();
        const pkg = PACKAGES[type];
        if (!pkg) throw new OrderError("Paket tidak dikenal.");
        const nm = clean(name, 40), ct = clean(contact, 60);
        if (nm.length < 2) throw new OrderError("Nama minimal 2 huruf.");
        if (ct.length < 3) throw new OrderError("Isi kontak WhatsApp atau Discord supaya kamu bisa dihubungi.");
        const t = now();
        while (rate.length && rate[0] <= t - RATE_WINDOW) rate.shift();
        if (rate.length >= RATE_MAX) throw new OrderError("Terlalu banyak pesanan dalam waktu singkat. Coba lagi beberapa menit lagi.", 429);
        const act = all().filter(isActive), pend = act.filter((o) => o.status === "pending");
        if (pend.length >= MAX_PENDING) throw new OrderError("Pesanan sedang ramai. Coba lagi sebentar lagi.", 429);
        if (pend.filter((o) => o.contact.toLowerCase() === ct.toLowerCase()).length >= MAX_PER_CONTACT)
            throw new OrderError("Kamu masih punya beberapa pesanan yang belum dibayar. Selesaikan atau tunggu kedaluwarsa dulu.", 429);
        const used = new Set(act.map((o) => o.amount));
        let unique = 0;
        for (let i = 0; i < 80 && !unique; i++) { const u = 1 + crypto.randomInt(MAX_UNIQUE); if (!used.has(pkg.price + u)) unique = u; }
        if (!unique) throw new OrderError("Sistem sedang penuh. Coba lagi sebentar lagi.", 503);
        rate.push(t);
        const token = crypto.randomBytes(24).toString("hex");
        const o = { id: crypto.randomBytes(6).toString("hex"), code: newCode(), type, name: nm, contact: ct, days: pkg.days, price: pkg.price, amount: pkg.price + unique,
                    status: "pending", tokenHash: sha(token), createdAt: t, expiresAt: t + ttl };
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
        o.status = "claimed"; o.claimedAt = now(); store.save();
        const text = [`💰 Pesanan menunggu dicek`, `Kode: ${o.code}`, `Paket: ${PACKAGES[o.type]?.name} ${o.days} hari`, `Nominal: ${rp(o.amount)}`, `Pembeli: ${o.name} (${o.contact})`,
                      `Cek mutasi DANA, lalu konfirmasi di halaman admin.`, publicUrl ? publicUrl.replace(/\/+$/, "") + "/admin.html" : ""].filter(Boolean).join("\n");
        Promise.resolve(notify({ title: "Pesanan baru menunggu dicek", text, url: publicUrl ? publicUrl.replace(/\/+$/, "") + "/admin.html" : "" })).catch(() => {});
        return view(o);
    }

    const adminView = (o) => ({ ...view(o), name: o.name, contact: o.contact, claimedAt: o.claimedAt || null, confirmedAt: o.confirmedAt || null });
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
        const key = issueLicense(o.name, o.type, o.days, { save: false });
        const t = now();
        o.status = "done"; o.confirmedAt = t; o.endedAt = t; o.keyEnc = encrypt({ key }); o.keyUntil = t + KEY_VISIBLE_MS;
        store.save(); // satu kali simpan: key dan pesanan berubah bersamaan
        return { order: adminView(o), key, already: false };
    }

    function reject(id) {
        sweep();
        const o = adminFind(id);
        if (o.status === "done") throw new OrderError("Pesanan sudah dikonfirmasi, tidak bisa ditolak.", 409);
        if (o.status !== "rejected") { o.status = "rejected"; o.endedAt = now(); store.save(); }
        return { order: adminView(o) };
    }

    return { create, get, claim, adminList, confirm, reject, PACKAGES, sweep };
}

module.exports = { createOrders, OrderError, PACKAGES, rp };
