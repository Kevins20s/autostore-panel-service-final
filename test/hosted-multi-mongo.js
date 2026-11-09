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
        async function clickStorefront(customId, isPrivate = true, hasProfileMenu = true) {
            let acknowledged;
            await handleStorefront({
                customId, guildId, guild, isButton: () => true,
                user: { id: buyerId, displayAvatarURL: () => "https://example.com/avatar.png" },
                message: {
                    flags: { has: flag => flag === MessageFlags.Ephemeral && isPrivate },
                    components: hasProfileMenu ? [{ components: [{ customId: "storefront_profile" }] }] : [],
                },
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
        const hasProfileButton = () => privateReply.components.some(row =>
            row.toJSON().components.some(button => button.custom_id === "storefront_profile"));
        await clickStorefront("storefront_convert", true, false);
        assert.equal(hasProfileButton(), false);
        await clickStorefront("storefront_convert");
        assert.equal(hasProfileButton(), true);
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
    const { createProductQris } = require("../src/product-qris");
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
    const delivered = [], testimonies = [], roles = [];
    const productQris = createProductQris({ mongoUrl: url, botToken: "synthetic", discordFetch: async (url, init) => {
        const pathname = new URL(url).pathname;
        if (pathname.endsWith("/users/@me/channels")) return Response.json({ id: buyerId });
        if (pathname.endsWith("/channels/" + testimonyId)) return Response.json({ guild_id: guilds[0] });
        if (pathname.endsWith("/channels/" + testimonyId + "/messages")) testimonies.push(JSON.parse(init.body).embeds[0]);
        if (pathname.endsWith("/roles/" + role)) roles.push(pathname.split("/")[4]);
        if (pathname.endsWith("/channels/" + buyerId + "/messages")) delivered.push(await init.body.get("files[0]").text());
        return new Response(null, { status: 204 });
    } });
    let time = Date.now();
    const wallet = createWallet({ getCols: walletDb.getCols, autoko, minDeposit: 100, now: () => time,
        creditHosted: createHostedCredit({ mongoUrl: url }), productQris });
    const app = express();
    app.use(express.json());
    const buyer = (req, res, next) => {
        req.lic = findLicense(req.headers["x-test-license"]);
        if (!req.lic) return res.sendStatus(401);
        next();
    };
    const valid = license => license.expiresAt > Date.now();
    app.use("/shop", buyer, createShopRouter({ valid, licenses, decrypt: () => { throw Error("Unexpected own-bot config"); } }));
    registerWalletRoutes(app, { wallet, autoko, productQris, buyer, admin: (_req, res) => res.sendStatus(401), licenses, findLicense, valid, store: { save() {} } });
    const http = app.listen(0, "127.0.0.1");
    const client = new MongoClient(url);
    let children = [];
    try {
        await client.connect();
        const origin = "http://127.0.0.1:" + http.address().port;
        const request = async (i, method, endpoint, body, status = 200) => {
            const r = await fetch(origin + endpoint, { method, headers: { "Content-Type": "application/json", "X-Test-License": fixtures[i].id },
                body: body && JSON.stringify(body) });
            assert.equal(r.status, status, endpoint);
            return r.json();
        };
        const firstReads = await Promise.all(Array.from({ length: 40 }, (_, i) =>
            request(i % tenants.length, "GET", "/shop/products")));
        assert.ok(firstReads.every(result => result.products.length === 0));
        await client.db(tenants[0].dbName).collection("storefronts").insertOne({ _id: guilds[0], model: "model1", emojis: { profile: profileEmote } });
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
        const bannerRoute = "/shop/settings/storefront/banner";
        assert.equal((await request(0, "PUT", bannerRoute, { guildId: tenants[0].guildId, url: "https://example.com/catalog-a.png" })).url,
            "https://example.com/catalog-a.png");
        await request(0, "PUT", bannerRoute, { guildId: tenants[1].guildId, url: "" }, 409);
        await request(0, "PUT", bannerRoute, { guildId: tenants[0].guildId, url: "https://name:secret@example.com/private.png" }, 400);
        assert.equal((await request(0, "GET", bannerRoute)).url, "https://example.com/catalog-a.png");
        assert.equal((await request(1, "GET", bannerRoute)).url, "");
        await request(0, "PUT", bannerRoute, { guildId: tenants[0].guildId, url: "" });
        assert.equal((await request(0, "GET", bannerRoute)).url, "");
        assert.equal((await request(0, "GET", "/shop/settings")).storefront.model, "model1");
        assert.equal((await request(0, "GET", "/shop/users")).users[0].balanceRp, 70);
        const mode = "/api/wallet/mode";
        const storefront = "/shop/settings/storefront";
        const model3 = { guildId: tenants[0].guildId, model: "model3" };
        await request(0, "PUT", mode, { mode: "manual" });
        await request(0, "PUT", storefront, model3, 409);
        await request(0, "PUT", mode, { mode: "auto" });
        const raw = (endpoint, body) => fetch(origin + endpoint, { method: "PUT",
            headers: { "Content-Type": "application/json", "X-Test-License": fixtures[0].id }, body: JSON.stringify(body) });
        const competingSettings = await Promise.all([raw(storefront, model3), raw(mode, { mode: "manual" })]);
        assert.deepEqual(competingSettings.map(response => response.status).sort(), [200, 409]);
        await request(0, "PUT", mode, { mode: "auto" });
        await Promise.all(tenants.map(async (tenant, i) => {
            await request(i, "PUT", "/shop/settings/storefront", { guildId: tenant.guildId, model: "model3" });
            await request(i, "PUT", "/shop/products/" + code, { name: "Store " + i, role, type: "yes", description: "Full source", priceIdr: 12000 + i });
            await request(i, "POST", "/shop/products/" + code + "/stock", { text: i === 0 ? "QR-STOCK-0\nQR-STOCK-0B" : "QR-STOCK-1" });
        }));
        await request(0, "PUT", mode, { mode: "manual" }, 409);
        const internal = (tenant, route, body) => fetch(origin + "/internal/wallet/" + route, {
            method: "POST", headers: { "Content-Type": "application/json", "X-License-Id": tenant.licenseId,
                "X-Hosted-Guild": tenant.guildId, Authorization: "Bearer " + hostedWalletToken(tenant.licenseId, tenant.guildId) },
            body: JSON.stringify(body),
        });
        const buy = (tenant, quantity) => internal(tenant, "deposit", { productCode: code, amount: 1000, discordId: buyerId, quantity });
        assert.equal((await buy(tenants[0], 0)).status, 400);
        assert.equal((await buy(tenants[0], 2.5)).status, 400);
        assert.equal((await buy(tenants[0], 100)).status, 400);
        assert.equal((await buy(tenants[0], 3)).status, 409);
        const competing = await Promise.all([buy(tenants[0], 2), buy(tenants[0], 2), buy(tenants[1])]);
        assert.deepEqual(competing.slice(0, 2).map(r => r.status).sort(), [200, 409]);
        assert.equal(competing[2].status, 200);
        const direct = await Promise.all([competing.find(r => r.status === 200), competing[2]].map(r => r.json()));
        assert.deepEqual(direct.map(r => r.amount), [24000, 12001]);
        assert.deepEqual(direct.map(r => r.quantity), [2, 1]);
        assert.ok(direct.every(r => r.qrPng));
        const legacyOrders = client.db(tenants[1].dbName).collection("qrisproductorders");
        const legacyOrder = await legacyOrders.findOne({ _id: direct[1].orderId });
        await legacyOrders.updateOne({ _id: direct[1].orderId }, { $set: { stock: legacyOrder.stock[0] }, $unset: { quantity: "" } });
        const claim = (tenant, order, discordId = buyerId) => internal(tenant, "hosted-product/" + order.orderId + "/claim", { discordId });
        assert.equal((await claim(tenants[0], direct[0])).status, 409);
        assert.equal((await claim(tenants[1], direct[0])).status, 404);
        assert.equal((await claim(tenants[0], direct[0], guilds[1])).status, 404);
        assert.equal((await wallet.handlePaid({ orderId: direct[0].orderId }, { background: true })).reason, "amount_missing");
        await Promise.all(direct.flatMap(order => [1, 2].map(() => wallet.handlePaid({ orderId: order.orderId, amount: order.amount }))));
        const files = ["QR-STOCK-0\nQR-STOCK-0B", "QR-STOCK-1"];
        assert.deepEqual(delivered.sort(), files);
        assert.equal(testimonies.length, 1);
        assert.match(testimonies[0].description, /Quantity: 2\nTotal Price: Rp24\.000/);
        assert.deepEqual(roles.sort(), guilds);
        for (const [i, order] of direct.entries()) {
            const db = client.db(tenants[i].dbName);
            const account = await db.collection("bals").findOne({ DiscordID: buyerId });
            assert.equal(account.BalanceRp, 70);
            const orderPage = await request(i, "GET", "/shop/orders");
            assert.equal(orderPage.total, 2);
            assert.equal(orderPage.idr, order.amount);
            assert.equal(orderPage.wl, 10);
            const exportPath = "/shop/orders/export.csv?" + new URLSearchParams({ q: "Store " + i });
            const response = await fetch(origin + exportPath, { headers: { "X-Test-License": fixtures[i].id } });
            assert.equal(response.status, 200);
            const exported = await response.text();
            assert.equal(exported.trimEnd().split("\r\n").length, 3);
            assert.ok(exported.includes(`"Store ${i}",${order.quantity},,${order.amount}`));
            assert.ok(!exported.includes(`"Store ${1 - i}"`));
            assert.ok(!exported.includes("QR-STOCK"));
            const stats = await request(i, "GET", "/shop/stats?days=1");
            assert.equal(stats.daily[0].idr, order.amount);
            assert.equal(orderPage.qty, order.quantity + 1);
            assert.equal((await (await claim(tenants[i], order)).json()).data, files[i]);
        }
        assert.equal((await fetch(origin + "/shop/orders/export.csv")).status, 401);
        await request(0, "POST", "/shop/products/" + code + "/stock", { text: "EXPIRED-QR-STOCK-A\nEXPIRED-QR-STOCK-B" });
        const expired = await buy(tenants[0], 2);
        assert.equal(expired.status, 200);
        const expiredOrder = await expired.json();
        time = expiredOrder.expiresAt + 6 * 60e3;
        autoko.getStatus = async () => ({ paid: false, status: "Expired" });
        await wallet.sweep();
        assert.equal(await client.db(tenants[0].dbName).collection("shops").countDocuments({ code }), 2);
        assert.equal((await claim(tenants[0], expiredOrder)).status, 409);
        await wallet.handlePaid({ orderId: expiredOrder.orderId, amount: expiredOrder.amount });
        assert.equal((await (await claim(tenants[0], expiredOrder)).json()).data, "EXPIRED-QR-STOCK-A\nEXPIRED-QR-STOCK-B");
        console.log("OK: direct product QRIS, quoted price, concurrent stock reservation, delivery, access checks and expired stock recovery");
    } finally {
        for (const child of children) if (child.connected) child.kill();
        http.close();
        await Promise.allSettled([...tenants.map(t => t.dbName), walletName].map(name => client.db(name).dropDatabase()));
        await client.close();
        await walletDb.close();
        for (const tenant of tenants) require("../src/shopdb").closeConn("hosted:" + tenant.tenantId);
    }
}
