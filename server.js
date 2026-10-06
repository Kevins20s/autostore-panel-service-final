// DNS publik untuk pengecekan MongoDB (mongodb+srv). Isi di .env, contoh: DNS_SERVERS=8.8.8.8,1.1.1.1
// Harus dijalankan paling awal, sebelum modul lain memakai DNS.
if (process.env.DNS_SERVERS) {
    try {
        const dns = require("dns");
        dns.setServers(process.env.DNS_SERVERS.split(",").map((s) => s.trim()).filter(Boolean));
        console.log("[PANEL] DNS:", dns.getServers().join(", "));
    } catch (e) { console.error("[PANEL] DNS_SERVERS tidak valid:", e.message); }
}

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { createBackup } = require("./src/backup");
const { createStore } = require("./src/store");
const { encrypt, decrypt, sha256 } = require("./src/crypto");
const auth = require("./src/auth");
const { checkDiscord, checkMongo } = require("./src/validate");
const { Runner } = require("./src/runner");
const createShopRouter = require("./src/shopapi");
const { closeConn } = require("./src/shopdb");
const { getServiceDb, closeServiceDb, closeAllServiceDb } = require("./src/servicedb");
const { JASA_TYPES, getJasaTypeKeys } = require("./service/src/utils/jasaTypes.js");

const PORT = Number(process.env.PANEL_PORT || process.env.PORT || 8080); // Railway mengisi PORT otomatis
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SKIP_VALIDATE = process.env.SKIP_VALIDATE === "1"; // hanya untuk tes
const DAY = 86400000;

if (ADMIN_PASSWORD.length < 8) { console.error("ADMIN_PASSWORD wajib diisi (minimal 8 karakter)."); process.exit(1); }
require("./src/crypto").encrypt({}); // gagal cepat kalau MASTER_KEY salah

const fs = require("fs");
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const store = createStore(DATA_FILE);
const backup = createBackup({ file: DATA_FILE, url: process.env.BACKUP_WEBHOOK_URL });
const runner = new Runner(
    process.env.BOT_DIR || path.join(__dirname, "bot"),
    process.env.SERVICE_DIR || path.join(__dirname, "service")
);
const licenses = () => store.data.licenses;

// ---------- helpers ----------
const valid = (l) => !l.revoked && l.expiresAt > Date.now();
const FIELDS = ["botToken", "clientId", "mongoUrl", "ownerId", "adminIds", "guildId", "paymentUrl", "paymentApiKey", "paymentSecret"];
const SECRET = new Set(["botToken", "mongoUrl", "paymentApiKey", "paymentSecret"]);
const isId = (v) => /^\d{17,20}$/.test(v);

function newKey(type = "autostore") {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const g = () => Array.from(crypto.randomBytes(4), (b) => A[b % A.length]).join("");
    const prefix = type === "service" ? "SV" : "AS";
    return `${prefix}-${g()}-${g()}-${g()}-${g()}`;
}

// Jalankan/hentikan bot sesuai kondisi lisensi (dipanggil berkala & setelah perubahan)
function reconcile(l) {
    const shouldRun = l.desired === "running" && valid(l) && !!l.config;
    const st = runner.status(l.id);
    if (shouldRun && st === "stopped") runner.start(l.id, decrypt(l.config), l.port, l.type || "autostore");
    else if (!shouldRun && st !== "stopped") runner.stop(l.id);
}

// Express 4 tidak menangkap error dari handler async; bungkus supaya masuk ke error handler, bukan bikin panel mati
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- app ----------
const app = express();
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'");
    next();
});

// Webhook payment pembeli -> diteruskan ke bot miliknya (port bot tidak perlu dibuka ke internet)
app.post("/hook/:id", express.raw({ type: "*/*", limit: "100kb" }), async (req, res) => {
    const l = licenses().find((x) => x.id === req.params.id);
    if (!l || runner.status(l.id) !== "running") return res.sendStatus(404);
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.sendStatus(400);
    try {
        const r = await fetch(`http://127.0.0.1:${l.port}/webhook`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-webhook-signature": req.headers["x-webhook-signature"] || "" },
            body: req.body,
            signal: AbortSignal.timeout(8000),
        });
        res.sendStatus(r.status);
    } catch { res.sendStatus(502); }
});

app.use(express.static(path.join(__dirname, "public")));

const buyer = (req, res, next) => {
    const s = auth.session(req);
    const l = s?.t === "buyer" && licenses().find((x) => x.id === s.id);
    if (!l) return res.status(401).json({ error: "Belum login." });
    req.lic = l;
    next();
};
const admin = (req, res, next) =>
    auth.session(req)?.t === "admin" ? next() : res.status(401).json({ error: "Belum login admin." });

