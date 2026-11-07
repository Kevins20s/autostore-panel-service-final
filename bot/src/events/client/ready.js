let client = require('../../index.js');
let {
    ActivityType,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
    MessageEmbed,
    ButtonBuilder,
} = require("discord.js");

module.exports = {
    name: "ready"
};

client.once("ready", async (client) => {
    try {
        if (!process.env.HOSTED_PILOT_BINDING) {
            const activities = [`Made By Gevra`, `${client.user.username} Online!`, `AutoSend Bot`, `/help to see commands`];
            let index = 0;
            setInterval(() => {
                client.user.setPresence({
                    activities: [{ name: activities[index++ % activities.length], type: ActivityType.Watching }],
                    status: "dnd",
                });
            }, 10000);
        }
        console.log("----------------------------------------".white.bold);
        console.log(`[READY] ${client.user.tag} is up and ready to go.`.green.bold);
        console.log("----------------------------------------".white.bold);
    } catch (err) {
        console.error(err);
    }
})
