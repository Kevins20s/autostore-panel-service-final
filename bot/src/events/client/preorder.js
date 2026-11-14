"use strict";

const client = require("../../index");
const { handleComponent, safeRun, repairSummaries } = require("../../utils/preorderDiscord");
let repairing = false;

client.on("interactionCreate", interaction => {
    if (!interaction.guildId || !interaction.customId?.startsWith("po:")) return;
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;
    void safeRun(interaction, () => handleComponent(client, interaction));
});

client.once("ready", () => {
    const repair = async () => {
        if (repairing || !client.isReady()) return;
        repairing = true;
        try { await repairSummaries(client); }
        catch { console.error("[PREORDER] Ringkasan belum bisa dipulihkan."); }
        finally { repairing = false; }
    };
    setTimeout(repair, 10000).unref();
    setInterval(repair, 60000).unref();
});

module.exports = { name: "preorder" };
