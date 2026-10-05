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
module.exports = {
    name: 'uptime',
    description: "sending informasi server",
    accessableby: "admin",
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        try {
            const Ct = Date.now();
            const UIS = Math.floor((Ct - client.startTime) / 1000);
            const day = Math.floor(UIS / 86400);
            const hours = Math.floor((UIS % 86400) / 3600);
            const minutes = Math.floor((UIS % 3600) / 60);
            const seconds = UIS % 60;
            
            const serverInfo = (
        `- Uptime: **${day} Days ${hours} Hours, ${minutes} Minutes, ${seconds} Seconds**\n` +
        `- Ping: **${client.ws.ping} Ms**`
        );

            const embeds = new EmbedBuilder()
                .setTitle("INFORMASI SERVER")
                .setDescription(serverInfo)
                .setTimestamp();

            await interaction.reply({
                embeds: [embeds],
                ephemeral: true
            });
        } catch (error) {
            console.error('Error fetching server information:', error);
            interaction.reply({
                content: `An error occurred while fetching server information.`,
                ephemeral: true
            });
        }
    }
}