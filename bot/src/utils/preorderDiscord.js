"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, OverwriteType, FileUploadBuilder, LabelBuilder, PermissionFlagsBits: P, escapeMarkdown } = require("discord.js");
const { Order, Settings } = require("../Schema/preorder");
const { Owner, Admin = [] } = require("../config/config.json");
const { createPreorders, PreorderError, progress } = require("./preorders");
const { collection: storefrontCollection, resolvePreorderEmojis } = require("../config/storefront");
const orders = createPreorders();
const refreshes = new Map();
const privateReply = { ephemeral: true };
const buttonIcons = { create: "🛒", mine: "📋", manage: "⚙️", panel: "🔄", collect: "📦", refresh: "🔄",
    deposit: "📝", upload: "📤", paid: "💳", handle: "🙌", close: "🔒", cancel: "⛔", remaining: "🗂️", open: "🎫" };
const button = (id, label, style = ButtonStyle.Secondary) => {
    const component = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
    const icon = buttonIcons[id.split(":")[1]];
    if (icon) component.setEmoji(icon);
    return component;
};
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const ticketTopic = order => `Preorder ${order.code} | order:${order._id} | buyer:${order.buyerId}`;
const staffIds = () => [...new Set([Owner, ...Admin].filter(Boolean))];

function isStaff(interaction, settings) {
    return staffIds().includes(interaction.user.id) || !!interaction.memberPermissions?.has(P.Administrator) ||
        !!(settings?.staffRoleId && interaction.member?.roles?.cache?.has(settings.staffRoleId));
}

function displayStatus(order) {
    const label = progress(order);
    const styles = {
        "Menunggu konfirmasi pembayaran": ["⏳", 0xf59e0b], "Menunggu stok": ["🔄", 0x5865f2],
        "Siap sebagian": ["📦", 0x14b8a6], "Siap semua": ["✅", 0x22c55e],
        "Selesai": ["🏁", 0x22c55e], "Dibatalkan": ["⛔", 0xef4444],
    };
    const [icon, color] = styles[label];
    return { text: `${icon} ${label}`, color };
}

function summary(order) {
    const filled = Math.floor(order.depositedQty / order.quantity * 10);
    const status = displayStatus(order);
    const cancelled = progress(order) === "Dibatalkan";
    const pendingDelivery = order.claims?.some(claim => !claim.deliveredAt);
    const components = [
        row(button(`po:collect:${order._id}`, "Ambil pesanan", ButtonStyle.Success).setDisabled(!pendingDelivery && !order.collectedQty && (order.status !== "open" || !order.paidAt || order.depositedQty <= order.collectedQty)),
            button(`po:refresh:${order._id}`, "Cek status")),
        row(button(`po:deposit:${order._id}`, "Setor teks").setDisabled(order.status !== "open" || order.depositedQty === order.quantity),
            button(`po:upload:${order._id}`, "Upload .txt").setDisabled(order.status !== "open" || order.depositedQty === order.quantity),
            button(`po:paid:${order._id}`, "Tandai lunas", ButtonStyle.Success).setDisabled(!!order.paidAt || order.status !== "open")),
        row(button(`po:handle:${order._id}`, order.handledBy ? "Sudah ditangani" : "Claim tiket", ButtonStyle.Primary).setDisabled(!!order.handledBy || order.status !== "open"),
            button(`po:close:${order._id}`, "Tutup tiket").setDisabled(!!order.ticketDeletedAt || !!order.ticketClosing),
            button(`po:cancel:${order._id}`, "Batalkan paksa", ButtonStyle.Danger).setDisabled(order.status !== "open" || order.collectedQty === order.quantity)),
    ];
    if (order.status === "cancelled" && order.depositedQty > order.collectedQty) {
        components.push(row(button(`po:remaining:${order._id}`, "Unduh sisa stok (admin)")));
    }
    const fields = [
        { name: "👤 Pembeli", value: `<@${order.buyerId}>`, inline: true },
        { name: "🎫 Nomor pesanan", value: `\`${order.code}\``, inline: true },
        { name: "🙌 Admin", value: order.handledBy ? `<@${order.handledBy}>` : "Belum di-claim", inline: true },
        { name: "🛒 Jumlah pesanan", value: `**${order.quantity}** stok`, inline: true },
        { name: "📦 Sudah disetor", value: `**${order.depositedQty}** stok`, inline: true },
        { name: "⏳ Belum disetor", value: `**${order.quantity - order.depositedQty}** stok`, inline: true },
        { name: "📥 Sudah diambil", value: `**${order.collectedQty}** stok`, inline: true },
        { name: cancelled ? "🗂️ Sisa stok admin" : "🎁 Siap diambil", value: `**${order.depositedQty - order.collectedQty}** stok`, inline: true },
        { name: "💳 Pembayaran", value: order.paidAt ? "✅ Dikonfirmasi admin" : "⏳ Menunggu admin", inline: true },
    ];
    if (cancelled) fields.push({ name: "📝 Pembatalan", value: escapeMarkdown(order.cancelReason || "Dibatalkan admin.") +
        (order.paidAt ? "\n💬 Hubungi admin untuk penyelesaian pembayaran manual." : ""), inline: false });
    return { content: `<@${order.buyerId}> · <@${Owner}>`, embeds: [{
        title: cancelled ? "⛔ Preorder Dibatalkan" : order.status === "closed" ? "🔒 Preorder Selesai" : "🎫 Tiket Preorder",
        color: status.color,
        description: (order.status !== "open" ? "Riwayat preorder tetap tersimpan.\n\n"
            : `Halo <@${order.buyerId}>! Selamat datang di tiket privatmu. Admin akan membantu pembayaran dan menyiapkan pesanan.\n\n`) +
            `📦 **${escapeMarkdown(order.productName)}**\n${status.text}\n\n` +
            `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} **${Math.round(order.depositedQty / order.quantity * 100)}%**\n` +
            `\`${order.depositedQty}/${order.quantity} stok disetor\``,
        fields, footer: { text: "GevraStore • Stok bertahap • Pembayaran manual" },
    }], components, allowedMentions: { parse: [] } };
}

