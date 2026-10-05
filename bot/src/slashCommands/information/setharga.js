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
const list = require("../../Schema/list.js");
const Price = require("../../Schema/priceproduct.js");
let { Owner } = require("../../config/config.json");
module.exports = {
    name: 'setprice',
    description: "Set Price For Product",
    accessableby: "admin",
    options: [
        {
            name: "code",
            description: "Code Of Product",
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: "price",
            description: "Howmany Price To Add In Product? contoh: 20 atau 9,5",
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
        // Defer PALING PERTAMA, sebelum ada DB call atau Discord API call apa pun.
        // Ini yang bikin "The application did not respond" — kalau ada yang lambat
        // (Mongo, atau client.users.fetch di bawah) sebelum sempat reply, Discord
        // keburu timeout di 3 detik. Defer langsung ack duluan, kita punya 15 menit
        // buat editReply setelahnya.
        await interaction.deferReply({ ephemeral: true });

        try {
            const wut = interaction.options.getString("code");
            const priceRaw = interaction.options.getString("price");
            // Terima format koma (Indonesia, contoh: "9,5") maupun titik (contoh: "9.5")
            const price = parseFloat(priceRaw.trim().replace(",", "."));

            if (isNaN(price)) {
                return interaction.editReply({ content: `Number No Falid!` });
            }

            const getCode = await list.findOne({ code: wut }).catch(console.error);
            if (!getCode) {
                return interaction.editReply({ content: "Code Not Found" });
            }

            const res = await Price.findOneAndUpdate(
                { code: wut },
                { price: parseFloat(price), code: wut, role: wut },
                { upsert: true, new: true }
            );

            await interaction.editReply({
                content: "Successfully Set " + res.code + " Price With Price " + res.price,
            });

            // Kirim history ke Owner, tapi jangan sampai gagalnya bikin command ini error
            // (misal Owner udah leave server / DM ditutup)
            client.users
                .fetch(Owner)
                .then((user) => {
                    const sendToOwner = new EmbedBuilder()
                        .setTitle("Price History")
                        .setDescription(
                            `
         Code: ${wut}
         New Price: ${parseFloat(price)}
       `.replace(/ {2,}/g, "")
                        )
                        .setTimestamp();
                    user.send({ embeds: [sendToOwner] }).catch(() => {});
                })
                .catch(() => {});
        } catch (err) {
            console.error("[setprice] error:", err);
            await interaction.editReply({ content: `⚠️ Gagal set price: \`${err.message}\`` }).catch(() => {});
        }
    }
}
