const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    AttachmentBuilder,
} = require("discord.js");
const client = require("../../index");
const Bal = require("../../Schema/balance.js");
const Qris = require("../../Schema/qris.js");
const { getEffectiveWLPrice } = require("../../utils/gtidPrice.js");
const { getQrisImageUrl, sendDepositLog } = require("../../utils/depositWatcher.js");
const { requestAutoDeposit, PanelError } = require("../../utils/panelWallet.js");
const { COLOR, WL, Warning } = require("../../config/configemoji.json");

module.exports = {
    name: "interactionDepositQrisModal",
};

/**
 * Alur QRIS otomatis: QR dinamis dari panel, saldo masuk sendiri begitu webhook pembayaran diterima.
 * Transaksi dicatat SEBELUM DM dikirim, supaya webhook yang datang cepat tetap menemukan ordernya.
 */
async function handleAutoDeposit(interaction, wallet, panel, nominal, pricePerWL) {
    const wlAmount = Math.floor(panel.amount / pricePerWL);

    if (wlAmount < 1) {
        return interaction.editReply({
            content: `${Warning} Nominal terlalu kecil. Minimal **Rp${pricePerWL.toLocaleString("id-ID")}** untuk 1 ${WL}.`,
        });
    }

    let qrisDoc;
    try {
        qrisDoc = await Qris.create({
            orderId: panel.orderId,
            mode: "auto",
            discordId: interaction.user.id,
            growId: wallet.GrowIDNow,
            grossAmount: panel.amount,
            wlAmount,
        });
    } catch (err) {
        console.error("Gagal menyimpan transaksi QRIS otomatis:", err);
        return interaction.editReply({
            content: `${Warning} Gagal menyimpan transaksi deposit. Coba lagi beberapa saat lagi.`,
        });
    }

    const embed = new EmbedBuilder()
        .setTitle("Deposit QRIS")
        .setDescription(
            `Scan QR di bawah ini menggunakan aplikasi e-wallet/mobile banking kamu\n\n` +
            `> Order ID: \`${panel.orderId}\`\n` +
            `> Nominal: **Rp${panel.amount.toLocaleString("id-ID")}**\n` +
            `> Rate: **Rp${pricePerWL.toLocaleString("id-ID")}/WL**\n` +
            `> Balance Diterima: **${wlAmount} ${WL}**\n` +
            `> Berlaku sampai: <t:${Math.floor(panel.expiresAt / 1000)}:R>\n\n` +
            `✅ Pembayaran **diverifikasi otomatis**. Balance masuk sendiri beberapa saat setelah kamu membayar, tidak perlu menunggu admin.\n` +
            `⚠️ Bayar sesuai nominal **Rp${panel.amount.toLocaleString("id-ID")}** dan sebelum QR kedaluwarsa. Simpan Order ID di atas kalau ada kendala.`
        )
        .setColor(COLOR)
        .setTimestamp();

    const files = [];
    if (panel.qrPng) {
        files.push(new AttachmentBuilder(Buffer.from(panel.qrPng, "base64"), { name: "qris.png" }));
        embed.setImage("attachment://qris.png");
    } else if (panel.qrImageUrl) {
        embed.setImage(panel.qrImageUrl);
    }

    let sentMessage;
    try {
        sentMessage = await interaction.user.send({ embeds: [embed], files });
    } catch (err) {
        console.error("Gagal kirim DM:", err.message);
        await Qris.updateOne({ orderId: panel.orderId }, { $set: { status: "cancelled" } }).catch(console.error);
        return interaction.editReply({
            content: `${Warning} Gagal mengirim DM ke kamu. Pastikan DM kamu terbuka untuk member server ini, lalu coba lagi.`,
        });
    }

    qrisDoc = await Qris.findOneAndUpdate(
        { orderId: panel.orderId },
        { $set: { dmChannelId: sentMessage.channelId, dmMessageId: sentMessage.id } },
        { new: true }
    ).catch((err) => { console.error("Gagal menyimpan ID pesan DM:", err); return qrisDoc; });

    sendDepositLog(qrisDoc).catch((err) => console.error("sendDepositLog error:", err.message));

    return interaction.editReply({
        content: `✅ QR Code deposit kamu sudah dikirim lewat **DM**. Bayar sesuai nominal, balance akan masuk **otomatis**!`,
    });
}

