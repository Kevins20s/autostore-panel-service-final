const { ApplicationCommandOptionType } = require("discord.js");
const jasaPromo = require("../../Schema/jasaPromo.js");

module.exports = {
    name: "setjasapromo",
    description: "Tambah atau hapus kode promo/diskon untuk order jasa",
    accessableby: "owner",
    options: [
        {
            name: "aksi",
            description: "add atau remove",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: "add", value: "add" },
                { name: "remove", value: "remove" },
            ],
        },
        { name: "kode", description: "Kode promo, contoh: DISKON50", type: ApplicationCommandOptionType.String, required: true },
        { name: "diskon_persen", description: "Persen diskon, contoh: 10 untuk 10% (wajib kalau aksi = add)", type: ApplicationCommandOptionType.Number, required: false },
    ],
    run: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });

        try {
            const aksi = interaction.options.getString("aksi");
            const kode = interaction.options.getString("kode").trim().toUpperCase();
            const persen = interaction.options.getNumber("diskon_persen");

            if (aksi === "add") {
                if (persen === null || persen <= 0 || persen >= 100) {
                    return interaction.editReply({ content: "Isi `diskon_persen` antara 1-99." });
                }
                await jasaPromo.findOneAndUpdate({ code: kode }, { $set: { discount: persen / 100 } }, { upsert: true });
                return interaction.editReply({ content: `✅ Kode promo **${kode}** aktif, diskon **${persen}%**.` });
            }

            await jasaPromo.deleteOne({ code: kode });
            return interaction.editReply({ content: `🗑️ Kode promo **${kode}** dihapus (kalau ada).` });
        } catch (err) {
            console.error("[setjasapromo] error:", err);
            await interaction.editReply({ content: `⚠️ Gagal: \`${err.message}\`` }).catch(() => {});
        }
    },
};
