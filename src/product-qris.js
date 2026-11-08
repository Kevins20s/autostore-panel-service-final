"use strict";

const { getDb, COL } = require("./shopdb");
const { hostedDbName } = require("./shared-tenants");
const { WalletError } = require("./walletdb");
const { models, collection } = require("../bot/src/config/storefront");

const codePattern = /^[A-Za-z0-9_-]{1,32}$/;
const buyerPattern = /^\d{17,20}$/;
const sellable = code => ({ code, data: { $type: "string", $ne: "" } });

function createProductQris({ mongoUrl, botToken, openDb = getDb, discordFetch = fetch }) {
    const dbFor = tenantId => openDb("hosted:" + tenantId, mongoUrl, hostedDbName("autostore", tenantId));
    const transaction = (db, run) => db.client.withSession(session => session.withTransaction(
        () => run({ session }), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }));

    async function productAt(db, guildId, code, options) {
        if (!codePattern.test(code)) throw new WalletError("Kode produk tidak valid.");
        if ((await db.collection(collection).findOne({ _id: guildId }, options))?.model !== models.model3) {
            throw new WalletError("Katalog ini sudah berubah. Muat ulang katalog.", 409);
        }
        if (await db.collection(COL.mt).findOne({ mt: true }, options)) throw new WalletError("Toko sedang dalam pemeliharaan.", 409);
        const product = await db.collection(COL.list).findOne({ code }, options);
        if (!product) throw new WalletError("Produk tidak ditemukan.", 404);
        if (!Number.isSafeInteger(product.priceIdr) || product.priceIdr < 1000 || product.priceIdr > 1000000) {
            throw new WalletError("Harga QRIS produk ini belum diatur.", 409);
        }
        return product;
    }

    async function quote(tenant, code) {
        const db = await dbFor(tenant.tenantId);
        return productAt(db, tenant.guildId, code);
    }

    async function takeStock(db, code, script, options) {
        const query = { ...options, sort: { _id: 1 } };
        return script ? db.collection(COL.shop).findOne(sellable(code), query)
            : db.collection(COL.shop).findOneAndDelete(sellable(code), query);
    }

    async function reserve(dep) {
        const db = await dbFor(dep.hostedTenantId);
        return transaction(db, async options => {
            const { code, guildId } = dep.productOrder;
            const product = await productAt(db, guildId, code, options);
            if (product.priceIdr !== dep.amount) throw new WalletError("Harga produk baru berubah. Pilih Buy lagi.", 409);
            const script = product.type?.includes("script") === true;
            const stock = await takeStock(db, code, script, options);
            if (!stock) throw new WalletError("Stok produk ini habis.", 409);
            await db.collection("qrisproductorders").insertOne({
                _id: dep.orderId, discordId: dep.discordId, productId: product._id,
                code, productName: product.name, role: product.role, amount: dep.amount, script, stock, status: "reserved",
            }, options);
        });
    }

    async function release(dep) {
        const db = await dbFor(dep.hostedTenantId);
        return transaction(db, async options => {
            const orders = db.collection("qrisproductorders");
            const order = await orders.findOne({ _id: dep.orderId, status: "reserved" }, options);
            if (!order) return;
            if (!order.script && await db.collection(COL.list).findOne({ _id: order.productId }, options)) {
                await db.collection(COL.shop).insertOne(order.stock, options);
            }
            await orders.updateOne({ _id: order._id }, { $set: { status: "released" }, $unset: { stock: "" } }, options);
        });
    }

    async function fulfill(db, dep) {
        return transaction(db, async options => {
            const orders = db.collection("qrisproductorders");
            const order = await orders.findOne({ _id: dep.orderId, discordId: dep.discordId }, options);
            if (!order || order.amount !== dep.amount) return null;
            if (order.status === "fulfilled") return order;
            let stock = order.stock;
            if (order.status === "released") {
                // A late payment may use a replacement only from the original product.
                if (!await db.collection(COL.list).findOne({ _id: order.productId }, options)) return null;
                stock = await takeStock(db, order.code, order.script, options);
            }
            if (!stock) return null;
            const counter = await db.collection("orders").findOneAndUpdate({}, { $inc: { Order: 1 } },
                { ...options, upsert: true, returnDocument: "after" });
            await db.collection(COL.list).updateOne({ _id: order.productId }, { $inc: { sold: 1 } }, options);
            await db.collection(COL.orderlog).insertOne({
                orderNumber: counter.Order, discordId: order.discordId, code: order.code, productName: order.productName,
                qty: 1, totalIdr: order.amount, createdAt: new Date(),
            }, options);
            const result = { status: "fulfilled", orderNumber: counter.Order, stock };
            await orders.updateOne({ _id: order._id }, { $set: result }, options);
            return { ...order, ...result };
        });
    }

    function discord(path, init = {}) {
        return discordFetch("https://discord.com/api/v10" + path, {
            ...init, headers: { Authorization: "Bot " + botToken, ...init.headers }, signal: AbortSignal.timeout(8000),
        });
    }

    async function sendDm(order) {
        if (!botToken) return false;
        const channel = await discord("/users/@me/channels", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recipient_id: order.discordId }),
        });
        if (!channel.ok) return false;
        const { id } = await channel.json();
        if (!buyerPattern.test(id)) return false;
        const form = new FormData();
        form.set("payload_json", JSON.stringify({
            content: `Pembayaran QRIS berhasil. File pesanan #${order.orderNumber} (${order.productName}) terlampir.`,
            allowed_mentions: { parse: [] }, nonce: order._id, enforce_nonce: true,
        }));
        form.set("files[0]", new Blob([order.stock.data], { type: "text/plain" }), `order-${order.orderNumber}.txt`);
        return (await discord("/channels/" + id + "/messages", { method: "POST", body: form })).ok;
    }

    async function recordDiscordSale(db, guildId, order) {
        if (!botToken) return;
        const log = async () => {
            const channelId = (await db.collection("setchannels").findOne({}))?.ChanelTesti;
            if (!buyerPattern.test(channelId)) return;
            const channel = await discord("/channels/" + channelId);
            if (!channel.ok || (await channel.json()).guild_id !== guildId) return;
            const response = await discord("/channels/" + channelId + "/messages", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    embeds: [{ title: "#Order Number: " + order.orderNumber, description:
                        `Buyer: <@${order.discordId}>\nProduct: ${order.productName}\nQuantity: 1\nTotal Price: Rp${order.amount.toLocaleString("id-ID")} · QRIS` }],
                    allowed_mentions: { parse: [] }, nonce: "sale-" + order._id, enforce_nonce: true,
                }),
            });
            if (!response.ok) throw new Error("Discord testimony " + response.status);
        };
        const grant = async () => {
            if (!buyerPattern.test(order.role) || order.role === guildId) return;
            const response = await discord(`/guilds/${guildId}/members/${order.discordId}/roles/${order.role}`, { method: "PUT" });
            if (!response.ok) throw new Error("Discord role " + response.status);
        };
        for (const result of await Promise.allSettled([log(), grant()])) {
            if (result.status === "rejected") console.warn("[PRODUCT QRIS] Discord order update failed:", order._id, result.reason.message);
        }
    }

    async function deliver(dep) {
        const db = await dbFor(dep.hostedTenantId);
        const order = await fulfill(db, dep);
        if (!order) return false;
        const orders = db.collection("qrisproductorders");
        if (order.sentAt) return true;
        const lease = Date.now() + 60000;
        const claimed = await orders.updateOne({ _id: order._id, sentAt: null, $or: [
            { sendLease: null }, { sendLease: { $lt: Date.now() } },
        ] }, { $set: { sendLease: lease } });
        if (!claimed.matchedCount) return false;
        let sent = false;
        try {
            if (!order.saleLoggedAt) {
                await recordDiscordSale(db, dep.productOrder.guildId, order);
                await orders.updateOne({ _id: order._id, sendLease: lease }, { $set: { saleLoggedAt: new Date() } });
            }
            sent = await sendDm(order);
            return sent;
        } finally {
            await orders.updateOne({ _id: order._id, sendLease: lease }, sent
                ? { $set: { sentAt: new Date() }, $unset: { sendLease: "" } } : { $unset: { sendLease: "" } });
        }
    }

    async function claim(dep) {
        const order = await fulfill(await dbFor(dep.hostedTenantId), dep);
        if (!order) throw new WalletError("Pembayaran diterima. Produk belum tersedia, hubungi admin toko dengan nomor QRIS ini.", 409);
        return { orderNumber: order.orderNumber, productName: order.productName, data: order.stock.data };
    }

    return { quote, reserve, release, deliver, claim };
}

module.exports = { createProductQris };