async function refresh(client, guildId, id) {
    const key = guildId + ":" + id;
    const previous = refreshes.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        const order = await orders.get(guildId, id);
        if (!order.channelId || order.ticketClosing || order.ticketDeletedAt) return;
        const channel = await client.channels.fetch(order.channelId).catch(async error => {
            if (error.code !== 10003 || order.status === "open") throw error;
            await Order.updateOne({ _id: order._id, guildId, channelId: order.channelId, status: { $in: ["closed", "cancelled"] } },
                { $set: { ticketDeletedAt: new Date(), ticketClosing: false, summaryDirty: false } });
            return null;
        });
        if (!channel) return;
        if (channel?.guildId !== guildId) throw new PreorderError("Channel tiket tidak ditemukan di server ini.");
        let message = order.messageId ? await channel.messages.fetch(order.messageId).catch(() => null) : null;
        if (message) await message.edit(summary(order));
        else {
            message = await channel.send({ ...summary(order), nonce: String(order._id), enforceNonce: true,
                allowedMentions: { users: [...new Set([order.buyerId, Owner].filter(Boolean))] } });
            await Order.updateOne({ _id: order._id, guildId }, { $set: { messageId: message.id } });
        }
        if (order.status !== "open") await channel.permissionOverwrites.edit(order.buyerId, { SendMessages: false, AttachFiles: false });
        await Order.updateOne({ _id: order._id, guildId, revision: order.revision }, { $set: { summaryDirty: false } });
    });
    refreshes.set(key, current);
    try { await current; }
    finally { if (refreshes.get(key) === current) refreshes.delete(key); }
}

async function refreshQuietly(client, order) {
    try { await Settings.updateOne({ guildId: order.guildId }, { $set: { panelDirty: true }, $inc: { panelRevision: 1 } }); }
    catch { console.error("[PREORDER] Pembaruan daftar belum bisa dijadwalkan."); return; }
    try { await refresh(client, order.guildId, order._id); }
    catch { console.error("[PREORDER] Ringkasan tiket belum diperbarui", order.code); }
    try { await refreshPanel(client, order.guildId); }
    catch { console.error("[PREORDER] Daftar preorder belum diperbarui."); }
}

