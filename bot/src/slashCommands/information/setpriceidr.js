"use strict";

const { ApplicationCommandOptionType, MessageFlags } = require("discord.js");
const Product = require("../../Schema/list.js");
const { qrisPriceMin, qrisPriceMax, validQrisPrice } = require("../../config/storefront");

module.exports = {
    name: "setpriceidr",
    description: "Atur harga tetap Rupiah untuk QRIS Model 3",
    accessableby: "admin",
    hostedOnly: true,
    options: [
        { name: "code", description: "Kode produk", type: ApplicationCommandOptionType.String, required: true },
        { name: "rupiah", description: "Harga per item, contoh 20000 untuk Rp20.000", type: ApplicationCommandOptionType.Integer,
            min_value: qrisPriceMin, max_value: qrisPriceMax, required: true },
    ],
    async run(_client, interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const code = interaction.options.getString("code", true).trim();
        const priceIdr = interaction.options.getInteger("rupiah", true);
        if (!validQrisPrice(priceIdr)) return interaction.editReply("Harga QRIS harus antara Rp1.000 dan Rp1.000.000.");

        try {
            const product = await Product.findOneAndUpdate({ code }, { $set: { priceIdr } });
            if (!product) return interaction.editReply("Kode produk tidak ditemukan. Periksa kode dan huruf besar/kecilnya.");
            return interaction.editReply(`Harga QRIS **${code}** disimpan sebesar **Rp${priceIdr.toLocaleString("id-ID")}** per item. Katalog Model 3 akan memuatnya saat pembaruan berikutnya.`);
        } catch (error) {
            console.error("[SETPRICEIDR]", error.code || error.name);
            return interaction.editReply("Harga QRIS belum tersimpan. Coba lagi sebentar.");
        }
    },
};