// ---------- backup & restore (admin). Dipasang sebelum parser JSON global karena file bisa besar ----------
app.get("/api/admin/backup", admin, (req, res) => {
    if (!fs.existsSync(DATA_FILE)) return res.status(404).json({ error: "data.json belum ada." });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", 'attachment; filename="data.json"');
    res.send(fs.readFileSync(DATA_FILE));
});
app.get("/api/admin/backup/status", admin, (req, res) => res.json(backup.status()));
app.post("/api/admin/backup/send", admin, wrap(async (req, res) => {
    try { await backup.send("manual"); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
}));
app.post("/api/admin/restore", admin, express.raw({ type: "*/*", limit: "5mb" }), wrap(async (req, res) => {
    let d;
    try { d = JSON.parse(Buffer.from(req.body).toString("utf8")); } catch { return res.status(400).json({ error: "File bukan JSON yang valid." }); }
    if (!d || !Array.isArray(d.licenses) || !Number.isFinite(d.nextPort) || d.licenses.some((l) => !l || !l.id || !l.buyer))
        return res.status(400).json({ error: "Isi file bukan backup data.json panel ini." });
    licenses().forEach((l) => runner.stop(l.id));
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + ".bak"); // jaga-jaga kalau salah file
    Object.keys(store.data).forEach((k) => delete store.data[k]);
    Object.assign(store.data, d);
    store.save();
    licenses().forEach(reconcile); // bot yang seharusnya hidup akan dinyalakan lagi (sisanya oleh pemeriksa berkala)
    res.json({ ok: true, count: licenses().length });
}));

// API toko: login dulu, baru body (maks 2MB) diproses, supaya upload stok besar tidak bisa dipakai orang luar
app.use("/api/shop", buyer, (req, res, next) => req.lic.type === "service" ? res.status(403).json({ error: "Fitur toko AutoStore tidak tersedia untuk key Service." }) : next(), express.json({ limit: "2mb" }), createShopRouter({ valid, decrypt }));
app.use(express.json({ limit: "20kb" }));

// ---------- pembeli ----------
app.post("/api/login", (req, res) => {
    if (auth.tooMany(req.ip)) return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi 10 menit lagi." });
    const key = String(req.body?.key || "").trim().toUpperCase();
    const l = key && licenses().find((x) => x.keyHash === sha256(key));
    if (!l) { auth.recordFail(req.ip); return res.status(401).json({ error: "Key tidak ditemukan." }); }
    auth.clearFails(req.ip);
    auth.setSession(res, { t: "buyer", id: l.id });
    res.json({ ok: true, type: l.type || "autostore" });
});

app.post("/api/logout", (req, res) => { auth.clearSession(res); res.json({ ok: true }); });

app.get("/api/me", buyer, (req, res) => {
    const l = req.lic;
    const c = l.config ? decrypt(l.config) : {};
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    res.json({
        buyer: l.buyer,
        type: l.type || "autostore",
        keyPrefix: l.keyPrefix,
        expiresAt: l.expiresAt,
        daysLeft: Math.max(0, Math.ceil((l.expiresAt - Date.now()) / DAY)),
        revoked: l.revoked,
        valid: valid(l),
        bot: runner.status(l.id),
        desired: l.desired,
        webhookUrl: `${base}/hook/${l.id}`,
        config: {
            clientId: c.clientId || "", ownerId: c.ownerId || "", adminIds: c.adminIds || "",
            guildId: c.guildId || "", paymentUrl: c.paymentUrl || "",
            has: { botToken: !!c.botToken, mongoUrl: !!c.mongoUrl, paymentApiKey: !!c.paymentApiKey, paymentSecret: !!c.paymentSecret },
        },
    });
});

