const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const client = require("../index.js");
const Qris = require("../Schema/qris.js");
const Bal = require("../Schema/balance.js");
const SettingChannel = require("../Schema/SettingChannel.js");
const { WL, COLOR } = require("../config/configemoji.json");
const { serverId } = require("../config/config.json");
const { rupiahCredit, models, interactionEmojis, componentEmoji } = require("../config/storefront");

const LOG_STATUS = {
    PENDING: { emoji: "paymentPending", color: 0xfee75c },
    SUCCESS: { emoji: "paymentOk", color: 0x57f287 },
    CANCELLED: { emoji: "paymentCancelled", color: 0xed4245 },
};

function formatDepositCredit(trx, wl = WL) {
    return trx.creditCurrency === rupiahCredit
        ? `Rp${trx.grossAmount.toLocaleString("id-ID")} ke saldo Rupiah` : `${trx.wlAmount} ${wl}`;
}

function depositEmojis(trx, channel) {
    const guild = client.guilds?.cache.get(serverId);
    const member = guild?.members.me;
    const appPermissions = channel && member ? channel.permissionsFor?.(member) : member?.permissions;
    return interactionEmojis({ guildId: serverId, guild, appPermissions },
        trx.creditCurrency === rupiahCredit ? models.model1 : models.classic);
}

function buildLogEmbed(trx, statusKey, emojis) {
    const style = LOG_STATUS[statusKey];
    const rate = trx.wlAmount ? Math.round(trx.grossAmount / trx.wlAmount) : null;

    const embed = new EmbedBuilder()
        .setTitle(`${emojis.paymentLog} QRIS Deposit (${trx.mode === "auto" ? "Otomatis" : "Manual"})`)
        .setColor(style.color)
        .addFields(
            { name: "Status", value: `${emojis[style.emoji]} ${statusKey}` },
            { name: "User", value: `<@${trx.discordId}>`, inline: true },
            { name: "GrowID", value: `\`${trx.growId || "-"}\``, inline: true },
            { name: "Order ID", value: `\`${trx.orderId}\`` },
            { name: "Amount", value: `Rp${trx.grossAmount.toLocaleString("id-ID")}`, inline: true },
            { name: "Saldo diterima", value: formatDepositCredit(trx, emojis.wl), inline: true },
            ...(trx.creditCurrency === rupiahCredit ? [] : [{ name: "Rate", value: rate ? `1 ${emojis.wl} = Rp${rate.toLocaleString("id-ID")}` : "-", inline: true }])
        )
        .setFooter({ text: trx.mode === "auto" ? "Auto-Store QRIS Deposit • Otomatis" : "Auto-Store QRIS Deposit • Konfirmasi Manual" })
        .setTimestamp();

    if (statusKey !== "PENDING" && trx.processedBy) {
        embed.addFields({
            name: statusKey === "SUCCESS" ? "Dikonfirmasi Oleh" : "Dibatalkan Oleh",
            value: `<@${trx.processedBy}>`,
        });
    }

    return embed;
}

function buildAdminButtons(orderId, emojis) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel("Success")
            .setEmoji(componentEmoji(emojis.paymentOk))
            .setStyle(ButtonStyle.Success)
            .setCustomId(`qrisadmin_success_${orderId}`),
        new ButtonBuilder()
            .setLabel("Cancel")
            .setEmoji(componentEmoji(emojis.paymentCancelButton))
            .setStyle(ButtonStyle.Danger)
            .setCustomId(`qrisadmin_cancel_${orderId}`)
    );
}

/**
 * Ambil URL gambar QRIS statis yang di-set admin lewat /setqris.
 * Selalu fetch fresh dari pesan aslinya (bukan simpan URL mentah), supaya
 * gak kena masalah URL attachment Discord yang bisa expired.
 */
async function getQrisImageUrl() {
    const setting = await SettingChannel.findOne({}).catch(() => null);
    if (!setting?.QrisImageChannelId || !setting?.QrisImageMessageId) return null;

    const channel = await client.channels.fetch(setting.QrisImageChannelId).catch(() => null);
    if (!channel) return null;

    const message = await channel.messages.fetch(setting.QrisImageMessageId).catch(() => null);
    if (!message) return null;

    return message.attachments.first()?.url ?? null;
}

/**
 * Kirim log deposit QRIS (status PENDING) ke channel donation (/setchannel donationlog),
 * lengkap dengan tombol Success/Cancel khusus admin/owner.
 * Menyimpan channelId + messageId ke dokumen Qris supaya bisa diedit belakangan.
 */
