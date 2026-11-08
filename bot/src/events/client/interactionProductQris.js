"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder,
    TextInputBuilder, TextInputStyle, escapeMarkdown } = require("discord.js");
const { serverId } = require("../../config/config.json");
const { qrisBuyPrefix, qrisSelectId, qrisPagePrefix } = require("../../config/storefront");
const { requestAutoDeposit, claimProductOrder, PanelError } = require("../../utils/panelWallet");
const client = require("../../index");

const claimPrefix = "storefront_qris_claim:";
const quantityPrefix = "storefront_qris_qty:";

async function handleProductQris(interaction) {
    if (!process.env.HOSTED_PILOT_BINDING || interaction.guildId !== serverId) return;
    const id = interaction.customId || "";
    if (interaction.isButton() && id.startsWith(qrisPagePrefix)) {
        return interaction.reply({ content: "Lihat kartu produk lanjutan di channel katalog.", flags: MessageFlags.Ephemeral });
    }
    const buy = interaction.isButton() && id.startsWith(qrisBuyPrefix);
    const select = interaction.isStringSelectMenu() && id === qrisSelectId;
    const claim = interaction.isButton() && id.startsWith(claimPrefix);
    const submit = interaction.isModalSubmit() && id.startsWith(quantityPrefix);
    if (!buy && !select && !claim && !submit) return;

    if (buy || select) {
        const code = buy ? id.slice(qrisBuyPrefix.length) : interaction.values[0];
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(code) || code === "none") {
            return interaction.reply({ content: "Produk tidak tersedia.", flags: MessageFlags.Ephemeral });
        }
        const quantity = new TextInputBuilder().setCustomId("quantity").setLabel("Jumlah yang ingin dibeli")
            .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(4).setValue("1").setRequired(true);
        return interaction.showModal(new ModalBuilder().setCustomId(quantityPrefix + code).setTitle("Konfirmasi jumlah pesanan")
            .addComponents(new ActionRowBuilder().addComponents(quantity)));
    }

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
        const productCode = id.slice(quantityPrefix.length);
        const input = interaction.fields.getTextInputValue("quantity").trim();
        if (!/^[1-9]\d{0,3}$/.test(input)) throw new PanelError("Masukkan jumlah bulat minimal 1.");
        const checkout = await requestAutoDeposit({ productCode, quantity: Number(input), discordId: interaction.user.id });
        if (checkout.mode !== "auto") throw new PanelError("Aktifkan QRIS otomatis untuk toko ini sebelum membeli.");
        if (!checkout.qrPng && !checkout.qrImageUrl) throw new PanelError("Kode QRIS belum tersedia. Hubungi admin toko.");
        const filename = "qris-" + checkout.orderId + ".png";
        const amount = "Rp" + checkout.amount.toLocaleString("id-ID");
        const embed = new EmbedBuilder().setTitle("Bayar produk dengan QRIS")
            .setDescription(`**${escapeMarkdown(checkout.productName)}** · ${checkout.quantity} item\n\nBayar tepat **${amount}** sebelum <t:${Math.floor(checkout.expiresAt / 1000)}:t>.\nFile dikirim lewat DM setelah pembayaran terkonfirmasi.\n\nNomor QRIS \`${checkout.orderId}\``)
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
