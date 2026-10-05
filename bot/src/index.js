require('./console/watermark')
let {
    GatewayIntentBits,
    Client,
    Collection,
    Partials,
} = require("discord.js");
let { readdirSync } = require("fs");
let config = require('./config/config.json');
let mongoose = require("mongoose");
let IncludedIntents = Object.entries(GatewayIntentBits).reduce(
    (t, [, V]) => t | V,
    0
);
let client = new Client({
    intents: IncludedIntents,
    partials: [Partials.Channel, Partials.Message],
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

["event", "slash"].forEach(file => {
    require(`./handlers/${file}`)(client);
});

mongoose
    .connect(config.MongoURL)
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
startWebhookServer(client);

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
