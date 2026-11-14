"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, OverwriteType, FileUploadBuilder, LabelBuilder, PermissionFlagsBits: P, escapeMarkdown } = require("discord.js");
const { Order, Settings } = require("../Schema/preorder");
const { Owner, Admin = [] } = require("../config/config.json");
const { createPreorders, PreorderError, progress } = require("./preorders");
const orders = createPreorders();
const refreshes = new Map();
const privateReply = { ephemeral: true };
const buttonIcons = { create: "🛒", mine: "📋", panel: "🔄", collect: "📦", download: "📥", refresh: "🔄",
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
    const components = [
        row(button(`po:collect:${order._id}`, "Ambil stok", ButtonStyle.Success).setDisabled(order.status !== "open" || !order.paidAt || order.depositedQty <= order.collectedQty),
            button(`po:download:${order._id}`, "Unduh pesanan").setDisabled(!order.collectedQty), button(`po:refresh:${order._id}`, "Cek status")),
        row(button(`po:deposit:${order._id}`, "Setor teks").setDisabled(order.status !== "open" || order.depositedQty === order.quantity),
            button(`po:upload:${order._id}`, "Upload .txt").setDisabled(order.status !== "open" || order.depositedQty === order.quantity),
            button(`po:paid:${order._id}`, "Tandai lunas", ButtonStyle.Success).setDisabled(!!order.paidAt || order.status !== "open")),
        row(button(`po:handle:${order._id}`, order.handledBy ? "Sudah ditangani" : "Claim tiket", ButtonStyle.Primary).setDisabled(!!order.handledBy || order.status !== "open"),
            button(`po:close:${order._id}`, "Tutup tiket").setDisabled(order.status !== "open"),
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
        description: (order.status !== "open" ? "Riwayat dan file pengambilanmu tetap tersimpan.\n\n"
            : `Halo <@${order.buyerId}>! Selamat datang di tiket privatmu. Admin akan membantu pembayaran dan menyiapkan pesanan.\n\n`) +
            `📦 **${escapeMarkdown(order.productName)}**\n${status.text}\n\n` +
            `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} **${Math.round(order.depositedQty / order.quantity * 100)}%**\n` +
            `\`${order.depositedQty}/${order.quantity} stok disetor\``,
        fields, footer: { text: "GevraStore • Stok bertahap • Pengambilan dapat diunduh ulang" },
    }], components, allowedMentions: { parse: [] } };
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

async function deliver(interaction, order, lines, requestId) {
    const file = { attachment: Buffer.from(lines.join("\n"), "utf8"), name: `${order.code}-${requestId}.txt` };
    try {
        await interaction.user.send({ content: `Pengambilan ${order.code} · ${escapeMarkdown(order.productName)} · ${lines.length} stok.`,
            files: [file], allowedMentions: { parse: [] }, nonce: "po-" + requestId, enforceNonce: true });
        await interaction.editReply({ content: `📥 **${lines.length} stok** sudah dikirim ke DM. Kamu bisa mengunduhnya ulang melalui tombol Unduh pesanan.` });
    } catch {
        await interaction.editReply({ content: `📥 DM belum bisa dikirim. Unduh **${lines.length} stok** di sini. Tombol Unduh pesanan tetap tersedia jika perlu mengambil file lagi.`, files: [file] });
    }
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

async function panelPayload(guildId, requestedPage = 0) {
    const total = await Order.countDocuments({ guildId });
    const pages = Math.max(1, Math.ceil(total / 8));
    const page = Math.max(0, Math.min(pages - 1, Number(requestedPage) || 0));
    const list = await Order.find({ guildId }).select("code buyerId productName quantity depositedQty collectedQty paidAt status handledBy")
        .sort({ createdAt: -1, _id: -1 }).skip(page * 8).limit(8).lean();
    const description = list.map((order, index) => `**${page * 8 + index + 1}. ${escapeMarkdown(order.productName)}**\n` +
        `👤 <@${order.buyerId}> · \`${order.code}\`\n` +
        `📦 **${order.depositedQty}/${order.quantity}** disetor · 📥 **${order.collectedQty}** diambil\n${displayStatus(order).text}`).join("\n\n");
    return { embeds: [
        { title: "🛍️ Preorder Center", color: 0x5865f2, description: "Pesan produk sesuai kebutuhanmu dan pantau progresnya dari satu tempat.\nTekan **Buat Preorder** untuk membuka tiket privat bersama admin.",
            fields: [
                { name: "📝 Buat pesanan", value: "Isi produk dan jumlah yang kamu butuhkan.", inline: true },
                { name: "💳 Pembayaran", value: "Konfirmasi pembayaran bersama admin di tiket.", inline: true },
                { name: "📦 Ambil bertahap", value: "Ambil stok yang sudah siap tanpa menunggu semuanya.", inline: true },
            ], footer: { text: "GevraStore • Tiket privat • Progres transparan" } },
        { title: "📋 Daftar Preorder", color: 0x65efd0, description: description || "📭 Belum ada preorder. Tekan Buat Preorder untuk membuat pesanan pertama.",
            footer: { text: `Halaman ${page + 1}/${pages} · ${total} preorder · Diperbarui otomatis` } },
    ], components: [
        row(button("po:create", "Buat Preorder", ButtonStyle.Success), button("po:mine:0", "Pesanan saya")),
        row(button(`po:panel:${page - 1}`, "Sebelumnya").setEmoji("◀️").setDisabled(page === 0),
            button(`po:panel:${page}`, "Perbarui daftar"), button(`po:panel:${page + 1}`, "Selanjutnya").setEmoji("▶️").setDisabled(page === pages - 1)),
    ], allowedMentions: { parse: [] } };
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
        await message.edit(await panelPayload(guildId, settings.panelPage));
        const revision = settings.panelRevision === undefined ? { $exists: false } : settings.panelRevision;
        await Settings.updateOne({ guildId, panelRevision: revision }, { $set: { panelDirty: false, panelRevision: settings.panelRevision || 0 } });
    });
    refreshes.set(key, current);
    try { await current; }
    finally { if (refreshes.get(key) === current) refreshes.delete(key); }
}

