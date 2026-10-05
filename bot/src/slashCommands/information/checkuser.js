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
const { WL } = require("../../config/configemoji.json");
module.exports = {
    name: 'checkuser',
    description: "Check Balance And Growid User",
    accessableby: "admin",
    options: [
        {
            name: "user",
            description: "User To Check",
            type: ApplicationCommandOptionType.User,
            required: true
        }
    ],
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        let discorduser = interaction.options.getUser("user");
        let userid = discorduser.id;

        let wallet1 = await Bal.findOne({ DiscordID: userid })
            .then((d) => {
                return d;
            })
            .catch((e) => console.error(e));

        if (!wallet1) return interaction.reply({
            content:"The user with the tagged user was not found",
            ephemeral: true
        });

        let embed = new EmbedBuilder()
            .setTitle(`${discorduser.username}'s Balance`)
            .setDescription(`- GrowID: **${wallet1.GrowIDNow}**\n- Balance:** ${wallet1.Balance}** ${WL}`);
        
        await interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
    }
}