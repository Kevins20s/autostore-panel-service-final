"use strict";

const mongoose = require("mongoose");
const Balance = require("../Schema/balance");
const units = new Map([["worldlock", 1], ["diamondlock", 100], ["bluegemlock", 10000]]);

async function creditWorldDeposit(message, settings) {
    if (!settings?.DonationWebhookId || message.webhookId !== settings.DonationWebhookId ||
        message.channelId !== settings.ChannelDonation || !/^\d{17,20}$/.test(message.id)) return null;
    const description = message.embeds[0]?.description || "";
    if (/tidak dikonfirmasi/i.test(description)) return null;
    const growId = description.match(/GrowID: ([A-Za-z0-9_]{1,24})[ \t]*\r?\n/i)?.[1]?.toLowerCase();
    const donation = description.match(/Amount: (\d+) (World\s*Lock|Diamond\s*Lock|Blue\s*Gem\s*Lock)\b/i);
    const amount = donation && Number(donation[1]) * units.get(donation[2].replace(/\s/g, "").toLowerCase());
    if (!growId || !Number.isSafeInteger(amount) || amount < 1) return null;

    const receipts = mongoose.connection.db.collection("worlddepositreceipts");
    return mongoose.connection.transaction(async session => {
        const receipt = { _id: message.id, growId, amount, createdAt: new Date() };
        if (await receipts.findOne({ _id: receipt._id }, { session })) return null;
        const buyer = await Balance.findOneAndUpdate({ GrowID: growId },
            { $inc: { Balance: amount, Deposit: amount } }, { session, new: true });
        if (!buyer) return null;
        await receipts.insertOne(receipt, { session });
        return { discordId: buyer.DiscordID, balance: buyer.Balance, amount,
            growId, quantity: donation[1], unit: donation[2].replace(/\s/g, "").toLowerCase() };
    });
}

module.exports = { creditWorldDeposit };