function checkPermissions(channel, member, flags) {
    const permissions = channel.permissionsFor(member);
    const missing = flags.filter(flag => !permissions?.has(flag));
    const names = new Map([[P.ViewChannel, "View Channel"], [P.SendMessages, "Send Messages"], [P.EmbedLinks, "Embed Links"],
        [P.AttachFiles, "Attach Files"], [P.ReadMessageHistory, "Read Message History"], [P.ManageChannels, "Manage Channels"], [P.ManageRoles, "Manage Roles"]]);
    if (missing.length) throw new PreorderError(`Izin bot yang kurang di ${channel}: **${missing.map(flag => names.get(flag)).join(", ")}**. Buka Edit Channel/Kategori → Permissions → pilih bot dan izinkan bagian tersebut, lalu ulangi /setpreorder.`);
}

async function ensureTicket(client, guild, order, settings) {
    if (order.channelId) return order;
    const now = new Date();
    const reserved = await Order.findOneAndUpdate({ _id: order._id, guildId: guild.id, status: "open", channelId: null,
        $or: [{ ticketLeaseUntil: null }, { ticketLeaseUntil: { $lt: now } }] },
    { $set: { ticketLeaseUntil: new Date(Date.now() + 60000) } }, { new: true }).lean();
    if (!reserved) throw new PreorderError("Tiket sedang dibuat. Buka panel preorder → Pesanan saya → pilih pesananmu sebentar lagi.");
    const member = guild.members.me || await guild.members.fetchMe();
    const category = await guild.channels.fetch(settings.categoryId);
    if (category?.type !== ChannelType.GuildCategory) throw new PreorderError("Kategori tiket sudah tidak tersedia. Minta admin menjalankan /setpreorder kembali.");
    checkPermissions(category, member, [P.ViewChannel, P.ManageChannels, P.ManageRoles]);
    const channels = await guild.channels.fetch();
    let channel = channels.find(item => item?.topic === ticketTopic(order));
    if (!channel) {
        const access = P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.AttachFiles;
        const overwrites = new Map([
            [guild.id, { id: guild.id, type: OverwriteType.Role, deny: [P.ViewChannel] }],
            [client.user.id, { id: client.user.id, type: OverwriteType.Member, allow: [access | P.EmbedLinks | P.ManageChannels] }],
            [order.buyerId, { id: order.buyerId, type: OverwriteType.Member, allow: [access] }],
        ]);
        for (const id of staffIds()) overwrites.set(id, { id, type: OverwriteType.Member, allow: [access] });
        if (settings.staffRoleId) overwrites.set(settings.staffRoleId, { id: settings.staffRoleId, type: OverwriteType.Role, allow: [access] });
        channel = await guild.channels.create({ name: order.code.toLowerCase(), type: ChannelType.GuildText,
            parent: category.id, topic: ticketTopic(order), permissionOverwrites: [...overwrites.values()],
            reason: "Tiket preorder " + order.code });
    }
    const saved = await Order.findOneAndUpdate({ _id: order._id, guildId: guild.id, channelId: null },
        { $set: { channelId: channel.id, ticketLeaseUntil: null, summaryDirty: true } }, { new: true }).lean();
    order = saved || await orders.get(guild.id, order._id);
    await refreshQuietly(client, order);
    return order;
}

function modal(id, title, fields) {
    const inputs = fields.map(field => {
        const input = new TextInputBuilder().setCustomId(field.id).setLabel(field.label)
            .setStyle(field.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(true).setMaxLength(field.max || 100);
        if (field.placeholder) input.setPlaceholder(field.placeholder);
        return new ActionRowBuilder().addComponents(input);
    });
    return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...inputs);
}

function requireStaff(interaction, settings) {
    if (!isStaff(interaction, settings)) throw new PreorderError("Hanya admin preorder yang boleh melakukan tindakan ini.");
}

async function deliver(client, interaction, order, lines, requestId) {
    const file = { attachment: Buffer.from(lines.join("\n"), "utf8"), name: `${order.code}-${requestId}.txt` };
    let sentByDm = false;
    try {
        await interaction.user.send({ content: `Pengambilan ${order.code} · ${escapeMarkdown(order.productName)} · ${lines.length} stok.`,
            files: [file], allowedMentions: { parse: [] }, nonce: "po-" + requestId, enforceNonce: true });
        sentByDm = true;
    } catch { /* Deliver privately in the interaction when the buyer has closed DMs. */ }
    if (!sentByDm) await interaction.editReply({ content: `📦 DM belum bisa dikirim. File **${lines.length} stok pesananmu** tersedia di sini.`, files: [file] });
    await Order.updateOne({ _id: order._id, guildId: order.guildId, buyerId: interaction.user.id, "claims.requestId": requestId },
        { $set: { "claims.$.deliveredAt": new Date(), summaryDirty: true }, $inc: { revision: 1 } });
    if (sentByDm) await interaction.editReply({ content: `📦 **${lines.length} stok pesananmu** sudah dikirim ke DM.` });
    await refreshQuietly(client, order);
}

