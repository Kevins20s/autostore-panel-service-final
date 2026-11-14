"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { Collection, ChannelType, OverwriteType, PermissionFlagsBits: P } = require("discord.js");
const { createPreorders, stockLines, progress } = require("../bot/src/utils/preorders");

const uri = process.env.PREORDER_TEST_MONGO_URL;
if (!uri) { console.error("PREORDER_TEST_MONGO_URL is required; this test creates and drops its own isolated database."); process.exit(1); }
const dbName = "gevra_po_test_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex");
const guildId = "100000000000000001", otherGuild = "100000000000000002";
const buyerId = "100000000000000003", ownerId = "100000000000000004", botId = "100000000000000005";
const config = require("../bot/src/config/config.json");
config.Owner = ownerId;
config.Admin = [];

async function main() {
    await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10000 });
    const { Order, Settings } = require("../bot/src/Schema/preorder");
    await Promise.all([Order.init(), Settings.init()]);
    const service = createPreorders();
    const make = (requestId, amount = 200, guild = guildId, buyer = buyerId) => service.create({
        guildId: guild, buyerId: buyer, requestId, productName: "Preorder test product", amount,
    });
    const lines = (prefix, count) => Array.from({ length: count }, (_, i) => prefix + " " + i).join("\n");
    assert.deepEqual(stockLines("account one:password\r\naccount two:password\n\n"), ["account one:password", "account two:password"]);
    const first = await make("create-first");
    const same = await Promise.all([make("create-first"), make("create-first")]);
    assert.ok(same.every(order => String(order._id) === String(first._id)));
    await Promise.all([service.deposit(guildId, first._id, "batch-a", lines("SECRET-A", 100)),
        service.deposit(guildId, first._id, "batch-a", lines("SECRET-A", 100))]);
    let order = await service.get(guildId, first._id);
    assert.equal(order.depositedQty, 100);
    assert.equal(order.items.length, 100);
    await assert.rejects(service.collect(guildId, first._id, buyerId, "unpaid", 1), /ditolak/);
    await service.markPaid(guildId, first._id, ownerId);
    const fifty = await service.collect(guildId, first._id, buyerId, "claim-fifty", 50);
    assert.equal(fifty.lines.length, 50);
    assert.equal(fifty.lines[0], "SECRET-A 0");
    assert.equal(fifty.order.depositedQty, 100);
    assert.equal(fifty.order.collectedQty, 50);
    const replay = await service.collect(guildId, first._id, buyerId, "claim-fifty", 50);
    assert.deepEqual(replay.lines, fifty.lines);
    assert.equal(replay.order.collectedQty, 50);
    const concurrent = await Promise.allSettled([
        service.collect(guildId, first._id, buyerId, "claim-one", 40),
        service.collect(guildId, first._id, buyerId, "claim-two", 40),
    ]);
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
    order = await service.get(guildId, first._id);
    assert.equal(order.collectedQty, 90);
    assert.equal(order.depositedQty, 100);
    await assert.rejects(service.collect(guildId, first._id, ownerId, "wrong-buyer", 1), /bukan milikmu/);
    await assert.rejects(service.get(otherGuild, first._id), /server ini/);
    await assert.rejects(service.deposit(otherGuild, first._id, "wrong-guild", "stock"), /server ini/);
    await assert.rejects(service.close(guildId, first._id, ownerId), /kewajiban/);
    await assert.rejects(service.deposit(guildId, first._id, "too-many", lines("over", 101)), /ditolak/);
    await service.deposit(guildId, first._id, "batch-b", lines("SECRET-B", 100));
    order = await service.get(guildId, first._id);
    assert.equal(progress(order), "Siap semua");
    const rest = await service.collect(guildId, first._id, buyerId, "claim-rest", 110);
    assert.equal(rest.lines[0], "SECRET-A 90");
    assert.equal(rest.lines.at(-1), "SECRET-B 99");
    assert.equal(progress(rest.order), "Selesai");
    await service.close(guildId, first._id, ownerId);
    await assert.rejects(service.deposit(guildId, first._id, "closed-deposit", "secret"), /ditolak/);
    const cancelled = await make("cancelled");
    assert.equal(progress(await service.close(guildId, cancelled._id, ownerId)), "Dibatalkan");
    const second = await make("other-guild", 200, otherGuild);
    const deposits = await Promise.allSettled([
        service.deposit(otherGuild, second._id, "simultaneous-a", lines("A", 150)),
        service.deposit(otherGuild, second._id, "simultaneous-b", lines("B", 150)),
    ]);
    assert.equal(deposits.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await service.get(otherGuild, second._id)).depositedQty, 150);
    console.log("OK: real MongoDB partial deposits and collections, concurrent operations, duplicate retries, and guild/buyer isolation");

    const discord = require("../bot/src/utils/preorderDiscord");
    const settings = await Settings.create({ guildId, categoryId: "100000000000000006", staffRoleId: "100000000000000007" });
    let createdChannels = 0, creationPayload;
    const channels = new Collection();
    const channel = {
        id: "100000000000000008", guildId, messages: { fetch: async () => ({ edit: async () => {} }) },
        send: async () => ({ id: "100000000000000009" }), permissionOverwrites: { edit: async () => {} },
    };
    const category = { id: settings.categoryId, type: ChannelType.GuildCategory, permissionsFor: () => ({ has: () => true }) };
    const client = { user: { id: botId }, channels: { fetch: async () => channel } };
    const guild = { id: guildId, members: { me: {} }, channels: {
        fetch: async id => id ? category : channels,
        create: async payload => { createdChannels++; creationPayload = payload; channel.topic = payload.topic; channels.set(channel.id, channel); return channel; },
    } };
    let reply;
    const interaction = {
        guildId, guild, id: "100000000000000010", customId: "po:new",
        user: { id: buyerId, send: async () => { throw new Error("DM closed"); } },
        member: { roles: { cache: new Collection() } },
        fields: { getTextInputValue: key => key === "product" ? "Private product" : "200" },
        isButton: () => false, isModalSubmit: () => true,
        deferReply: async () => {}, editReply: async value => { reply = value; },
    };
    await discord.handleComponent(client, interaction);
    await discord.handleComponent(client, interaction);
    assert.equal(createdChannels, 1);
    assert.ok(creationPayload.permissionOverwrites.some(entry => entry.id === guildId && entry.type === OverwriteType.Role && entry.deny.includes(P.ViewChannel)));
    assert.ok(creationPayload.permissionOverwrites.some(entry => entry.id === buyerId && entry.type === OverwriteType.Member));
    assert.ok(creationPayload.permissionOverwrites.some(entry => entry.id === settings.staffRoleId && entry.type === OverwriteType.Role));
    const ticket = await Order.findOne({ guildId, requestId: interaction.id }).lean();
    assert.equal(ticket.channelId, channel.id);
    await service.deposit(guildId, ticket._id, "ticket-stock", lines("TICKET-SECRET", 100));
    await service.markPaid(guildId, ticket._id, ownerId);
    interaction.id = "100000000000000011";
    interaction.customId = "po:take:" + ticket._id;
    interaction.fields.getTextInputValue = () => "25";
    await discord.handleComponent(client, interaction);
    assert.match(reply.content, /DM belum bisa dikirim/);
    assert.equal(reply.files[0].attachment.toString().split("\n").length, 25);
    assert.equal((await service.get(guildId, ticket._id)).collectedQty, 25);
    await discord.handleComponent(client, interaction);
    assert.equal((await service.get(guildId, ticket._id)).collectedQty, 25);
    interaction.customId = "po:download:" + ticket._id;
    interaction.isButton = () => true;
    interaction.isModalSubmit = () => false;
    await discord.handleComponent(client, interaction);
    assert.equal(reply.files[0].attachment.toString().split("\n").length, 25);
    interaction.user.id = ownerId;
    await assert.rejects(discord.handleComponent(client, interaction), /Hanya pembeli/);
    interaction.user.id = buyerId;
    interaction.customId = "po:deposit:" + ticket._id;
    await assert.rejects(discord.handleComponent(client, interaction), /Hanya admin/);
    interaction.options = { getSubcommand: () => "list", getInteger: () => 1 };
    await discord.runCommand(client, interaction);
    assert.equal(JSON.stringify(reply).includes("SECRET"), false);
    const publicSummary = discord.summary(await service.get(guildId, ticket._id));
    for (const row of publicSummary.components) assert.ok(row.toJSON().components.length > 0);
    assert.equal(JSON.stringify(publicSummary).includes("TICKET-SECRET"), false);
    assert.match(publicSummary.embeds[0].description, /100\/200/);
    assert.equal(publicSummary.embeds[0].fields.find(field => field.name === "Sudah diambil").value, "25");
    assert.equal((await service.get(guildId, ticket._id)).collectedQty, 25);
    let openedModal;
    interaction.showModal = async value => { openedModal = value.toJSON(); };
    interaction.user.id = ownerId;
    for (const action of ["paid", "deposit", "close"]) {
        interaction.customId = `po:${action}:${ticket._id}`;
        await discord.handleComponent(client, interaction);
        assert.ok(openedModal.custom_id.startsWith("po:"));
        assert.ok(openedModal.components.length > 0);
    }
    interaction.user.id = buyerId;
    interaction.customId = `po:collect:${ticket._id}`;
    await discord.handleComponent(client, interaction);
    assert.ok(openedModal.components.length > 0);
    console.log("OK: private ticket permissions, replay-safe ticket creation, DM fallback and redownload, admin controls, and secret-free summaries");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    try {
        if (mongoose.connection.readyState === 1 && mongoose.connection.name === dbName && /^gevra_po_test_\d+_[a-f0-9]+$/.test(dbName)) {
            await mongoose.connection.dropDatabase();
            console.log("Isolated preorder test database removed");
        }
    } finally { await mongoose.disconnect(); }
});
