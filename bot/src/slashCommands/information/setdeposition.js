const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const depo = require("../../Schema/deposition.js");
const { Owner } = require("../../config/config.json");

module.exports = {
    name: 'setdepo',
    description: "Set World Deposit",
    accessableby: "admin",
    options: [
        {
            name: "world",
            description: "World Deposit",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "owner",
            description: "Nama Owner World Depo",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "botname",
            description: "Name Of Bot Depo",
            type: ApplicationCommandOptionType.String,
            required: true
        }
    ],
    run: async (client, interaction, args) => {
        const world = interaction.options.getString("world");
        const owner = interaction.options.getString("owner");
        const botName = interaction.options.getString("botname");
        const user = await client.users.fetch(Owner);

        try {
            const updatedDepo = await depo.findOneAndUpdate(
                {},
                {
                    $set: {
                        world: world,
                        owner: owner,
                        botName: botName,
                    },
                },
                { upsert: true, new: true }
            );

            console.log("Updated deposit information:", updatedDepo);

            await interaction.reply({ content: "Successfully set World Depo", ephemeral: true });

            const sendToOwner = new EmbedBuilder()
                .setTitle("World Depo History")
                .setDescription(
                    `
                    New World: ${world}
                    New Owner: ${owner}
                    New Bot Name: ${botName}
                    `.replace(/^\s+/gm, '')
                )
                .setTimestamp();

            await user.send({ embeds: [sendToOwner] });
        } catch (error) {
            console.error("Error updating deposit information:", error);
            await interaction.reply({ content: "An error occurred while setting World Depo", ephemeral: true });
        }
    }
};