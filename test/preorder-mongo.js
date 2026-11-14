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
    const command = require("../bot/src/slashCommands/information/setpreorder");
    assert.equal(command.name, "setpreorder");
    assert.deepEqual(command.options.map(option => option.name), ["channel", "kategori"]);
    assert.equal(require("node:fs").existsSync(require("node:path").join(__dirname, "../bot/src/slashCommands/information/preorder.js")), false);
    let createdChannels = 0, creationPayload;
    let lastPanel, mainPanel;
    const panelMessages = new Collection();
    let nextMessage = 40n;
    const savePanelView = value => {
        if (value.embeds[0].title.includes("Create Ticket PreOrder")) mainPanel = value;
        else lastPanel = value;
    };
    const panel = { id: "100000000000000031", guildId, type: ChannelType.GuildText,
        permissionsFor: () => ({ has: () => true }), messages: { fetch: async id => {
            if (!panelMessages.has(id)) throw Object.assign(new Error("Unknown message"), { code: 10008 });
            return panelMessages.get(id);
        } },
        send: async value => {
            savePanelView(value);
            const message = { id: String(100000000000000000n + nextMessage++),
                edit: async updated => { savePanelView(updated); return message; }, delete: async () => panelMessages.delete(message.id) };
            panelMessages.set(message.id, message);
            return message;
        }, toString: () => "<#panel>" };
    const channels = new Collection();
    const channel = {
        id: "100000000000000008", guildId, messages: { fetch: async () => ({ edit: async () => {} }) },
        send: async () => ({ id: "100000000000000009" }), permissionOverwrites: { edit: async () => {} },
    };
    const category = { id: settings.categoryId, guildId, name: "Preorder Tickets", type: ChannelType.GuildCategory, permissionsFor: () => ({ has: () => true }) };
    const client = { user: { id: botId }, channels: { fetch: async id => id === panel.id ? panel : channel } };
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
    interaction.user.id = ownerId;
    interaction.options = { getChannel: name => name === "channel" ? panel : category };
    const fullPanelPermissions = panel.permissionsFor;
    panel.permissionsFor = () => ({ has: flag => flag !== P.SendMessages });
    await assert.rejects(discord.runCommand(client, interaction), error => /Send Messages/.test(error.message) && !/Manage Roles/.test(error.message));
    panel.permissionsFor = fullPanelPermissions;
    await discord.runCommand(client, interaction);
    assert.equal(panelMessages.size, 2);
    assert.equal(mainPanel.embeds.length, 1);
    assert.equal(mainPanel.embeds[0].title, "🎫 Create Ticket PreOrder 🎫");
    assert.ok(mainPanel.embeds[0].description.length < 100);
    assert.equal(mainPanel.components[0].toJSON().components[0].label, "Create PreOrder");
    assert.equal(lastPanel.embeds[0].title, "Daftar PreOrder");
    assert.ok(lastPanel.embeds[0].description.includes("`200/200` ✅"));
    assert.equal(lastPanel.embeds[0].description.split("\n").length, 2, "one logical line per preorder");
    assert.ok(lastPanel.components[0].toJSON().components.some(button => button.custom_id === "po:mine:0"));
    interaction.user.id = buyerId;
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
    interaction.customId = "po:mine:0";
    await discord.handleComponent(client, interaction);
    assert.equal(JSON.stringify(reply).includes("SECRET"), false);
    assert.equal(JSON.stringify(reply).includes(second.code), false);
    const publicSummary = discord.summary(await service.get(guildId, ticket._id));
    for (const row of publicSummary.components) assert.ok(row.toJSON().components.length > 0);
    assert.equal(JSON.stringify(publicSummary).includes("TICKET-SECRET"), false);
    assert.match(publicSummary.embeds[0].description, /100\/200/);
    assert.match(publicSummary.embeds[0].fields.find(field => field.name.includes("Sudah diambil")).value, /25/);
    assert.equal((await service.get(guildId, ticket._id)).collectedQty, 25);
    let openedModal;
    interaction.showModal = async value => { openedModal = value.toJSON(); };
    interaction.user.id = ownerId;
    for (const action of ["paid", "deposit", "upload", "close"]) {
        interaction.customId = `po:${action}:${ticket._id}`;
        await discord.handleComponent(client, interaction);
        assert.ok(openedModal.custom_id.startsWith("po:"));
        assert.ok(openedModal.components.length > 0);
        if (action === "upload") assert.equal(openedModal.components[0].component.type, 19);
    }
    interaction.user.id = buyerId;
    interaction.customId = `po:collect:${ticket._id}`;
    await discord.handleComponent(client, interaction);
    assert.ok(openedModal.components.length > 0);
    interaction.user.id = ownerId;
    interaction.customId = `po:handle:${ticket._id}`;
    await discord.handleComponent(client, interaction);
    assert.equal((await service.get(guildId, ticket._id)).handledBy, ownerId);
    await assert.rejects(service.handle(guildId, ticket._id, "other-admin"), /admin lain/);
    const originalFetch = global.fetch;
    try {
        global.fetch = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(lines("FILE-SECRET", 10)).buffer });
        interaction.id = "100000000000000032";
        interaction.customId = `po:stockfile:${ticket._id}`;
        interaction.isButton = () => false;
        interaction.isModalSubmit = () => true;
        interaction.fields.getUploadedFiles = () => new Collection([["file", {
            name: "stocks.txt", size: 200, url: "https://cdn.discordapp.com/ephemeral-attachments/1/2/stocks.txt",
        }]]);
        await discord.handleComponent(client, interaction);
        assert.equal((await service.get(guildId, ticket._id)).depositedQty, 110);
        assert.match(lastPanel.embeds[0].description, /110\/200/);
        assert.equal(JSON.stringify(lastPanel).includes("FILE-SECRET"), false);
    } finally { global.fetch = originalFetch; }
    await Order.insertMany(Array.from({ length: 10 }, (_, i) => ({ guildId, buyerId: "another-buyer", requestId: "page-" + i,
        code: "PO-PAGE" + i, productName: "Pagination product", quantity: 10 })));
    interaction.customId = "po:panel:1";
    interaction.isButton = () => true;
    interaction.isModalSubmit = () => false;
    interaction.deferUpdate = async () => {};
    await discord.handleComponent(client, interaction);
    assert.match(lastPanel.embeds[0].footer.text, /^2\//);
    assert.equal(panelMessages.size, 2, "updates keep the same two panel and list messages");
    for (const row of lastPanel.components) row.toJSON();
    await Order.updateOne({ _id: second._id }, { $set: { productName: "Other store product" } });
    const isolatedPanel = await discord.panelPayload(otherGuild);
    assert.ok(isolatedPanel.list.embeds[0].description.includes("Other store product"));
    assert.equal(isolatedPanel.list.embeds[0].description.includes("Private product"), false);
    assert.ok(isolatedPanel.list.embeds[0].description.endsWith("⏳"));
    await service.deposit(otherGuild, second._id, "finish-second", lines("READY", 50));
    assert.ok((await discord.panelPayload(otherGuild)).list.embeds[0].description.endsWith("✅"), "fully stocked preorder uses ready emoji even before manual payment confirmation");
    const custom = "<:preorder_test:100000000000000099>";
    guild.emojis = { cache: new Collection([["100000000000000099", { available: true, roles: { cache: new Collection() }, toString: () => custom }]]) };
    await mongoose.connection.collection("storefronts").updateOne({ _id: guildId },
        { $set: { preorderEmojis: { preorderTitleLeft: custom, preorderLoading: custom, preorderReady: custom } } }, { upsert: true });
    const customPanel = await discord.panelPayload(guildId, 0, { guild });
    assert.equal(customPanel.panel.embeds[0].title, custom + " Create Ticket PreOrder 🎫");
    assert.ok(customPanel.list.embeds[0].description.split("\n").every(line => line.endsWith(custom)), "pending status uses configured custom emoji");
    const oldSettings = await Settings.findOne({ guildId }).lean();
    panelMessages.delete(oldSettings.listMessageId);
    await Settings.updateOne({ guildId }, { $unset: { listMessageId: "" } });
    await discord.handleComponent(client, interaction);
    assert.equal(panelMessages.size, 2, "legacy or missing list messages are recreated once");
    assert.ok((await Settings.findOne({ guildId }).lean()).listMessageId);
    interaction.user.id = buyerId;
    interaction.customId = `po:cancel:${ticket._id}`;
    await assert.rejects(discord.handleComponent(client, interaction), /Hanya admin/);
    interaction.user.id = ownerId;
    await discord.handleComponent(client, interaction);
    assert.equal(openedModal.components.length, 2);
    const beforeCancel = await service.get(guildId, ticket._id);
    interaction.isButton = () => false;
    interaction.isModalSubmit = () => true;
    interaction.customId = `po:cancelconfirm:${ticket._id}`;
    interaction.fields.getTextInputValue = key => key === "confirm" ? "CLOSE" : "Pembeli meminta pembatalan";
    await assert.rejects(discord.handleComponent(client, interaction), /Ketik BATAL/);
    interaction.fields.getTextInputValue = key => key === "confirm" ? "BATAL" : "Pembeli meminta pembatalan";
    await discord.handleComponent(client, interaction);
    const cancelledTicket = await service.get(guildId, ticket._id);
    assert.equal(cancelledTicket.status, "cancelled");
    assert.equal(progress(cancelledTicket), "Dibatalkan");
    assert.equal(cancelledTicket.collectedQty, 25);
    assert.equal(cancelledTicket.depositedQty, 110);
    assert.deepEqual(cancelledTicket.items, beforeCancel.items);
    assert.equal(cancelledTicket.paidAt.getTime(), beforeCancel.paidAt.getTime());
    assert.equal(cancelledTicket.closedBy, ownerId);
    assert.match(cancelledTicket.cancelReason, /Pembeli meminta/);
    await assert.rejects(service.collect(guildId, ticket._id, buyerId, "after-cancel", 1), /ditolak/);
    await assert.rejects(service.deposit(guildId, ticket._id, "after-cancel-deposit", "stock"), /ditolak/);
    interaction.isButton = () => true;
    interaction.isModalSubmit = () => false;
    interaction.customId = `po:remaining:${ticket._id}`;
    interaction.user.id = buyerId;
    await assert.rejects(discord.handleComponent(client, interaction), /Hanya admin/);
    interaction.user.id = ownerId;
    await discord.handleComponent(client, interaction);
    assert.equal(reply.files[0].attachment.toString().split("\n").length, 85);
    assert.equal(reply.files[0].attachment.toString().split("\n")[0], "TICKET-SECRET 25");
    interaction.user.id = buyerId;
    interaction.customId = `po:download:${ticket._id}`;
    await discord.handleComponent(client, interaction);
    assert.equal(reply.files[0].attachment.toString().split("\n").length, 25);
    const cancelledSummary = discord.summary(cancelledTicket);
    assert.ok(cancelledSummary.components[0].toJSON().components[0].disabled);
    assert.ok(cancelledSummary.components[0].toJSON().components[0].emoji);
    assert.equal(JSON.stringify(cancelledSummary).includes("TICKET-SECRET"), false);
    for (const row of cancelledSummary.components) row.toJSON();
    const racing = await make("race-cancel", 50, otherGuild, "race-buyer");
    await service.deposit(otherGuild, racing._id, "race-batch", lines("RACE", 50));
    await service.markPaid(otherGuild, racing._id, ownerId);
    const race = await Promise.allSettled([
        service.collect(otherGuild, racing._id, "race-buyer", "racing-claim", 10),
        service.cancel(otherGuild, racing._id, ownerId, "Batalkan setelah verifikasi admin"),
    ]);
    assert.equal(race[1].status, "fulfilled");
    const raced = await service.get(otherGuild, racing._id);
    assert.equal(raced.status, "cancelled");
    assert.ok([0, 10].includes(raced.collectedQty));
    assert.equal(raced.items.length, 50);
    await assert.rejects(service.collect(otherGuild, racing._id, "race-buyer", "racing-after", 1), /ditolak/);
    console.log("OK: private ticket permissions, replay-safe ticket creation, DM fallback and redownload, admin controls, and secret-free summaries");
    console.log("OK: single setup command, live paginated public list, private order recovery, modal file upload, and staff claim");
    console.log("OK: admin-only forced cancellation, explicit confirmation, retained collected files, leftover stock recovery, and concurrent cancellation/collection");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    try {
        if (mongoose.connection.readyState === 1 && mongoose.connection.name === dbName && /^gevra_po_test_\d+_[a-f0-9]+$/.test(dbName)) {
            await mongoose.connection.dropDatabase();
            console.log("Isolated preorder test database removed");
        }
    } finally { await mongoose.disconnect(); }
});
