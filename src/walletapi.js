// Rute HTTP wallet. Logika ada di src/wallet.js, adapter Autoko di src/autoko.js.
"use strict";
const crypto = require("crypto");
const express = require("express");
const { derive } = require("./crypto");
const { WalletError } = require("./walletdb");

// Token & secret per pembeli diturunkan dari MASTER_KEY, jadi tidak perlu disimpan dan ikut pindah bersama MASTER_KEY.
const internalToken = (licenseId) => derive("wallet-internal:" + licenseId).toString("hex");
const botHookSecret = (licenseId) => derive("wallet-hook:" + licenseId).toString("hex");
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Meneruskan "pembayaran sukses" ke bot pembeli lewat jalur /webhook yang sudah ada, ditandatangani HMAC dengan secret milik pembeli itu.
function createBotForwarder({ findLicense, isRunning }) {
    return async function forwardToBot(licenseId, payload) {
        const l = findLicense(licenseId);
        if (!l || !isRunning(l.id)) return false;
        const body = JSON.stringify(payload);
        const sig = crypto.createHmac("sha256", botHookSecret(l.id)).update(body).digest("hex");
        try {
            const r = await fetch(`http://127.0.0.1:${l.port}/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-signature": sig }, body, signal: AbortSignal.timeout(8000) });
            return r.ok;
        } catch { return false; }
    };
}

// Permintaan dari bot datang langsung ke 127.0.0.1. Yang lewat proxy (Railway/nginx) selalu membawa header ini, jadi ditolak.
const directOnly = (req) => !["x-forwarded-for", "x-real-ip", "forwarded", "x-forwarded-host"].some((h) => req.headers[h]);

function errorResponder(res) {
    return (e) => {
        if (e instanceof WalletError) return res.status(e.status).json({ error: e.message });
        console.error("[WALLET]", e);
        res.status(500).json({ error: "Terjadi kesalahan di server." });
    };
}

// Webhook dari Autoko. Dipasang SEBELUM express.json karena butuh isi mentah untuk cek signature.
// getOrders (opsional): dipakai untuk pembayaran key lewat /beli. Order berawalan "KO-" milik pesanan, "DP-" milik deposit wallet.
function registerWalletWebhook(app, { wallet, autoko, getOrders = () => null }) {
    app.post("/hook-autoko", express.raw({ type: "*/*", limit: "100kb" }), async (req, res) => {
        const orders = getOrders();
        const ordersOn = !!(orders && orders.autoEnabled());
        if (!wallet && !ordersOn) return res.sendStatus(503);
        if (!Buffer.isBuffer(req.body) || !req.body.length) return res.sendStatus(400);
        let ev;
        try { ev = autoko.verifyWebhook(req.body, req.headers); }
        catch (e) { if (e.status === 401) console.warn("[WALLET] webhook Autoko dengan signature tidak valid ditolak."); return res.sendStatus(e.status === 401 ? 401 : e.status === 503 ? 503 : 400); }
        if (!ev.paid) return res.sendStatus(200);
        if (ordersOn && orders.ownsRef(ev.orderId)) {
            try { orders.handlePaid({ orderId: ev.orderId, amount: ev.amount }); return res.sendStatus(200); }
            catch (e) { console.error("[ORDERS] gagal memproses webhook:", e.message); return res.sendStatus(500); }
        }
        if (!wallet) { console.warn("[ORDERS] webhook untuk order tidak dikenal:", ev.orderId); return res.sendStatus(200); }
        try {
            const r = await wallet.handlePaid({ orderId: ev.orderId, amount: ev.amount, providerRef: ev.providerRef }, { background: true });
            if (!r.ok && r.reason === "unknown_order") console.warn("[WALLET] webhook untuk order tidak dikenal:", ev.orderId);
            res.sendStatus(200); // 200 juga untuk order tak dikenal / duplikat, supaya Autoko tidak mengulang tanpa henti
        } catch (e) { console.error("[WALLET] gagal memproses webhook:", e.message); res.sendStatus(500); } // 500 = minta Autoko mengulang
    });
}

function registerWalletRoutes(app, { wallet, autoko, buyer, admin, licenses, findLicense, valid, store, qr }) {
    const QRCode = qr || require("qrcode");
    const send = (res) => errorResponder(res);
    const h = (fn) => async (req, res) => { res.setHeader("Cache-Control", "no-store"); try { res.json(await fn(req)); } catch (e) { send(res)(e); } };
    const modeOf = (l) => (l.paymentMode === "auto" ? "auto" : "manual");

    // ---- API internal untuk bot milik pembeli ----
    const rate = new Map();
    const tooFast = (id) => { const t = Date.now(), a = (rate.get(id) || []).filter((x) => x > t - 60e3); a.push(t); rate.set(id, a); return a.length > 30; };
    app.post("/internal/wallet/deposit", async (req, res) => {
        if (!directOnly(req)) return res.sendStatus(404);
        const id = String(req.headers["x-license-id"] || "");
        const l = findLicense(id);
        const tok = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        if (!l || !safeEq(tok, internalToken(id))) return res.sendStatus(401);
        if (l.type === "service" || !valid(l)) return res.status(403).json({ error: "Key tidak aktif." });
        if (l.runMode === "central") return res.status(409).json({ error: "Gunakan perintah isi saldo di bot GevraStore." });
        if (modeOf(l) === "manual") return res.json({ mode: "manual" });
        if (!wallet) return res.status(503).json({ error: "Pembayaran otomatis belum aktif." });
        if (tooFast(id)) return res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi sebentar lagi." });
        try {
            const d = await wallet.createDeposit({ licenseId: l.id, amount: req.body?.amount, discordId: req.body?.discordId });
            const qrPng = d.qrString ? (await QRCode.toBuffer(d.qrString, { type: "png", width: 512, margin: 2 })).toString("base64") : null;
            res.json({ mode: "auto", orderId: d.orderId, amount: d.amount, expiresAt: d.expiresAt, qrPng, qrImageUrl: d.qrImageUrl });
        } catch (e) { send(res)(e); }
    });

    // ---- Rute pembeli ----
    const storeOnly = (req, res, next) => (req.lic.type === "service" ? res.status(403).json({ error: "Fitur ini hanya untuk key AutoStore." }) : next());
    const needWallet = (req, res, next) => (wallet ? next() : res.status(503).json({ error: "Fitur pembayaran otomatis belum diaktifkan oleh penjual." }));
    const B = [buyer, storeOnly];

    app.get("/api/wallet/summary", ...B, h(async (req) => {
        if (!wallet) return { enabled: false };
        return { enabled: true, ...(await wallet.summary(req.lic.id, { mode: modeOf(req.lic), frozen: !!req.lic.walletFrozen })) };
    }));
    app.get("/api/wallet/transactions", ...B, needWallet, h(async (req) => ({ transactions: await wallet.listDeposits(req.lic.id, { limit: Number(req.query.limit) || 50 }) })));
    app.get("/api/wallet/withdrawals", ...B, needWallet, h(async (req) => ({ withdrawals: await wallet.listWithdrawals(req.lic.id) })));
    app.put("/api/wallet/bank", ...B, needWallet, h(async (req) => ({ bank: await wallet.setBank(req.lic.id, req.body || {}) })));
    app.post("/api/wallet/withdraw", ...B, needWallet, h(async (req) => ({ withdrawal: await wallet.requestWithdrawal({ licenseId: req.lic.id, buyer: req.lic.buyer, amount: req.body?.amount }) })));
    app.put("/api/wallet/mode", ...B, h(async (req) => {
        const mode = req.body?.mode === "auto" ? "auto" : req.body?.mode === "manual" ? "manual" : null;
        if (!mode) throw new WalletError("Mode harus manual atau auto.");
        if (mode === "auto" && (!wallet || !autoko.enabled)) throw new WalletError("QRIS otomatis belum tersedia. Hubungi penjual.", 503);
        req.lic.paymentMode = mode; store.save();
        return { mode };
    }));

    // ---- Rute admin ----
    const A = [admin, needWallet];
    app.get("/api/admin/wallet/overview", admin, h(async () => (wallet ? { enabled: true, ...(await wallet.adminOverview()) } : { enabled: false })));
    app.get("/api/admin/withdrawals", ...A, h(async (req) => {
        const names = new Map(licenses().map((l) => [l.id, l.buyer]));
        const rows = await wallet.adminWithdrawals({ status: ["pending", "paid", "rejected", "all"].includes(req.query.status) ? req.query.status : "pending" });
        return { withdrawals: rows.map((w) => ({ ...w, buyer: names.get(w.licenseId) || w.buyer })) };
    }));
    app.post("/api/admin/withdrawals/:id/paid", ...A, h((req) => wallet.adminComplete(req.params.id, { reference: req.body?.reference })));
    app.post("/api/admin/withdrawals/:id/reject", ...A, h((req) => wallet.adminReject(req.params.id, { reason: req.body?.reason })));
    app.post("/api/admin/wallet/reconcile", ...A, h(async (req) => ({ diffs: await wallet.reconcile(null, { fix: !!req.body?.fix }), fixed: !!req.body?.fix })));
    app.post("/api/admin/licenses/:id/wallet-freeze", admin, h((req) => {
        const l = findLicense(req.params.id);
        if (!l) throw new WalletError("Tidak ditemukan.", 404);
        l.walletFrozen = !!req.body?.frozen; store.save();
        return { ok: true, frozen: l.walletFrozen };
    }));
    // Khusus uji coba (AUTOKO_MODE=mock): pura-pura QRIS sudah dibayar.
    app.post("/api/admin/wallet/mock-pay", ...A, h(async (req) => {
        if (autoko.mode !== "mock") throw new WalletError("Hanya tersedia di mode mock.", 403);
        autoko.mockPay(String(req.body?.orderId || ""));
        return wallet.handlePaid({ orderId: String(req.body?.orderId || "") });
    }));
}

module.exports = { registerWalletWebhook, registerWalletRoutes, createBotForwarder, internalToken, botHookSecret };
