// Rute HTTP untuk pesanan key. Logika ada di src/orders.js.
"use strict";
const { OrderError } = require("./orders");

module.exports = function registerOrderRoutes(app, { admin, orders, ttlMin = 30 }) {
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
        qris: "/qris.png", ttlMin,
    })));
    app.post("/api/orders", h((req) => orders.create(req.body || {})));
    app.get("/api/orders/:id", h((req) => ({ order: orders.get(req.params.id, tok(req)) })));
    app.post("/api/orders/:id/paid", h((req) => ({ order: orders.claim(req.params.id, tok(req)) })));

    app.get("/api/admin/orders", admin, h(() => ({ orders: orders.adminList() })));
    app.post("/api/admin/orders/:id/confirm", admin, h((req) => orders.confirm(req.params.id)));
    app.post("/api/admin/orders/:id/reject", admin, h((req) => orders.reject(req.params.id)));
};
