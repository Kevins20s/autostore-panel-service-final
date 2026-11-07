"use strict";

const { getDb, COL } = require("./shopdb");
const { hostedDbName } = require("./shared-tenants");
const { rupiahCredit } = require("../bot/src/config/storefront");

function createHostedCredit({ mongoUrl, openDb = getDb }) {
    return async ({ licenseId, orderId, discordId, hostedWL, hostedTenantId, creditCurrency, amount }) => {
        const rupiah = creditCurrency === rupiahCredit;
        const credit = rupiah ? amount : hostedWL;
        if (!mongoUrl || !licenseId || !/^\d{17,20}$/.test(discordId) ||
            !Number.isSafeInteger(credit) || credit < 1 || (rupiah && !hostedTenantId)) return false;
        const tenantId = hostedTenantId || licenseId;
        const db = await openDb("hosted:" + tenantId, mongoUrl, hostedDbName("autostore", tenantId));
        return db.client.withSession(session => session.withTransaction(async () => {
            const credits = db.collection("hostedcredits");
            const options = { session };
            if (await credits.findOne({ _id: orderId }, options)) return true;
            await credits.insertOne({ _id: orderId, discordId, ...(rupiah ? { rupiah: credit } : { wl: credit }), createdAt: new Date() }, options);
            const result = await db.collection(COL.bal).updateOne(
                { DiscordID: discordId },
                { $inc: rupiah ? { BalanceRp: credit } : { Balance: credit, Deposit: credit } },
                options,
            );
            if (!result.matchedCount) throw new Error("Hosted buyer not found");
            return true;
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }));
    };
}

module.exports = { createHostedCredit };
