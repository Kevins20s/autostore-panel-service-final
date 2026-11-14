"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, OverwriteType, PermissionFlagsBits: P, escapeMarkdown } = require("discord.js");
const { Order, Settings } = require("../Schema/preorder");
const { Owner, Admin = [] } = require("../config/config.json");
const { createPreorders, PreorderError, progress } = require("./preorders");
const orders = createPreorders();
const refreshes = new Map();
const privateReply = { ephemeral: true };
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
const ticketTopic = order => `Preorder ${order.code} | order:${order._id} | buyer:${order.buyerId}`;
const staffIds = () => [...new Set([Owner, ...Admin].filter(Boolean))];

function isStaff(interaction, settings) {
    return staffIds().includes(interaction.user.id) || !!(settings?.staffRoleId && interaction.member?.roles?.cache?.has(settings.staffRoleId));
}

function summary(order) {
    const filled = Math.floor(order.depositedQty / order.quantity * 10);
    return { embeds: [{ title: `Preorder ${order.code}`, color: 0x65efd0,
        description: `**${escapeMarkdown(order.productName)}**\n${"▰".repeat(filled)}${"▱".repeat(10 - filled)} **${order.depositedQty}/${order.quantity}**`,
        fields: [
            { name: "Pembeli", value: `<@${order.buyerId}>`, inline: true },
            { name: "Pembayaran", value: order.paidAt ? "Dikonfirmasi admin" : "Menunggu admin", inline: true },
            { name: "Status", value: progress(order), inline: true },
            { name: "Total disetor", value: String(order.depositedQty), inline: true },
            { name: "Sudah diambil", value: String(order.collectedQty), inline: true },
            { name: "Tersedia untuk diambil", value: String(order.depositedQty - order.collectedQty), inline: true },
            { name: "Belum disetor", value: String(order.quantity - order.depositedQty), inline: true },
        ], footer: { text: "Pembayaran diurus admin · Satu stok per baris · Pengambilan dapat diunduh ulang" },
    }], components: [
        row(button(`po:collect:${order._id}`, "Ambil stok siap", ButtonStyle.Success).setDisabled(order.status !== "open" || !order.paidAt || order.depositedQty <= order.collectedQty),
            button(`po:download:${order._id}`, "Unduh pengambilan").setDisabled(!order.collectedQty),
            button(`po:refresh:${order._id}`, "Cek status")),
        row(button(`po:deposit:${order._id}`, "Setor stok (admin)").setDisabled(order.status !== "open" || order.depositedQty === order.quantity),
            button(`po:paid:${order._id}`, "Konfirmasi pembayaran", ButtonStyle.Primary).setDisabled(!!order.paidAt || order.status !== "open"),
            button(`po:close:${order._id}`, "Tutup tiket", ButtonStyle.Danger).setDisabled(order.status === "closed")),
    ], allowedMentions: { parse: [] } };
}

async function refresh(client, guildId, id) {
    const key = guildId + ":" + id;
    const previous = refreshes.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
        const order = await orders.get(guildId, id);
        if (!order.channelId) return;
        const channel = await client.channels.fetch(order.channelId);
        if (channel?.guildId !== guildId) throw new PreorderError("Channel tiket tidak ditemukan di server ini.");
        let message = order.messageId ? await channel.messages.fetch(order.messageId).catch(() => null) : null;
        if (message) await message.edit(summary(order));
        else {
            message = await channel.send(summary(order));
            await Order.updateOne({ _id: order._id, guildId }, { $set: { messageId: message.id } });
        }
        if (order.status === "closed") await channel.permissionOverwrites.edit(order.buyerId, { SendMessages: false, AttachFiles: false });
        await Order.updateOne({ _id: order._id, guildId, revision: order.revision }, { $set: { summaryDirty: false } });
    });
    refreshes.set(key, current);
    try { await current; }
    finally { if (refreshes.get(key) === current) refreshes.delete(key); }
}

async function refreshQuietly(client, order) {
    try { await refresh(client, order.guildId, order._id); }
    catch { console.error("[PREORDER] Ringkasan tiket belum diperbarui", order.code); }
}

