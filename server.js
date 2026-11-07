// Baca .env lebih dulu (aman kalau file tidak ada, variabel dari hosting tidak ditimpa).
require("./src/loadenv").loadEnv();

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
const { MongoClient } = require("mongodb");
const { createOrders, OrderError } = require("./src/orders");
const { createTurnstile } = require("./src/turnstile");
const { createWalletBackup } = require("./src/walletbackup");
const { createNotifier } = require("./src/notify");
const registerOrderRoutes = require("./src/ordersapi");
const { createWalletDb } = require("./src/walletdb");
const { createAutoko } = require("./src/autoko");
const { createWallet } = require("./src/wallet");
const { registerWalletWebhook, registerWalletRoutes, createBotForwarder, internalToken, botHookSecret } = require("./src/walletapi");

const PORT = Number(process.env.PANEL_PORT || process.env.PORT || 8080);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SKIP_VALIDATE = process.env.SKIP_VALIDATE === "1";
const DAY = 86400000;

if (ADMIN_PASSWORD.length < 8) { console.error("ADMIN_PASSWORD wajib diisi (minimal 8 karakter)."); process.exit(1); }
require("./src/crypto").encrypt({});

const fs = require("fs");
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const store = createStore(DATA_FILE);
const backup = createBackup({ file: DATA_FILE, url: process.env.BACKUP_WEBHOOK_URL });
const runner = new Runner(
    process.env.BOT_DIR || path.join(__dirname, "bot"),
    process.env.SERVICE_DIR || path.join(__dirname, "service"),
    {
        // Bot memanggil panel lewat alamat lokal. Token dan secret diturunkan dari MASTER_KEY per pembeli.
        extraEnv: (id, type) => type === "service" ? {} : {
            PANEL_INTERNAL_URL: `http://127.0.0.1:${PORT}`,
            PANEL_LICENSE_ID: id,
            PANEL_INTERNAL_TOKEN: internalToken(id),
            PANEL_WEBHOOK_SECRET: botHookSecret(id),
        },
        // Bot pembeli menyerah setelah crash berulang: kabari kamu lewat Telegram/ntfy/Discord (kalau notifikasi diaktifkan).
        onCrash: (id) => {
            const l = licenses().find((x) => x.id === id);
            const url = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, "") + "/admin.html" : "";
            return notifier({ title: "Bot pembeli crash", text: ["⚠️ Bot pembeli berhenti (crash berulang)", `Pembeli: ${l ? l.buyer : id}`, "Minta pembeli cek Bot & Server (token / MongoDB), lalu Start lagi.", url].filter(Boolean).join("\n"), url });
        },
    }
);
const licenses = () => store.data.licenses;

const valid = (l) => !l.revoked && l.expiresAt > Date.now();