async function sendDepositLog(trx) {
    let claimed;
    try {
        claimed = await Qris.findOneAndUpdate({
            _id: trx._id, logMessageId: { $in: [null, ""] },
            $or: [{ logClaimUntil: { $exists: false } }, { logClaimUntil: { $lte: new Date() } }],
        }, { $set: { logClaimUntil: new Date(Date.now() + 60000) } }, { new: true });
        if (!claimed) return null;
        const setting = await SettingChannel.findOne({}).catch(() => null);
        const channelId = setting?.ChannelDonation;
        if (!channelId) return null;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return null;

        const emojis = await depositEmojis(trx, channel);
        const message = await channel.send({
            embeds: [buildLogEmbed(trx, "PENDING", emojis)],
            components: trx.panelManaged ? [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel("Cancel").setEmoji(componentEmoji(emojis.paymentCancelButton)).setStyle(ButtonStyle.Danger)
                    .setCustomId(`qrisadmin_cancel_${trx.orderId}`),
            )] : [buildAdminButtons(trx.orderId, emojis)],
            nonce: String(trx._id),
            enforceNonce: true,
        });

        await Qris.updateOne(
            { orderId: trx.orderId },
            { $set: { logChannelId: channel.id, logMessageId: message.id } }
        );

        return message;
    } catch (err) {
        console.error("Gagal kirim log deposit QRIS:", err.message);
        return null;
    } finally {
        if (claimed) await Qris.updateOne({ _id: trx._id }, { $unset: { logClaimUntil: "" } }).catch(() => {});
    }
}

/**
 * Update log deposit QRIS di channel donation jadi SUCCESS/CANCELLED, sekaligus
 * menghapus tombol Success/Cancel (biar gak bisa ditekan dobel).
 */
async function updateDepositLog(trx, statusKey) {
    try {
        if (!trx.logChannelId || !trx.logMessageId) {
            console.log("[DEBUG QRIS] updateDepositLog: SKIP, logChannelId/logMessageId kosong di dokumen trx.");
            return false;
        }

        const channel = await client.channels.fetch(trx.logChannelId).catch((err) => {
            console.error("[DEBUG QRIS] updateDepositLog: gagal fetch channel:", err.message);
            return null;
        });
        if (!channel) return false;

        const message = await channel.messages.fetch(trx.logMessageId).catch((err) => {
            console.error("[DEBUG QRIS] updateDepositLog: gagal fetch message log:", err.message);
            return null;
        });
        if (!message) return false;

        const emojis = await depositEmojis(trx, channel);
        await message.edit({ embeds: [buildLogEmbed(trx, statusKey, emojis)], components: [] });
        console.log("[DEBUG QRIS] updateDepositLog: berhasil edit log jadi", statusKey);
        return true;
    } catch (err) {
        console.error("Gagal update log deposit QRIS:", err);
        return false;
    }
}

/**
 * Ambil ulang pesan DM (QR yang dikirim ke user) dari channelId + messageId
 * yang tersimpan di dokumen Qris.
 */
async function fetchDmMessage(trx) {
    if (!trx.dmChannelId || !trx.dmMessageId) return null;
    const channel = await client.channels.fetch(trx.dmChannelId).catch(() => null);
    if (!channel) return null;
    return channel.messages.fetch(trx.dmMessageId).catch(() => null);
}

async function editMessageSafely(message, embed) {
    if (!message) {
        console.log("[DEBUG QRIS] editMessageSafely: SKIP, message DM tidak ditemukan.");
        return;
    }
    try {
        await message.edit({ embeds: [embed], components: [], attachments: [] });
    } catch (err) {
        console.error("Gagal update pesan deposit, coba fallback fetch ulang:", err.message);
        try {
            const channel = await client.channels.fetch(message.channelId);
            const freshMessage = await channel.messages.fetch(message.id);
            await freshMessage.edit({ embeds: [embed], components: [], attachments: [] });
            console.log("[DEBUG QRIS] editMessageSafely: berhasil edit pesan DM lewat fallback fetch.");
        } catch (err2) {
            console.error("Gagal update pesan deposit (fallback juga gagal):", err2.message);
        }
    }
}

/**
 * Dipanggil saat admin/owner menekan tombol Success. Kreditkan balance & edit
 * pesan DM + log jadi "Berhasil". Atomic (aman ditekan bersamaan admin lain).
 * @param {Object} trx - dokumen Qris
 * @param {import("discord.js").Message} message - pesan DM user (hasil fetchDmMessage)
 * @param {String} [processedBy] - Discord ID admin/owner yang menekan tombol
 */
