// Menjalankan satu proses bot per pembeli, dan menjaganya tetap hidup.
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOG_MAX = 200;

function cfgToEnv(cfg, port, type) {
    // Sengaja TIDAK mewarisi env panel (MASTER_KEY, ADMIN_PASSWORD, dll) ke bot.
    return {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        PORT: String(port),
        DNS_SERVERS: process.env.DNS_SERVERS || "",
        DISCORD_TOKEN: cfg.botToken,
        CLIENT_ID: cfg.clientId,
        MONGO_URL: cfg.mongoUrl,
        OWNER_ID: cfg.ownerId,
        ADMIN_IDS: cfg.adminIds || "",
        GUILD_ID: cfg.guildId || "",
        PAYMENT_GATEWAY_URL: cfg.paymentUrl || "",
        PAYMENT_GATEWAY_API_KEY: cfg.paymentApiKey || "",
        PAYMENT_WEBHOOK_SECRET: cfg.paymentSecret || "",
        SERVICE_MODE: type === "service" ? "1" : "0",
    };
}

class Runner {
    constructor(botDir, serviceDir) {
        this.botDir = botDir;
        this.serviceDir = serviceDir;
        this.items = new Map(); // licenseId -> state
    }

    status(id) { return this.items.get(id)?.status || "stopped"; }
    logs(id) { return this.items.get(id)?.logs || []; }
    port(id) { return this.items.get(id)?.port; }

    start(id, cfg, port, type = "autostore") {
        const cur = this.items.get(id);
        if (cur && cur.status !== "stopped" && cur.status !== "crashed") return;
        const entry = { status: "starting", child: null, logs: cur?.logs || [], restarts: 0, wantStop: false, cfg, port, type, timer: null, startedAt: 0 };
        this.items.set(id, entry);
        this._spawn(id, entry);
    }

    _log(entry, line) {
        // Hanya data rahasia yang disensor (ID Discord bukan rahasia)
        const c = entry.cfg;
        const mongoPass = (/^mongodb(?:\+srv)?:\/\/[^:]+:([^@]+)@/.exec(c.mongoUrl || "") || [])[1];
        const secrets = [c.botToken, c.mongoUrl, mongoPass && decodeURIComponent(mongoPass), c.paymentApiKey, c.paymentSecret]
            .filter((v) => typeof v === "string" && v.length >= 6);
        let clean = line.replace(/\x1b\[[0-9;]*m/g, "");
        for (const s of secrets) clean = clean.split(s).join("***");
        entry.logs.push(new Date().toISOString().slice(11, 19) + " " + clean);
        if (entry.logs.length > LOG_MAX) entry.logs.shift();
    }

    _spawn(id, entry) {
        const dir = entry.type === "service" ? this.serviceDir : this.botDir;
        const entryFile = path.join(dir, "index.js");
        if (!fs.existsSync(entryFile)) {
            entry.status = "crashed";
            this._log(entry, "[PANEL] File bot tidak ditemukan: " + entryFile);
            return;
        }
        entry.startedAt = Date.now();
        entry.status = "running";
        const child = spawn(process.execPath, [entryFile], { cwd: dir, env: cfgToEnv(entry.cfg, entry.port, entry.type) });
        entry.child = child;
        const pipe = (stream) => {
            let buf = "";
            stream.on("data", (d) => {
                buf += d.toString();
                const parts = buf.split("\n");
                buf = parts.pop();
                parts.filter(Boolean).forEach((l) => this._log(entry, l));
            });
        };
        pipe(child.stdout);
        pipe(child.stderr);
        child.on("exit", (code) => {
            entry.child = null;
            if (entry.wantStop) { entry.status = "stopped"; return; }
            if (Date.now() - entry.startedAt > 60000) entry.restarts = 0; // sempat stabil -> reset hitungan
            entry.restarts++;
            this._log(entry, `[PANEL] Bot berhenti (kode ${code}).`);
            if (entry.restarts > 5) {
                entry.status = "crashed";
                this._log(entry, "[PANEL] Terlalu sering crash, berhenti otomatis. Periksa pengaturan lalu Start lagi.");
                return;
            }
            entry.status = "restarting";
            entry.timer = setTimeout(() => this._spawn(id, entry), Math.min(30000, 2000 * 2 ** entry.restarts));
        });
    }

    stop(id) {
        const entry = this.items.get(id);
        if (!entry || entry.status === "stopped") return Promise.resolve();
        entry.wantStop = true;
        clearTimeout(entry.timer);
        if (!entry.child) { entry.status = "stopped"; return Promise.resolve(); }
        return new Promise((resolve) => {
            const kill = setTimeout(() => entry.child && entry.child.kill("SIGKILL"), 5000);
            entry.child.once("exit", () => { clearTimeout(kill); resolve(); });
            entry.child.kill("SIGTERM");
        });
    }
}

module.exports = { Runner };