async function deleteTicket(client, order) {
    if (order.ticketDeletedAt) return;
    const channel = order.channelId ? await client.channels.fetch(order.channelId).catch(error => {
        if (error.code === 10003) return null;
        throw error;
    }) : null;
    if (channel) {
        if (channel.guildId !== order.guildId || channel.topic !== ticketTopic(order)) throw new PreorderError("Identitas channel tidak cocok dengan tiket preorder ini.");
        await channel.delete("Tiket preorder " + order.code + " ditutup oleh admin").catch(error => {
            if (error.code !== 10003) throw error;
        });
    }
    await Order.updateOne({ _id: order._id, guildId: order.guildId, ticketClosing: true },
        { $set: { ticketClosing: false, ticketDeletedAt: new Date(), summaryDirty: false } });
}

async function readStockFile(attachment) {
    if (!attachment || !/\.txt$/i.test(attachment.name || "") || attachment.size > 1024 * 1024 ||
        !/^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/(?:ephemeral-)?attachments\//.test(attachment.url)) {
        throw new PreorderError("Upload file .txt dari Discord, maksimal 1 MB. Satu stok per baris.");
    }
    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new PreorderError("File stok belum bisa diunduh. Coba lagi.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 1024 * 1024) throw new PreorderError("File stok terlalu besar. Maksimal 1 MB.");
    return Buffer.from(bytes).toString("utf8");
}

async function panelPayload(guildId, requestedPage = 0, context = {}) {
    const total = await Order.countDocuments({ guildId });
    const storefront = await Order.db.collection(storefrontCollection).findOne({ _id: guildId });
    const emojis = await resolvePreorderEmojis(storefront, context.guild, context.permissions);
    const pages = Math.max(1, Math.ceil(total / 8));
    const page = Math.max(0, Math.min(pages - 1, Number(requestedPage) || 0));
    const list = await Order.find({ guildId }).select("code buyerId productName quantity depositedQty collectedQty paidAt status handledBy")
        .sort({ createdAt: -1, _id: -1 }).skip(page * 8).limit(8).lean();
    const description = list.map((order, index) => {
        const cancelled = progress(order) === "Dibatalkan";
        const icon = cancelled ? "⛔" : order.depositedQty >= order.quantity ? emojis.preorderReady : emojis.preorderLoading;
        const product = escapeMarkdown(order.productName.replace(/\s+/g, " "));
        return `**${page * 8 + index + 1}.** <@${order.buyerId}> · **${product}** · \`${order.depositedQty}/${order.quantity}\` ${icon}`;
    }).join("\n");
    const navigation = [];
    if (pages > 1) navigation.push(row(button(`po:panel:${page - 1}`, "Sebelumnya").setEmoji("◀️").setDisabled(page === 0),
        button(`po:panel:${page + 1}`, "Selanjutnya").setEmoji("▶️").setDisabled(page === pages - 1)));
    return {
        panel: { embeds: [{ title: `${emojis.preorderTitleLeft} Create Ticket PreOrder ${emojis.preorderTitleRight}`,
            color: 0x3498db, description: "Klik tombol di bawah, lalu isi produk dan jumlah preorder kamu.", footer: { text: "GevraStore" } }],
            components: [row(button("po:create", "Create PreOrder", ButtonStyle.Secondary).setEmoji("🎫"))], allowedMentions: { parse: [] } },
        list: { embeds: [{ title: "Daftar PreOrder", color: 0x3498db, description: description || "Belum ada preorder.",
            footer: { text: `${page + 1}/${pages} · ${total} preorder` } }], components: navigation, allowedMentions: { parse: [] } },
    };
}

async function refreshPanel(client, guildId) {
    const key = "panel:" + guildId;
    const previous = refreshes.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        const settings = await Settings.findOne({ guildId }).lean();
        if (!settings?.panelChannelId || !settings.panelMessageId) return;
        const channel = await client.channels.fetch(settings.panelChannelId);
        if (channel?.guildId !== guildId) throw new PreorderError("Channel panel preorder tidak tersedia.");
        const message = await channel.messages.fetch(settings.panelMessageId);
        const guild = channel.guild || client.guilds?.cache.get(guildId);
        const permissions = guild?.members.me ? channel.permissionsFor(guild.members.me) : undefined;
        const payload = await panelPayload(guildId, settings.panelPage, { guild, permissions });
        await message.edit(payload.panel);
        let listMessage = settings.listMessageId ? await channel.messages.fetch(settings.listMessageId).catch(error => {
            if (error.code === 10008) return null;
            throw error;
        }) : null;
        if (listMessage) await listMessage.edit(payload.list);
        else {
            listMessage = await channel.send({ ...payload.list, nonce: "pol-" + settings.panelMessageId, enforceNonce: true });
            await Settings.updateOne({ guildId, panelMessageId: settings.panelMessageId }, { $set: { listMessageId: listMessage.id } });
        }
        const revision = settings.panelRevision === undefined ? { $exists: false } : settings.panelRevision;
        await Settings.updateOne({ guildId, panelRevision: revision }, { $set: { panelDirty: false, panelRevision: settings.panelRevision || 0 } });
    });
    refreshes.set(key, current);
    try { await current; }
    finally { if (refreshes.get(key) === current) refreshes.delete(key); }
}