app.put("/api/config", buyer, wrap(async (req, res) => {
    const l = req.lic;
    const cur = l.config ? decrypt(l.config) : {};
    const next = { ...cur };
    for (const k of FIELDS) {
        if (typeof req.body?.[k] !== "string") continue;
        const v = req.body[k].trim();
        if (SECRET.has(k)) { if (v) next[k] = v; } else next[k] = v; // secret: kosong = tidak diubah
    }
    const err = (m) => res.status(400).json({ error: m });
    for (const [k, label] of [["botToken", "Bot token"], ["clientId", "Client ID"], ["mongoUrl", "MongoDB URL"], ["ownerId", "Owner ID"]])
        if (!next[k]) return err(`${label} wajib diisi.`);
    if (!isId(next.clientId)) return err("Client ID harus berupa angka (ID Discord).");
    if (!isId(next.ownerId)) return err("Owner ID harus berupa angka (ID Discord).");
    if (next.guildId && !isId(next.guildId)) return err("ID server harus berupa angka.");
    if (next.adminIds && !next.adminIds.split(",").every((x) => isId(x.trim()))) return err("Admin ID harus angka dipisah koma.");
    if (!/^mongodb(\+srv)?:\/\//.test(next.mongoUrl)) return err("MongoDB URL harus diawali mongodb:// atau mongodb+srv://");
    try {
        if (!SKIP_VALIDATE) { await checkDiscord(next.botToken, next.clientId); await checkMongo(next.mongoUrl); }
    } catch (e) { return err(e.message); }
    l.config = encrypt(next);
    closeConn(l.id);
    await closeServiceDb(l.id);
    store.save();
    res.json({ ok: true, restartNeeded: runner.status(l.id) !== "stopped" });
}));

const botAction = (action) => wrap(async (req, res) => {
    const l = req.lic;
    if (action !== "stop") {
        if (!valid(l)) return res.status(403).json({ error: "Key sudah habis atau dicabut." });
        if (!l.config) return res.status(400).json({ error: "Isi pengaturan dulu sebelum menjalankan bot." });
    }
    if (action === "stop") { l.desired = "stopped"; await runner.stop(l.id); }
    if (action === "restart" || runner.status(l.id) === "crashed") { await runner.stop(l.id); }
    if (action !== "stop") { l.desired = "running"; reconcile(l); }
    store.save();
    res.json({ ok: true });
});
app.post("/api/bot/start", buyer, botAction("start"));
app.post("/api/bot/stop", buyer, botAction("stop"));
app.post("/api/bot/restart", buyer, botAction("restart"));
app.get("/api/logs", buyer, (req, res) => res.json({ lines: runner.logs(req.lic.id).slice(-100) }));

// ---------- AutoStore Service management (web) ----------
function serviceOnly(req, res, next) {
    if (req.lic.type !== "service") return res.status(403).json({ error: "Fitur ini hanya untuk key Service." });
    next();
}

function serviceMongo(l) {
    if (!l.config) throw new Error("Isi konfigurasi bot Service terlebih dahulu.");
    const cfg = decrypt(l.config);
    if (!cfg.mongoUrl) throw new Error("MongoDB URL belum diatur.");
    return getServiceDb(l.id, cfg.mongoUrl);
}

app.get("/api/service/settings", buyer, serviceOnly, wrap(async (req, res) => {
    const db = await serviceMongo(req.lic);
    const configs = await db.collection("jasaconfigs").find({}).toArray();
    const byType = Object.fromEntries(configs.map((x) => [x.type, x]));
    res.json({
        services: getJasaTypeKeys().map((type) => {
            const def = JASA_TYPES[type];
            const cfg = byType[type] || {};
            return {
                type,
                label: def.label,
                unit: def.unit,
                blockSize: def.blockSize || null,
                defaultPrice: def.defaultPrice,
                status: cfg.status === "OPEN" ? "OPEN" : "CLOSE",
                price: Number.isFinite(cfg.price) ? cfg.price : def.defaultPrice,
                completed: Number(cfg.completed || 0),
            };
        }),
    });
}));

app.put("/api/service/settings", buyer, serviceOnly, wrap(async (req, res) => {
    const db = await serviceMongo(req.lic);
    const updates = Array.isArray(req.body?.services) ? req.body.services : [];
    if (!updates.length) return res.status(400).json({ error: "Tidak ada perubahan jasa." });

    const allowed = new Set(getJasaTypeKeys());
    const ops = [];
    for (const item of updates) {
        const type = String(item?.type || "").trim();
        if (!allowed.has(type)) continue;
        const def = JASA_TYPES[type];
        const status = item?.status === "OPEN" ? "OPEN" : item?.status === "CLOSE" ? "CLOSE" : null;
        const price = Number(String(item?.price ?? "").replace(",", "."));
        if (status === null) return res.status(400).json({ error: `Status ${type} tidak valid.` });
        if (!Number.isFinite(price) || price < 0 || price > 1000000000) return res.status(400).json({ error: `Harga ${type} tidak valid.` });
        ops.push({
            updateOne: {
                filter: { type },
                update: { $set: { type, status, price }, $setOnInsert: { completed: 0, ...(def.defaultPrice != null ? {} : {}) } },
                upsert: true,
            },
        });
    }
    if (!ops.length) return res.status(400).json({ error: "Tidak ada jasa yang valid." });
    await db.collection("jasaconfigs").bulkWrite(ops, { ordered: true });
    res.json({ ok: true, message: "Pengaturan jasa tersimpan." });
}));

// ---------- admin (kamu) ----------
app.post("/api/admin/login", (req, res) => {
    if (auth.tooMany(req.ip)) return res.status(429).json({ error: "Terlalu banyak percobaan." });
    const a = Buffer.from(sha256(String(req.body?.password || ""))), b = Buffer.from(sha256(ADMIN_PASSWORD));
    if (!crypto.timingSafeEqual(a, b)) { auth.recordFail(req.ip); return res.status(401).json({ error: "Password salah." }); }
    auth.clearFails(req.ip);
    auth.setSession(res, { t: "admin" }, 8);
    res.json({ ok: true });
});

const row = (l) => ({
    id: l.id, buyer: l.buyer, type: l.type || "autostore", keyPrefix: l.keyPrefix, expiresAt: l.expiresAt, revoked: l.revoked,
    configured: !!l.config, bot: runner.status(l.id),
});
app.get("/api/admin/licenses", admin, (req, res) => res.json({ licenses: licenses().map(row) }));

app.post("/api/admin/licenses", admin, (req, res) => {
    const name = String(req.body?.buyer || "").trim().slice(0, 60);
    const days = Math.min(3650, Math.max(1, Math.floor(Number(req.body?.days) || 30)));
    if (!name) return res.status(400).json({ error: "Nama pembeli wajib diisi." });
    const type = req.body?.type === "service" ? "service" : "autostore";
    const key = newKey(type);
    licenses().push({
        id: crypto.randomBytes(8).toString("hex"), buyer: name, type, keyHash: sha256(key), keyPrefix: key.slice(0, 7),
        createdAt: Date.now(), expiresAt: Date.now() + days * DAY, revoked: false,
        port: store.data.nextPort++, config: null, desired: "stopped",
    });
    store.save();
    res.json({ key }); // key asli hanya ditampilkan SEKALI ini
});

const find = (req, res) => {
    const l = licenses().find((x) => x.id === req.params.id);
    if (!l) res.status(404).json({ error: "Tidak ditemukan." });
    return l;
};
app.post("/api/admin/licenses/:id/extend", admin, (req, res) => {
    const l = find(req, res); if (!l) return;
    const days = Math.min(3650, Math.max(1, Math.floor(Number(req.body?.days) || 30)));
    l.expiresAt = Math.max(l.expiresAt, Date.now()) + days * DAY; // kalau sudah habis, hitung dari sekarang
    store.save(); reconcile(l); res.json({ ok: true });
});
app.post("/api/admin/licenses/:id/revoke", admin, (req, res) => {
    const l = find(req, res); if (!l) return;
    l.revoked = !!req.body?.revoked;
    store.save(); reconcile(l); res.json({ ok: true });
});
app.delete("/api/admin/licenses/:id", admin, wrap(async (req, res) => {
    const l = find(req, res); if (!l) return;
    await runner.stop(l.id);
    closeConn(l.id);
    await closeServiceDb(l.id);
    store.data.licenses = licenses().filter((x) => x !== l);
    store.save(); res.json({ ok: true });
}));

// error handler terakhir: balas JSON rapi, jangan bocorkan detail internal
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error("[PANEL] error:", err);
    res.status(status).json({ error: status === 500 ? "Terjadi kesalahan di server." : err.message });
});

