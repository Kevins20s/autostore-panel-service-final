"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, escapeMarkdown } = require("discord.js");
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");
const { serverId } = require("../../config/config.json");
const { COLOR } = require("../../config/configemoji.json");
const { collection, buttons, resolveEmojis, componentEmoji } = require("../../config/storefront");
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
    new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(componentEmoji(emoji)).setStyle(style);
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const navigation = emojis => row(
    button(buttons.profile, "Profile", emojis.profile),
    button(buttons.balance, "Balance", emojis.balance),
    button(buttons.history, "History", emojis.history),
);

function growId(account) {
    return escapeMarkdown(account?.GrowIDNow || account?.GrowID || "Belum diatur");
}

async function showProfile(interaction, embed, emojis) {
    const discordId = interaction.user.id;
    const [account, [spending]] = await Promise.all([
        Balance.findOne({ DiscordID: discordId }).select("GrowID GrowIDNow Balance BalanceRp Deposit").lean(),
        OrderLog.aggregate([{ $match: { discordId } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    ]);
    const joined = interaction.member?.joinedTimestamp ?? Date.parse(interaction.member?.joined_at);
    embed.setTitle(`${emojis.profile} Profil Kamu`).setThumbnail(interaction.user.displayAvatarURL()).addFields(
        { name: `${emojis.discord} Discord`, value: "<@" + discordId + ">", inline: true },
        { name: `${emojis.growId} GrowID`, value: growId(account), inline: true },
        { name: `${emojis.balance} Balance WL`, value: formatWL(account?.Balance), inline: true },
        { name: `${emojis.rupiah} Balance Rp`, value: formatRp(account?.BalanceRp), inline: true },
        { name: `${emojis.spent} Total Spent`, value: formatWL(spending?.total), inline: true },
        { name: `${emojis.deposit} Total Deposit`, value: formatWL(account?.Deposit), inline: true },
        { name: `${emojis.joined} Bergabung`, value: Number.isFinite(joined) ? `<t:${Math.floor(joined / 1000)}:f>` : "—", inline: true },
    );
    return [row(button("growid23", "Set / Edit GrowID", emojis.growId, ButtonStyle.Primary))];
}

async function showBalance(interaction, embed, emojis) {
    const account = await Balance.findOne({ DiscordID: interaction.user.id }).select("GrowID GrowIDNow Balance BalanceRp").lean();
    embed.setTitle(`${emojis.balance} Balance Kamu`).setColor(0x57f287)
        .setDescription(`GrowID: **${growId(account)}**\n\n**Saldo WL:** ${formatWL(account?.Balance)}\n**Saldo Rupiah:** ${formatRp(account?.BalanceRp)}`);
    return [];
}

async function showHistory(interaction, embed, requestedPage, emojis) {
    const filter = { discordId: interaction.user.id };
    const total = await OrderLog.countDocuments(filter);
    const pages = Math.max(1, Math.ceil(total / orderPageSize));
    const page = Math.max(1, Math.min(requestedPage, pages));
    const orders = await OrderLog.find(filter).select("orderNumber productName code qty total createdAt")
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * orderPageSize).limit(orderPageSize).lean();
    embed.setTitle(`${emojis.history} Riwayat Order`).setFooter({ text: `Halaman ${page}/${pages} · ${interaction.guild?.name || "GevraStore"}` });
    if (!orders.length) embed.setDescription("Belum ada pembelian yang tercatat.");
    for (const order of orders) {
        const name = escapeMarkdown(String(order.productName || order.code || "Produk").slice(0, 100));
        const date = order.createdAt instanceof Date ? ` · <t:${Math.floor(order.createdAt.getTime() / 1000)}:f>` : "";
        embed.addFields({ name: "#" + (order.orderNumber ?? "—"),
            value: `**${name}** ×${number.format(order.qty ?? 0)} · ${formatWL(order.total)}\n\`success\`${date}` });
    }
    if (pages === 1) return [];
    return [row(
        button(buttons.history + ":" + (page - 1), "Sebelumnya", emojis.previous).setDisabled(page === 1),
        button(buttons.history + ":" + (page + 1), "Berikutnya", emojis.next).setDisabled(page === pages),
    )];
}

async function showWorldDeposit(embed, emojis) {
    const deposit = await DepositWorld.findOne({}).lean();
    const code = value => "`" + String(value || "Belum diatur").slice(0, 150).replaceAll("`", "'") + "`";
    embed.setTitle(`${emojis.deposit} Deposit via Growtopia`).setColor(0x57f287).setDescription(
        "Drop **World Lock** atau **Diamond Lock** di world berikut.\n\n" +
        `**WORLD** = ${code(deposit?.world)}\n**OWNER** = ${code(deposit?.owner)}\n**BOT** = ${code(deposit?.botName)}\n\n` +
        "**⚠️ Penting**\n1. Pastikan GrowID sudah diatur di bot.\n2. Cek kembali GrowID dan pastikan bot deposit ada di world sebelum drop.\n3. Saldo WL bertambah setelah deposit tercatat.");
    return [row(
        button(buttons.deposit, "Deposit WL/DL", emojis.deposit, ButtonStyle.Success),
        button(buttons.qris, "QRIS / E-Wallet", emojis.qris, ButtonStyle.Primary),
        button(buttons.convert, "Convert Rp to WL", emojis.convert, ButtonStyle.Success),
    )];
}

async function showQuote(interaction, embed, emojis) {
    const discordId = interaction.user.id;
    const [account, { pricePerWL }] = await Promise.all([
        Balance.findOne({ DiscordID: discordId }).select("BalanceRp").lean(),
        getEffectiveWLPrice(),
    ]);
    const rupiah = account?.BalanceRp ?? 0;
    const quote = conversionQuote(rupiah, pricePerWL);
    embed.setTitle(`${emojis.convert} Convert Rp to WL`).setColor(0x57f287);
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
    return [row(button(confirmPrefix + token, "Konfirmasi konversi", emojis.confirm, ButtonStyle.Success))];
}

async function confirmConversion(interaction, embed, emojis) {
    const discordId = interaction.user.id;
    const quote = quotes.get(discordId);
    embed.setTitle(`${emojis.convert} Convert Rp to WL`).setColor(0x57f287);
    if (!quote || quote.token !== interaction.customId.slice(confirmPrefix.length) || (!quote.completion && quote.expiresAt <= Date.now())) {
        embed.setDescription("Penawaran ini sudah kedaluwarsa atau dipakai. Buka Convert lagi untuk kurs terbaru.");
        return [row(button(buttons.convert, "Buka Convert", emojis.convert))];
    }
    // Repeated clicks on the same card must show the same result.
    quote.completion ??= Balance.updateOne({ DiscordID: discordId, BalanceRp: quote.rupiah }, {
        $inc: { BalanceRp: -quote.cost, Balance: quote.wl, Deposit: quote.wl },
    }).exec();
    const updated = await quote.completion;
    embed.setDescription(updated.matchedCount
        ? `**${formatWL(quote.wl)}** masuk ke saldo WL. Sisa saldo Rupiah **${formatRp(quote.remaining)}**.`
        : "Saldo Rupiah sudah berubah. Buka Convert lagi untuk melihat jumlah terbaru.");
    return updated.matchedCount ? [] : [row(button(buttons.convert, "Buka Convert", emojis.convert))];
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
        const storefront = await mongoose.connection.collection(collection).findOne({ _id: interaction.guildId });
        const emojis = await resolveEmojis(storefront?.emojis, interaction.guild, storefront?.emojiSourceGuildId, interaction.appPermissions);
        const embed = new EmbedBuilder().setColor(COLOR).setTimestamp()
            .setFooter({ text: interaction.guild?.name || "GevraStore" });
        let actions;
        if (customId === buttons.profile) actions = await showProfile(interaction, embed, emojis);
        else if (customId === buttons.balance) actions = await showBalance(interaction, embed, emojis);
        else if (customId === buttons.deposit) actions = await showWorldDeposit(embed, emojis);
        else if (customId === buttons.convert) actions = await showQuote(interaction, embed, emojis);
        else if (confirm) actions = await confirmConversion(interaction, embed, emojis);
        else actions = await showHistory(interaction, embed, Number(customId.split(":")[1] || "1"), emojis);
        await interaction.editReply({ content: null, embeds: [embed], components: [...actions, navigation(emojis)], allowedMentions: { parse: [] } });
    } catch (error) {
        console.error("[STOREFRONT] Gagal membuka data pembeli:", error.code || error.name);
        await interaction.editReply({ content: "Permintaan belum bisa diproses. Cek saldo terbaru sebelum mencoba lagi." });
    }
}

module.exports = { name: "Storefront Profile", handleStorefront };
client.on("interactionCreate", interaction => {
    handleStorefront(interaction).catch(error => console.error("[STOREFRONT] Interaksi gagal:", error.code || error.name));
});