async function showMyOrders(interaction, requestedPage, manage = false) {
    const scope = { guildId: interaction.guildId, ...(manage ? {} : { buyerId: interaction.user.id }) };
    const total = await Order.countDocuments(scope);
    const pages = Math.max(1, Math.ceil(total / 5));
    const page = Math.max(0, Math.min(pages - 1, Number(requestedPage) || 0));
    const list = await Order.find(scope).select("code productName quantity depositedQty collectedQty paidAt status channelId")
        .sort({ createdAt: -1, _id: -1 }).skip(page * 5).limit(5).lean();
    const description = list.map(order => `**${order.code}** · ${escapeMarkdown(order.productName)}\n` +
        `📦 Disetor **${order.depositedQty}/${order.quantity}** · 📥 Diambil **${order.collectedQty}**\n${displayStatus(order).text}`).join("\n\n");
    const components = list.length ? [row(...list.map(order => button(`po:open:${order._id}`, order.code)))] : [];
    if (pages > 1) components.push(row(button(`po:mine:${page - 1}`, "Sebelumnya").setEmoji("◀️").setDisabled(page === 0),
        button(`po:mine:${page + 1}`, "Selanjutnya").setEmoji("▶️").setDisabled(page === pages - 1)));
    await interaction.editReply({ embeds: [{ title: manage ? "⚙️ Kelola Preorder" : "📋 Preorder Kamu", color: 0x65efd0,
        description: description || "Kamu belum mempunyai preorder.", footer: { text: `Halaman ${page + 1}/${pages} · Tekan kode pesanan untuk membuka tiket dan status` } }],
        components, allowedMentions: { parse: [] } });
}

