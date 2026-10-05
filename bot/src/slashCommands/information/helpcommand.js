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
const { Owner, Admin } = require("../../config/config.json");
const chanol = require("../../Schema/SettingChannel");
const {
    Warning,
    ARROW,
    COLOR,
    CROWN,
    imageUrl
} = require("../../config/configemoji.json");
module.exports = {
    name: 'help',
    description: "help commands",
    accessableby: "everyone",
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        try {
            let channelstock = await chanol
                .findOne({})
                .then((d) => {
                    return d?.ChannelStock;
                })
                .catch(console.error);

            if (!channelstock) return interaction.reply({
                content:"/setchannel first before use this commands!",
                ephemeral: true
            });

            const publicCmds = [];
            const adminCmds = [];

            client.slash.forEach((command) => {
                const cmdString = `**/${command.name}**\n${ARROW} ${command.description}`;
                const cmdStrings = `**/${command.name}**\n${ARROW} ${command.description}`;
                if (command.accessableby === "everyone") {
                    publicCmds.push(cmdString);
                } else if (command.accessableby === "admin") {
                    adminCmds.push(cmdStrings);
                }
            });

            const publicCmdList = publicCmds.join("\n");
            const adminCmdList = adminCmds.join("\n");
            let text;

            if (
                !interaction.user.bot &&
                !Admin.includes(interaction.user.id) &&
                interaction.user.id !== Owner
            ) {
                text = 
                    `${CROWN} **Available Slash Commands** ${CROWN}\n\n` + 
                    publicCmdList +
                    `\n\n${Warning} **HOW TO BUY** ${Warning}\n` +
                    `${ARROW} Just Go Here: <#${channelstock}>\n` +
                    `- Click Button **Set GrowID**\n` +
                    `- Make Sure Click Button **Balance** To Check Your GrowID\n` +
                    `- Click Button **Deposit** To See World Deposit\n` +
                    `- Click Button **Buy** For Buying The Items`;
            } else {
                text =
                    `${CROWN} **Available Slash Commands** ${CROWN}\n\n` +
                    adminCmdList +
                    "\n" +
                    publicCmdList;
            }

            const help = new EmbedBuilder()
                .setDescription(text)
                .setFooter({
                    text: `Use /help for Commands`,
                    iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
                })
                .setColor(COLOR)
                .setTimestamp()
                .setImage(imageUrl);

            await interaction.reply({
                embeds: [help],
                ephemeral: true
            });

        } catch (error) {
            console.error(error);
        }
    }
}