// ---- Wallet / QRIS otomatis (aktif kalau WALLET_MONGO_URL diisi) ----
const numEnv = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" && Number.isFinite(Number(process.env[k])) ? Number(process.env[k]) : d);
const findLicense = (id) => licenses().find((x) => x.id === id);
const walletDb = createWalletDb();
const autoko = createAutoko();
const hostedMongoUrl = process.env.DISCORD_CATALOG_PILOT_MONGO_URL;
const creditHosted = require("./src/shared-deposit").createHostedCredit({ mongoUrl: hostedMongoUrl });
const forwardToBot = createBotForwarder({ findLicense, isRunning: (id) => runner.status(id) === "running" });
const wallet = walletDb.enabled ? createWallet({
    getCols: walletDb.getCols, autoko, forwardToBot, creditHosted, notify: createNotifier(), publicUrl: process.env.PUBLIC_URL || "",
    isFrozen: (id) => !!findLicense(id)?.walletFrozen,
    holdMs: numEnv("WALLET_HOLD_HOURS", 3) * 3600e3,
    feePercent: numEnv("WALLET_FEE_PERCENT", 0), feeFlat: numEnv("WALLET_FEE_FLAT", 0),
    minDeposit: numEnv("WALLET_MIN_DEPOSIT", 1000), maxDeposit: numEnv("WALLET_MAX_DEPOSIT", 5000000),
    depositTtlMs: numEnv("WALLET_DEPOSIT_TTL_MIN", 15) * 60e3,
    minWithdraw: numEnv("WALLET_MIN_WITHDRAW", 10000), withdrawFee: numEnv("WALLET_WITHDRAW_FEE", 0),
    bankCooldownMs: numEnv("WALLET_BANK_COOLDOWN_HOURS", 24) * 3600e3,
}) : null;
console.log("[PANEL] Wallet:", wallet ? `aktif (Autoko: ${autoko.mode})` : "nonaktif (isi WALLET_MONGO_URL untuk mengaktifkan)");
const walletBackup = wallet ? createWalletBackup({ getCols: walletDb.getCols, sendFile: backup.sendFile, enabled: backup.enabled }) : null;
const FIELDS = ["botToken", "clientId", "mongoUrl", "ownerId", "adminIds", "guildId", "paymentUrl", "paymentApiKey", "paymentSecret"];
const SECRET = new Set(["botToken", "mongoUrl", "paymentApiKey", "paymentSecret"]);
const isId = (v) => /^\d{17,20}$/.test(v);
const EMOJI_KEYS = ["WL","DL","BGL","CROWN","ARROW","EARTH","BOT","Dolar","BALANCE","Warning","Benar","Salah","Megaphone","Loading","Buy","SetGrowID","BalanceButton","Deposit","DepositQRIS","AdminPanel","Queue","Waiting","imageUrl","imageUrl2","COLOR"];
const AUTOSTORE_EMOJI_DEFAULTS = require("./bot/src/config/configemoji.json");
const SERVICE_EMOJI_DEFAULTS = require("./service/src/config/emoji.js").defaults;
const sanitizeEmojis = (input) => {
    const out = {};
    for (const k of EMOJI_KEYS) {
        if (typeof input?.[k] === "string" && input[k].trim()) out[k] = input[k].trim().slice(0, 500);
    }
    return out;
};

function newKey(type = "autostore") {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const g = () => Array.from(crypto.randomBytes(4), (b) => A[b % A.length]).join("");
    const prefix = type === "service" ? "SV" : "AS";
    return `${prefix}-${g()}-${g()}-${g()}-${g()}`;
}

// Dipakai pesanan web setelah admin konfirmasi. Isinya sama dengan rute admin "buat key".
function issueLicense(name, type, days, { save = true, lifetime = false } = {}) {
    const key = newKey(type);
    licenses().push({
        id: crypto.randomBytes(8).toString("hex"), buyer: name, type, keyHash: sha256(key), keyPrefix: key.slice(0, 7),
        createdAt: Date.now(), expiresAt: lifetime ? Date.UTC(9999, 11, 31) : Date.now() + days * DAY, revoked: false, lifetime,
        port: store.data.nextPort++, config: null, desired: "stopped",
    });
    if (save) store.save();
    return key;
}

function reconcile(l) {
    const shouldRun = l.runMode !== "central" && l.desired === "running" && valid(l) && !!l.config;
    const st = runner.status(l.id);
    if (shouldRun && st === "stopped") runner.start(l.id, decrypt(l.config), l.port, l.type || "autostore");
    else if (!shouldRun && st !== "stopped") runner.stop(l.id);
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Turnstile (CAPTCHA /beli): CSP hanya dilonggarkan kalau fiturnya diaktifkan.
const turnstile = createTurnstile();
const TS_CSP = turnstile.enabled ? " https://challenges.cloudflare.com" : "";

const app = express();
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    // Izinkan preview custom Discord emoji.
    const qrImages = req.path === "/beli.html" ? " https:" : "";
    res.setHeader("Content-Security-Policy", `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'${TS_CSP}; img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net${qrImages}${TS_CSP ? `; frame-src${TS_CSP}; connect-src 'self'${TS_CSP}` : ""}`);
    next();
});

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

registerWalletWebhook(app, { wallet, autoko, getOrders: () => orders });

app.use(express.static(path.join(__dirname, "public")));