async function setup(client, interaction) {
    const previous = await Settings.findOne({ guildId: interaction.guildId }).lean();
    if (!isStaff(interaction, previous)) throw new PreorderError("Hanya owner atau admin yang boleh mengatur preorder.");
    const channel = interaction.options.getChannel("channel");
    const category = interaction.options.getChannel("kategori");
    if (channel?.guildId !== interaction.guildId || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) ||
        category?.guildId !== interaction.guildId || category.type !== ChannelType.GuildCategory) {
        throw new PreorderError("Pilih channel teks untuk panel dan kategori tiket di server ini.");
    }
    const member = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    checkPermissions(channel, member, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory]);
    checkPermissions(category, member, [P.ViewChannel, P.ManageChannels, P.ManageRoles]);
    const payload = await panelPayload(interaction.guildId, 0, { guild: interaction.guild, permissions: channel.permissionsFor(member) });
    const existing = previous?.panelChannelId === channel.id && previous.panelMessageId
        ? await channel.messages.fetch(previous.panelMessageId).catch(() => null) : null;
    const message = existing ? await existing.edit(payload.panel) : await channel.send(payload.panel);
    let listMessage;
    let existingList;
    try {
        existingList = previous?.panelChannelId === channel.id && previous.listMessageId
            ? await channel.messages.fetch(previous.listMessageId).catch(error => { if (error.code === 10008) return null; throw error; }) : null;
        listMessage = existingList ? await existingList.edit(payload.list)
            : await channel.send({ ...payload.list, nonce: "pol-" + message.id, enforceNonce: true });
        await Settings.findOneAndUpdate({ guildId: interaction.guildId }, { $set: { panelChannelId: channel.id, panelMessageId: message.id,
            listMessageId: listMessage.id, categoryId: category.id, panelPage: 0, panelDirty: true }, $inc: { panelRevision: 1 } }, { upsert: true });
    } catch (error) {
        if (!existing) await message.delete().catch(() => {});
        if (listMessage && !existingList) await listMessage.delete().catch(() => {});
        throw error;
    }
    await interaction.editReply({ content: `Panel dan daftar preorder dibuat di ${channel}. Tiket akan masuk kategori **${escapeMarkdown(category.name || "Preorder")}**. Selanjutnya buyer dan admin cukup memakai tombol.`,
        components: [row(button("po:manage:0", "Kelola preorder"))] });
}

async function runCommand(client, interaction) {
    await interaction.deferReply(privateReply);
    return setup(client, interaction);
}

