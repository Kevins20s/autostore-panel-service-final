"use strict";

const fs = require("node:fs");
const path = require("node:path");
require("./loadenv").loadEnv();
const { Client, Events, GatewayIntentBits } = require(require.resolve("discord.js", {
    paths: [path.join(__dirname, "../bot")],
}));
const { pilotTenant } = require("./shared-tenants");
const { createCatalogHandler, commands } = require("./shared-catalog");

const guilds = (process.env.DISCORD_HOSTED_PILOT_GUILD_IDS || "").split(",").filter(Boolean);
const statusFile = process.env.DISCORD_HOSTED_PILOT_STATUS_FILE;
const dataFile = path.resolve(process.env.DATA_FILE || "data.json");
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const registry = () => {
    try {
        const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
        const license = data.licenses.find(item => item.id === process.env.DISCORD_HOSTED_PILOT_LICENSE_ID);
        const tenant = pilotTenant(license);
        if (tenant) return new Map([[tenant.guildId, tenant]]);
    } catch {
        console.error("[HOSTED] Data lisensi tidak bisa dibaca.");
    }
    return new Map();
};

const handle = createCatalogHandler({ registry });
client.on(Events.InteractionCreate, interaction => {
    handle(interaction).catch(() => console.error("[HOSTED] Interaksi Discord gagal."));
});
client.on(Events.Error, () => console.error("[HOSTED] Koneksi Discord bermasalah."));

function publishStatus() {
    try {
        const connected = client.isReady() ? guilds.filter(id => client.guilds.cache.get(id)?.available) : [];
        fs.writeFileSync(statusFile + ".next", JSON.stringify({ at: Date.now(), guilds: connected }), { mode: 0o600 });
        fs.renameSync(statusFile + ".next", statusFile);
    } catch {
        console.error("[HOSTED] Status koneksi tidak bisa disimpan.");
    }
}

client.once(Events.ClientReady, async () => {
    publishStatus();
    for (const id of guilds) {
        try {
            const guild = await client.guilds.fetch(id);
            for (const command of commands.filter(item => item.name !== "isi-saldo")) {
                await guild.commands.create(command);
            }
            console.log("[HOSTED] Perintah terdaftar di server", id);
        } catch (error) {
            console.error("[HOSTED] Pendaftaran gagal untuk server", id, error.code || error.name);
        }
    }
});
setInterval(publishStatus, 5000).unref();
client.login(process.env.DISCORD_CATALOG_PILOT_TOKEN).catch(error => {
    console.error("[HOSTED] Login Discord gagal:", error.code || error.name);
    process.exitCode = 1;
    client.destroy();
});
