"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, escapeMarkdown } = require("discord.js");
const { serverId } = require("../../config/config.json");
const { COLOR } = require("../../config/configemoji.json");
const { buttons } = require("../../config/storefront");
const Balance = require("../../Schema/balance.js");
const OrderLog = require("../../Schema/orderlog.js");
const client = require("../../index.js");

const number = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const formatWL = amount => number.format(Number.isFinite(amount) ? amount : 0) + " WL";

function profileActions() {
    return [
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("growid23")
            .setLabel("Set / Edit GrowID").setEmoji("✏️").setStyle(ButtonStyle.Primary)),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(buttons.profile).setLabel("Profile").setEmoji("👤").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("balance1").setLabel("Balance").setEmoji("💰").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(buttons.history).setLabel("History").setEmoji("📜").setStyle(ButtonStyle.Secondary)),
    ];
}

async function handleStorefront(interaction) {
    if (!interaction.isButton() || !interaction.guildId || interaction.guildId !== serverId ||
        ![buttons.profile, buttons.history].includes(interaction.customId)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const discordId = interaction.user.id;
        const filter = { discordId };
        const embed = new EmbedBuilder().setColor(COLOR).setTimestamp()
            .setFooter({ text: interaction.guild?.name || "GevraStore" });
        if (interaction.customId === buttons.profile) {
            const [account, [spending]] = await Promise.all([
                Balance.findOne({ DiscordID: discordId }).select("GrowID GrowIDNow Balance Deposit").lean(),
                OrderLog.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: "$total" } } }]),
            ]);
            const joined = interaction.member?.joinedTimestamp ?? Date.parse(interaction.member?.joined_at);
            embed.setTitle("Profil Kamu").setThumbnail(interaction.user.displayAvatarURL()).addFields(
                { name: "Discord", value: "<@" + discordId + ">", inline: true },
                { name: "GrowID", value: escapeMarkdown(account?.GrowIDNow || account?.GrowID || "Belum diatur"), inline: true },
                { name: "Balance WL", value: formatWL(account?.Balance), inline: true },
                { name: "Total Spent", value: formatWL(spending?.total), inline: true },
                { name: "Total Deposit", value: formatWL(account?.Deposit), inline: true },
                { name: "Bergabung", value: Number.isFinite(joined) ? `<t:${Math.floor(joined / 1000)}:f>` : "—", inline: true },
            );
        } else {
            const orders = await OrderLog.find(filter).select("orderNumber productName code qty total createdAt")
                .sort({ createdAt: -1, _id: -1 }).limit(10).lean();
            embed.setTitle("Riwayat Pembelian").setDescription(orders.length ? "10 pesanan terakhir yang tercatat di toko ini." : "Belum ada pembelian yang tercatat.");
            for (const order of orders) {
                const name = escapeMarkdown(String(order.productName || order.code || "Produk").slice(0, 100));
                const date = order.createdAt instanceof Date ? ` · <t:${Math.floor(order.createdAt.getTime() / 1000)}:f>` : "";
                embed.addFields({ name: "#" + (order.orderNumber ?? "—") + " · " + name,
                    value: `${number.format(order.qty ?? 0)} item · ${formatWL(order.total)}${date}` });
            }
        }
        await interaction.editReply({ embeds: [embed], components: profileActions(), allowedMentions: { parse: [] } });
    } catch (error) {
        console.error("[STOREFRONT] Gagal membuka profil atau riwayat:", error.code || error.name);
        await interaction.editReply({ content: "Data pembeli belum bisa dimuat. Coba lagi." });
    }
}

module.exports = { name: "Storefront Profile", handleStorefront };
client.on("interactionCreate", interaction => {
    handleStorefront(interaction).catch(error => console.error("[STOREFRONT] Interaksi gagal:", error.code || error.name));
});