async function handleComponent(client, interaction) {
    const [prefix, action, id] = interaction.customId.split(":");
    if (prefix !== "po" || !interaction.guildId) return;
    const settings = await Settings.findOne({ guildId: interaction.guildId }).lean();
    if (action === "panel" && interaction.isButton()) {
        if (!settings) throw new PreorderError("Admin belum mengatur preorder. Jalankan /setpreorder.");
        await interaction.deferUpdate();
        await Settings.updateOne({ guildId: interaction.guildId }, { $set: { panelPage: Number(id) || 0, panelDirty: true }, $inc: { panelRevision: 1 } });
        return refreshPanel(client, interaction.guildId);
    }
    if (["mine", "manage"].includes(action) && interaction.isButton()) {
        if (action === "manage") requireStaff(interaction, settings);
        await interaction.deferReply(privateReply);
        return showMyOrders(interaction, id, action === "manage");
    }
    if (action === "create" && interaction.isButton()) {
        if (!settings) throw new PreorderError("Admin belum mengatur preorder. Jalankan /setpreorder.");
        return interaction.showModal(modal("po:new", "Buat Preorder", [
            { id: "product", label: "Produk yang ingin dipesan", placeholder: "Contoh: GrowID unregistered" },
            { id: "amount", label: "Jumlah pesanan", max: 5, placeholder: "Contoh: 200" },
        ]));
    }
    if (action === "new" && interaction.isModalSubmit()) {
        await interaction.deferReply(privateReply);
        if (!settings) throw new PreorderError("Admin belum mengatur preorder.");
        let order = await orders.create({ guildId: interaction.guildId, buyerId: interaction.user.id, requestId: interaction.id,
            productName: interaction.fields.getTextInputValue("product"), amount: interaction.fields.getTextInputValue("amount") });
        order = await ensureTicket(client, interaction.guild, order, settings);
        return interaction.editReply({ content: `Preorder ${order.code} dibuat. Lanjutkan di <#${order.channelId}>. Pembayaran diurus bersama admin di tiket.`,
            components: [row(button("po:mine:0", "Pesanan saya"))] });
    }
    let order = await orders.get(interaction.guildId, id);
    const buyer = order.buyerId === interaction.user.id;
    if (!buyer && !isStaff(interaction, settings)) throw new PreorderError("Tiket ini bukan milikmu.");
    if (interaction.isButton()) {
        if (["deposit", "upload", "paid", "close", "handle", "cancel", "remaining"].includes(action)) requireStaff(interaction, settings);
        if (action === "deposit") return interaction.showModal(modal(`po:stock:${id}`, "Setor Stok Preorder", [
            { id: "stock", label: "Satu stok per baris", long: true, max: 4000, placeholder: "Untuk stok besar, gunakan tombol Upload stok .txt" },
        ]));
        if (action === "upload") return interaction.showModal(new ModalBuilder().setCustomId(`po:stockfile:${id}`).setTitle("Upload Stok Preorder")
            .addLabelComponents(new LabelBuilder().setLabel("File stok .txt").setDescription("Satu stok per baris. Maksimal 1 MB per setoran.")
                .setFileUploadComponent(new FileUploadBuilder().setCustomId("stock_file").setMinValues(1).setMaxValues(1).setRequired(true))));
        if (action === "cancel") return interaction.showModal(modal(`po:cancelconfirm:${id}`, "Batalkan Preorder", [
            { id: "confirm", label: "Ketik BATAL untuk membatalkan preorder", max: 10 },
            { id: "reason", label: "Alasan pembatalan", long: true, max: 300, placeholder: "Jelaskan alasan agar pembeli mengetahui penyelesaiannya." },
        ]));
        if (action === "paid" || action === "close") return interaction.showModal(modal(`po:${action}confirm:${id}`,
            action === "paid" ? "Konfirmasi Pembayaran Manual" : "Tutup dan Hapus Channel Tiket", [
                { id: "confirm", label: action === "paid" ? "Ketik LUNAS jika pembayaran sudah diterima" : "Ketik TUTUP untuk menghapus channel tiket", max: 10 },
            ]));
        if (action === "collect") {
            if (!buyer) throw new PreorderError("Hanya pembeli pemilik preorder yang bisa mengambil stok.");
            const pending = order.claims.find(claim => !claim.deliveredAt);
            if (pending) {
                await interaction.deferReply(privateReply);
                return deliver(client, interaction, order, order.items.slice(pending.start, pending.start + pending.quantity), pending.requestId);
            }
            if (order.collectedQty > 0 && (order.status !== "open" || order.depositedQty === order.collectedQty)) {
                await interaction.deferReply(privateReply);
                return interaction.editReply({ content: `📦 Salinan **${order.collectedQty} stok yang sudah diambil**. Jumlah pengambilan tetap sama.`,
                    files: [{ attachment: Buffer.from(order.items.slice(0, order.collectedQty).join("\n"), "utf8"), name: `${order.code}-salinan-pesanan.txt` }] });
            }
            return interaction.showModal(modal(`po:take:${id}`, "Ambil Pesanan", [
                { id: "amount", label: "Jumlah yang ingin diambil", max: 5, placeholder: `Tersedia: ${order.depositedQty - order.collectedQty}` },
            ]));
        }
    }
    await interaction.deferReply(privateReply);
    if (action === "remaining" && interaction.isButton()) {
        requireStaff(interaction, settings);
        if (order.status !== "cancelled" || order.depositedQty <= order.collectedQty) throw new PreorderError("Tidak ada sisa stok dari preorder yang dibatalkan.");
        const lines = order.items.slice(order.collectedQty);
        return interaction.editReply({ content: `🗂️ **${lines.length} stok yang belum diambil** dari preorder ${order.code}. File hanya ditampilkan untuk admin.`,
            files: [{ attachment: Buffer.from(lines.join("\n"), "utf8"), name: `${order.code}-sisa-stok.txt` }] });
    }
    if (action === "open" && interaction.isButton()) {
        if (!order.channelId && settings && order.status === "open") order = await ensureTicket(client, interaction.guild, order, settings);
        await refreshQuietly(client, order);
        return interaction.editReply({ ...summary(order), content: order.ticketDeletedAt ? "Channel tiket sudah ditutup." : order.channelId ? `Buka tiketmu di <#${order.channelId}>.` : "Tiket belum tersedia." });
    }
    if (action === "cancelconfirm" && interaction.isModalSubmit()) {
        requireStaff(interaction, settings);
        if (interaction.fields.getTextInputValue("confirm").trim().toUpperCase() !== "BATAL") throw new PreorderError("Ketik BATAL untuk mengonfirmasi pembatalan paksa.");
        order = await orders.cancel(interaction.guildId, id, interaction.user.id, interaction.fields.getTextInputValue("reason"));
    } else if (action === "handle" && interaction.isButton()) {
        requireStaff(interaction, settings);
        order = await orders.handle(interaction.guildId, id, interaction.user.id);
    } else if (action === "stockfile" && interaction.isModalSubmit()) {
        requireStaff(interaction, settings);
        const file = interaction.fields.getUploadedFiles("stock_file", true).first();
        order = await orders.deposit(interaction.guildId, id, interaction.id, await readStockFile(file));
    } else if (action === "stock" && interaction.isModalSubmit()) {
        requireStaff(interaction, settings);
        order = await orders.deposit(interaction.guildId, id, interaction.id, interaction.fields.getTextInputValue("stock"));
    } else if (["paidconfirm", "closeconfirm"].includes(action) && interaction.isModalSubmit()) {
        requireStaff(interaction, settings);
        const expected = action === "paidconfirm" ? "LUNAS" : "TUTUP";
        if (interaction.fields.getTextInputValue("confirm").trim().toUpperCase() !== expected) throw new PreorderError(`Ketik ${expected} untuk konfirmasi.`);
        order = action === "paidconfirm" ? await orders.markPaid(interaction.guildId, id, interaction.user.id)
            : await orders.close(interaction.guildId, id, interaction.user.id);
        if (action === "closeconfirm") {
            if (order.ticketDeletedAt) return interaction.editReply({ content: "Channel tiket ini sudah dihapus." });
            await Order.updateOne({ _id: order._id, guildId: interaction.guildId }, { $set: { ticketClosing: true }, $inc: { revision: 1 } });
            await interaction.editReply({ content: "🔒 Tiket ditutup. Channel tiket sedang dihapus." });
            await deleteTicket(client, order);
            return refreshQuietly(client, await orders.get(interaction.guildId, id));
        }
    } else if (action === "take" && interaction.isModalSubmit()) {
        if (!buyer) throw new PreorderError("Hanya pembeli pemilik preorder yang bisa mengambil stok.");
        const result = await orders.collect(interaction.guildId, id, interaction.user.id, interaction.id, interaction.fields.getTextInputValue("amount"));
        await refreshQuietly(client, result.order);
        return deliver(client, interaction, result.order, result.lines, interaction.id);
    }
    await refreshQuietly(client, order);
    await interaction.editReply({ content: `${order.code} · ${progress(order)} · Disetor ${order.depositedQty}/${order.quantity} · Diambil ${order.collectedQty} · Siap diambil ${order.depositedQty - order.collectedQty}.` });
}

