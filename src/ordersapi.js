// Rute HTTP untuk pesanan key. Logika ada di src/orders.js.
"use strict";
const crypto = require("crypto");
const { OrderError } = require("./orders");
const { getLiveWLPrice } = require("../bot/src/utils/gtidPrice");
const discordInvite = "https://discord.gg/ffU9Q6bagA";

// Kunci pengunjung = HMAC dari IP, jadi IP asli tidak tersimpan di data.json.
// IP lokal (127.0.0.1 / ::1) dilewati: itu tanda panel ada di belakang tunnel/proxy tanpa TRUST_PROXY=1, jadi semua pengunjung
// tampak berasal dari satu IP. Daripada membatasi seluruh situs sekaligus, batas per IP dimatikan dan batas global tetap berlaku.
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
function makeIpKey() {
    let secret;
    try { secret = require("./crypto").derive("order-ip"); } catch { secret = Buffer.from("order-ip-fallback"); }
    return (req) => (req.ip && !LOOPBACK.has(String(req.ip)) ? crypto.createHmac("sha256", secret).update(String(req.ip)).digest("hex").slice(0, 16) : "");
}

module.exports = function registerOrderRoutes(app, { admin, buyer = null, orders, ttlMin = 30, turnstile = null, ipKey = makeIpKey(), liveRate = getLiveWLPrice }) {
    let rate;
    let loadingRate;
    async function getRate() {
        if (rate?.expiresAt > Date.now()) return rate;
        if (!loadingRate) {
            loadingRate = Promise.resolve().then(liveRate).then(({ pricePerDL }) => {
                if (!Number.isFinite(pricePerDL) || pricePerDL <= 0) throw new Error("Invalid DL rate");
                return (rate = { pricePerDL, expiresAt: Date.now() + 60000 });
            }).catch(() => { throw new OrderError("Kurs DL belum tersedia. Coba lagi atau pilih QRIS.", 503); })
                .finally(() => { loadingRate = null; });
        }
        return loadingRate;
    }
    const fail = (res) => (e) => {
        if (e instanceof OrderError || e?.expose) return res.status(e.status || 400).json({ error: e.message });
        console.error("[ORDERS]", e);
        res.status(500).json({ error: "Terjadi kesalahan di server." });
    };
    const h = (fn) => async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        try { res.json(await fn(req)); } catch (e) { fail(res)(e); }
    };
    const tok = (req) => String(req.headers["x-order-token"] || "");

    // Pesanan QRIS otomatis membawa teks QR; ubah jadi gambar PNG (data URI) supaya halaman /beli cukup menampilkannya.
    async function withQr(order) {
        if (order?.qrString?.startsWith("MOCKQRIS|")) {
            order.qrisSimulation = true;
        } else if (order && order.qrString) {
            try { order.qrPng = await require("qrcode").toDataURL(order.qrString, { width: 420, margin: 2 }); }
            catch (e) { console.error("[ORDERS] gagal membuat gambar QR:", e.message); }
        }
        if (order) delete order.qrString;
        return order;
    }
    const tryAuto = async (id) => {
        try { await orders.upgradeToAuto(id); }
        catch (e) { console.error("[ORDERS] QRIS otomatis gagal, pesanan memakai jalur manual:", e.message); }
    };

    app.get("/beli", (req, res) => res.redirect("/beli.html"));
    app.get("/api/checkout/dl-rate", h(getRate));

    app.get("/api/shop-info", h(() => ({
        packages: orders.packages({ sellable: true }).map(({ id, name, days, price, lifetime }) => ({ id, name, days, price, lifetime: !!lifetime })),
        qris: "/qris.png", ttlMin, auto: orders.autoEnabled(),
        discordInvite,
        turnstileSiteKey: turnstile && turnstile.enabled ? turnstile.siteKey : null,
    })));

    app.post("/api/orders", h(async (req) => {
        const body = req.body || {};
        const method = body.paymentMethod;
        if (method != null && method !== "dl" && method !== "qris") throw new OrderError("Metode pembayaran tidak dikenal.");
        if (turnstile && turnstile.enabled) await turnstile.verify(body.turnstileToken, req.ip);
        let pricePerDL;
        if (method === "dl") {
            const current = await getRate();
            if (current.pricePerDL !== body.pricePerDL) throw new OrderError("Kurs DL berubah. Periksa nominal terbaru sebelum lanjut.", 409);
            pricePerDL = current.pricePerDL;
        }
        if (method === "qris" && !orders.autoEnabled()) throw new OrderError("QRIS otomatis belum tersedia. Coba lagi nanti.", 503);
        const r = orders.create({ type: body.type, name: body.name, contact: body.contact, ip: ipKey(req) }, { pricePerDL });
        if (method === "qris") {
            try {
                if (!await orders.upgradeToAuto(r.order.id)) throw new OrderError("QRIS otomatis belum tersedia. Coba lagi nanti.", 503);
            } catch (error) {
                orders.reject(r.order.id);
                throw error?.expose ? error : new OrderError("QRIS otomatis belum tersedia. Coba lagi nanti.", 503);
            }
        } else if (method !== "dl") await tryAuto(r.order.id);
        return { token: r.token, order: await withQr(orders.get(r.order.id, r.token)) };
    }));
    app.get("/api/orders/:id", h(async (req) => ({ order: await withQr(orders.get(req.params.id, tok(req))) })));
    app.post("/api/orders/:id/paid", h((req) => ({ order: orders.claim(req.params.id, tok(req)) })));

    // Perpanjangan dari dalam panel (pembeli sudah login dengan key-nya).
    if (buyer) {
        app.get("/api/renew/options", buyer, h((req) => ({ packages: req.lic.lifetime ? [] : orders.renewPackages(req.lic.type || "autostore") })));
        app.post("/api/renew", buyer, h(async (req) => {
            const r = orders.createRenewal({ licenseId: req.lic.id, packageId: req.body?.packageId, ip: ipKey(req) });
            await tryAuto(r.order.id);
            return { id: r.order.id, token: r.token };
        }));
    }

    app.get("/api/admin/orders", admin, h(() => ({ orders: orders.adminList() })));
    app.post("/api/admin/orders/:id/confirm", admin, h((req) => orders.confirm(req.params.id)));
    app.post("/api/admin/orders/:id/reject", admin, h((req) => orders.reject(req.params.id)));
    app.delete("/api/admin/orders/:id", admin, h((req) => orders.removeRejected(req.params.id)));
    app.post("/api/admin/orders/:id/mock-pay", admin, h((req) => orders.mockPay(req.params.id)));
    app.get("/api/admin/packages", admin, h(() => ({ packages: orders.packages().filter(p => p.type !== "service"), auto: orders.autoEnabled(), mock: orders.isMock() })));
    app.put("/api/admin/packages/:id", admin, h((req) => {
        if (req.params.id === "service") throw new OrderError("AutoStore Service tidak lagi dijual.", 404);
        return { package: orders.setPackage(req.params.id, { price: req.body?.price, sellable: req.body?.sellable }) };
    }));
};
