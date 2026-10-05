const {
    EmbedBuilder,
    Client,
    CommandInteraction,
    ApplicationCommandOptionType,
} = require("discord.js");
const setchannel = require("../../Schema/SettingChannel.js");
const { Owner } = require("../../config/config.json");

module.exports = {
    name: 'setrestockchannel',
    description: "Set Channel For Restock Notification",
    accessableby: "admin",
    options: [
        {
            name: "channel",
            description: "Channel To Send Restock Notification",
            type: ApplicationCommandOptionType.Channel,
            required: true
        }
    ],
    /**
     * @param {Client} client
     * @param {CommandInteraction} interaction
     * @param {String[]} args
     */
    run: async (client, interaction, args) => {
        const channelOpt = interaction.options.getChannel("channel");
        const user = await client.users.fetch(Owner);

        const channelCheck = interaction.guild.channels.cache.get(channelOpt.id);
        if (!channelCheck.viewable) {
            return interaction.reply({
                content: "The provided channel is not visible to me",
                ephemeral: true
            });
        }

        await setchannel.findOneAndUpdate(
            {},
            { $set: { ChannelRestock: channelOpt.id } },
            { upsert: true, new: true }
        )
            .then((res) => {
                const sendToOwner = new EmbedBuilder()
                    .setTitle("Change Restock Channel")
                    .setDescription(`New Channel For Restock Notification: ${channelOpt.id}`)
                    .setTimestamp();
                user.send({ embeds: [sendToOwner] });
                interaction.reply({
                    content: `Success Set Restock Channel To **${channelOpt}**`,
                    ephemeral: true
                });
            })
            .catch((e) => console.error(e));
    }
}