const buyer = (req, res, next) => {
    const s = auth.session(req);
    const l = s?.t === "buyer" && s.via !== "discord" && licenses().find((x) => x.id === s.id);
    if (!l) return res.status(401).json({ error: "Belum login." });
    req.lic = l;
    next();
};
const ownBotOnly = (req, res, next) => {
    if (req.lic.runMode === "central") {
        return res.status(403).json({ error: "Lisensi ini sedang menggunakan Bot GevraStore." });
    }
    next();
};
app.get("/api/deposit-template", buyer, (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!valid(req.lic) || req.lic.type === "service") {
        return res.status(403).json({ error: "Script deposit tersedia untuk lisensi AutoStore aktif." });
    }
    res.type("text/plain").sendFile(path.join(__dirname, "src", "deposit-template.lua"));
});
const admin = (req, res, next) =>
    auth.session(req)?.t === "admin" ? next() : res.status(401).json({ error: "Belum login admin." });

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
app.get("/api/admin/wallet/backup/status", admin, (req, res) => res.json(walletBackup ? { enabled: true, ...walletBackup.status() } : { enabled: false }));
app.post("/api/admin/wallet/backup", admin, wrap(async (req, res) => {
    if (!walletBackup) return res.status(503).json({ error: "Wallet belum diaktifkan." });
    try { const r = await walletBackup.send("manual"); res.json({ ok: true, counts: r.counts }); }
    catch (e) { res.status(400).json({ error: e.message }); }
}));
app.post("/api/admin/restore", admin, express.raw({ type: "*/*", limit: "5mb" }), wrap(async (req, res) => {
    let d;
    try { d = JSON.parse(Buffer.from(req.body).toString("utf8")); } catch { return res.status(400).json({ error: "File bukan JSON yang valid." }); }
    if (!d || !Array.isArray(d.licenses) || !Number.isFinite(d.nextPort) || d.licenses.some((l) => !l || !l.id || !l.buyer))
        return res.status(400).json({ error: "Isi file bukan backup data.json panel ini." });
    licenses().forEach((l) => runner.stop(l.id));
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + ".bak");
    Object.keys(store.data).forEach((k) => delete store.data[k]);
    Object.assign(store.data, d);
    store.save();
    licenses().forEach(reconcile);
    res.json({ ok: true, count: licenses().length });
}));

app.use("/api/shop", buyer, (req, res, next) => req.lic.type === "service" ? res.status(403).json({ error: "Fitur toko AutoStore tidak tersedia untuk key Service." }) : next(), express.json({ limit: "2mb" }), createShopRouter({ valid, decrypt, licenses }));
app.use(express.json({ limit: "20kb" }));

// ---- Pesanan key lewat web (QRIS manual) ----
const notifier = createNotifier();
const ORDER_TTL_MIN = Number(process.env.ORDER_TTL_MIN) > 0 ? Number(process.env.ORDER_TTL_MIN) : 30;
// Perpanjangan: tambah masa aktif key lama (penyimpanan dilakukan oleh orders.confirm setelah ini).
function extendLicense(id, days) {
    const l = findLicense(id);
    if (!l) throw new OrderError("Key pembeli ini sudah dihapus, perpanjangan tidak bisa diproses.", 409);
    l.expiresAt = Math.max(l.expiresAt, Date.now()) + days * DAY;
    reconcile(l);
    return l.expiresAt;
}
const orders = createOrders({
    store, issueLicense, encrypt, decrypt, notify: notifier, ttlMin: ORDER_TTL_MIN, publicUrl: process.env.PUBLIC_URL || "",
    autoko, autoOrders: process.env.ORDER_AUTO === "1", getLicense: findLicense, extendLicense,
});
registerOrderRoutes(app, { admin, buyer, orders, ttlMin: ORDER_TTL_MIN, turnstile });
registerWalletRoutes(app, { wallet, autoko, buyer, admin, licenses, findLicense, valid, store });
const discordLogin = require("./src/discord-login")(app, { buyer, valid, save: store.save, licenses });
console.log("[PANEL] Pembayaran key di /beli:", orders.autoEnabled() ? "QRIS otomatis aktif (cadangan: QRIS statis)" : "QRIS statis + konfirmasi admin", "| CAPTCHA:", turnstile.enabled ? "Turnstile aktif" : "nonaktif");
console.log("[PANEL] Notifikasi pesanan:", notifier.channels.join(", ") || "belum diatur (isi TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)");