// ---------- start ----------
const WATCH_MS = Number(process.env.WATCH_MS || 60000);
setInterval(() => licenses().forEach(reconcile), WATCH_MS).unref();
if (backup.enabled()) backup.schedule(process.env.BACKUP_EVERY_HOURS);
if (backup.enabled()) setTimeout(() => backup.send("server start").catch((e) => console.error("[BACKUP]", e.message)), 15000).unref();
licenses().forEach(reconcile); // hidupkan lagi bot yang seharusnya jalan setelah server restart

// Di belakang proxy/tunnel, hanya terima koneksi dari server sendiri: port 8080 tidak bisa diakses langsung
// lewat IP (kalau bisa, orang bisa memalsukan header X-Forwarded-For untuk menghindari pembatas login).
const HOST = process.env.PANEL_HOST || (process.env.TRUST_PROXY === "1" ? "127.0.0.1" : "0.0.0.0");
const server = app.listen(PORT, HOST, () => console.log(`[PANEL] jalan di ${HOST}:${PORT}`));
server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `Port ${PORT} sudah dipakai. Panel lama mungkin masih jalan, tutup dulu lalu coba lagi.` : e);
    process.exit(1);
});

// Satu error tak terduga jangan sampai mematikan panel dan semua bot pembeli
process.on("unhandledRejection", (e) => console.error("[PANEL] unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("[PANEL] uncaughtException:", e));

let closing = false;
async function shutdown() {
    if (closing) return;
    closing = true;
    setTimeout(() => process.exit(1), 10000).unref(); // jangan menggantung kalau ada yang macet
    server.close();
    try { await Promise.all(licenses().map((l) => runner.stop(l.id))); await closeAllServiceDb(); } catch (e) { console.error(e); }
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
