let {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require("discord.js");
let client = require("../../index");
let { Owner } = require("../../config/runtime.js");
let { COLOR, Benar, Salah, Warning } = require("../../config/emoji.js");
let Bal = require("../../Schema/balance.js");
let jasaOrder = require("../../Schema/jasaOrder.js");
let jasaConfig = require("../../Schema/jasaConfig.js");
let { JASA_TYPES, PROMO_FIELD, getJasaType } = require("../../utils/jasaTypes.js");
let { refreshJasaPanel } = require("../../utils/jasaPanelBuilder.js");

module.exports = {
    name: "Jasa Buttons",
};

// Kontrol jasa (Admin Panel, Take/Complete/Cancel) cuma buat Owner — sesuai config.json
function isStaff(userId) {
    return userId === Owner;
}

const TEXT_STYLE = { Short: TextInputStyle.Short, Paragraph: TextInputStyle.Paragraph };

client.on("interactionCreate", async (interaction) => {
    try {
        // ── Pilih jenis jasa dari dropdown panel -> munculin modal order sesuai jenisnya ──
        if (interaction.isStringSelectMenu() && interaction.customId === "jasaSelect") {
            const type = interaction.values[0];
            const def = getJasaType(type);
            if (!def) return interaction.reply({ content: `${Warning} Jenis jasa tidak dikenali.`, ephemeral: true });

            const getBal = await Bal.findOne({ DiscordID: interaction.user.id }).catch(() => null);
            if (!getBal) {
                return interaction.reply({
                    content: "**Set GrowID** dulu (tombol **Register GrowID**) sebelum order jasa!",
                    ephemeral: true,
                });
            }

            const modal = new ModalBuilder().setCustomId(`jasaOrder::${type}`).setTitle(`Order ${type}`);

            const amountInput = new TextInputBuilder()
                .setCustomId(def.amountField.id)
                .setLabel(def.amountField.label)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(def.amountField.placeholder)
                .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(amountInput));

            for (const f of def.fields) {
                const input = new TextInputBuilder()
                    .setCustomId(f.id)
                    .setLabel(f.label.slice(0, 45))
                    .setStyle(TEXT_STYLE[f.style] || TextInputStyle.Short)
                    .setPlaceholder(f.placeholder)
                    .setRequired(true);
                modal.addComponents(new ActionRowBuilder().addComponents(input));
            }

            const promoInput = new TextInputBuilder()
                .setCustomId(PROMO_FIELD.id)
                .setLabel(PROMO_FIELD.label.slice(0, 45))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(PROMO_FIELD.placeholder)
                .setRequired(false);
            modal.addComponents(new ActionRowBuilder().addComponents(promoInput));

            return interaction.showModal(modal);
        }

        // ── Tombol "Admin Panel" -> tampilkan dropdown antrian yang masih aktif (staff only) ──
        if (interaction.isButton() && interaction.customId === "jasaAdminPanel") {
            if (!isStaff(interaction.user.id)) {
                return interaction.reply({ content: "**Cuma Owner yang bisa buka Admin Panel!**", ephemeral: true });
            }

            const queue = await jasaOrder
                .find({ status: { $in: ["waiting", "in_progress"] } })
                .sort({ orderNumber: 1 })
                .limit(25)
                .catch(() => []);

            if (queue.length < 1) {
                return interaction.reply({ content: `${Warning} Tidak ada antrian jasa yang aktif saat ini.`, ephemeral: true });
            }

            const options = queue.map((o) => ({
                label: `#${o.orderNumber} — ${o.type} (${o.amount} ${o.unit})`.slice(0, 100),
                description: `Status: ${o.status}${o.assignedTo ? ` | by <@${o.assignedTo}>`.replace(/<@|>/g, "") : ""}`.slice(0, 100),
                value: String(o.orderNumber),
            }));

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId("jasaAdminSelect").setPlaceholder("Pilih order untuk dikelola...").addOptions(options)
            );

            return interaction.reply({ content: "**Antrian Jasa Aktif:**", components: [row], ephemeral: true });
        }

        // ── Admin pilih 1 order dari dropdown -> tampilkan tombol aksi ──
        if (interaction.isStringSelectMenu() && interaction.customId === "jasaAdminSelect") {
            if (!isStaff(interaction.user.id)) return interaction.reply({ content: `${Warning} Khusus Owner.`, ephemeral: true });

            const orderNumber = Number(interaction.values[0]);
            const order = await jasaOrder.findOne({ orderNumber }).catch(() => null);
            if (!order) return interaction.update({ content: "Order tidak ditemukan (mungkin sudah selesai/dibatalkan).", components: [] });

            const detailLines = Object.entries(order.details || {})
                .map(([k, v]) => `**${k}:** ${v}`)
                .join("\n");

            const embed = new EmbedBuilder()
                .setColor(COLOR)
                .setTitle(`Order #${order.orderNumber} — ${order.type}`)
                .setDescription(
                    `**Buyer:** <@${order.buyerId}>\n` +
                    `**Jumlah:** ${order.amount} ${order.unit}\n` +
                    `**Harga:** ${order.price} WL\n` +
                    `**Status:** ${order.status}${order.assignedTo ? ` (by <@${order.assignedTo}>)` : ""}\n\n` +
                    (detailLines || "_Tidak ada detail_")
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`jasaTake::${order.orderNumber}`).setLabel("Take Order").setStyle(ButtonStyle.Primary).setDisabled(order.status === "in_progress"),
                new ButtonBuilder().setCustomId(`jasaComplete::${order.orderNumber}`).setLabel("Mark Complete").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`jasaCancel::${order.orderNumber}`).setLabel("Cancel & Refund").setStyle(ButtonStyle.Danger)
            );

            return interaction.update({ content: "", embeds: [embed], components: [row] });
        }

        // ── Tombol aksi admin: Take / Complete / Cancel ──
        if (interaction.isButton() && /^jasa(Take|Complete|Cancel)::/.test(interaction.customId)) {
            if (!isStaff(interaction.user.id)) return interaction.reply({ content: `${Warning} Khusus Owner.`, ephemeral: true });

            const [action, orderNumberStr] = interaction.customId.split("::");
            const orderNumber = Number(orderNumberStr);
            const order = await jasaOrder.findOne({ orderNumber }).catch(() => null);

            if (!order) {
                return interaction.update({ content: "Order ini sudah tidak ada di antrian (mungkin sudah diproses staff lain).", embeds: [], components: [] });
            }

            if (action === "jasaTake") {
                order.status = "in_progress";
                order.assignedTo = interaction.user.id;
                await order.save();

                await interaction.update({ content: `${Benar} Order #${orderNumber} kamu ambil, statusnya sekarang **In Progress**.`, embeds: [], components: [] });
                refreshJasaPanel(client).catch(console.error);
                return;
            }

            if (action === "jasaComplete") {
                await jasaConfig.findOneAndUpdate(
                    { type: order.type },
                    { $inc: { completed: order.amount } },
                    { upsert: true }
                );
                await jasaOrder.deleteOne({ orderNumber });

                await interaction.update({ content: `${Benar} Order #${orderNumber} ditandai **selesai**.`, embeds: [], components: [] });
                refreshJasaPanel(client).catch(console.error);

                interaction.client.users
                    .fetch(order.buyerId)
                    .then((u) => u.send(`${Benar} Order **${order.type}** (#${orderNumber}) kamu sudah **selesai** dikerjakan!`).catch(() => {}))
                    .catch(() => {});
                return;
            }

            if (action === "jasaCancel") {
                await Bal.findOneAndUpdate({ DiscordID: order.buyerId }, { $inc: { Balance: order.price } }).catch(() => {});
                await jasaOrder.deleteOne({ orderNumber });

                await interaction.update({ content: `${Salah} Order #${orderNumber} dibatalkan, ${order.price} WL sudah di-refund ke buyer.`, embeds: [], components: [] });
                refreshJasaPanel(client).catch(console.error);

                interaction.client.users
                    .fetch(order.buyerId)
                    .then((u) => u.send(`${Salah} Order **${order.type}** (#${orderNumber}) kamu **dibatalkan** staff, ${order.price} WL sudah dikembalikan ke balance kamu.`).catch(() => {}))
                    .catch(() => {});
                return;
            }
        }
    } catch (err) {
        console.error(err);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: "Terjadi kesalahan, coba lagi.", ephemeral: true }).catch(() => {});
        }
    }
});
