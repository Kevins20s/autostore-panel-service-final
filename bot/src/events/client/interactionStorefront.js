"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, escapeMarkdown } = require("discord.js");
const { randomUUID } = require("node:crypto");
const { serverId } = require("../../config/config.json");
const { COLOR } = require("../../config/configemoji.json");
const { buttons } = require("../../config/storefront");
const Balance = require("../../Schema/balance.js");
const OrderLog = require("../../Schema/orderlog.js");
const DepositWorld = require("../../Schema/deposition.js");
const { getEffectiveWLPrice } = require("../../utils/gtidPrice.js");
const { conversionQuote } = require("../../utils/storefrontConversion");
const client = require("../../index.js");

const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const rateNumber = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 6 });
const formatRp = amount => "Rp" + number.format(amount ?? 0);
const confirmPrefix = buttons.convert + ":";
const quoteTtl = 60000;
const quotes = new Map();
const orderPageSize = 5;

function formatWL(amount) {
    const wl = Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100) / 100) : 0;
    const dl = Math.floor(wl / 100);
    const remainder = wl - dl * 100;
    return [dl && number.format(dl) + " DL", remainder && number.format(remainder) + " WL"]
        .filter(Boolean).join(" ") || "0 WL";
}

const button = (id, label, emoji, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const navigation = () => row(
    button(buttons.profile, "Profile", "👤"),
    button(buttons.balance, "Balance", "💰"),
    button(buttons.history, "History", "📜"),
);

function growId(account) {
    return escapeMarkdown(account?.GrowIDNow || account?.GrowID || "Belum diatur");
}

async function showProfile(interaction, embed) {
    const discordId = interaction.user.id;
    const [account, [spending]] = await Promise.all([
        Balance.findOne({ DiscordID: discordId }).select("GrowID GrowIDNow Balance BalanceRp Deposit").lean(),
        OrderLog.aggregate([{ $match: { discordId } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    ]);
    const joined = interaction.member?.joinedTimestamp ?? Date.parse(interaction.member?.joined_at);
    embed.setTitle("👤 Profil Kamu").setThumbnail(interaction.user.displayAvatarURL()).addFields(
        { name: "Discord", value: "<@" + discordId + ">", inline: true },
        { name: "GrowID", value: growId(account), inline: true },
        { name: "Balance WL", value: formatWL(account?.Balance), inline: true },
        { name: "Balance Rp", value: formatRp(account?.BalanceRp), inline: true },
        { name: "Total Spent", value: formatWL(spending?.total), inline: true },
        { name: "Total Deposit", value: formatWL(account?.Deposit), inline: true },
        { name: "Bergabung", value: Number.isFinite(joined) ? `<t:${Math.floor(joined / 1000)}:f>` : "—", inline: true },
    );
    return [row(button("growid23", "Set / Edit GrowID", "✏️", ButtonStyle.Primary))];
}

async function showBalance(interaction, embed) {
    const account = await Balance.findOne({ DiscordID: interaction.user.id }).select("GrowID GrowIDNow Balance BalanceRp").lean();
    embed.setTitle("💰 Balance Kamu").setColor(0x57f287)
        .setDescription(`GrowID: **${growId(account)}**\n\n**Saldo WL:** ${formatWL(account?.Balance)}\n**Saldo Rupiah:** ${formatRp(account?.BalanceRp)}`);
    return [];
}

async function showHistory(interaction, embed, requestedPage) {
    const filter = { discordId: interaction.user.id };
    const total = await OrderLog.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / orderPageSize));
    const page = Math.max(1, Math.min(requestedPage, pages));
    const orders = await OrderLog.find(filter).select("orderNumber productName code qty total createdAt")
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * orderPageSize).limit(orderPageSize).lean();
    embed.setTitle("📜 Riwayat Order").setFooter({ text: `Halaman ${page}/${pages} · ${interaction.guild?.name || "GevraStore"}` });
    if (!orders.length) embed.setDescription("Belum ada pembelian yang tercatat.");
    for (const order of orders) {
        const name = escapeMarkdown(String(order.productName || order.code || "Produk").slice(0, 100));
        const date = order.createdAt instanceof Date ? ` · <t:${Math.floor(order.createdAt.getTime() / 1000)}:f>` : "";
        embed.addFields({ name: "#" + (order.orderNumber ?? "—"),
            value: `**${name}** ×${number.format(order.qty ?? 0)} · ${formatWL(order.total)}\n\`success\`${date}` });
    }
    if (pages === 1) return [];
    return [row(
        button(buttons.history + ":" + (page - 1), "Sebelumnya", "⬅️").setDisabled(page === 1),
        button(buttons.history + ":" + (page + 1), "Berikutnya", "➡️").setDisabled(page === pages),
    )];
}

async function showWorldDeposit(embed) {
    const deposit = await DepositWorld.findOne({}).lean();
    const code = value => "`" + String(value || "Belum diatur").slice(0, 150).replaceAll("`", "'") + "`";
    embed.setTitle("💎 Deposit via Growtopia").setColor(0x57f287).setDescription(
        "Drop **World Lock** atau **Diamond Lock** di world berikut.\n\n" +
        `**WORLD** = ${code(deposit?.world)}\n**OWNER** = ${code(deposit?.owner)}\n**BOT** = ${code(deposit?.botName)}\n\n` +
        "**⚠️ Penting**\n1. Pastikan GrowID sudah diatur di bot.\n2. Cek kembali GrowID dan pastikan bot deposit ada di world sebelum drop.\n3. Saldo WL bertambah setelah deposit tercatat.");
    return [row(
        button(buttons.deposit, "Deposit WL/DL", "💎", ButtonStyle.Success),
        button(buttons.qris, "QRIS / E-Wallet", "💳", ButtonStyle.Primary),
        button(buttons.convert, "Convert Rp to WL", "🔄", ButtonStyle.Success),
    )];
}

async function showQuote(interaction, embed) {
    const discordId = interaction.user.id;
    const [account, { pricePerWL }] = await Promise.all([
        Balance.findOne({ DiscordID: discordId }).select("BalanceRp").lean(),
        getEffectiveWLPrice(),
    ]);
    const rupiah = account?.BalanceRp ?? 0;
    const quote = conversionQuote(rupiah, pricePerWL);
    embed.setTitle("🔄 Convert Rp to WL").setColor(0x57f287);
    if (!quote || quote.wl < 1) {
        embed.setDescription(!quote ? "Kurs WL belum tersedia. Coba lagi sebentar." : `Saldo Rupiah ${formatRp(rupiah)} belum cukup untuk 1 WL.`);
        return [];
    }
    const token = randomUUID();
    const pending = { ...quote, rupiah, token, expiresAt: Date.now() + quoteTtl };
    quotes.set(discordId, pending);
    setTimeout(() => { if (quotes.get(discordId) === pending) quotes.delete(discordId); }, quoteTtl).unref();
    embed.addFields(
        { name: "Saldo Rupiah", value: formatRp(rupiah), inline: true },
        { name: "Kurs saat tombol ditekan", value: "Rp" + rateNumber.format(quote.rate) + " / WL", inline: true },
        { name: "WL/DL diterima", value: formatWL(quote.wl), inline: true },
        { name: "Rupiah dipakai", value: formatRp(quote.cost), inline: true },
        { name: "Sisa Rupiah", value: formatRp(quote.remaining), inline: true },
    ).setDescription("Konfirmasi dalam 60 detik untuk memakai kurs ini.");
    return [row(button(confirmPrefix + token, "Konfirmasi konversi", "✅", ButtonStyle.Success))];
}

async function confirmConversion(interaction, embed) {
    const discordId = interaction.user.id;
    const quote = quotes.get(discordId);
    embed.setTitle("🔄 Convert Rp to WL").setColor(0x57f287);
    if (!quote || quote.token !== interaction.customId.slice(confirmPrefix.length) || (!quote.completion && quote.expiresAt <= Date.now())) {
        embed.setDescription("Penawaran ini sudah kedaluwarsa atau dipakai. Buka Convert lagi untuk kurs terbaru.");
        return [row(button(buttons.convert, "Buka Convert", "🔄"))];
    }
    // Repeated clicks on the same card must show the same result.
    quote.completion ??= Balance.updateOne({ DiscordID: discordId, BalanceRp: quote.rupiah }, {
        $inc: { BalanceRp: -quote.cost, Balance: quote.wl, Deposit: quote.wl },
    }).exec();
    const updated = await quote.completion;
    embed.setDescription(updated.matchedCount
        ? `**${formatWL(quote.wl)}** masuk ke saldo WL. Sisa saldo Rupiah **${formatRp(quote.remaining)}**.`
        : "Saldo Rupiah sudah berubah. Buka Convert lagi untuk melihat jumlah terbaru.");
    return updated.matchedCount ? [] : [row(button(buttons.convert, "Buka Convert", "🔄"))];
}

async function handleStorefront(interaction) {
    if (!interaction.isButton() || !interaction.guildId || interaction.guildId !== serverId) return;
    const { customId } = interaction;
    const history = customId === buttons.history || new RegExp("^" + buttons.history + ":[0-9]{1,8}$").test(customId);
    const confirm = customId.startsWith(confirmPrefix);
    if (!history && !confirm && ![buttons.profile, buttons.balance, buttons.deposit, buttons.convert].includes(customId)) return;
    if (interaction.message?.flags.has(MessageFlags.Ephemeral)) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const embed = new EmbedBuilder().setColor(COLOR).setTimestamp()
            .setFooter({ text: interaction.guild?.name || "GevraStore" });
        let actions;
        if (customId === buttons.profile) actions = await showProfile(interaction, embed);
        else if (customId === buttons.balance) actions = await showBalance(interaction, embed);
        else if (customId === buttons.deposit) actions = await showWorldDeposit(embed);
        else if (customId === buttons.convert) actions = await showQuote(interaction, embed);
        else if (confirm) actions = await confirmConversion(interaction, embed);
        else actions = await showHistory(interaction, embed, Number(customId.split(":")[1] || "1"));
        await interaction.editReply({ content: null, embeds: [embed], components: [...actions, navigation()], allowedMentions: { parse: [] } });
    } catch (error) {
        console.error("[STOREFRONT] Gagal membuka data pembeli:", error.code || error.name);
        await interaction.editReply({ content: "Permintaan belum bisa diproses. Cek saldo terbaru sebelum mencoba lagi." });
    }
}

module.exports = { name: "Storefront Profile", handleStorefront };
client.on("interactionCreate", interaction => {
    handleStorefront(interaction).catch(error => console.error("[STOREFRONT] Interaksi gagal:", error.code || error.name));
});
