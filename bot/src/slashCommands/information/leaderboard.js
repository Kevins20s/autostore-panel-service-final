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
let Bal = require("../../Schema/balance.js");
const { imageUrl, COLOR, WL } = require("../../config/configemoji.json");
module.exports = {
    name: 'leaderboard',
    description: "Leaders Top 5 Rich In The Store",
    accessableby: "everyone",
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        let Data = ""
        await Bal.find({})
            .sort({ Balance: -1 })
            .limit(5)
            .then(data => {
                data.forEach((d, index) => {
                    Data += `**${index + 1}. ${d.GrowIDNow} <@${d.DiscordID}> : ${d.Balance}** ${WL}\n`;
                });
            });

        const embed = new EmbedBuilder()
            .setTitle("Leaderboard Top 5 Player")
            .setDescription(`${Data}`)
            .setTimestamp()
            .setImage(imageUrl)
            .setColor(COLOR);
        
        await interaction.reply({
            embeds: [ embed ],
            ephemeral: true
        });
    }
}