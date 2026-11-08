"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require("discord.js");
const { serverId } = require("../../config/config.json");
const { qrisBuyPrefix, qrisSelectId, qrisPagePrefix } = require("../../config/storefront");
const { openQrisCatalogPage } = require("../../slashCommands/information/startrealtime");
const { requestAutoDeposit, claimProductOrder, PanelError } = require("../../utils/panelWallet");
const client = require("../../index");

const claimPrefix = "storefront_qris_claim:";

async function handleProductQris(interaction) {
    if (!process.env.HOSTED_PILOT_BINDING || interaction.guildId !== serverId) return;
    const id = interaction.customId || "";
    if (interaction.isButton() && id.startsWith(qrisPagePrefix)) return openQrisCatalogPage(interaction);
    const buy = interaction.isButton() && id.startsWith(qrisBuyPrefix);
    const select = interaction.isStringSelectMenu() && id === qrisSelectId;
    const claim = interaction.isButton() && id.startsWith(claimPrefix);
    if (!buy && !select && !claim) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        if (claim) {
            const order = await claimProductOrder(id.slice(claimPrefix.length), interaction.user.id);
            return interaction.editReply({
                content: `File pesanan #${order.orderNumber} (${order.productName}) terlampir.`,
                files: [{ attachment: Buffer.from(order.data), name: `order-${order.orderNumber}.txt` }],
                allowedMentions: { parse: [] },
            });
        }
        const productCode = buy ? id.slice(qrisBuyPrefix.length) : interaction.values[0];
        const checkout = await requestAutoDeposit({ productCode, discordId: interaction.user.id });
        if (checkout.mode !== "auto") throw new PanelError("Aktifkan QRIS otomatis untuk toko ini sebelum membeli.");
        if (!checkout.qrPng && !checkout.qrImageUrl) throw new PanelError("Kode QRIS belum tersedia. Hubungi admin toko.");
        const filename = "qris-" + checkout.orderId + ".png";
        const amount = "Rp" + checkout.amount.toLocaleString("id-ID");
        const embed = new EmbedBuilder().setTitle("Bayar produk dengan QRIS")
            .setDescription(`**${checkout.productName}** · 1 item\n\nBayar tepat **${amount}** sebelum <t:${Math.floor(checkout.expiresAt / 1000)}:t>.\nFile dikirim lewat DM setelah pembayaran terkonfirmasi.\n\nNomor QRIS \`${checkout.orderId}\``)
            .setImage(checkout.qrPng ? "attachment://" + filename : checkout.qrImageUrl);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Secondary)
            .setCustomId(claimPrefix + checkout.orderId).setLabel("Cek pembayaran / Ambil file"));
        return interaction.editReply({ embeds: [embed], components: [row], allowedMentions: { parse: [] },
            files: checkout.qrPng ? [{ attachment: Buffer.from(checkout.qrPng, "base64"), name: filename }] : [] });
    } catch (error) {
        if (!(error instanceof PanelError)) console.error("[PRODUCT QRIS]", error.code || error.name);
        return interaction.editReply(error instanceof PanelError ? error.message : "Pesanan belum bisa dibuka. Coba lagi atau hubungi admin toko.");
    }
}

module.exports = { name: "Product QRIS", handleProductQris };
client.on("interactionCreate", interaction => {
    handleProductQris(interaction).catch(error => console.error("[PRODUCT QRIS]", error.code || error.name));
});
