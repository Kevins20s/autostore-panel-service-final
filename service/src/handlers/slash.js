const client = require("../index.js");
const config = require("../config/runtime.js");
const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");

module.exports = async () => {
    const slash = [];
    const dir = path.join(__dirname, "../slashCommands/information");

    for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".js"))) {
        const pull = require(path.join(dir, file));
        if (pull.name) {
            slash.push(pull);
            client.slash.set(pull.name, pull);
            console.log(`[SERVICE SLASH] Loaded: ${pull.name}`);
        }
    }

    if (!config.CLIENTID || !config.TOKEN) {
        console.error("[SERVICE] CLIENTID dan TOKEN wajib diisi di src/config/config.json");
        return;
    }

    const rest = new REST({ version: "10" }).setToken(config.TOKEN);
    await rest.put(Routes.applicationCommands(config.CLIENTID), { body: slash });
    console.log("[SERVICE SLASH] Service commands registered.");
};
