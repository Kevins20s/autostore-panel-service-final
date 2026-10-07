const { ApplicationCommandOptionType } = require("discord.js");
const jasaConfig = require("../../Schema/jasaConfig.js");
const { getJasaTypeKeys, JASA_TYPES } = require("../../utils/jasaTypes.js");
const { refreshJasaPanel } = require("../../utils/jasaPanelBuilder.js");
const { Benar, Warning } = require("../../config/emoji.js");

module.exports = {
    name: "setjasaharga",
    description: "Atur status (OPEN/CLOSE) dan harga (WL) untuk satu jenis jasa",
    accessableby: "owner",
    options: [
        {
            name: "jenis",
            description: "Jenis jasa yang mau diatur",
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: getJasaTypeKeys().map((t) => ({ name: t, value: t })),
        },
        {
            name: "status",
            description: "OPEN atau CLOSE",
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: "OPEN", value: "OPEN" },
                { name: "CLOSE", value: "CLOSE" },
            ],
        },
        { name: "harga", description: "Harga WL per unit (per World, atau per block untuk MOVE)", type: ApplicationCommandOptionType.Number, required: false },
    ],
    run: async (client, interaction) => {
        // Defer PALING PERTAMA, sebelum kesentuh database sama sekali. Ini
        // langsung "acknowledge" interaksinya ke Discord (< 1 detik), jadi apapun
        // yang terjadi setelahnya (DB lambat/nyangkut dll) gak akan bikin
        // "The application did not respond" lagi. Kita punya 15 menit buat
        // editReply setelah defer ini.
        await interaction.deferReply({ ephemeral: true });

        try {
            const jenis = interaction.options.getString("jenis");
            const status = interaction.options.getString("status");
            const harga = interaction.options.getNumber("harga");

            if (!status && harga === null) {
                return interaction.editReply({ content: `${Warning} Isi minimal salah satu dari \`status\` atau \`harga\`.` });
            }

            const update = {};
            if (status) update.status = status;
            if (harga !== null) update.price = harga;

            await jasaConfig.findOneAndUpdate(
                { type: jenis },
                {
                    $set: update,
                    $setOnInsert: {
                        type: jenis,
                        completed: 0,
                        ...(update.price === undefined ? { price: JASA_TYPES[jenis].defaultPrice } : {}),
                        ...(update.status === undefined ? { status: "CLOSE" } : {}),
                    },
                },
                { upsert: true }
            );

            await interaction.editReply({
                content: `${Benar} Jasa **${jenis}** diperbarui.${status ? ` Status: **${status}**.` : ""}${harga !== null ? ` Harga: **${harga} WL**.` : ""}`,
            });

            refreshJasaPanel(client).catch(console.error);
        } catch (err) {
            console.error("[setjasaharga] error:", err);
            await interaction.editReply({ content: `${Warning} Gagal update: \`${err.message}\`` }).catch(() => {});
        }
    },
};
