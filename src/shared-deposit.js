"use strict";

const { getDb, COL } = require("./shopdb");
const { hostedDbName } = require("./shared-tenants");

function createHostedCredit({ mongoUrl, openDb = getDb }) {
    return async ({ licenseId, orderId, discordId, hostedWL, hostedTenantId }) => {
        if (!mongoUrl || !licenseId || !/^\d{17,20}$/.test(discordId) ||
            !Number.isSafeInteger(hostedWL) || hostedWL < 1) return false;
        const tenantId = hostedTenantId || licenseId;
        const db = await openDb("hosted:" + tenantId, mongoUrl, hostedDbName("autostore", tenantId));
        return db.client.withSession(session => session.withTransaction(async () => {
            const credits = db.collection("hostedcredits");
            const options = { session };
            if (await credits.findOne({ _id: orderId }, options)) return true;
            await credits.insertOne({ _id: orderId, discordId, wl: hostedWL, createdAt: new Date() }, options);
            const result = await db.collection(COL.bal).updateOne(
                { DiscordID: discordId },
                { $inc: { Balance: hostedWL, Deposit: hostedWL } },
                options,
            );
            if (!result.matchedCount) throw new Error("Hosted buyer not found");
            return true;
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }));
    };
}

module.exports = { createHostedCredit };
