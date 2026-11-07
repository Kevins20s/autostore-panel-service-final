require('./console/watermark')
let {
    ActivityType,
    GatewayIntentBits,
    Client,
    Collection,
    Partials,
} = require("discord.js");
let { readdirSync } = require("fs");
let config = require('./config/config.json');
let mongoose = require("mongoose");
const fs = require("node:fs");
const hostedBinding = process.env.HOSTED_PILOT_BINDING ? JSON.parse(process.env.HOSTED_PILOT_BINDING) : null;
const { readHostedQrCancelId } = require("./utils/hostedQrCancel");
function hostedActive() {
    try {
        const data = JSON.parse(fs.readFileSync(hostedBinding.dataFile, "utf8"));
        const license = data.licenses.find(item => item.id === hostedBinding.licenseId);
        return !!(license && !license.revoked && license.expiresAt > Date.now() &&
            license.discordLoginId === config.Owner && license.hostedBot?.enabled &&
            license.hostedBot.guildId === config.serverId &&
            !data.licenses.some(other => other.id !== license.id && other.hostedBot?.guildId === config.serverId));
    } catch {
        return false;
    }
}
class HostedClient extends Client {
    emit(event, ...args) {
        if (event === "interactionCreate" || event === "messageCreate") {
            const ownQrCancelDm = event === "interactionCreate" && !args[0]?.guildId &&
                !!readHostedQrCancelId(args[0]?.customId, config.serverId, hostedBinding.legacy);
            if ((!ownQrCancelDm && args[0]?.guildId !== config.serverId) || !hostedActive() || mongoose.connection.readyState !== 1) {
                return false;
            }
        }
        return super.emit(event, ...args);
    }
}
let IncludedIntents = Object.entries(GatewayIntentBits).reduce(
    (t, [, V]) => t | V,
    0
);
const BotClient = hostedBinding ? HostedClient : Client;
let client = new BotClient({
    intents: hostedBinding
        ? [GatewayIntentBits.Guilds, ...(process.env.HOSTED_WORLD_DEPOSIT === "1"
            ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : [])]
        : IncludedIntents,
    partials: [Partials.Channel, Partials.Message],
    ...(hostedBinding && {
        presence: {
            status: "dnd",
            activities: [{ type: ActivityType.Custom, name: "Custom Status", state: "https://discord.gg/ffU9Q6bagA" }],
        },
    }),
});

if (!config.TOKEN) {
    console.log("[WARN] Token for discord bot is required! put your token in config file".yellow.bold + "\n")
    return process.exit();
};

if(!config.MongoURL) {
    console.log("[WARN] Mongo Db For bot is required! put your MongoDB in config file".yellow.bold + "\n")
    return process.exit();
}

client.startTime = Date.now()
client.events = new Collection()
client.slash = new Collection()
client.config = require("./config/config.json")

module.exports = client;

require("./handlers/event")(client);
let commandsReady = false;
require("./handlers/slash")(client).then(() => {
    commandsReady = true;
}).catch(error => {
    console.error("[SLASH] Pendaftaran gagal:", error.code || error.name);
    if (hostedBinding) process.exit(1);
});

mongoose
    .connect(config.MongoURL, hostedBinding ? { dbName: hostedBinding.dbName, maxPoolSize: 5 } : {})
    .then(() => {
        console.log("----------------------------------------".white);
        console.log(`[READY] MongoDB Is Ready To Give Data!`.bold);
        console.log("----------------------------------------".white);
    })
    .catch((e) => {
        console.log("[CRUSH] Something went wrong while connecting to your MongoDB" + "\n");
        console.log("[CRUSH] Error from MongoDB :" + e);
        process.exit();
    });

const { startWebhookServer } = require("./webhookServer.js");
if (!hostedBinding) startWebhookServer(client);

if (hostedBinding) {
    const { syncHostedDepositLogs } = require("./utils/hostedDepositLogs");
    let syncingLogs = false;
    setInterval(async () => {
        if (syncingLogs || !hostedActive() || !client.isReady() || mongoose.connection.readyState !== 1) return;
        syncingLogs = true;
        try { await syncHostedDepositLogs(); }
        catch (error) { console.error("[HOSTED LOGS]", error.code || error.name); }
        finally { syncingLogs = false; }
    }, 15000).unref();
    const report = () => {
        if (!hostedActive()) return process.exit(0);
        const online = commandsReady && mongoose.connection.readyState === 1 &&
            client.isReady() && !!client.guilds.cache.get(config.serverId)?.available;
        process.send?.({ online });
    };
    setInterval(report, 1000).unref();
}

client.login(config.TOKEN)
    .catch((err) => {
        console.log("[CRUSH] Something went wrong while connecting to your bot" + "\n");
        console.log("[CRUSH] Error from DiscordAPI :" + err);
        process.exit();
    });

process.on("unhandledRejection", async (err) => {
    console.log(`[ANTI - CRUSH] Unhandled Rejection : ${err.stack}`);
})

client.on("error", (err) => {
    console.log(`[ANTI - CRUSH] Client Error (dicegah crash): ${err.stack || err}`);
});
