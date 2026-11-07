"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fork } = require("node:child_process");
require("./loadenv").loadEnv();
const { hostedTenant } = require("./shared-tenants");
const { hostedWalletToken } = require("./walletapi");

const statusFile = process.env.DISCORD_HOSTED_PILOT_STATUS_FILE;
const dataFile = path.resolve(process.env.DATA_FILE || "data.json");
const botDir = path.join(__dirname, "../bot");
const token = process.env.DISCORD_CATALOG_PILOT_TOKEN;
const clientId = process.env.DISCORD_HOSTED_BOT_CLIENT_ID;
const fixedGuilds = new Set((process.env.DISCORD_HOSTED_PILOT_GUILD_IDS || "").split(",").map(id => id.trim()).filter(id => /^\d{17,20}$/.test(id)));
const knownGuilds = new Set(fixedGuilds);
try {
    const previous = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    for (const id of previous.managedGuilds || []) if (/^\d{17,20}$/.test(id)) knownGuilds.add(id);
} catch { /* The status file may not exist on first start. */ }
const workers = new Map();
const retryAt = new Map();
const failures = new Map();
const clearing = new Set();
const cleared = new Set();
let nextWorkerStartAt = 0;
let stopping = false;

function publishStatus(bindings) {
    fs.writeFileSync(statusFile + ".next", JSON.stringify({ at: Date.now(), guilds: Object.keys(bindings), bindings,
        managedGuilds: [...knownGuilds] }), { mode: 0o600 });
    fs.renameSync(statusFile + ".next", statusFile);
}

function currentBindings() {
    try {
        const { licenses } = JSON.parse(fs.readFileSync(dataFile, "utf8"));
        const bindings = new Map();
        for (const license of licenses) {
            const tenant = hostedTenant(license, licenses);
            const owner = license.discordLoginId;
            if (!tenant || !/^\d{17,20}$/.test(owner)) continue;
            bindings.set(tenant.guildId, { ...tenant, owner });
        }
        return bindings;
    } catch {
        console.error("[HOSTED] Data lisensi tidak bisa dibaca.");
        return null;
    }
}

async function clearCommands(id) {
    clearing.add(id);
    try {
        const url = `https://discord.com/api/v10/applications/${clientId}/guilds/${id}/commands`;
        const response = await fetch(url, {
            method: "PUT",
            headers: { Authorization: "Bot " + token, "Content-Type": "application/json" },
            body: "[]",
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok && response.status !== 403 && response.status !== 404) throw new Error(String(response.status));
        if (fixedGuilds.has(id)) cleared.add(id);
        else knownGuilds.delete(id);
        retryAt.delete(id);
        failures.delete(id);
    } catch (error) {
        console.error("[HOSTED] Gagal membersihkan command:", error.message);
        retryAt.set(id, Date.now() + 15000);
    } finally {
        clearing.delete(id);
    }
}

function bindingKey(binding) {
    return JSON.stringify([binding.licenseId, binding.dbName, binding.owner]);
}

function startWorker(binding) {
    const { guildId, licenseId, owner, dbName } = binding;
    const child = fork(path.join(botDir, "index.js"), {
        cwd: botDir,
        env: {
            PATH: process.env.PATH,
            DNS_SERVERS: process.env.DNS_SERVERS || "",
            DISCORD_TOKEN: token,
            CLIENT_ID: clientId,
            MONGO_URL: binding.config.mongoUrl,
            OWNER_ID: owner,
            ADMIN_IDS: owner,
            GUILD_ID: guildId,
            PANEL_INTERNAL_URL: "http://127.0.0.1:" + (process.env.PANEL_PORT || process.env.PORT || 8080),
            PANEL_INTERNAL_TOKEN: hostedWalletToken(licenseId, guildId),
            PANEL_LICENSE_ID: licenseId,
            HOSTED_WORLD_DEPOSIT: process.env.HOSTED_WORLD_DEPOSIT || "",
            HOSTED_PILOT_BINDING: JSON.stringify({ dataFile, licenseId, dbName, legacy: binding.legacy }),
        },
    });
    const entry = { key: bindingKey(binding), licenseId, child, onlineAt: 0, stopping: false };
    workers.set(guildId, entry);
    // All workers identify with the same Discord app and shard number.
    nextWorkerStartAt = Date.now() + 6000;
    cleared.delete(guildId);
    child.on("message", message => {
        entry.onlineAt = message.online === true ? Date.now() : 0;
        if (entry.onlineAt) failures.delete(guildId);
    });
    child.on("error", error => console.error("[HOSTED] Worker gagal:", error.code || error.name));
    child.on("close", () => {
        workers.delete(guildId);
        if (!entry.stopping) {
            const count = (failures.get(guildId) || 0) + 1;
            failures.set(guildId, count);
            retryAt.set(guildId, Date.now() + Math.min(300000, 5000 * 2 ** Math.min(count - 1, 6)));
        }
        if (stopping && !workers.size) process.exit(0);
    });
}

function reconcile() {
    if (stopping) return;
    const bindings = currentBindings();
    const online = Object.create(null);
    if (!bindings) { publishStatus(online); return; }
    for (const guildId of bindings.keys()) knownGuilds.add(guildId);
    for (const [guildId, worker] of workers) {
        const binding = bindings.get(guildId);
        if (!binding || worker.key !== bindingKey(binding)) {
            if (!worker.stopping) {
                worker.stopping = true;
                worker.child.kill();
            }
        } else if (!worker.stopping && worker.onlineAt && Date.now() - worker.onlineAt < 3000) {
            online[guildId] = worker.licenseId;
        }
    }
    for (const guildId of knownGuilds) {
        if (workers.has(guildId) || clearing.has(guildId) || Date.now() < (retryAt.get(guildId) || 0)) continue;
        const binding = bindings.get(guildId);
        if (binding) {
            if (Date.now() >= nextWorkerStartAt) startWorker(binding);
        }
        else if (!cleared.has(guildId)) void clearCommands(guildId);
    }
    publishStatus(online);
}

function shutdown() {
    stopping = true;
    try { publishStatus({}); }
    finally {
        for (const worker of workers.values()) worker.child.kill();
        if (!workers.size) process.exit(0);
    }
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
function tick() {
    try { reconcile(); }
    catch (error) { console.error("[HOSTED] Sinkronisasi gagal:", error.code || error.name); }
    if (!stopping) setTimeout(tick, 1000);
}
tick();
