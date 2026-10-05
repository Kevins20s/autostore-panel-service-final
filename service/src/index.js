require("colors");
if (process.env.DNS_SERVERS) {
    try {
        const dns = require("dns");
        dns.setServers(
            process.env.DNS_SERVERS
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
        );
        console.log("[SERVICE] DNS:", dns.getServers().join(", "));
    } catch (e) {
        console.error("[SERVICE] DNS_SERVERS tidak valid:", e.message);
    }
}
const { GatewayIntentBits, Client, Collection, Partials } = require("discord.js");
const mongoose = require("mongoose");
const config = require("./config/runtime.js");

const intents = Object.values(GatewayIntentBits).reduce((a, b) => a | b, 0);
const client = new Client({ intents, partials: [Partials.Channel, Partials.Message] });

client.events = new Collection();
client.slash = new Collection();
client.config = config;
module.exports = client;

require("./handlers/event")(client);

mongoose.connect(config.MongoURL)
    .then(() => console.log("[SERVICE] MongoDB connected."))
    .catch((err) => {
        console.error("[SERVICE] MongoDB connection failed:", err);
        process.exit(1);
    });

require("./handlers/slash")(client).catch(console.error);

client.once("ready", () => console.log(`[SERVICE] Logged in as ${client.user.tag}`));
client.login(config.TOKEN).catch((err) => {
    console.error("[SERVICE] Discord login failed:", err);
    process.exit(1);
});

process.on("unhandledRejection", err => console.error("[SERVICE] Unhandled rejection:", err));
client.on("error", err => console.error("[SERVICE] Discord client error:", err));
