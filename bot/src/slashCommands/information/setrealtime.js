const {
    EmbedBuilder,
    Client,
    CommandInteraction,
    ApplicationCommandOptionType,
} = require("discord.js");
let RealtimeChannel = require("../../Schema/RealtimeChannel.js");
let { Owner } = require("../../config/config.json");

module.exports = {
    name: 'setrealtime',
    description: "Set Realtime Channel! (bisa dipisah per kategori produk)",
    accessableby: "admin",
    options: [
        {
            name: "channel",
            description: "Where Channel Do You Want To Send Realtime?",
            type: ApplicationCommandOptionType.Channel,
            required: true
        },
        {
            name: "kategori",
            description: "Kategori produk (harus sama persis kayak field 'kategori' di /addproduct).",
            type: ApplicationCommandOptionType.String,
            required: false
        }
    ],
    /** 
     * @param {Client} client 
     * @param {CommandInteraction} interaction
     * @param {String[]} args 
     */
    run: async (client, interaction, args) => {
        const data1 = interaction.options.getChannel("channel");
        const kategoriInput = interaction.options.getString("kategori");
        const kategori = kategoriInput ? kategoriInput.trim() : "ALL";

        const ChanelID = interaction.guild.channels.cache.get(`${data1.id}`);

        if (!ChanelID.viewable) {
            return interaction.reply({
                content: "The provided channel is not visible to me",
                ephemeral: true
            })
        }

        if (ChanelID) {
            const guya = await data1.send({
                content: kategori === "ALL"
                    ? `Prepare Auto Store Gevra`
                    : `Prepare Auto Store Gevra — Kategori: **${kategori}**`
            });

            await RealtimeChannel.findOneAndUpdate(
                { kategori },
                { $set: { channelId: data1.id, messageId: guya.id } },
                { upsert: true, new: true }
            )
                .then(async (res) => {
                    console.log(res);
                    await interaction.reply({
                        content: `Successfully Set Your Realtime To ${data1} (Kategori: **${kategori}**), MessageID: ${guya.id}`,
                        ephemeral: true
                    });
                })
                .catch(console.error);
        }
    }
}
