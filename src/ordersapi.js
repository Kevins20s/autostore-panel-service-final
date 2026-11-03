// Rute HTTP untuk pesanan key. Logika ada di src/orders.js.
// Kalau Autoko aktif, POST /api/orders sekaligus membuat QRIS dinamis.
"use strict";
const QRCode = require("qrcode");
const { OrderError } = require("./orders");

// Cache PNG QRIS (base64) di memori. data.json TIDAK menyimpan PNG (bengkak).
// 100 order × ~50KB = ~5MB, aman untuk puluhan pembeli.
const qrPngCache = new Map();
async function getQrPng(orderDoc) {
    if (!orderDoc || !orderDoc.qrString) return null;
    if (qrPngCache.has(orderDoc.id)) return qrPngCache.get(orderDoc.id);
    const png = (await QRCode.toBuffer(orderDoc.qrString, { type: "png", width: 512, margin: 2 })).toString("base64");
    qrPngCache.set(orderDoc.id, png);
    return png;
}

module.exports = function registerOrderRoutes(app, { admin, orders, autoko, ttlMin = 30 }) {
    const fail = (res) => (e) => {
        if (e instanceof OrderError) return res.status(e.status).json({ error: e.message });
        console.error("[ORDERS]", e);
        res.status(500).json({ error: "Terjadi kesalahan di server." });
    };
    const h = (fn) => (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        try { res.json(fn(req)); } catch (e) { fail(res)(e); }
    };
    const tok = (req) => String(req.headers["x-order-token"] || "");

    app.get("/beli", (req, res) => res.redirect("/beli.html"));

    app.get("/api/shop-info", h(() => ({
        packages: Object.values(orders.PACKAGES).map(({ id, name, days, price }) => ({ id, name, days, price })),
        qris: "/qris.png",
        ttlMin,
        autoQris: !!(autoko && autoko.enabled),
    })));

    // POST /api/orders — buat order, lalu coba buat QRIS dinamis kalau Autoko aktif.
    // Kalau Autoko gagal, order tetap pending dengan provider="manual" → frontend pakai /qris.png.
    app.post("/api/orders", async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        try {
            const { token, order } = orders.create(req.body || {});

            let qrPngBase64 = null;
            if (autoko && autoko.enabled) {
                try {
                    const q = await autoko.createQris({
                        orderId: order.id,
                        amount: order.amount,
                        expiresAt: order.expiresAt,
                    });
                    const updated = orders.attachPayment(order.id, {
                        provider: "autoko",
                        autokoOrderId: q.providerRef,
                        qrString: q.qrString,
                        qrImageUrl: q.qrImageUrl,
                    });
                    if (q.qrString) {
                        qrPngBase64 = (await QRCode.toBuffer(q.qrString, { type: "png", width: 512, margin: 2 })).toString("base64");
                        qrPngCache.set(order.id, qrPngBase64);
                    }
                    Object.assign(order, updated);
                } catch (e) {
                    console.warn("[ORDERS] Autoko gagal, fallback manual:", e.message);
                    // order tetap pending dengan provider="manual"; beli.js pakai /qris.png
                }
            }

            const fresh = orders.get(order.id, token);
            if (qrPngBase64) fresh.qrPngBase64 = qrPngBase64;
            res.json({ token, order: fresh });
        } catch (e) { fail(res)(e); }
    });

    // GET /api/orders/:id — kalau masih pending & provider=autoko, sertakan PNG QR.
    // Cache in-memory supaya polling tidak bolak-balik encode QR.
    app.get("/api/orders/:id", async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        try {
            const v = orders.get(req.params.id, tok(req));
            if (v.status === "pending" && v.provider === "autoko") {
                const raw = orders.findById(v.id);
                const png = await getQrPng(raw);
                if (png) v.qrPngBase64 = png;
            }
            res.json({ order: v });
        } catch (e) { fail(res)(e); }
    });

    app.post("/api/orders/:id/paid", h((req) => ({ order: orders.claim(req.params.id, tok(req)) })));

    app.get("/api/admin/orders", admin, h(() => ({ orders: orders.adminList() })));
    app.post("/api/admin/orders/:id/confirm", admin, h((req) => orders.confirm(req.params.id)));
    app.post("/api/admin/orders/:id/reject", admin, h((req) => orders.reject(req.params.id)));
};
