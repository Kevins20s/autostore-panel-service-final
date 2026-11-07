"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fork } = require("node:child_process");
require("./loadenv").loadEnv();
const { pilotTenant } = require("./shared-tenants");
const { hostedWalletToken } = require("./walletapi");

const statusFile = process.env.DISCORD_HOSTED_PILOT_STATUS_FILE;
const dataFile = path.resolve(process.env.DATA_FILE || "data.json");
const botDir = path.join(__dirname, "../bot");
const token = process.env.DISCORD_CATALOG_PILOT_TOKEN;
const clientId = process.env.DISCORD_HOSTED_BOT_CLIENT_ID;
const guildIds = (process.env.DISCORD_HOSTED_PILOT_GUILD_IDS || "").split(",").filter(Boolean);
let worker;
let retryAt = 0;
let stopping = false;
const clearedGuilds = new Set();

function publishStatus(guilds) {
    fs.writeFileSync(statusFile + ".next", JSON.stringify({ at: Date.now(), guilds }), { mode: 0o600 });
    fs.renameSync(statusFile + ".next", statusFile);
}

function currentBinding() {
    try {
        const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
        const license = data.licenses.find(item => item.id === process.env.DISCORD_HOSTED_PILOT_LICENSE_ID);
        const tenant = pilotTenant(license);
        const owner = license?.discordLoginId;
        if (tenant && /^\d{17,20}$/.test(owner)) return { ...tenant, owner, licenseId: license.id };
    } catch {
        console.error("[HOSTED] Data lisensi tidak bisa dibaca.");
    }
    return null;
}

async function clearInactiveCommands(activeGuild) {
    for (const id of guildIds) {
        if (id === activeGuild || clearedGuilds.has(id)) continue;
        clearedGuilds.add(id);
        const url = `https://discord.com/api/v10/applications/${clientId}/guilds/${id}/commands`;
        try {
            const res = await fetch(url, {
                method: "PUT",
                headers: { Authorization: "Bot " + token, "Content-Type": "application/json" },
                body: "[]",
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok && res.status !== 403 && res.status !== 404) throw new Error(String(res.status));
        } catch (error) {
            console.error("[HOSTED] Tidak bisa menghapus command pada server nonaktif:", error.message);
            setTimeout(() => clearedGuilds.delete(id), 15000).unref();
        }
    }
}

async function reconcile() {
    if (stopping) return;
    const binding = currentBinding();
    const key = binding && JSON.stringify([binding.licenseId, binding.guildId, binding.dbName, binding.owner]);
    if (worker && worker.key !== key) {
        worker.child.kill();
        publishStatus([]);
        return;
    }
    if (!worker && binding && Date.now() >= retryAt) {
        await clearInactiveCommands(binding.guildId);
        if (stopping) return;
        clearedGuilds.delete(binding.guildId);
        const child = fork(path.join(botDir, "index.js"), {
            cwd: botDir,
            env: {
                PATH: process.env.PATH,
                DNS_SERVERS: process.env.DNS_SERVERS || "",
                DISCORD_TOKEN: token,
                CLIENT_ID: clientId,
                MONGO_URL: binding.config.mongoUrl,
                OWNER_ID: binding.owner,
                ADMIN_IDS: binding.owner,
                GUILD_ID: binding.guildId,
                PANEL_INTERNAL_URL: "http://127.0.0.1:" + (process.env.PANEL_PORT || process.env.PORT || 8080),
                PANEL_INTERNAL_TOKEN: hostedWalletToken(binding.licenseId, binding.guildId),
                PANEL_LICENSE_ID: binding.licenseId,
                HOSTED_WORLD_DEPOSIT: process.env.HOSTED_WORLD_DEPOSIT || "",
                HOSTED_PILOT_BINDING: JSON.stringify({ dataFile, licenseId: binding.licenseId, dbName: binding.dbName }),
            },
        });
        const entry = worker = { key, child, onlineAt: 0 };
        child.on("message", message => { entry.onlineAt = message.online === true ? Date.now() : 0; });
        child.on("error", error => console.error("[HOSTED] Worker gagal:", error.code || error.name));
        child.on("close", () => {
            worker = null;
            retryAt = Date.now() + 5000;
            if (stopping) process.exit(0);
        });
    }
    if (!worker && !binding) await clearInactiveCommands(null);
    publishStatus(worker?.onlineAt && Date.now() - worker.onlineAt < 3000 ? [binding.guildId] : []);
}

function shutdown() {
    stopping = true;
    publishStatus([]);
    if (worker) worker.child.kill();
    else process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
async function tick() {
    try { await reconcile(); }
    catch (error) { console.error("[HOSTED] Sinkronisasi gagal:", error.code || error.name); }
    if (!stopping) setTimeout(tick, 1000);
}
void tick();
