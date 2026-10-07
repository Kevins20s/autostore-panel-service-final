const { ApplicationCommandOptionType } = require("discord.js");
const jasaPanel = require("../../Schema/jasaPanel.js");
const jasaConfig = require("../../Schema/jasaConfig.js");
const { getJasaTypeKeys, JASA_TYPES } = require("../../utils/jasaTypes.js");
const { buildJasaPanel } = require("../../utils/jasaPanelBuilder.js");
const { Benar, Salah, Warning } = require("../../config/emoji.js");

module.exports = {
    name: "setjasapanel",
    description: "Pasang panel jasa (PLANT/HARVEST/MOVE/PROVIDER/SPLICE dll) di sebuah channel",
    accessableby: "owner",
    options: [
        { name: "channel", description: "Channel untuk panel jasa", type: ApplicationCommandOptionType.Channel, required: true },
        { name: "nama_toko", description: "Nama toko yang ditampilkan di panel", type: ApplicationCommandOptionType.String, required: false },
    ],
    run: async (client, interaction) => {
        const channel = interaction.options.getChannel("channel");
        const namaToko = interaction.options.getString("nama_toko");

        if (!channel.viewable) {
            return interaction.reply({ content: "Channel itu tidak bisa saya lihat!", ephemeral: true });
        }

        // Defer duluan — command ini ngambil kurs live dari internet (bisa beberapa
        // detik) sebelum sempat kirim pesan, jadi harus ack dulu biar gak kena
        // "The application did not respond".
        await interaction.deferReply({ ephemeral: true });

        try {
            // Pastikan tiap jenis jasa punya dokumen config (kalau belum ada, dibuatin default CLOSE)
            for (const type of getJasaTypeKeys()) {
                await jasaConfig
                    .findOneAndUpdate(
                        { type },
                        { $setOnInsert: { type, status: "CLOSE", price: JASA_TYPES[type].defaultPrice, completed: 0 } },
                        { upsert: true }
                    )
                    .catch(console.error);
            }

            if (namaToko) {
                await jasaPanel.findOneAndUpdate({}, { $set: { storeName: namaToko } }, { upsert: true });
            }

            const payload = await buildJasaPanel();
            const message = await channel.send(payload);

            await jasaPanel.findOneAndUpdate({}, { $set: { channelId: channel.id, messageId: message.id } }, { upsert: true });

            await interaction.editReply({
                content: `${Benar} Panel jasa berhasil dipasang di ${channel}. Semua jenis jasa masih **CLOSE** — buka pakai \`/setjasaharga\` dulu buat tiap jenis yang mau dibuka.`,
            });
        } catch (err) {
            console.error("[setjasapanel] error:", err);
            await interaction.editReply({ content: `${Warning} Gagal pasang panel: \`${err.message}\`` }).catch(() => {});
        }
    },
};