client.on("interactionCreate", async (interaction) => {
    // Step 1: tombol "Deposit QRIS" diklik -> munculin modal
    if (interaction.isButton() && interaction.customId === "depositqris_btn") {
        const wallet = await Bal.findOne({ DiscordID: interaction.user.id }).catch(console.error);

        if (!wallet) {
            return interaction.reply({
                content: `${Warning} **Set GrowID** kamu dulu sebelum melakukan deposit!`,
                ephemeral: true,
            });
        }

        const modal = new ModalBuilder()
            .setCustomId("depositqris_modal")
            .setTitle("Deposit QRIS");

        const nominalInput = new TextInputBuilder()
            .setCustomId("nominal")
            .setLabel("Nominal Deposit (Rupiah)")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Contoh: 15000")
            .setMinLength(3)
            .setMaxLength(9)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(nominalInput));

        return interaction.showModal(modal);
    }

    // Step 2: modal disubmit -> hitung WL, tampilkan QRIS statis, kirim log ke admin
    if (interaction.isModalSubmit() && interaction.customId === "depositqris_modal") {
        const nominalRaw = interaction.fields.getTextInputValue("nominal").replace(/[^0-9]/g, "");
        const nominal = Math.floor(Number(nominalRaw));

        if (!nominal || nominal < 100) {
            return interaction.reply({
                content: `${Warning} Nominal tidak valid. Minimal deposit adalah **Rp100**`,
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const wallet = await Bal.findOne({ DiscordID: interaction.user.id }).catch(console.error);

            if (!wallet) {
                return interaction.editReply({
                    content: `${Warning} **Set GrowID** kamu dulu sebelum melakukan deposit!`,
                });
            }

            // Harga WL dicek lebih dulu, supaya QRIS otomatis tidak pernah dibuat untuk nominal yang tidak bernilai WL.
            const { pricePerWL } = await getEffectiveWLPrice();

            if (!pricePerWL) {
                return interaction.editReply({
                    content: `${Warning} Harga WL belum tersedia (API down & belum ada harga manual). Coba lagi nanti.`,
                });
            }

            // Pilihan pembeli toko: QRIS otomatis (lewat panel) atau QRIS manual (/setqris). Panel yang menentukan modenya.
            let panel;
            try {
                panel = await requestAutoDeposit({ amount: nominal, discordId: interaction.user.id });
            } catch (err) {
                if (!(err instanceof PanelError)) console.error("Deposit QRIS otomatis error:", err);
                return interaction.editReply({
                    content: `${Warning} ${err instanceof PanelError ? err.message : "Terjadi kesalahan saat membuat QRIS. Coba lagi nanti."}`,
                });
            }

            if (panel.mode === "auto") {
                return handleAutoDeposit(interaction, wallet, panel, nominal, pricePerWL);
            }

            const qrisImageUrl = await getQrisImageUrl();

            if (!qrisImageUrl) {
                return interaction.editReply({
                    content: `${Warning} QRIS deposit belum di-set oleh admin. Silakan hubungi admin/owner terlebih dahulu.`,
                });
            }

            const orderId = `GVRA-${interaction.user.id}-${Date.now()}`;
            const wlAmount = Math.floor(nominal / pricePerWL);

            const embed = new EmbedBuilder()
                .setTitle("Deposit QRIS")
                .setDescription(
                    `Scan QR di bawah ini menggunakan aplikasi e-wallet/mobile banking kamu\n\n` +
                    `> Order ID: \`${orderId}\`\n` +
                    `> Nominal: **Rp${nominal.toLocaleString("id-ID")}**\n` +
                    `> Rate: **Rp${pricePerWL.toLocaleString("id-ID")}/WL**\n` +
                    `> Balance Diterima: **${wlAmount} ${WL}**\n\n` +
                    `⚠️ QRIS ini **nominal bebas**, jadi pastikan kamu bayar dengan nominal yang **PAS/SESUAI** (Rp${nominal.toLocaleString("id-ID")}) supaya gampang diverifikasi.\n\n` +
                    `Setelah bayar, tunggu **admin memverifikasi pembayaran secara manual**. Balance akan otomatis masuk begitu dikonfirmasi. Simpan Order ID di atas untuk referensi kalau ada kendala.`
                )
                .setImage(qrisImageUrl)
                .setColor(COLOR)
                .setTimestamp();

            let sentMessage;
            try {
                sentMessage = await interaction.user.send({ embeds: [embed] });
            } catch (err) {
                console.error("Gagal kirim DM:", err.message);
                return interaction.editReply({
                    content: `${Warning} Gagal mengirim DM ke kamu. Pastikan DM kamu terbuka untuk member server ini, lalu coba lagi.`,
                });
            }

            let qrisDoc;
            try {
                qrisDoc = await Qris.create({
                    orderId,
                    discordId: interaction.user.id,
                    growId: wallet.GrowIDNow,
                    dmChannelId: sentMessage.channelId,
                    dmMessageId: sentMessage.id,
                    grossAmount: nominal,
                    wlAmount,
                });
            } catch (err) {
                console.error("Gagal menyimpan transaksi QRIS ke database:", err);
                return interaction.editReply({
                    content: `${Warning} Gagal menyimpan transaksi deposit. Coba lagi beberapa saat lagi.`,
                });
            }

            // Kirim log deposit (status PENDING + tombol Success/Cancel) ke channel donation
            sendDepositLog(qrisDoc).catch((err) => console.error("sendDepositLog error:", err.message));

            return interaction.editReply({
                content: `✅ QR Code deposit kamu sudah dikirim lewat **DM**. Silakan cek DM kamu, bayar sesuai nominal, dan tunggu konfirmasi admin!`,
            });
        } catch (err) {
            console.error("Deposit QRIS modal error:", err);
            return interaction
                .editReply({
                    content: `${Warning} Terjadi kesalahan saat memproses deposit kamu. Coba lagi beberapa saat lagi.`,
                })
                .catch(() => {});
        }
    }
});
