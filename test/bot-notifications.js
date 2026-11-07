"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
class Embed {
    constructor() { this.data = {}; }
    setTitle(v) { this.data.title = v; return this; }
    setDescription(v) { this.data.description = v; return this; }
    setColor(v) { this.data.color = v; return this; }
    setTimestamp() { return this; }
    setFooter(v) { this.data.footer = v; return this; }
    setImage(v) { this.data.image = v; return this; }
}
function load(file, imports, extra = {}) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), {
        require: id => { assert.ok(Object.hasOwn(imports, id), id); return imports[id]; },
        module, exports: module.exports, console, Buffer, process: { env: { HOSTED_PILOT_BINDING: "test" } },
        ...extra,
    }, { filename: file });
    return module.exports;
}

(async () => {
    let balance = 30, stock = true, sold = 0, orderCount = 0, testimonial;
    const emoji = { WL: "WL", ARROW: ">", Benar: "OK", CROWN: "*", Dolar: "$", BALANCE: "BAL", Buy: "BUY", Warning: "!", COLOR: 1, imageUrl: "https://example.com/image.png" };
    const product = { _id: "p", code: "TEST", name: "Test Product", type: "yes" };
    const stockQuery = () => ({ sort: () => ({ limit: () => ({ lean: async () => stock ? [{ _id: "s", data: "SECRET" }] : [] }) }) });
    const file = "bot/src/events/client/interactionBuy.js";
    const { handlePurchase } = load(file, {
        "discord.js": { InteractionType: { ModalSubmit: 5 }, EmbedBuilder: Embed },
        mongoose: { connection: { transaction: fn => fn({}) } },
        "../../config/config.json": { Owner: "owner", Admin: [] },
        "../../config/configemoji.json": emoji,
        "../../Schema/balance.js": { findOneAndUpdate: async (_q, update) => { balance += update.$inc.Balance; return { Balance: balance }; } },
        "../../Schema/shop.js": { find: stockQuery, deleteMany: async () => { stock = false; return { deletedCount: 1 }; } },
        "../../Schema/list.js": { findOne: async () => product, updateOne: async () => { sold++; } },
        "../../Schema/priceproduct.js": { findOne: async () => ({ price: 10 }) },
        "../../Schema/orderproduct.js": { findOneAndUpdate: async () => ({ Order: 1 }) },
        "../../Schema/orderlog.js": { create: async () => { orderCount++; } },
        "../../Schema/maintenance.js": { exists: () => ({ setOptions: async () => null }) },
        "../../Schema/SettingChannel.js": { findOne: async () => ({ ChanelTesti: "channel" }) },
        "../../Schema/discount.js": { findOne: async () => null },
        "../../Schema/bulkdiscount.js": { findOne: () => ({ sort: async () => null }) },
        "../../index.js": { on() {}, users: { fetch: async () => ({ send: async () => {} }) } },
    });
    let reply;
    await handlePurchase({
        type: 5, customId: "buysamount::TEST", fields: { getTextInputValue: () => "1" },
        user: { id: "buyer", username: "Buyer", displayAvatarURL: () => "https://example.com/avatar.png", send: async () => { throw Error("DM closed"); } },
        guild: { channels: { cache: new Map([["channel", { isTextBased: () => true, send: async payload => { testimonial = payload; throw Error("Forbidden"); } }]]) }, members: { cache: new Map() } },
        deferReply: async () => {}, editReply: async payload => { reply = payload; },
    });
    assert.equal(balance, 20);
    assert.equal(sold, 1);
    assert.equal(orderCount, 1);
    assert.equal(reply.files[0].attachment.toString(), "SECRET");
    assert.match(reply.embeds[0].data.title, /Purchase Details/);
    assert.equal(testimonial.embeds[0].data.description,
        "> Buyer: **<@buyer>**\n> Product: **Test Product**\n> Quantity: **1**\n> Total Price: **10.0** WL\n\n**Thanks For Purchasing Our Product** OK");
    console.log("PASS original testimonial and receipt embeds, private DM fallback, single debit on logging failure");

    const tx = { _id: "t", orderId: "DP-TEST", panelManaged: true, grossAmount: 1000, wlAmount: 114, status: "pending", logMessageId: "m", logChannelId: "c", notificationPending: false };
    let notifications = 0, updates = 0, paid = false;
    const model = {
        find: () => ({ sort: () => ({ limit: async () => tx.status === "pending" || tx.notificationPending ? [tx] : [] }) }),
        updateOne: async (_query, update) => { Object.assign(tx, update.$set); },
    };
    const { syncHostedDepositLogs } = load("bot/src/utils/hostedDepositLogs.js", {
        "../config/config.json": { PanelInternalUrl: "http://localhost" },
        "../Schema/qris": model,
        "discord.js": { EmbedBuilder: Embed },
        "../config/configemoji.json": emoji,
        "./depositWatcher": {
            sendDepositLog: async () => { throw Error("existing log should be reused"); },
            updateDepositLog: async (_doc, status) => { assert.equal(status, "SUCCESS"); notifications++; return true; },
            fetchDmMessage: async () => ({ edit: async () => { updates++; } }),
        },
    }, { fetch: async () => ({ ok: true, json: async () => ({ amount: 1000, wl: 114, credited: paid }) }), AbortSignal });
    await syncHostedDepositLogs();
    assert.equal(tx.status, "pending");
    assert.equal(notifications, 0);
    paid = true;
    await syncHostedDepositLogs();
    await syncHostedDepositLogs();
    assert.equal(tx.status, "credited");
    assert.equal(notifications, 1);
    assert.equal(updates, 1);
    console.log("PASS hosted payment log waits for confirmed credit and updates once without a balance write");
})().catch(error => { console.error(error); process.exitCode = 1; });