async function safeRun(interaction, operation) {
    try { await operation(); }
    catch (error) {
        if (!(error instanceof PreorderError)) console.error("[PREORDER] Operasi gagal:", error.code || error.name);
        let content = error instanceof PreorderError ? error.message : "Preorder belum bisa diproses. Buka panel → Pesanan saya → pilih pesananmu untuk cek status atau melanjutkan lewat Ambil pesanan.";
        if (error.code === 50013 || error.code === 50001) content = "Discord menolak akses bot. Periksa izin Manage Channels dan Manage Roles pada kategori tiket, serta izin melihat dan mengirim pesan pada channel panel. Pesanan yang sudah tercatat bisa dibuka melalui tombol Pesanan saya.";
        const payload = { content, allowedMentions: { parse: [] } };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
        else await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
    }
}

async function repairSummaries(client) {
    const closing = await Order.find({ ticketClosing: true, ticketDeletedAt: null }).limit(20).lean();
    for (const order of closing) {
        if (!client.guilds.cache.has(order.guildId)) continue;
        try { await deleteTicket(client, order); }
        catch { console.error("[PREORDER] Channel tiket belum bisa dihapus", order.code); }
    }
    const pending = await Order.find({ summaryDirty: true, channelId: { $ne: null }, ticketClosing: { $ne: true }, ticketDeletedAt: null }).select("_id guildId code").limit(20).lean();
    for (const order of pending) {
        if (client.guilds.cache.has(order.guildId)) await refreshQuietly(client, order);
    }
    const panels = await Settings.find({ $or: [{ panelDirty: true }, { panelRevision: { $exists: false } }] }).lean();
    for (const settings of panels) {
        if (client.guilds.cache.has(settings.guildId)) {
            try { await refreshPanel(client, settings.guildId); }
            catch { console.error("[PREORDER] Daftar preorder belum bisa dipulihkan."); }
        }
    }
}

module.exports = { runCommand, handleComponent, safeRun, repairSummaries, summary, isStaff, panelPayload };