async function showMyOrders(interaction, requestedPage) {
    const scope = { guildId: interaction.guildId, buyerId: interaction.user.id };
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
    await interaction.editReply({ embeds: [{ title: "📋 Preorder Kamu", color: 0x65efd0,
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
    const payload = await panelPayload(interaction.guildId);
    const existing = previous?.panelChannelId === channel.id && previous.panelMessageId
        ? await channel.messages.fetch(previous.panelMessageId).catch(() => null) : null;
    const message = existing ? await existing.edit(payload) : await channel.send(payload);
    try {
        await Settings.findOneAndUpdate({ guildId: interaction.guildId }, { $set: { panelChannelId: channel.id, panelMessageId: message.id,
            categoryId: category.id, panelPage: 0, panelDirty: true }, $inc: { panelRevision: 1 } }, { upsert: true });
    } catch (error) { if (!existing) await message.delete().catch(() => {}); throw error; }
    await interaction.editReply({ content: `Panel dan daftar preorder dibuat di ${channel}. Tiket akan masuk kategori **${escapeMarkdown(category.name || "Preorder")}**. Selanjutnya buyer dan admin cukup memakai tombol.` });
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
    if (action === "mine" && interaction.isButton()) {
        await interaction.deferReply(privateReply);
        return showMyOrders(interaction, id);
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
        return interaction.editReply({ content: `Preorder ${order.code} dibuat. Lanjutkan di <#${order.channelId}>. Pembayaran diurus bersama admin di tiket.` });
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
        return interaction.editReply({ ...summary(order), content: order.channelId ? `Buka tiketmu di <#${order.channelId}>.` : "Tiket belum tersedia." });
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
        let content = error instanceof PreorderError ? error.message : "Preorder belum bisa diproses. Buka panel → Pesanan saya → pilih pesananmu untuk cek status atau mengunduh pengambilan.";
        if (error.code === 50013 || error.code === 50001) content = "Discord menolak akses bot. Periksa izin Manage Channels dan Manage Roles pada kategori tiket, serta izin melihat dan mengirim pesan pada channel panel. Pesanan yang sudah tercatat bisa dibuka melalui tombol Pesanan saya.";
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
    const panels = await Settings.find({ $or: [{ panelDirty: true }, { panelRevision: { $exists: false } }] }).lean();
    for (const settings of panels) {
        if (client.guilds.cache.has(settings.guildId)) {
            try { await refreshPanel(client, settings.guildId); }
            catch { console.error("[PREORDER] Daftar preorder belum bisa dipulihkan."); }
        }
    }
}

module.exports = { runCommand, handleComponent, safeRun, repairSummaries, summary, isStaff, panelPayload };
