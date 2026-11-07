"use strict";

// Integration test with disposable MongoDB databases and simulated Discord/Autoko.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { fork } = require("node:child_process");
const root = path.join(__dirname, "..");

const buyerId = "100000000000000099";
const testimonyId = "100000000000000098";
const role = "100000000000000097";
const guilds = ["100000000000000001", "100000000000000002"];
const code = "SAME-SKU";

function botDependency(name) {
    return require(require.resolve(name, { paths: [path.join(root, "bot")] }));
}

async function runBuyer({ url, dbName, guildId }) {
    const mongoose = botDependency("mongoose");
    const { InteractionType } = botDependency("discord.js");
    const index = require.resolve("../bot/src/index.js");
    require.cache[index] = { id: index, filename: index, loaded: true, exports: {
        on() {}, users: { fetch: async () => ({ send: async () => {} }) },
    } };
    const { handlePurchase } = require("../bot/src/events/client/interactionBuy");
    const { creditWorldDeposit } = require("../bot/src/utils/hostedWorldDeposit");
    process.env.HOSTED_PILOT_BINDING = "integration";
    try {
        await mongoose.connect(url, { dbName });
        const log = { id: "100000000000000088", webhookId: "100000000000000087", channelId: "100000000000000086",
            embeds: [{ description: "GrowID: Synthetic\nAmount: 2 Diamond Lock" }] };
        const settings = { DonationWebhookId: log.webhookId, ChannelDonation: log.channelId };
        assert.equal(await creditWorldDeposit({ ...log, channelId: guildId }, settings), null);
        const credited = await Promise.all([creditWorldDeposit(log, settings), creditWorldDeposit(log, settings)]);
        assert.equal(credited.filter(Boolean).length, 1);
        const deliveries = [];
        const replies = [];
        const interaction = () => ({
            customId: "buysamount::" + code, type: InteractionType.ModalSubmit,
            fields: { getTextInputValue: () => "1" },
            user: { id: buyerId, username: "Synthetic", displayAvatarURL: () => "https://example.com/avatar.png",
                send: async message => { deliveries.push(message.files[0].attachment.toString()); } },
            guild: { channels: { cache: new Map([[testimonyId, { isTextBased: () => true, send: async () => {} }]]) }, members: { cache: new Map() } },
            deferReply: async () => {}, editReply: async message => { replies.push(message); },
        });
        await Promise.all([handlePurchase(interaction()), handlePurchase(interaction())]);
        assert.equal(deliveries.length, 1);
        assert.ok(replies.some(r => typeof r === "string" && /stok/i.test(r)));
        return deliveries[0];
    } finally { await mongoose.disconnect(); }
}

if (process.argv[2] === "worker") {
    process.once("message", async input => {
        try { process.send({ data: await runBuyer(input) }, () => process.disconnect()); }
        catch (error) { process.send({ error: error.code || error.name }, () => process.disconnect()); }
    });
} else {
    main().catch(error => { console.error(error); process.exitCode = 1; });
}

