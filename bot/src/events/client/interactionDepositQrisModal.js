const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const client = require("../../index");
const Bal = require("../../Schema/balance.js");
const Qris = require("../../Schema/qris.js");
const { getEffectiveWLPrice } = require("../../utils/gtidPrice.js");
const { getQrisImageUrl, sendDepositLog } = require("../../utils/depositWatcher.js");
const { requestAutoDeposit, PanelError } = require("../../utils/panelWallet.js");
const { hostedQrCancelId } = require("../../utils/hostedQrCancel");
const { serverId } = require("../../config/config.json");
const { buttons, models, menuId, storefrontAction, rupiahCredit, interactionEmojis } = require("../../config/storefront");
const { COLOR } = require("../../config/configemoji.json");

module.exports = {
    name: "interactionDepositQrisModal",
};

/**
 * Alur QRIS otomatis: QR dinamis dari panel, saldo masuk sendiri begitu webhook pembayaran diterima.
 * Transaksi dicatat SEBELUM DM dikirim, supaya webhook yang datang cepat tetap menemukan ordernya.
 */
function creditDetails(nominal, wlAmount, pricePerWL, rupiah, WL) {
    return rupiah
        ? `> Saldo Rupiah diterima: **Rp${nominal.toLocaleString("id-ID")}**\n` +
          "> Setelah lunas, gunakan **Convert Rp to WL** untuk menukar saldo sesuai kurs saat itu.\n"
        : `> Rate: **Rp${pricePerWL.toLocaleString("id-ID")}/WL**\n> Balance Diterima: **${wlAmount} ${WL}**\n`;
}

async function handleAutoDeposit(interaction, wallet, panel, pricePerWL, rupiah, emojis) {
    const { wl: WL, warning: Warning, paymentOk, paymentWarning } = emojis;
    const wlAmount = rupiah ? 0 : (panel.hostedWL ?? Math.floor(panel.amount / pricePerWL));

    if (!rupiah && wlAmount < 1) {
        return interaction.editReply({
            content: `${Warning} Nominal terlalu kecil. Minimal **Rp${pricePerWL.toLocaleString("id-ID")}** untuk 1 ${WL}.`,
        });
    }

    const embed = new EmbedBuilder()
        .setTitle("Deposit QRIS")
        .setDescription(
            `Scan QR di bawah ini menggunakan aplikasi e-wallet/mobile banking kamu\n\n` +
            `> Order ID: \`${panel.orderId}\`\n` +
            `> Nominal: **Rp${panel.amount.toLocaleString("id-ID")}**\n` +
            creditDetails(panel.amount, wlAmount, pricePerWL, rupiah, WL) +
            `> Berlaku sampai: <t:${Math.floor(panel.expiresAt / 1000)}:R>\n\n` +
            `${paymentOk} Pembayaran **diverifikasi otomatis**. Balance masuk sendiri beberapa saat setelah kamu membayar, tidak perlu menunggu admin.\n` +
            `${paymentWarning} Bayar sesuai nominal **Rp${panel.amount.toLocaleString("id-ID")}** dan sebelum QR kedaluwarsa. Simpan Order ID di atas kalau ada kendala.`
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

    // Hosted deposits are credited by the panel transaction, with no manual
    // approval button for the same payment.
    let qrisDoc;
    try {
        qrisDoc = await Qris.create({
            orderId: panel.orderId,
            mode: "auto",
            panelManaged: panel.panelManaged === true || panel.hostedWL !== undefined,
            discordId: interaction.user.id,
            growId: wallet.GrowIDNow,
            grossAmount: panel.amount,
            wlAmount,
            ...(rupiah ? { creditCurrency: rupiahCredit } : {}),
        });
    } catch (err) {
        console.error("Gagal menyimpan transaksi QRIS otomatis:", err);
        return interaction.editReply({
            content: `${Warning} Gagal menyimpan transaksi deposit. Coba lagi beberapa saat lagi.`,
        });
    }

    if (qrisDoc.panelManaged) {
        const components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(hostedQrCancelId(serverId, panel.orderId)).setLabel("Batalkan")
                .setStyle(ButtonStyle.Danger),
        )];
        const sent = await interaction.user.send({ embeds: [embed], files, components }).catch(() => null);
        if (sent) {
            await Qris.updateOne({ orderId: panel.orderId }, { $set: {
                dmChannelId: sent.channelId, dmMessageId: sent.id,
            } });
        }
        await sendDepositLog(qrisDoc);
        return sent ? interaction.editReply({
            content: `${paymentOk} ${rupiah ? "QR dikirim lewat DM. Setelah lunas, saldo Rupiah akan bertambah." : "QR Code deposit kamu sudah dikirim lewat **DM**. Bayar sesuai nominal, balance akan masuk **otomatis**!"}`,
        }) : interaction.editReply({ embeds: [embed], files, components });
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
        content: `${paymentOk} ${rupiah ? "QR dikirim lewat DM. Setelah lunas, saldo Rupiah akan bertambah." : "QR Code deposit kamu sudah dikirim lewat **DM**. Bayar sesuai nominal, balance akan masuk **otomatis**!"}`,
    });
}

