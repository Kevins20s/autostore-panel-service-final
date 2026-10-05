const { EmbedBuilder, ApplicationCommandOptionType } = require("discord.js");
const WLRate = require("../../Schema/wlrate.js");
const { COLOR, WL } = require("../../config/configemoji.json");

module.exports = {
    name: "setwlprice",
    description: "Set Harga Cadangan 1 WL (dipakai kalau API gtid.pro sedang down)",
    accessableby: "admin",
    options: [
        {
            name: "harga",
            description: "Harga 1 WL dalam Rupiah, contoh: 150 atau 9,5",
            type: ApplicationCommandOptionType.String,
            required: true,
        },
    ],
    run: async (client, interaction, args) => {
        const hargaRaw = interaction.options.getString("harga");
        // Terima format koma (Indonesia, contoh: "9,5") maupun titik (contoh: "9.5")
        const hargaClean = hargaRaw.trim().replace(",", ".");
        const harga = parseFloat(hargaClean);

        if (isNaN(harga)) {
            return interaction.reply({
                content: "Harga tidak valid! Contoh format yang benar: `150` atau `9,5`",
                ephemeral: true,
            });
        }

        if (harga < 1) {
            return interaction.reply({
                content: "Harga harus lebih dari 0!",
                ephemeral: true,
            });
        }

        await WLRate.findOneAndUpdate(
            {},
            { $set: { pricePerWL: harga } },
            { upsert: true, new: true }
        );

        const embed = new EmbedBuilder()
            .setTitle("Harga WL Berhasil Diubah")
            .setDescription(`1 ${WL} WL sekarang setara dengan **Rp${harga.toLocaleString("id-ID")}**`)
            .setColor(COLOR)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