function checkPermissions(channel, member, flags) {
    const permissions = channel.permissionsFor(member);
    const missing = flags.filter(flag => !permissions?.has(flag));
    if (missing.length) throw new PreorderError("Izin bot belum lengkap. Aktifkan View Channel, Send Messages, Embed Links, Attach Files, Read Message History, Manage Channels, dan Manage Roles untuk mengelola tiket.");
}

async function ensureTicket(client, guild, order, settings) {
    if (order.channelId) return order;
    const now = new Date();
    const reserved = await Order.findOneAndUpdate({ _id: order._id, guildId: guild.id, status: "open", channelId: null,
        $or: [{ ticketLeaseUntil: null }, { ticketLeaseUntil: { $lt: now } }] },
    { $set: { ticketLeaseUntil: new Date(Date.now() + 60000) } }, { new: true }).lean();
    if (!reserved) throw new PreorderError(`Tiket sedang dibuat. Coba /preorder status kode:${order.code} sebentar lagi.`);
    const member = guild.members.me || await guild.members.fetchMe();
    const category = await guild.channels.fetch(settings.categoryId);
    if (category?.type !== ChannelType.GuildCategory) throw new PreorderError("Kategori tiket sudah tidak tersedia. Minta admin menjalankan /preorder setup kembali.");
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

async function deliver(interaction, order, lines, requestId) {
    const file = { attachment: Buffer.from(lines.join("\n"), "utf8"), name: `${order.code}-${requestId}.txt` };
    try {
        await interaction.user.send({ content: `Pengambilan ${order.code} · ${escapeMarkdown(order.productName)} · ${lines.length} stok.`,
            files: [file], allowedMentions: { parse: [] }, nonce: "po-" + requestId, enforceNonce: true });
        await interaction.editReply({ content: `${lines.length} stok sudah dikirim ke DM. Kamu bisa mengunduhnya ulang melalui tombol Unduh pengambilan.` });
    } catch {
        await interaction.editReply({ content: `DM belum bisa dikirim. Unduh ${lines.length} stokmu di sini. Tombol Unduh pengambilan tetap tersedia jika perlu mengambil file lagi.`, files: [file] });
    }
}

async function readStockFile(attachment) {
    if (!attachment || !/\.txt$/i.test(attachment.name || "") || attachment.size > 1024 * 1024 ||
        !/^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//.test(attachment.url)) {
        throw new PreorderError("Upload file .txt dari Discord, maksimal 1 MB. Satu stok per baris.");
    }
    const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new PreorderError("File stok belum bisa diunduh. Coba lagi.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 1024 * 1024) throw new PreorderError("File stok terlalu besar. Maksimal 1 MB.");
    return Buffer.from(bytes).toString("utf8");
}

async function setup(client, interaction) {
    if (!staffIds().includes(interaction.user.id)) throw new PreorderError("Hanya owner atau admin bot yang boleh mengatur preorder.");
    const channel = interaction.options.getChannel("channel");
    const category = interaction.options.getChannel("kategori");
    const staff = interaction.options.getRole("admin");
    if (channel?.guildId !== interaction.guildId || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) ||
        category?.guildId !== interaction.guildId || category.type !== ChannelType.GuildCategory || staff?.id === interaction.guildId) {
        throw new PreorderError("Pilih channel teks, kategori tiket, dan role admin khusus di server ini. Role @everyone tidak boleh menjadi admin preorder.");
    }
    const member = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    checkPermissions(channel, member, [P.ViewChannel, P.SendMessages, P.EmbedLinks]);
    checkPermissions(category, member, [P.ViewChannel, P.ManageChannels, P.ManageRoles, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory]);
    const payload = { embeds: [{ title: "Preorder", color: 0x65efd0,
        description: "Pesan produk sesuai kebutuhanmu. Isi nama barang dan jumlah, lalu lanjutkan pembayaran bersama admin di tiket privat.\n\nStok bisa disiapkan bertahap dan diambil setelah pembayaran dikonfirmasi admin." }],
        components: [row(button("po:create", "Buat Preorder", ButtonStyle.Success))], allowedMentions: { parse: [] } };
    const previous = await Settings.findOne({ guildId: interaction.guildId }).lean();
    const existing = previous?.panelChannelId === channel.id && previous.panelMessageId
        ? await channel.messages.fetch(previous.panelMessageId).catch(() => null) : null;
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    try {
        await Settings.findOneAndUpdate({ guildId: interaction.guildId }, { $set: { panelChannelId: channel.id, panelMessageId: message.id,
            categoryId: category.id, staffRoleId: staff?.id || null } }, { upsert: true });
    } catch (error) { if (!existing) await message.delete().catch(() => {}); throw error; }
    await interaction.editReply({ content: `Panel preorder dibuat di ${channel}. Pembeli bisa menekan Buat Preorder. Admin mengonfirmasi pembayaran dan menyetor stok lewat tombol tiket atau /preorder setor.` });
}

async function runCommand(client, interaction) {
    await interaction.deferReply(privateReply);
    const action = interaction.options.getSubcommand();
    if (action === "setup") return setup(client, interaction);
    const settings = await Settings.findOne({ guildId: interaction.guildId }).lean();
    if (action === "list") {
        const page = interaction.options.getInteger("halaman") || 1;
        const scope = { guildId: interaction.guildId, ...(isStaff(interaction, settings) ? {} : { buyerId: interaction.user.id }) };
        const total = await Order.countDocuments(scope);
        const list = await Order.find(scope).select("-items -claims -depositRequests").sort({ createdAt: -1 }).skip((page - 1) * 10).limit(10).lean();
        const lines = list.map(order => `**${order.code}** · <@${order.buyerId}> · ${escapeMarkdown(order.productName)}\n` +
            `Setor **${order.depositedQty}/${order.quantity}** · Diambil **${order.collectedQty}** · ${progress(order)}${order.channelId ? ` · <#${order.channelId}>` : ""}`);
        return interaction.editReply({ embeds: [{ title: isStaff(interaction, settings) ? "Daftar Preorder Toko" : "Preorder Kamu",
            color: 0x65efd0, description: lines.join("\n\n") || "Belum ada preorder di halaman ini.",
            footer: { text: `Halaman ${page}/${Math.max(1, Math.ceil(total / 10))} · ${total} preorder` } }], allowedMentions: { parse: [] } });
    }
    let order = await orders.byCode(interaction.guildId, interaction.options.getString("kode"));
    if (action === "status") {
        if (!isStaff(interaction, settings) && order.buyerId !== interaction.user.id) throw new PreorderError("Preorder ini bukan milikmu.");
        if (!order.channelId && settings && order.status === "open") order = await ensureTicket(client, interaction.guild, order, settings);
        await refreshQuietly(client, order);
        return interaction.editReply({ ...summary(order), content: order.channelId ? `Tiket: <#${order.channelId}>` : "Tiket belum tersedia." });
    }
    requireStaff(interaction, settings);
    if (action === "setor") {
        const text = interaction.options.getString("stok");
        const file = interaction.options.getAttachment("file");
        if ((!text && !file) || (text && file)) throw new PreorderError("Pilih salah satu: stok teks atau file .txt. Satu stok per baris.");
        order = await orders.deposit(interaction.guildId, order._id, interaction.id, text || await readStockFile(file));
    } else if (action === "bayar") {
        order = await orders.markPaid(interaction.guildId, order._id, interaction.user.id);
    } else if (action === "tutup") {
        order = await orders.close(interaction.guildId, order._id, interaction.user.id);
    }
    await refreshQuietly(client, order);
    return interaction.editReply({ content: `${order.code} · ${progress(order)} · Disetor ${order.depositedQty}/${order.quantity} · Diambil ${order.collectedQty}.` });
}

async function handleComponent(client, interaction) {
    const [prefix, action, id] = interaction.customId.split(":");
    if (prefix !== "po" || !interaction.guildId) return;
    const settings = await Settings.findOne({ guildId: interaction.guildId }).lean();
    if (action === "create" && interaction.isButton()) {
        if (!settings) throw new PreorderError("Admin belum mengatur preorder. Jalankan /preorder setup.");
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
        return interaction.editReply({ content: `Preorder ${order.code} dibuat. Lanjutkan di <#${order.channelId}>. Pembayaran diurus bersama admin di tiket.` });
    }
    let order = await orders.get(interaction.guildId, id);
    const buyer = order.buyerId === interaction.user.id;
    if (!buyer && !isStaff(interaction, settings)) throw new PreorderError("Tiket ini bukan milikmu.");
    if (interaction.isButton()) {
        if (["deposit", "paid", "close"].includes(action)) requireStaff(interaction, settings);
        if (action === "deposit") return interaction.showModal(modal(`po:stock:${id}`, "Setor Stok Preorder", [
            { id: "stock", label: "Satu stok per baris", long: true, max: 4000, placeholder: "Untuk file .txt besar, gunakan /preorder setor" },
        ]));
        if (action === "paid" || action === "close") return interaction.showModal(modal(`po:${action}confirm:${id}`,
            action === "paid" ? "Konfirmasi Pembayaran Manual" : "Tutup Tiket Preorder", [
                { id: "confirm", label: action === "paid" ? "Ketik LUNAS jika pembayaran sudah diterima" : "Ketik TUTUP untuk menutup preorder", max: 10 },
            ]));
        if (action === "collect") {
            if (!buyer) throw new PreorderError("Hanya pembeli pemilik preorder yang bisa mengambil stok.");
            return interaction.showModal(modal(`po:take:${id}`, "Ambil Stok Preorder", [
                { id: "amount", label: "Jumlah stok yang ingin diambil", max: 5, placeholder: `Tersedia: ${order.depositedQty - order.collectedQty}` },
            ]));
        }
    }
    await interaction.deferReply(privateReply);
    if (action === "stock" && interaction.isModalSubmit()) {
        requireStaff(interaction, settings);
        order = await orders.deposit(interaction.guildId, id, interaction.id, interaction.fields.getTextInputValue("stock"));
    } else if (["paidconfirm", "closeconfirm"].includes(action) && interaction.isModalSubmit()) {
        requireStaff(interaction, settings);
        const expected = action === "paidconfirm" ? "LUNAS" : "TUTUP";
        if (interaction.fields.getTextInputValue("confirm").trim().toUpperCase() !== expected) throw new PreorderError(`Ketik ${expected} untuk konfirmasi.`);
        order = action === "paidconfirm" ? await orders.markPaid(interaction.guildId, id, interaction.user.id)
            : await orders.close(interaction.guildId, id, interaction.user.id);
    } else if (action === "take" && interaction.isModalSubmit()) {
        if (!buyer) throw new PreorderError("Hanya pembeli pemilik preorder yang bisa mengambil stok.");
        const result = await orders.collect(interaction.guildId, id, interaction.user.id, interaction.id, interaction.fields.getTextInputValue("amount"));
        await refreshQuietly(client, result.order);
        return deliver(interaction, result.order, result.lines, interaction.id);
    } else if (action === "download" && interaction.isButton()) {
        if (!buyer) throw new PreorderError("Hanya pembeli pemilik preorder yang bisa mengunduh stok.");
        if (!order.collectedQty) throw new PreorderError("Belum ada pengambilan untuk diunduh.");
        return deliver(interaction, order, order.items.slice(0, order.collectedQty), interaction.id);
    }
    await refreshQuietly(client, order);
    await interaction.editReply({ content: `${order.code} · ${progress(order)} · Disetor ${order.depositedQty}/${order.quantity} · Diambil ${order.collectedQty} · Siap diambil ${order.depositedQty - order.collectedQty}.` });
}

async function safeRun(interaction, operation) {
    try { await operation(); }
    catch (error) {
        if (!(error instanceof PreorderError)) console.error("[PREORDER] Operasi gagal:", error.code || error.name);
        let content = error instanceof PreorderError ? error.message : "Preorder belum bisa diproses. Cek /preorder list, lalu cek status atau unduh pengambilan untuk melanjutkan tanpa mengulang pesanan.";
        if (error.code === 50013 || error.code === 50001) content = "Izin bot belum cukup. Minta admin mengaktifkan Manage Channels, Manage Roles, serta izin melihat, mengirim pesan, menyematkan tautan, mengirim file, dan membaca riwayat di kategori tiket. Gunakan /preorder list untuk melihat pesanan yang sudah tercatat.";
        const payload = { content, allowedMentions: { parse: [] } };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
        else await interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
    }
}

async function repairSummaries(client) {
    const pending = await Order.find({ summaryDirty: true, channelId: { $ne: null } }).select("_id guildId code").limit(20).lean();
    for (const order of pending) {
        if (client.guilds.cache.has(order.guildId)) await refreshQuietly(client, order);
    }
}

module.exports = { runCommand, handleComponent, safeRun, repairSummaries, summary, isStaff };
