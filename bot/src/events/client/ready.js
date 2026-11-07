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
        const fixedActivities = client.options.presence?.activities ?? [];
        const watching = [`Made By Gevra`, `${client.user.username} Online!`, `AutoSend Bot`, `/help to see commands`];
        let index = 0;
        const updatePresence = () => {
            client.user.setPresence({
                activities: [...fixedActivities, { name: watching[index++ % watching.length], type: ActivityType.Watching }],
                status: "dnd",
            });
        };
        if (fixedActivities.length) updatePresence();
        setInterval(updatePresence, 10000);
        console.log("----------------------------------------".white.bold);
        console.log(`[READY] ${client.user.tag} is up and ready to go.`.green.bold);
        console.log("----------------------------------------".white.bold);
    } catch (err) {
        console.error(err);
    }
})