app.post("/api/login", (req, res) => {
    if (auth.tooMany(req.ip)) return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi 10 menit lagi." });
    const key = String(req.body?.key || "").trim().toUpperCase();
    const l = key && licenses().find((x) => x.keyHash === sha256(key));
    if (!l) { auth.recordFail(req.ip); return res.status(401).json({ error: "Key tidak ditemukan." }); }
    auth.clearFails(req.ip);
    auth.setSession(res, { t: "buyer", id: l.id });
    discordLogin.clearInstall(res);
    res.json({ ok: true, type: l.type || "autostore" });
});

app.post("/api/logout", (req, res) => { auth.clearSession(res); discordLogin.clearInstall(res); res.json({ ok: true }); });

app.get("/api/me", buyer, (req, res) => {
    const l = req.lic;
    const c = l.config ? decrypt(l.config) : {};
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    res.json({
        buyer: l.buyer, type: l.type || "autostore", keyPrefix: l.keyPrefix,
        expiresAt: l.expiresAt, lifetime: !!l.lifetime, daysLeft: Math.max(0, Math.ceil((l.expiresAt - Date.now()) / DAY)),
        revoked: l.revoked, valid: valid(l), bot: runner.status(l.id), desired: l.desired,
        discordInstallEnabled: discordLogin.eligible(l),
        hostedBotConfigured: discordLogin.eligible(l) && !!l.hostedBot,
        hostedBot: discordLogin.eligible(l) ? discordLogin.statusFor(l) : null,
        webhookUrl: `${base}/hook/${l.id}`,
        walletEnabled: !!wallet, autoAvailable: autoko.enabled, paymentMode: l.paymentMode === "auto" ? "auto" : "manual",
        config: {
            clientId: c.clientId || "", ownerId: c.ownerId || "", adminIds: c.adminIds || "",
            guildId: c.guildId || "", paymentUrl: c.paymentUrl || "",
            has: { botToken: !!c.botToken, mongoUrl: !!c.mongoUrl, paymentApiKey: !!c.paymentApiKey, paymentSecret: !!c.paymentSecret },
            emojis: l.type === "service" ? { ...SERVICE_EMOJI_DEFAULTS, ...(c.serviceEmojis || {}) } : { ...AUTOSTORE_EMOJI_DEFAULTS, ...(c.emojis || {}) },
            serviceEmojis: l.type === "service" ? { ...SERVICE_EMOJI_DEFAULTS, ...(c.serviceEmojis || {}) } : {},
        },
    });
});

