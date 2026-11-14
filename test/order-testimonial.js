"use strict";

const assert = require("node:assert/strict");
const { createOrderTestimonial } = require("../src/order-testimonial");
const { createOrders } = require("../src/orders");
const emojis = require("../bot/src/config/configemoji.json");

async function main() {
    const sent = [];
    const env = { ORDER_TESTIMONIAL_CHANNEL_ID: "100000000000000001", DISCORD_CATALOG_PILOT_TOKEN: "synthetic",
        DISCORD_HOSTED_BOT_CLIENT_ID: "100000000000000004" };
    const messageId = "100000000000000002";
    let failure = false;
    let lostResponse = false;
    const history = [];
    const testimonial = createOrderTestimonial({ env, discordFetch: async (url, init) => {
        assert.equal(init.headers.Authorization, "Bot synthetic");
        if (!init.method) {
            assert.match(url, /\/messages\?limit=100/);
            return { ok: true, json: async () => history };
        }
        assert.equal(url, "https://discord.com/api/v10/channels/" + env.ORDER_TESTIMONIAL_CHANNEL_ID + "/messages");
        if (failure) return { ok: false, status: 503 };
        const payload = JSON.parse(init.body);
        sent.push(payload);
        history.unshift({ id: messageId, author: { id: env.DISCORD_HOSTED_BOT_CLIENT_ID }, embeds: payload.embeds,
            timestamp: payload.embeds[0].timestamp });
        if (lostResponse) throw new Error("Connection closed after Discord accepted message");
        return { ok: true, json: async () => ({ id: messageId }) };
    } });
    let clock = 1700000000000;
    const store = { data: { orders: [], licenses: [] }, save() {} };
    const license = { id: "existing", buyer: "Owner", keyPrefix: "AS-TEST", discordLoginId: "100000000000000003" };
    let issued = 0, renewed = 0;
    const options = {
        store, testimonial, now: () => clock,
        issueLicense: () => { issued++; return "SECRET-LICENSE"; },
        encrypt: value => value, decrypt: value => value,
        getLicense: id => id === license.id ? license : null,
        extendLicense: () => { renewed++; return clock + 30 * 864e5; },
        autoko: { enabled: true, createQris: async () => ({ qrString: "synthetic" }) }, autoOrders: true,
    };
    let orders = createOrders(options);
    const first = orders.create({ type: "autostore" });
    orders.claim(first.order.id, first.token);
    await orders.publishTestimonials();
    assert.equal(sent.length, 0, "unpaid orders do not post testimonials");
    orders.confirm(first.order.id);
    await Promise.all([orders.publishTestimonials(), orders.publishTestimonials()]);
    assert.equal(sent.length, 1);
    const embed = sent[0].embeds[0];
    assert.equal(embed.title, "#Order Number: " + first.order.code);
    assert.equal(embed.description, `${emojis.ARROW} Buyer: **Pembeli web**\n` +
        `${emojis.ARROW} Product: **Starter Cloud · 1 bulan**\n` +
        `${emojis.ARROW} Quantity: **1**\n` +
        `${emojis.ARROW} Total Price: **Rp${first.order.amount.toLocaleString("id-ID")}**\n\n` +
        `**Thanks For Purchasing Our Product** ${emojis.Benar}`);
    assert.equal(embed.image.url, emojis.imageUrl);
    assert.equal(embed.color, Number.parseInt(emojis.COLOR.slice(1), 16));
    assert.deepEqual(sent[0].allowed_mentions, { parse: [] });
    assert.equal(sent[0].enforce_nonce, true);
    assert.equal(sent[0].nonce, "license-" + first.order.id);
    assert.equal(JSON.stringify(sent[0]).includes("SECRET-LICENSE"), false);
    orders.confirm(first.order.id);
    await orders.publishTestimonials();
    assert.equal(sent.length, 1);
    assert.equal(issued, 1);

    const auto = orders.create({ type: "autostore90" });
    await orders.upgradeToAuto(auto.order.id);
    assert.equal(orders.handlePaid({ orderId: "KO-" + auto.order.id, amount: 1 }).ok, false);
    await orders.publishTestimonials();
    assert.equal(sent.length, 1);
    orders.handlePaid({ orderId: "KO-" + auto.order.id, amount: 40000 });
    orders.handlePaid({ orderId: "KO-" + auto.order.id, amount: 40000 });
    await orders.publishTestimonials();
    assert.equal(sent.length, 2, "duplicate webhooks post once");
    assert.match(sent[1].embeds[0].description, /Pro Cloud · 3 bulan/);

    const renewal = orders.createRenewal({ licenseId: license.id, packageId: "autostore365" });
    orders.confirm(renewal.order.id);
    await orders.publishTestimonials();
    assert.equal(renewed, 1);
    assert.match(sent[2].embeds[0].description, /Buyer: \*\*<@100000000000000003>\*\*/);
    assert.match(sent[2].embeds[0].description, /Enterprise Cloud · 1 tahun/);

    failure = true;
    const dl = orders.create({ type: "autostoreLifetime", name: "<@everyone> **buyer**" }, { pricePerDL: 1000 });
    const result = orders.confirm(dl.order.id);
    await orders.publishTestimonials();
    assert.equal(result.order.status, "done", "Discord outage does not block license delivery");
    assert.equal(store.data.orders.at(-1).testimonialPending, true);
    failure = false;
    clock += 60001;
    orders = createOrders(options);
    await orders.publishTestimonials();
    assert.equal(sent.length, 4, "pending notification survives a process restart");
    assert.match(sent[3].embeds[0].description, /Lifetime AutoStore · Lifetime/);
    assert.match(sent[3].embeds[0].description, /Rp250\.000 \(250 DL 0 WL\)/);
    assert.equal(sent[3].embeds[0].description.includes("<@everyone>"), false);
    assert.equal(store.data.orders.at(-1).testimonialPending, undefined);
    orders = createOrders(options);
    await orders.publishTestimonials();
    assert.equal(sent.length, 4, "delivered notifications stay delivered after restart");

    const old = { ...store.data.orders[0], id: "old-order", code: "GS-OLD" };
    store.data.orders.push(old);
    const rejected = orders.create({ type: "autostore" });
    orders.reject(rejected.order.id);
    await orders.publishTestimonials();
    assert.equal(sent.length, 4, "old confirmed and rejected orders are not broadcast");
    assert.equal(createOrderTestimonial({ env: {} }).enabled, false);

    lostResponse = true;
    const uncertain = orders.create({ type: "autostore" });
    orders.confirm(uncertain.order.id);
    await orders.publishTestimonials();
    assert.equal(sent.length, 5);
    assert.equal(store.data.orders.at(-1).testimonialPending, true);
    lostResponse = false;
    clock += 3600000;
    orders = createOrders(options);
    await orders.publishTestimonials();
    assert.equal(sent.length, 5, "lost response followed by restart after the nonce window does not post twice");
    assert.equal(store.data.orders.at(-1).testimonialPending, undefined);
    console.log("OK: original testimonial style, all packages, QRIS and DL, renewals, privacy, retry, and duplicate protection");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
