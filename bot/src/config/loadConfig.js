const path = require("path");
const Module = require("module");

// Nama env var -> nama key yang dipakai kode lama (config.json)
const MAP = {
    DISCORD_TOKEN: "TOKEN",
    MONGO_URL: "MongoURL",
    CLIENT_ID: "CLIENTID",
    OWNER_ID: "Owner",
    GUILD_ID: "serverId",
    PAYMENT_GATEWAY_URL: "PaymentGatewayUrl",
    PAYMENT_GATEWAY_API_KEY: "PaymentGatewayApiKey",
    PAYMENT_WEBHOOK_SECRET: "PaymentWebhookSecret",
};

const REQUIRED = ["TOKEN", "MongoURL", "CLIENTID", "Owner"];

function buildConfig(env = process.env) {
    const filePath = path.join(__dirname, "config.json");
    const cfg = { ...require(filePath) };

    for (const [envName, key] of Object.entries(MAP)) {
        if (env[envName]) cfg[key] = env[envName].trim();
    }
    if (env.ADMIN_IDS) {
        cfg.Admin = env.ADMIN_IDS.split(",").map((s) => s.trim()).filter(Boolean);
    }

    const missing = REQUIRED.filter((k) => !cfg[k]);
    return { cfg, missing };
}

/**
 * Timpa hasil require("config/config.json") di SEMUA file supaya isinya
 * berasal dari env var. Dengan begini 30+ file lama tidak perlu diubah.
 * Harus dipanggil SEBELUM src/index.js di-require.
 */
function applyEnvConfig(env = process.env) {
    // DNS khusus (lihat DNS_SERVERS di panel): perbaikan untuk server yang menolak lookup SRV mongodb+srv
    const dnsList = String(env.DNS_SERVERS || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (dnsList.length) { try { require("dns").setServers(dnsList); } catch (e) { console.error("[DNS] DNS_SERVERS tidak valid:", e.message); } }

    const { cfg, missing } = buildConfig(env);
    if (missing.length) {
        console.error(`[CONFIG] Env wajib belum diisi untuk: ${missing.join(", ")}`);
        console.error("[CONFIG] Lihat .env.example untuk daftar variabel.");
        process.exit(1);
    }
    const filename = require.resolve("./config.json");
    const mod = new Module(filename);
    mod.filename = filename;
    mod.loaded = true;
    mod.exports = cfg;
    require.cache[filename] = mod;
    return cfg;
}

module.exports = { applyEnvConfig, buildConfig };