app.put("/api/config", buyer, ownBotOnly, wrap(async (req, res) => {
    const l = req.lic;
    const cur = l.config ? decrypt(l.config) : {};
    const next = { ...cur };
    for (const k of FIELDS) {
        if (typeof req.body?.[k] !== "string") continue;
        const v = req.body[k].trim();
        if (SECRET.has(k)) { if (v) next[k] = v; } else next[k] = v;
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
app.post("/api/bot/start", buyer, ownBotOnly, botAction("start"));
app.post("/api/bot/stop", buyer, ownBotOnly, botAction("stop"));
app.post("/api/bot/restart", buyer, ownBotOnly, botAction("restart"));
app.get("/api/logs", buyer, ownBotOnly, (req, res) => res.json({ lines: runner.logs(req.lic.id).slice(-100) }));

const SERVICE_DEFS = {
    "PLANT": { label: "PLANT", unit: "World", defaultPrice: 30 },
    "HARVEST": { label: "HARVEST", unit: "World", defaultPrice: 30 },
    "HARVEST MOVE": { label: "HARVEST MOVE", unit: "World", defaultPrice: 40 },
    "MOVE": { label: "MOVE", unit: "Item / 200", defaultPrice: 1 },
    "PROVIDER": { label: "PROVIDER", unit: "World", defaultPrice: 40 },
    "SPLICE": { label: "SPLICE", unit: "World", defaultPrice: 45 },
};
async function withServiceDb(l, fn) {
    if (l.type !== "service") throw Object.assign(new Error("Fitur ini hanya tersedia untuk key Service."), { status: 403 });
    if (!l.config) throw Object.assign(new Error("Isi konfigurasi bot Service terlebih dahulu."), { status: 400 });
    const c = decrypt(l.config);
    if (!c.mongoUrl) throw Object.assign(new Error("MongoDB URL Service belum diisi."), { status: 400 });
    const client = new MongoClient(c.mongoUrl, { serverSelectionTimeoutMS: 8000 });
    try { await client.connect(); return await fn(client.db()); } finally { await client.close().catch(() => {}); }
}
app.get("/api/service/settings", buyer, wrap(async (req, res) => {
    const services = await withServiceDb(req.lic, async (db) => db.collection("jasaconfigs").find({}).toArray());
    const byType = new Map(services.map(x => [x.type, x]));
    const out = Object.entries(SERVICE_DEFS).map(([type, d]) => {
        const x = byType.get(type) || {};
        return { type, label: d.label, unit: d.unit, price: Number(x.price ?? d.defaultPrice), status: String(x.status || "OPEN").toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN", completed: Number(x.completed || 0) };
    });
    res.json({ services: out });
}));
app.put("/api/service/settings", buyer, wrap(async (req, res) => {
    const incoming = Array.isArray(req.body?.services) ? req.body.services : [];
    if (!incoming.length) return res.status(400).json({ error: "Data jasa tidak ditemukan." });
    const clean = incoming.map(x => ({ type: String(x.type || "").trim(), price: Number(x.price), status: String(x.status || "").toUpperCase() }));
    for (const x of clean) {
        if (!SERVICE_DEFS[x.type]) return res.status(400).json({ error: `Jenis jasa tidak dikenal: ${x.type}` });
        if (!Number.isFinite(x.price) || x.price < 0) return res.status(400).json({ error: `Harga ${x.type} tidak valid.` });
        if (!["OPEN", "CLOSED"].includes(x.status)) return res.status(400).json({ error: `Status ${x.type} tidak valid.` });
    }
    await withServiceDb(req.lic, async (db) => {
        const col = db.collection("jasaconfigs");
        for (const x of clean) await col.updateOne({ type: x.type }, { $set: { price: x.price, status: x.status }, $setOnInsert: { completed: 0 } }, { upsert: true });
    });
    res.json({ ok: true });
}));

app.get("/api/service/orders", buyer, wrap(async (req, res) => {
    const status = String(req.query?.status || "all").toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 50));
    const allowed = ["waiting", "in_progress", "done"];
    const query = allowed.includes(status) ? { status } : {};
    const result = await withServiceDb(req.lic, async (db) => {
        const col = db.collection("jasaorders");
        const [orders, waiting, inProgress, done, total] = await Promise.all([
            col.find(query).sort({ createdAt: -1, orderNumber: -1 }).limit(limit).toArray(),
            col.countDocuments({ status: "waiting" }),
            col.countDocuments({ status: "in_progress" }),
            col.countDocuments({ status: "done" }),
            col.countDocuments({}),
        ]);
        return { orders, counts: { total, waiting, in_progress: inProgress, done } };
    });
    res.json(result);
}));

// ---------- Custom Emoji (AutoStore + AutoStore Service) ----------
// Kedua nama endpoint didukung agar frontend lama maupun Service sama-sama kompatibel.
function emojiConfig(l) {
    const isService = l.type === "service";
    const defaults = isService ? SERVICE_EMOJI_DEFAULTS : AUTOSTORE_EMOJI_DEFAULTS;
    const fieldName = isService ? "serviceEmojis" : "emojis";
    const cur = l.config ? decrypt(l.config) : {};
    return { isService, defaults, fieldName, cur, emojis: { ...defaults, ...(cur[fieldName] || {}) } };
}

const getEmojis = (req, res) => {
    const l = req.lic;
    const cfg = emojiConfig(l);
    res.json({
        emojis: cfg.emojis,
        defaults: cfg.defaults,
        keys: EMOJI_KEYS,
        type: cfg.isService ? "service" : "autostore"
    });
};
app.get("/api/emojis", buyer, getEmojis);
app.get("/api/service/emojis", buyer, getEmojis);

const putEmojis = wrap(async (req, res) => {
    const l = req.lic;
    const cfg = emojiConfig(l);
    const merged = {
        ...cfg.emojis,
        ...sanitizeEmojis(req.body?.emojis || {})
    };
    l.config = encrypt({ ...cfg.cur, [cfg.fieldName]: merged });
    store.save();

    const wasRunning = runner.status(l.id) !== "stopped";
    if (wasRunning) {
        l.desired = "running";
        await runner.stop(l.id);
        reconcile(l);
    }
    res.json({ ok: true, restarted: wasRunning, emojis: merged });
});
app.put("/api/emojis", buyer, ownBotOnly, putEmojis);
app.put("/api/service/emojis", buyer, ownBotOnly, putEmojis);

const resetEmojis = wrap(async (req, res) => {
    const l = req.lic;
    const cfg = emojiConfig(l);
    const defaults = { ...cfg.defaults };
    l.config = encrypt({ ...cfg.cur, [cfg.fieldName]: defaults });
    store.save();

    const wasRunning = runner.status(l.id) !== "stopped";
    if (wasRunning) {
        l.desired = "running";
        await runner.stop(l.id);
        reconcile(l);
    }
    res.json({ ok: true, restarted: wasRunning, emojis: defaults });
});
app.post("/api/emojis/reset", buyer, ownBotOnly, resetEmojis);
app.post("/api/service/emojis/reset", buyer, ownBotOnly, resetEmojis);

app.post("/api/admin/login", (req, res) => {
    if (auth.tooMany(req.ip)) return res.status(429).json({ error: "Terlalu banyak percobaan." });
    const a = Buffer.from(sha256(String(req.body?.password || ""))), b = Buffer.from(sha256(ADMIN_PASSWORD));
    if (!crypto.timingSafeEqual(a, b)) { auth.recordFail(req.ip); return res.status(401).json({ error: "Password salah." }); }
    auth.clearFails(req.ip);
    auth.setSession(res, { t: "admin" }, 8);
    res.json({ ok: true });
});

const row = (l) => ({
    id: l.id, buyer: l.buyer, type: l.type || "autostore", keyPrefix: l.keyPrefix, expiresAt: l.expiresAt, revoked: l.revoked, lifetime: !!l.lifetime,
    configured: !!l.config, bot: runner.status(l.id), walletFrozen: !!l.walletFrozen, paymentMode: l.paymentMode === "auto" ? "auto" : "manual",
});
app.get("/api/admin/licenses", admin, (req, res) => res.json({ licenses: licenses().map(row) }));

app.post("/api/admin/licenses", admin, (req, res) => {
    const name = String(req.body?.buyer || "").trim().slice(0, 60);
    const days = Math.min(3650, Math.max(1, Math.floor(Number(req.body?.days) || 30)));
    if (!name) return res.status(400).json({ error: "Nama pembeli wajib diisi." });
    if (req.body?.type === "service") return res.status(400).json({ error: "AutoStore Service tidak lagi tersedia untuk lisensi baru." });
    const type = "autostore";
    const key = newKey(type);
    licenses().push({
        id: crypto.randomBytes(8).toString("hex"), buyer: name, type, keyHash: sha256(key), keyPrefix: key.slice(0, 7),
        createdAt: Date.now(), expiresAt: Date.now() + days * DAY, revoked: false,
        port: store.data.nextPort++, config: null, desired: "stopped",
    });
    store.save();
    res.json({ key });
});

const find = (req, res) => {
    const l = licenses().find((x) => x.id === req.params.id);
    if (!l) res.status(404).json({ error: "Tidak ditemukan." });
    return l;
};
app.post("/api/admin/licenses/:id/extend", admin, (req, res) => {
    const l = find(req, res); if (!l) return;
    const days = Math.min(3650, Math.max(1, Math.floor(Number(req.body?.days) || 30)));
    l.expiresAt = Math.max(l.expiresAt, Date.now()) + days * DAY;
    store.save(); reconcile(l); res.json({ ok: true });
});
app.post("/api/admin/licenses/:id/revoke", admin, (req, res) => {
    const l = find(req, res); if (!l) return;
    l.revoked = !!req.body?.revoked;
    store.save(); reconcile(l); res.json({ ok: true });
});
app.delete("/api/admin/licenses/:id", admin, wrap(async (req, res) => {
    const l = find(req, res); if (!l) return;
    if (wallet) {
        // Gagal-aman: kalau saldo tidak bisa dicek, jangan hapus.
        let owed;
        try { owed = await wallet.balanceOf(l.id); } catch { return res.status(503).json({ error: "Saldo wallet tidak bisa dicek sekarang, coba lagi." }); }
        if (owed > 0) return res.status(409).json({ error: `Pembeli ini masih punya saldo wallet Rp${owed.toLocaleString("id-ID")}. Selesaikan penarikannya dulu.` });
    }
    await runner.stop(l.id);
    closeConn(l.id);
    store.data.licenses = licenses().filter((x) => x !== l);
    store.save(); res.json({ ok: true });
}));

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error("[PANEL] error:", err);
    res.status(status).json({ error: status === 500 ? "Terjadi kesalahan di server." : err.message });
});

const WATCH_MS = Number(process.env.WATCH_MS || 60000);
setInterval(() => licenses().forEach(reconcile), WATCH_MS).unref();
if (wallet) {
    // Saat start: hitung ulang saldo dari ledger (menyembuhkan sisa proses yang terputus), lalu rutin tiap menit.
    setTimeout(() => wallet.reconcile(null, { fix: true }).then((d) => d.length && console.warn("[WALLET] saldo dikoreksi dari ledger:", JSON.stringify(d))).catch((e) => console.error("[WALLET] reconcile:", e.message)), 5000).unref();
    setInterval(() => wallet.sweep().catch((e) => console.error("[WALLET] sweep:", e.message)), numEnv("WALLET_SWEEP_MS", 60000)).unref();
}
if (orders.autoEnabled()) setInterval(() => orders.sweepAuto().catch((e) => console.error("[ORDERS] sweep:", e.message)), numEnv("ORDER_SWEEP_MS", 60000)).unref();
if (wallet) {
    // Cek harian: saldo di dokumen wallet harus sama dengan hitungan ulang dari ledger. Kalau beda (dua kali cek), kabari lewat notifikasi.
    const checkConsistency = async () => {
        let diffs = await wallet.reconcile(null, { fix: false });
        if (diffs.length) { await new Promise((r) => setTimeout(r, 20000)); diffs = await wallet.reconcile(null, { fix: false }); } // hindari alarm palsu saat ada transaksi berjalan
        if (!diffs.length) return;
        console.warn("[WALLET] saldo tidak cocok dengan ledger:", JSON.stringify(diffs));
        const url = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, "") + "/admin.html" : "";
        await notifier({ title: "Saldo wallet tidak cocok", text: [`⚠️ ${diffs.length} wallet punya saldo berbeda dari ledger`, "Buka halaman admin, tekan Cek konsistensi saldo, lalu periksa.", url].filter(Boolean).join("\n"), url });
    };
    setInterval(() => checkConsistency().catch((e) => console.error("[WALLET] cek konsistensi:", e.message)), numEnv("WALLET_CHECK_HOURS", 24) * 3600e3).unref();
}
if (backup.enabled()) backup.schedule(process.env.BACKUP_EVERY_HOURS);
if (backup.enabled()) setTimeout(() => backup.send("server start").catch((e) => console.error("[BACKUP]", e.message)), 15000).unref();
if (backup.enabled() && walletBackup) {
    walletBackup.schedule(process.env.BACKUP_EVERY_HOURS);
    setTimeout(() => walletBackup.send("server start").catch((e) => console.error("[WALLET-BACKUP]", e.message)), 40000).unref();
}
licenses().forEach(reconcile);

const HOST = process.env.PANEL_HOST || (process.env.TRUST_PROXY === "1" ? "127.0.0.1" : "0.0.0.0");
const server = app.listen(PORT, HOST, () => console.log(`[PANEL] jalan di ${HOST}:${PORT}`));
server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `Port ${PORT} sudah dipakai. Panel lama mungkin masih jalan, tutup dulu lalu coba lagi.` : e);
    process.exit(1);
});

process.on("unhandledRejection", (e) => console.error("[PANEL] unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("[PANEL] uncaughtException:", e));

let closing = false;
async function shutdown() {
    if (closing) return;
    closing = true;
    setTimeout(() => process.exit(1), 10000).unref();
    server.close();
    catalogPilot?.destroy();
    try { await Promise.all(licenses().map((l) => runner.stop(l.id))); } catch (e) { console.error(e); }
    await walletDb.close();
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
