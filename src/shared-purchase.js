"use strict";

const { COL } = require("./shopdb");

class PurchaseError extends Error {}

async function purchaseOne(db, { id, discordId, code, isActive }) {
    return db.client.withSession(session => session.withTransaction(async () => {
        if (!isActive()) throw new PurchaseError("Lisensi server ini sudah berubah.");
        const options = { session };
        const orders = db.collection(COL.orderlog);
        const receipts = db.collection("hostedreceipts");
        const previous = await receipts.findOne({ _id: id, discordId }, options);
        if (previous) return previous;
        if (await db.collection(COL.mt).findOne({ mt: true }, options)) {
            throw new PurchaseError("Toko sedang dalam pemeliharaan.");
        }
        const products = db.collection(COL.list);
        const product = await products.findOne({ code, type: "yes" }, options);
        const price = await db.collection(COL.price).findOne({ code }, options);
        if (!product || !Number.isFinite(price?.price) || price.price <= 0) {
            throw new PurchaseError("Produk stok ini belum tersedia untuk dibeli.");
        }
        // Pricing rules for these products still belong to the existing bot.
        if (await db.collection(COL.discount).findOne({ code }, options) ||
            await db.collection(COL.bulk).findOne({ code }, options)) {
            throw new PurchaseError("Produk dengan diskon belum tersedia di uji coba ini.");
        }
        const buyer = await db.collection(COL.bal).findOneAndUpdate(
            { DiscordID: discordId, Balance: { $gte: price.price } },
            { $inc: { Balance: -price.price } },
            options,
        );
        if (!buyer) throw new PurchaseError("Saldo WL tidak cukup.");
        const stock = await db.collection(COL.shop).findOneAndDelete(
            { code, data: { $type: "string", $ne: "" } }, { ...options, sort: { _id: 1 } },
        );
        if (!stock) throw new PurchaseError("Stok habis.");
        await products.updateOne({ _id: product._id }, { $inc: { sold: 1 } }, options);
        const receipt = { _id: id, discordId, code, total: price.price, data: stock.data };
        await receipts.insertOne(receipt, options);
        await orders.insertOne({
            discordId, growId: buyer.GrowIDNow || buyer.GrowID || "",
            code, productName: product.name || code, qty: 1, total: price.price, createdAt: new Date(),
        }, options);
        if (!isActive()) throw new PurchaseError("Lisensi server ini sudah berubah.");
        return receipt;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }));
}

module.exports = { purchaseOne, PurchaseError };
