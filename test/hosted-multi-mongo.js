"use strict";

// Integration test with disposable MongoDB databases and simulated Discord/Autoko.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");
const path = require("node:path");
const { fork } = require("node:child_process");
const root = path.join(__dirname, "..");

const buyerId = "100000000000000099";
const testimonyId = "100000000000000098";
const role = "100000000000000097";
const guilds = ["100000000000000001", "100000000000000002"];
const code = "SAME-SKU";
const profileEmoteId = "100000000000000089";
const profileEmote = `<:test_profile:${profileEmoteId}>`;

function botDependency(name) {
    return require(require.resolve(name, { paths: [path.join(root, "bot")] }));
}

async function runBuyer({ url, dbName, guildId }) {
    const mongoose = botDependency("mongoose");
    const { InteractionType, MessageFlags } = botDependency("discord.js");
    const index = require.resolve("../bot/src/index.js");
    require.cache[index] = { id: index, filename: index, loaded: true, exports: {
        on() {}, users: { fetch: async () => ({ send: async () => {} }) },
    } };
    const { handlePurchase } = require("../bot/src/events/client/interactionBuy");
    const { creditWorldDeposit } = require("../bot/src/utils/hostedWorldDeposit");
    const botConfig = require("../bot/src/config/config.json");
    botConfig.serverId = guildId;
    botConfig.PanelWebhookSecret = "synthetic-panel-webhook-secret";
    const { handleStorefront } = require("../bot/src/events/client/interactionStorefront");
    const { creditDeposit } = require("../bot/src/utils/depositWatcher");
    const Qris = require("../bot/src/Schema/qris");
    process.env.HOSTED_PILOT_BINDING = "integration";
    try {
        await mongoose.connect(url, { dbName });
        const accounts = mongoose.connection.db.collection("bals");
        if (guildId === guilds[1]) {
            const order = await Qris.create({ orderId: "model1-manual", discordId: buyerId, grossAmount: 8500, wlAmount: 0, creditCurrency: "idr" });
            assert.equal((await Promise.all([creditDeposit(order, null), creditDeposit(order, null)])).filter(Boolean).length, 1);
            const retry = await Qris.create({ orderId: "model1-retry", discordId: buyerId, grossAmount: 250,
                wlAmount: 0, creditCurrency: "idr", status: "crediting" });
            await accounts.updateOne({ DiscordID: buyerId }, { $inc: { BalanceRp: 250 }, $addToSet: { RupiahCreditIds: retry.orderId } });
            assert.ok(await creditDeposit(retry, null));
            process.env.PORT = "0";
            const webhook = require("../bot/src/webhookServer").startWebhookServer({});
            await once(webhook, "listening");
            try {
                const forward = async amount => {
                    const body = JSON.stringify({ status: "completed", externalId: "model1-auto", amount, creditCurrency: "idr" });
                    const signature = crypto.createHmac("sha256", botConfig.PanelWebhookSecret).update(body).digest("hex");
                    const response = await fetch("http://127.0.0.1:" + webhook.address().port + "/webhook", {
                        method: "POST", headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature }, body,
                    });
                    await response.text();
                    return response.status;
                };
                assert.equal(await forward(500), 503);
                await Qris.create({ orderId: "model1-auto", discordId: buyerId, grossAmount: 500,
                    wlAmount: 0, creditCurrency: "idr", status: "cancelled", mode: "auto" });
                assert.equal(await forward(400), 409);
                assert.deepEqual(await Promise.all([forward(500), forward(500)]), [200, 200]);
            } finally { await new Promise(resolve => webhook.close(resolve)); }
        }
        assert.equal((await accounts.findOne({ DiscordID: buyerId })).BalanceRp, 9250);
        let privateReply;
        const guild = { name: "Synthetic store", emojis: { cache: new Map() } };
        if (guildId === guilds[0]) {
            guild.client = { application: { emojis: { fetch: async () => new Map([
                [profileEmoteId, { toString: () => profileEmote }],
            ]) } } };
        }
        async function clickStorefront(customId, isPrivate = true) {
            let acknowledged;
            await handleStorefront({
                customId, guildId, guild, isButton: () => true,
                user: { id: buyerId, displayAvatarURL: () => "https://example.com/avatar.png" },
                message: { flags: { has: flag => flag === MessageFlags.Ephemeral && isPrivate } },
                deferReply: async options => {
                    assert.equal(options.flags, MessageFlags.Ephemeral);
                    acknowledged = "new";
                },
                deferUpdate: async () => { acknowledged = "update"; },
                editReply: async response => { privateReply = response; },
            });
            assert.equal(acknowledged, isPrivate ? "update" : "new");
            return privateReply.embeds[0].toJSON();
        }
        const profile = await clickStorefront("storefront_profile", false);
        assert.equal(profile.title, (guildId === guilds[0] ? profileEmote : "👤") + " Profil Kamu");
        assert.equal(privateReply.components.at(-1).toJSON().components[0].emoji.name, guildId === guilds[0] ? "test_profile" : "👤");
        assert.match((await clickStorefront("storefront_balance")).description, /Saldo Rupiah/);
        assert.match((await clickStorefront("storefront_history:2")).title, /Riwayat/);
        assert.match((await clickStorefront("storefront_profile")).title, /Profil/);
        assert.match((await clickStorefront("storefront_deposit", false)).title, /Deposit via Growtopia/);
        const depositAction = privateReply.components[0].toJSON().components[0].custom_id;
        assert.match((await clickStorefront(depositAction)).title, /Deposit via Growtopia/);
        await clickStorefront("storefront_convert");
        const quote = privateReply.components[0].toJSON().components[0].custom_id;
        assert.match(quote, /^storefront_convert:/);
        const confirmations = await Promise.all([clickStorefront(quote), clickStorefront(quote)]);
        for (const reply of confirmations) assert.match(reply.description, /masuk ke saldo WL/);
        assert.equal((await accounts.findOne({ DiscordID: buyerId })).BalanceRp, 70);

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
        DISCORD_HOSTED_PILOT_GUILD_IDS: guilds[0], DISCORD_HOSTED_TEST_MANAGED_GUILDS: "1",
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
        await client.db(tenants[0].dbName).collection("storefronts").insertOne({ _id: guilds[0], emojis: { profile: profileEmote } });
        await Promise.all(tenants.map(async (tenant, i) => {
            await request(i, "POST", "/shop/products", { code, name: "Store " + i, type: "yes", role, price: 10 });
            await request(i, "POST", "/shop/products/" + code + "/stock", { text: "STOCK-" + i });
            const db = client.db(tenant.dbName);
            await db.collection("bals").insertOne({ DiscordID: buyerId, GrowID: "synthetic", GrowIDNow: "Synthetic", Balance: 30 + 20 * i, Deposit: 30 + 20 * i });
            await db.collection("setchannels").insertOne({ ChanelTesti: testimonyId });
            await db.collection("apisettings").insertOne({ useLiveApi: false });
            await db.collection("wlrates").insertOne({ pricePerWL: 90 });
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
        const tenant = tenants[0];
        const rupiahOrderResponse = await fetch(origin + "/internal/wallet/deposit", { method: "POST", headers: {
            "Content-Type": "application/json", "X-License-Id": tenant.licenseId, "X-Hosted-Guild": tenant.guildId,
            Authorization: "Bearer " + hostedWalletToken(tenant.licenseId, tenant.guildId),
        }, body: JSON.stringify({ amount: 9250, discordId: buyerId, creditCurrency: "idr" }) });
        assert.equal(rupiahOrderResponse.status, 200);
        const rupiahOrder = await rupiahOrderResponse.json();
        assert.equal(rupiahOrder.creditCurrency, "idr");
        assert.equal(rupiahOrder.panelManaged, true);
        await Promise.all([1, 2].map(() => wallet.handlePaid({ orderId: rupiahOrder.orderId, amount: 9250 })));
        const status = await wallet.hostedDepositStatus(tenant.licenseId, tenant.tenantId, rupiahOrder.orderId);
        assert.equal(status.creditCurrency, "idr");
        assert.equal(status.credited, true);
        assert.equal((await client.db(tenant.dbName).collection("bals").findOne({ DiscordID: buyerId })).Balance, 130);
        assert.equal((await client.db(tenants[1].dbName).collection("bals").findOne({ DiscordID: buyerId })).BalanceRp, undefined);

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
            assert.equal(buyerDoc.Balance, 422 + 20 * i);
            assert.equal(buyerDoc.BalanceRp, 70);
            assert.equal(await db.collection("hostedcredits").countDocuments({ _id: deposits[i].orderId }), 1);
            assert.equal(await db.collection("hostedcredits").countDocuments({ _id: deposits[1-i].orderId }), 0);
            assert.equal(await db.collection("worlddepositreceipts").countDocuments(), 1);
        }));
        console.log("OK: two isolated stores; concurrent QRIS and conversion, interrupted credit retry, stock, world deposit and reports");
    } finally {
        for (const child of children) if (child.connected) child.kill();
        http.close();
        await Promise.allSettled([...tenants.map(t => t.dbName), walletName].map(name => client.db(name).dropDatabase()));
        await client.close();
        await walletDb.close();
        for (const tenant of tenants) require("../src/shopdb").closeConn("hosted:" + tenant.tenantId);
    }
}