async function creditRupiahDeposit(trx, processedBy, allowCancelled) {
    if (!Number.isSafeInteger(trx.grossAmount) || trx.grossAmount <= 0) return null;
    const order = { orderId: trx.orderId, creditCurrency: rupiahCredit };
    const eligible = allowCancelled ? { $in: ["pending", "cancelled"] } : "pending";
    const claimed = await Qris.findOneAndUpdate({ ...order, status: eligible },
        { $set: { status: "crediting", processedBy } }, { new: true })
        || await Qris.findOne({ ...order, status: "crediting" });
    if (!claimed) return null;

    // The order marker and the balance change commit in the same document, even on standalone MongoDB.
    const account = { DiscordID: claimed.discordId };
    const result = await Bal.updateOne({ ...account, RupiahCreditIds: { $ne: claimed.orderId } }, {
        $inc: { BalanceRp: claimed.grossAmount }, $addToSet: { RupiahCreditIds: claimed.orderId },
    });
    if (!result.matchedCount && !await Bal.exists({ ...account, RupiahCreditIds: claimed.orderId })) {
        throw new Error("Akun saldo Rupiah tidak ditemukan");
    }
    return Qris.findOneAndUpdate({ ...order, status: "crediting" }, { $set: { status: "credited" } }, { new: true });
}

async function creditDeposit(trx, message, processedBy, { allowCancelled = false, background = false } = {}) {
    if (trx.panelManaged) return false;
    console.log("[DEBUG QRIS] creditDeposit dipanggil untuk orderId:", trx.orderId, "| processedBy:", processedBy);

    const rupiah = trx.creditCurrency === rupiahCredit;
    const updated = rupiah ? await creditRupiahDeposit(trx, processedBy, allowCancelled) : await Qris.findOneAndUpdate(
        { orderId: trx.orderId, status: "pending" },
        { $set: { status: "credited", processedBy } }
    );

    if (!updated) {
        console.log("[DEBUG QRIS] creditDeposit: sudah diproses lebih dulu (status bukan pending), skip.");
        return false;
    }

    if (!rupiah) await Bal.updateOne(
        { DiscordID: trx.discordId },
        { $inc: { Balance: trx.wlAmount, Deposit: trx.wlAmount } }
    );

    trx.processedBy = rupiah ? updated.processedBy : processedBy;
    const notify = async () => {
        const dm = message === undefined ? await fetchDmMessage(trx) : message;
        if (dm) {
            const { success, wl } = await depositEmojis(trx);
            const embed = new EmbedBuilder().setTitle("Deposit Berhasil").setColor(COLOR).setTimestamp()
                .setDescription(`${success} Pembayaran **Rp${trx.grossAmount.toLocaleString("id-ID")}** berhasil ${processedBy ? "dikonfirmasi oleh admin" : "diverifikasi otomatis"}!\n\n` +
                    `> Order ID: \`${trx.orderId}\`\n> Balance Diterima: **${formatDepositCredit(trx, wl)}**`);
            await editMessageSafely(dm, embed);
        }
        await updateDepositLog(trx, "SUCCESS");
    };
    if (background) notify().catch(error => console.error("Gagal mengirim notifikasi QRIS:", error.code || error.name));
    else await notify();
    console.log("[DEBUG QRIS] creditDeposit: selesai.");
    return true;
}

/**
 * Dipanggil saat admin/owner menekan tombol Cancel. Batalkan transaksi & edit
 * pesan DM + log jadi "Dibatalkan". Atomic (aman ditekan bersamaan admin lain).
 * @param {Object} trx - dokumen Qris
 * @param {import("discord.js").Message} message - pesan DM user (hasil fetchDmMessage)
 * @param {String} [processedBy] - Discord ID admin/owner yang menekan tombol
 */
async function cancelDeposit(trx, message, processedBy) {
    if (trx.panelManaged) return false;
    console.log("[DEBUG QRIS] cancelDeposit dipanggil untuk orderId:", trx.orderId, "| processedBy:", processedBy);

    const updated = await Qris.findOneAndUpdate(
        { orderId: trx.orderId, status: "pending" },
        { $set: { status: "cancelled", processedBy } }
    );

    if (!updated) {
        console.log("[DEBUG QRIS] cancelDeposit: sudah diproses lebih dulu (status bukan pending), skip.");
        return false;
    }

    const { warning } = await depositEmojis(trx);
    const embed = new EmbedBuilder()
        .setTitle("Deposit Dibatalkan")
        .setDescription(
            `${warning} Transaksi deposit kamu **dibatalkan oleh admin** (pembayaran tidak ditemukan/tidak valid).\n\n` +
            `> Order ID: \`${trx.orderId}\`\n\n` +
            `Kalau kamu merasa ini keliru, silakan hubungi admin dan sertakan Order ID di atas.`
        )
        .setColor(COLOR)
        .setTimestamp();

    await editMessageSafely(message, embed);

    trx.processedBy = processedBy;
    await updateDepositLog(trx, "CANCELLED");
    console.log("[DEBUG QRIS] cancelDeposit: selesai.");
    return true;
}

module.exports = {
    sendDepositLog,
    updateDepositLog,
    fetchDmMessage,
    getQrisImageUrl,
    creditDeposit,
    formatDepositCredit,
    depositEmojis,
    cancelDeposit,
};
