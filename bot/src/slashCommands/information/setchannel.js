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
const setchannel = require("../../Schema/SettingChannel.js");
const  { Owner } = require("../../config/config.json");
module.exports = {
    name: 'setchannel',
    description: "Set Channel Deposit And Testimoni",
    accessableby: "admin",
    options: [
        {
            name: "testimoni",
            description: "Set Channel For Testimoni",
            type: ApplicationCommandOptionType.Channel,
            required: true
        },
        {
            name: "donationlog",
            description: "Set Channel For Donation Logs",
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
        const data1 = interaction.options.getChannel("testimoni");
        const data2 = interaction.options.getChannel("donationlog");
        const user = await client.users.fetch(Owner);

        const ChanelID = interaction.guild.channels.cache.get(`${data1.id}`);
        const ChanelID1 = interaction.guild.channels.cache.get(`${data2.id}`);

        if (!ChanelID.viewable) {
            return interaction.reply({
                content: "The provided channel is not visible to me",
                ephemeral: true
            })
        }
        if (!ChanelID1.viewable) {
            return interaction.reply({
                content: "The provided channel is not visible to me",
                ephemeral: true
            })
        }

        await setchannel.findOneAndUpdate(
            {},
            { $set: { ChanelTesti: data1.id, ChannelDonation: data2.id } },
            { upsert: true, new: true }
        )
            .then((res) => {
                console.log(res);
                const sendToOwner = new EmbedBuilder()
                .setTitle("Change Channel Options")
                .setDescription(
                    `
                    New Channel Testi: ${data1.id}
                    New Channel For Donation: ${data2.id}
                `.replace(/ {2,}/g, "")
                )
                .setTimestamp();
                user.send({ embeds: [sendToOwner] });
                interaction.reply({ content:`Succes Set Chanel Testimoni To **${data1}**\nSucces Set Chanel Donation To **${data2}**`, ephemeral: true });
            })
            .catch((e) => console.error(e));
    }
}
