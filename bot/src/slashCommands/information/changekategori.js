const {
    EmbedBuilder,
    Client,
    CommandInteraction,
    ApplicationCommandOptionType,
} = require("discord.js");
const list = require("../../Schema/list.js");
const { Owner } = require("../../config/config.json");

module.exports = {
    name: 'changekategori',
    description: "Change Kategori Of Product (buat multi-channel)",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "Code Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "kategori",
            description: "Kategori baru buat produk ini (misal: RDP, Armor)",
            type: ApplicationCommandOptionType.String,
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
        const kategoriBaru = interaction.options.getString("kategori").trim();

        const getCode = await list
            .findOne({ code: code })
            .catch(console.error);

        if (!getCode) return interaction.reply({
            content: `Product With That Code Doesn't Exist`,
            ephemeral: true
        });

        await list
            .updateOne(
                { code: code },
                { kategori: kategoriBaru }
            )
            .then((d) => {
                interaction.reply({
                    content: `Product Kategori Changed **${getCode.kategori ?? "ALL"}** to **${kategoriBaru}**`,
                    ephemeral: true
                });
            })
            .catch(console.error);
    }
}
