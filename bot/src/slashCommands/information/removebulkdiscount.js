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
let bulk = require("../../Schema/bulkdiscount.js");

module.exports = {
    name: 'removebulkdiscount',
    description: "Hapus satu tingkatan bulk discount dari produk",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "Code Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "minqty",
            description: "Minqty tingkatan yang mau dihapus",
            type: ApplicationCommandOptionType.Number,
            required: true
        }
    ],
    /**
     * @param {Client} client
     * @param {CommandInteraction} interaction
     * @param {String[]} args
     */
    run: async (client, interaction, args) => {
        const code = interaction.options.getString("code");
        const minQty = interaction.options.getNumber("minqty");

        const getTier = await bulk
            .findOne({ code: code, minQty: minQty })
            .then((res) => res)
            .catch(console.error);

        if (!getTier) return interaction.reply({
            content: "Tingkatan Bulk Discount Itu Tidak Ditemukan",
            ephemeral: true
        });

        await bulk
            .deleteOne({ code: code, minQty: minQty })
            .then(async () => {
                await interaction.reply({
                    content: `Bulk Discount **${minQty}+** Untuk **${code}** Berhasil Dihapus`,
                    ephemeral: true
                });
            })
            .catch(console.error);
    }
}