client.on("interactionCreate", async (interaction) => {
    // Step 1: tombol "Deposit QRIS" diklik -> munculin modal
    const action = storefrontAction(interaction, serverId);
    if ((interaction.isButton() || interaction.customId === menuId) && ["depositqris_btn", buttons.qris].includes(action)) {
        const rupiah = action === buttons.qris;
        if (rupiah && interaction.guildId !== serverId) return;
        const wallet = await Bal.findOne({ DiscordID: interaction.user.id }).catch(console.error);

        if (!wallet) {
            const { warning: Warning } = await interactionEmojis(interaction, rupiah ? models.model1 : models.classic);
            return interaction.reply({
                content: `${Warning} **Set GrowID** kamu dulu sebelum melakukan deposit!`,
                ephemeral: true,
            });
        }

        const modal = new ModalBuilder()
            .setCustomId(rupiah ? "depositqris_modal_rp" : "depositqris_modal")
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
    if (interaction.isModalSubmit() && ["depositqris_modal", "depositqris_modal_rp"].includes(interaction.customId)) {
        const rupiah = interaction.customId === "depositqris_modal_rp";
        const model = rupiah ? models.model1 : models.classic;
        if (rupiah && interaction.guildId !== serverId) return;
        const nominalRaw = interaction.fields.getTextInputValue("nominal").replace(/[^0-9]/g, "");
        const nominal = Math.floor(Number(nominalRaw));

        if (!nominal || nominal < 100) {
            const { warning: Warning } = await interactionEmojis(interaction, model);
            return interaction.reply({
                content: `${Warning} Nominal tidak valid. Minimal deposit adalah **Rp100**`,
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });
        const emojis = await interactionEmojis(interaction, model);
        const { wl: WL, warning: Warning, paymentOk, paymentWarning } = emojis;

        try {
            const wallet = await Bal.findOne({ DiscordID: interaction.user.id }).catch(console.error);

            if (!wallet) {
                return interaction.editReply({
                    content: `${Warning} **Set GrowID** kamu dulu sebelum melakukan deposit!`,
                });
            }

            // Harga WL dicek lebih dulu, supaya QRIS otomatis tidak pernah dibuat untuk nominal yang tidak bernilai WL.
            const { pricePerWL } = rupiah ? {} : await getEffectiveWLPrice();

            if (!rupiah && !pricePerWL) {
                return interaction.editReply({
                    content: `${Warning} Harga WL belum tersedia (API down & belum ada harga manual). Coba lagi nanti.`,
                });
            }

            // Pilihan pembeli toko: QRIS otomatis (lewat panel) atau QRIS manual (/setqris). Panel yang menentukan modenya.
            let panel;
            try {
                panel = await requestAutoDeposit({ amount: nominal, discordId: interaction.user.id, pricePerWL,
                    creditCurrency: rupiah ? rupiahCredit : undefined });
            } catch (err) {
                if (!(err instanceof PanelError)) console.error("Deposit QRIS otomatis error:", err);
                return interaction.editReply({
                    content: `${Warning} ${err instanceof PanelError ? err.message : "Terjadi kesalahan saat membuat QRIS. Coba lagi nanti."}`,
                });
            }

            if (panel.mode === "auto") {
                if (rupiah && panel.creditCurrency !== rupiahCredit) {
                    return interaction.editReply("QRIS saldo Rupiah belum siap. Coba lagi sebentar.");
                }
                return handleAutoDeposit(interaction, wallet, panel, pricePerWL, rupiah, emojis);
            }

            const qrisImageUrl = await getQrisImageUrl();

            if (!qrisImageUrl) {
                return interaction.editReply({
                    content: `${Warning} QRIS deposit belum di-set oleh admin. Silakan hubungi admin/owner terlebih dahulu.`,
                });
            }

            const orderId = `GVRA-${interaction.user.id}-${Date.now()}`;
            const wlAmount = rupiah ? 0 : Math.floor(nominal / pricePerWL);

            const embed = new EmbedBuilder()
                .setTitle("Deposit QRIS")
                .setDescription(
                    `Scan QR di bawah ini menggunakan aplikasi e-wallet/mobile banking kamu\n\n` +
                    `> Order ID: \`${orderId}\`\n` +
                    `> Nominal: **Rp${nominal.toLocaleString("id-ID")}**\n` +
                    creditDetails(nominal, wlAmount, pricePerWL, rupiah, WL) + "\n" +
                    `${paymentWarning} QRIS ini **nominal bebas**, jadi pastikan kamu bayar dengan nominal yang **PAS/SESUAI** (Rp${nominal.toLocaleString("id-ID")}) supaya gampang diverifikasi.\n\n` +
                    `Setelah bayar, tunggu **admin memverifikasi pembayaran secara manual**. Balance akan otomatis masuk begitu dikonfirmasi. Simpan Order ID di atas untuk referensi kalau ada kendala.`
                )
                .setImage(qrisImageUrl)
                .setColor(COLOR)
                .setTimestamp();

            let qrisDoc;
            try {
                qrisDoc = await Qris.create({
                    orderId,
                    discordId: interaction.user.id,
                    growId: wallet.GrowIDNow,
                    grossAmount: nominal,
                    wlAmount,
                    ...(rupiah ? { creditCurrency: rupiahCredit } : {}),
                });
            } catch (err) {
                console.error("Gagal menyimpan transaksi QRIS ke database:", err);
                return interaction.editReply({
                    content: `${Warning} Gagal menyimpan transaksi deposit. Coba lagi beberapa saat lagi.`,
                });
            }

            const sentMessage = await interaction.user.send({ embeds: [embed] }).catch(() => null);
            if (!sentMessage) {
                await Qris.updateOne({ orderId, status: "pending" }, { $set: { status: "cancelled" } });
                return interaction.editReply({
                    content: `${Warning} Gagal mengirim DM ke kamu. Pastikan DM kamu terbuka untuk member server ini, lalu coba lagi.`,
                });
            }
            await Qris.updateOne({ orderId }, { $set: { dmChannelId: sentMessage.channelId, dmMessageId: sentMessage.id } })
                .catch(error => console.error("Gagal menyimpan ID pesan QRIS:", error.code || error.name));

            // Kirim log deposit (status PENDING + tombol Success/Cancel) ke channel donation
            sendDepositLog(qrisDoc).catch((err) => console.error("sendDepositLog error:", err.message));

            return interaction.editReply({
                content: `${paymentOk} QR Code deposit kamu sudah dikirim lewat **DM**. Silakan cek DM kamu, bayar sesuai nominal, dan tunggu konfirmasi admin!`,
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
