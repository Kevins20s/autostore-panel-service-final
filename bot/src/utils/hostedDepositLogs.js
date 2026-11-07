"use strict";

const config = require("../config/config.json");
const Qris = require("../Schema/qris");
const { EmbedBuilder } = require("discord.js");
const { COLOR, Benar } = require("../config/configemoji.json");
const { sendDepositLog, updateDepositLog, fetchDmMessage, formatDepositCredit } = require("./depositWatcher");
const { rupiahCredit } = require("../config/storefront");

function headers() {
    return {
        "X-License-Id": config.PanelLicenseId, "X-Hosted-Guild": config.serverId,
        Authorization: "Bearer " + config.PanelInternalToken,
    };
}

async function cancelHostedQris(trx) {
    const response = await fetch(config.PanelInternalUrl + "/internal/wallet/hosted-deposit/" +
        encodeURIComponent(trx.orderId) + "/cancel", {
        method: "POST", headers: headers(), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(response.status === 409 ? "Pembayaran sudah diterima atau status berubah. Tunggu pembaruan otomatis." : "Pembatalan belum bisa diproses. Coba lagi.");
    await Qris.updateOne({ _id: trx._id, status: "pending" }, { $set: { status: "cancelled", notificationPending: true } });
    const logged = await updateDepositLog(trx, "CANCELLED");
    const dm = await fetchDmMessage(trx);
    if (dm) await dm.edit({
        embeds: [new EmbedBuilder().setTitle("Deposit Dibatalkan").setColor(COLOR)
            .setDescription("Permintaan QRIS ditutup. Jika pembayaran sudah terlanjur dikirim, sistem tetap memproses pembayaran yang terverifikasi.")],
        components: [], attachments: [],
    }).catch(() => {});
    if (logged) await Qris.updateOne({ _id: trx._id }, { $set: { notificationPending: false } });
}

async function syncHostedDepositLogs() {
    const transactions = await Qris.find({
        panelManaged: true,
        $or: [{ status: { $in: ["pending", "cancelled"] } }, { notificationPending: true }],
    }).sort({ statusCheckedAt: 1 }).limit(20);
    for (let trx of transactions) {
        await Qris.updateOne({ _id: trx._id }, { $set: { statusCheckedAt: new Date() } });
        const response = await fetch(config.PanelInternalUrl + "/internal/wallet/hosted-deposit/" + encodeURIComponent(trx.orderId), {
            headers: headers(),
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) continue;
        const result = await response.json();
        if (result.amount !== trx.grossAmount || (trx.creditCurrency === rupiahCredit
            ? result.creditCurrency !== rupiahCredit : result.wl !== trx.wlAmount)) continue;
        if (!trx.logMessageId) {
            await sendDepositLog(trx);
            trx = await Qris.findById(trx._id);
        }
        if (result.status === "cancelled" && !result.credited) {
            if (trx.status !== "cancelled" || trx.notificationPending) {
                await Qris.updateOne({ _id: trx._id }, { $set: { status: "cancelled", notificationPending: true } });
                if (await updateDepositLog(trx, "CANCELLED")) {
                    await Qris.updateOne({ _id: trx._id }, { $set: { notificationPending: false } });
                }
            }
            continue;
        }
        if (!result.credited) continue;
        await Qris.updateOne({ _id: trx._id }, { $set: { status: "credited", notificationPending: true } });
        const logged = await updateDepositLog(trx, "SUCCESS");
        const dm = await fetchDmMessage(trx);
        if (dm) {
            const embed = new EmbedBuilder().setTitle("Deposit Berhasil")
                .setDescription(`${Benar} Pembayaran **Rp${trx.grossAmount.toLocaleString("id-ID")}** berhasil diverifikasi otomatis!\n\n> Order ID: \`${trx.orderId}\`\n> Balance Diterima: **${formatDepositCredit(trx)}**`)
                .setColor(COLOR).setTimestamp();
            await dm.edit({ embeds: [embed], components: [], attachments: [] }).catch(() => {});
        }
        if (logged) await Qris.updateOne({ _id: trx._id }, { $set: { notificationPending: false } });
    }
}

module.exports = { syncHostedDepositLogs, cancelHostedQris };
