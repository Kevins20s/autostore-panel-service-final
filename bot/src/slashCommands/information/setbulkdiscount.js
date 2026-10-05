let {
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
let list = require("../../Schema/list.js");
let Price = require("../../Schema/priceproduct.js");
let bulk = require("../../Schema/bulkdiscount.js");
let { Owner } = require("../../config/config.json");

module.exports = {
    name: 'setbulkdiscount',
    description: "Set potongan harga per unit kalau beli dalam jumlah tertentu",
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
            description: "Minimal jumlah beli supaya dapat potongan (contoh: 50)",
            type: ApplicationCommandOptionType.Number,
            required: true
        },
        {
            name: "cut",
            description: "Potongan harga per unit dalam WL (contoh: 10)",
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
        const wut = interaction.options.getString("code");
        const minQty = interaction.options.getNumber("minqty");
        const cut = interaction.options.getNumber("cut");
        const user = await client.users.fetch(Owner);

        const getCode = await list
            .findOne({ code: wut })
            .then((res) => res)
            .catch(console.error);

        if (!getCode) return interaction.reply({ content: "Code Not Found", ephemeral: true });

        let price = await Price
            .findOne({ code: wut })
            .then((d) => d?.price)
            .catch(console.error);

        if (!price) return interaction.reply({
            content: "Set Price First Before Use This Commands!",
            ephemeral: true
        });

        if (isNaN(minQty) || minQty < 1) return interaction.reply({
            content: "Minqty Harus Angka Positif!",
            ephemeral: true
        });

        if (isNaN(cut) || cut < 1) return interaction.reply({
            content: "Cut Harus Angka Positif!",
            ephemeral: true
        });

        if (cut >= price) return interaction.reply({
            content: "Potongan Tidak Boleh Lebih Besar/Sama Dengan Harga Produk!",
            ephemeral: true
        });

        await bulk.findOneAndUpdate(
            { code: wut, minQty: minQty },
            { $set: { cut: cut } },
            { upsert: true, new: true }
        )
            .then((res) => {
                interaction.reply({
                    content: `Successfully Set Bulk Discount For **${wut}**: Beli **${minQty}+** → Potongan **${cut} WL**/unit`,
                    ephemeral: true
                });
                const sendToOwner = new EmbedBuilder()
                    .setTitle("Bulk Discount History")
                    .setDescription(
                        `
         Code: ${wut}
         Min Qty: ${minQty}
         Cut Per Unit: ${cut} WL
       `.replace(/ {2,}/g, "")
                    )
                    .setTimestamp();
                user.send({ embeds: [sendToOwner] }).catch(console.error);
            })
            .catch(console.error);
    }
}