async function main() {
    const url = process.env.HOSTED_TEST_MONGO;
    if (!url) throw new Error("Set HOSTED_TEST_MONGO for the disposable MongoDB test.");
    const nonce = crypto.randomBytes(8).toString("hex");
    const idA = "test-a-" + nonce, idB = "test-b-" + nonce;
    Object.assign(process.env, {
        MASTER_KEY: "e".repeat(64), DISCORD_CATALOG_PILOT_MONGO_URL: url,
        DISCORD_HOSTED_PILOT_DB_NAMESPACE: "test-legacy-" + nonce,
        DISCORD_HOSTED_PILOT_LICENSE_ID: idA, DISCORD_HOSTED_TEST_LICENSE_IDS: idB,
        DISCORD_HOSTED_PILOT_GUILD_IDS: guilds.join(","),
    });
    const { MongoClient } = require("mongodb");
    const express = require("express");
    const { hostedTenant } = require("../src/shared-tenants");
    const { hostedWalletToken, registerWalletRoutes } = require("../src/walletapi");
    const { createHostedCredit } = require("../src/shared-deposit");
    const { createWalletDb } = require("../src/walletdb");
    const { createWallet } = require("../src/wallet");
    const { createAutoko } = require("../src/autoko");
    const createShopRouter = require("../src/shopapi");
    const fixtures = [idA, idB].map((id, index) => ({ id, expiresAt: Date.now() + 300000, paymentMode: "auto",
        discordLoginId: buyerId, hostedBot: { enabled: true, guildId: guilds[index] } }));
    const licenses = () => fixtures;
    const findLicense = id => fixtures.find(l => l.id === id);
    const tenants = fixtures.map(license => hostedTenant(license, fixtures));
    const walletName = "gevra_test_wallet_" + nonce;
    const walletDb = createWalletDb({ url, dbName: walletName });
    const autoko = createAutoko({ AUTOKO_MODE: "mock" });
    const wallet = createWallet({ getCols: walletDb.getCols, autoko, minDeposit: 100, creditHosted: createHostedCredit({ mongoUrl: url }) });
    const app = express();
    app.use(express.json());
    const buyer = (req, res, next) => {
        req.lic = findLicense(req.headers["x-test-license"]);
        if (!req.lic) return res.sendStatus(401);
        next();
    };
    const valid = license => license.expiresAt > Date.now();
    app.use("/shop", buyer, createShopRouter({ valid, licenses, decrypt: () => { throw Error("Unexpected own-bot config"); } }));
    registerWalletRoutes(app, { wallet, autoko, buyer, admin: (_req, res) => res.sendStatus(401), licenses, findLicense, valid, store: { save() {} } });
    const http = app.listen(0, "127.0.0.1");
    const client = new MongoClient(url);
    let children = [];
    try {
        await client.connect();
        const origin = "http://127.0.0.1:" + http.address().port;
        const request = async (i, method, endpoint, body) => {
            const r = await fetch(origin + endpoint, { method, headers: { "Content-Type": "application/json", "X-Test-License": fixtures[i].id },
                body: body && JSON.stringify(body) });
            assert.equal(r.status, 200, endpoint);
            return r.json();
        };
        const firstReads = await Promise.all(Array.from({ length: 40 }, (_, i) =>
            request(i % tenants.length, "GET", "/shop/products")));
        assert.ok(firstReads.every(result => result.products.length === 0));
        await Promise.all(tenants.map(async (tenant, i) => {
            await request(i, "POST", "/shop/products", { code, name: "Store " + i, type: "yes", role, price: 10 });
            await request(i, "POST", "/shop/products/" + code + "/stock", { text: "STOCK-" + i });
            const db = client.db(tenant.dbName);
            await db.collection("bals").insertOne({ DiscordID: buyerId, GrowID: "synthetic", GrowIDNow: "Synthetic", Balance: 30 + 20 * i, Deposit: 30 + 20 * i });
            await db.collection("setchannels").insertOne({ ChanelTesti: testimonyId });
        }));

        const deposits = await Promise.all(tenants.map(async tenant => {
            const r = await fetch(origin + "/internal/wallet/deposit", { method: "POST", headers: {
                "Content-Type": "application/json", "X-License-Id": tenant.licenseId, "X-Hosted-Guild": tenant.guildId,
                Authorization: "Bearer " + hostedWalletToken(tenant.licenseId, tenant.guildId),
            }, body: JSON.stringify({ amount: 1000, discordId: buyerId, pricePerWL: 10 }) });
            assert.equal(r.status, 200);
            return r.json();
        }));
        await Promise.all(deposits.flatMap(tx => [1, 2].map(() => wallet.handlePaid({ orderId: tx.orderId, amount: 1000 }))));

        const purchases = await Promise.all(tenants.map(tenant => new Promise((resolve, reject) => {
            const worker = fork(__filename, ["worker"]);
            children.push(worker);
            worker.once("message", message => message.error ? reject(new Error(message.error)) : resolve(message.data));
            worker.once("error", reject);
            worker.once("exit", code => { if (code) reject(new Error("Test worker exited: " + code)); });
            worker.send({ url, dbName: tenant.dbName, guildId: tenant.guildId });
        })));
        assert.deepEqual(purchases, ["STOCK-0", "STOCK-1"]);
        await Promise.all(tenants.map(async (tenant, i) => {
            const db = client.db(tenant.dbName);
            const [orders, products, stats, buyerDoc] = await Promise.all([
                request(i, "GET", "/shop/orders"), request(i, "GET", "/shop/products"), request(i, "GET", "/shop/stats?days=1"),
                db.collection("bals").findOne({ DiscordID: buyerId }),
            ]);
            assert.equal(orders.total, 1);
            assert.equal(products.products[0].name, "Store " + i);
            assert.equal(products.products[0].stock, 0);
            assert.equal(stats.productSales[0].qty, 1);
            assert.equal(buyerDoc.Balance, 320 + 20 * i);
            assert.equal(await db.collection("hostedcredits").countDocuments({ _id: deposits[i].orderId }), 1);
            assert.equal(await db.collection("hostedcredits").countDocuments({ _id: deposits[1-i].orderId }), 0);
            assert.equal(await db.collection("worlddepositreceipts").countDocuments(), 1);
        }));
        console.log("OK: 40 concurrent panel reads and two simultaneous isolated stores; no mixed stock, balance, QRIS, world credit, or reports");
    } finally {
        for (const child of children) if (child.connected) child.kill();
        http.close();
        await Promise.allSettled([...tenants.map(t => t.dbName), walletName].map(name => client.db(name).dropDatabase()));
        await client.close();
        await walletDb.close();
        for (const tenant of tenants) require("../src/shopdb").closeConn("hosted:" + tenant.tenantId);
    }
}
