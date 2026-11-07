"use strict";

const config = require("../config/config.json");
const Qris = require("../Schema/qris");
const { EmbedBuilder } = require("discord.js");
const { COLOR, WL, Benar } = require("../config/configemoji.json");
const { sendDepositLog, updateDepositLog, fetchDmMessage } = require("./depositWatcher");

async function syncHostedDepositLogs() {
    const transactions = await Qris.find({
        panelManaged: true,
        $or: [{ status: "pending" }, { notificationPending: true }],
    }).sort({ statusCheckedAt: 1 }).limit(20);
    for (let trx of transactions) {
        await Qris.updateOne({ _id: trx._id }, { $set: { statusCheckedAt: new Date() } });
        const response = await fetch(config.PanelInternalUrl + "/internal/wallet/hosted-deposit/" + encodeURIComponent(trx.orderId), {
            headers: {
                "X-License-Id": config.PanelLicenseId,
                "X-Hosted-Guild": config.serverId,
                Authorization: "Bearer " + config.PanelInternalToken,
            },
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) continue;
        const result = await response.json();
        if (result.amount !== trx.grossAmount || result.wl !== trx.wlAmount) continue;
        if (!trx.logMessageId) {
            await sendDepositLog(trx);
            trx = await Qris.findById(trx._id);
        }
        if (!result.credited) continue;
        await Qris.updateOne({ _id: trx._id }, { $set: { status: "credited", notificationPending: true } });
        const logged = await updateDepositLog(trx, "SUCCESS");
        const dm = await fetchDmMessage(trx);
        if (dm) {
            const embed = new EmbedBuilder().setTitle("Deposit Berhasil")
                .setDescription(`${Benar} Pembayaran **Rp${trx.grossAmount.toLocaleString("id-ID")}** berhasil diverifikasi otomatis!\n\n> Order ID: \`${trx.orderId}\`\n> Balance Diterima: **${trx.wlAmount} ${WL}**`)
                .setColor(COLOR).setTimestamp();
            await dm.edit({ embeds: [embed], components: [], attachments: [] }).catch(() => {});
        }
        if (logged) await Qris.updateOne({ _id: trx._id }, { $set: { notificationPending: false } });
    }
}

module.exports = { syncHostedDepositLogs };
