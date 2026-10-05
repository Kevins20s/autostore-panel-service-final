const {
    EmbedBuilder,
    Client,
    CommandInteraction,
    ChannelType,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ApplicationCommandOptionType,
} = require("discord.js");
let mt = require("../../Schema/maintenance.js")
const request = require("request");
const { OWNER, Admin } = require("../../config/config.json");
module.exports = {
    name: 'setmaintenance',
    description: "Set Your Bot To Mt or Maintenance",
    accessableby: "admin",
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        await mt
            .findOne({})
            .then(async (d) => {
                if (d) {
                    d.mt = !d?.mt;
                    await d
                        .save()
                        .then(async (d1) => {
                            await interaction.reply({
                                content:`${d?.mt ? "Bot Maintenance" : "Done Maintenance"}`,
                                ephemeral: true
                            });
                        })
                        .catch(console.error);
                } else {
                    await new mt({ mt: !d?.mt })
                        .save()
                        .then(async (d) => {
                            await interaction.reply({
                                content:`${d?.mt ? "Bot Maintenance" : "Done Maintenance"}`,
                                ephemeral: true
                            });
                        })
                        .catch(console.error);
                }
            })
            .catch(console.error);
    }
}