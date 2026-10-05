const {
    EmbedBuilder,
    Client,
    CommandInteraction,
    ApplicationCommandOptionType,
} = require("discord.js");
const setchannel = require("../../Schema/SettingChannel.js");
const { COLOR, Benar, Warning } = require("../../config/configemoji.json");

module.exports = {
    name: "setqris",
    description: "Set gambar QRIS statis (nominal bebas) untuk Deposit QRIS manual",
    accessableby: "admin",
    options: [
        {
            name: "image",
            description: "Upload gambar QRIS kamu (QRIS biasa/nominal bebas, PNG/JPG)",
            type: ApplicationCommandOptionType.Attachment,
            required: true,
        },
    ],
    /**
     * @param {Client} client
     * @param {CommandInteraction} interaction
     * @param {String[]} args
     */
    run: async (client, interaction, args) => {
        const image = interaction.options.getAttachment("image");

        if (!image.contentType || !image.contentType.startsWith("image/")) {
            return interaction.reply({
                content: `${Warning} File harus berupa gambar (PNG/JPG/WEBP), bukan \`${image.contentType || "tipe tidak dikenal"}\`.`,
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Kirim ulang gambar sebagai pesan permanen di channel ini. Ini PENTING:
            // URL attachment Discord punya tanda tangan yang bisa expired kalau cuma
            // disimpan sebagai string mentah. Dengan nyimpen referensi pesannya,
            // bot bisa fetch ulang URL yang selalu fresh tiap kali dibutuhkan.
            const storedMessage = await interaction.channel.send({
                content:
                    `📌 **Gambar QRIS Deposit (Manual)**\n` +
                    `⚠️ Jangan hapus pesan ini — bot memakainya sebagai sumber gambar QRIS untuk fitur Deposit QRIS.`,
                files: [image.url],
            });

            const imageUrl = storedMessage.attachments.first()?.url;

            if (!imageUrl) {
                throw new Error("Gagal mendapatkan URL gambar setelah diupload ulang.");
            }

            await setchannel.findOneAndUpdate(
                {},
                {
                    $set: {
                        QrisImageChannelId: storedMessage.channelId,
                        QrisImageMessageId: storedMessage.id,
                    },
                },
                { upsert: true, new: true }
            );

            const embed = new EmbedBuilder()
                .setTitle("QRIS Deposit Berhasil Diupdate")
                .setDescription(
                    `${Benar} Gambar QRIS untuk **Deposit QRIS (manual)** sudah di-set.\n\n` +
                    `Mulai sekarang, gambar ini akan otomatis ditampilkan ke semua user yang melakukan Deposit QRIS.\n\n` +
                    `⚠️ Ingat, jangan hapus pesan penanda QRIS yang barusan saya kirim di channel ini.`
                )
                .setImage(imageUrl)
                .setColor(COLOR)
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error("setqris error:", err);
            return interaction.editReply({
                content: `${Warning} Gagal menyimpan QRIS: ${err.message}`,
            });
        }
    },
};
