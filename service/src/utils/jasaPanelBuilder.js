const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { WL, CROWN, COLOR, Benar, Salah, ARROW, Buy, Loading, imageUrl2, Queue, Waiting, SetGrowID, BalanceButton, Deposit, DepositQRIS, AdminPanel } = require("../config/emoji.js");
const jasaConfig = require("../Schema/jasaConfig.js");
const jasaOrder = require("../Schema/jasaOrder.js");
const jasaPanel = require("../Schema/jasaPanel.js");
const { getEffectiveWLPrice } = require("./gtidPrice.js");
const { JASA_TYPES, getJasaTypeKeys } = require("./jasaTypes.js");

const DIVIDER = "-".repeat(43);
// "waiting" pakai ⏳ (lagi ngantri, belum dikerjain), "in_progress" pakai emote Loading
// custom kamu (yang sudah ada di configemoji.json) karena beneran lagi "diproses".
const STATUS_ICON = { waiting: Waiting, in_progress: Loading };
const STATUS_TEXT = { waiting: "Waiting in Queue", in_progress: "In Progress" };

function fmt(num) {
    return Number(num || 0).toLocaleString("id-ID");
}

/**
 * Susun embed + components panel jasa berdasarkan data terbaru di database.
 * Tidak mengirim/mengedit pesan apa pun — cuma nge-build.
 */
async function buildJasaPanel() {
    const panel = (await jasaPanel.findOne({}).catch(() => null)) || {};

    // Kurs WL/DL diambil live (gtid.pro atau /setwlprice manual), sama kayak panel shop kamu yang lain
    const { pricePerWL, pricePerDL } = await getEffectiveWLPrice();

    const configs = await jasaConfig.find({}).catch(() => []);
    const configByType = {};
    for (const c of configs) configByType[c.type] = c;

    const totalOrders = await jasaOrder.countDocuments({}).catch(() => 0);

    const queue = await jasaOrder
        .find({ status: { $in: ["waiting", "in_progress"] } })
        .sort({ status: -1, orderNumber: 1 }) // in_progress duluan, lalu urut nomor order
        .limit(15)
        .catch(() => []);

    let serviceBlocks = [];
    let selectOptions = [];

    for (const type of getJasaTypeKeys()) {
        const def = JASA_TYPES[type];
        const cfg = configByType[type];
        const status = cfg?.status || "CLOSE";
        const price = cfg?.price ?? def.defaultPrice;
        const completed = cfg?.completed || 0;

        const statusText = status === "OPEN" ? `${Benar} OPEN` : `${Salah} CLOSE`;
        const rupiah = pricePerWL ? ` | Rp ${fmt(Math.round(price * pricePerWL))}` : "";
        const priceLine = def.blockSize
            ? `${ARROW} Price: ${price} ${WL} per ${def.blockSize} Item${rupiah}`
            : `${ARROW} Price: ${price} ${WL}${rupiah}`;

        serviceBlocks.push(
            `${CROWN} **${type}** ${CROWN}\n` +
            `${ARROW} Status: ${statusText}\n` +
            priceLine + `\n` +
            `${Buy} Completed: ${fmt(completed)} ${def.unit}\n` +
            DIVIDER
        );

        if (status === "OPEN") {
            selectOptions.push({
                label: `Order ${type}`,
                description: def.blockSize
                    ? `${price} WL per ${def.blockSize} Item`
                    : `${price} WL per ${def.unit}`,
                value: type,
            });
        }
    }

    let queueLines = queue.map((o, i) => {
        const icon = STATUS_ICON[o.status] || "⏳";
        const statusTxt = STATUS_TEXT[o.status] || "Waiting in Queue";
        const assignee = o.assignedTo ? ` (<@${o.assignedTo}>)` : "";
        return `${i + 1}. <@${o.buyerId}> — **${o.type}** (${fmt(o.amount)} ${o.unit}) | ${icon} *${statusTxt}*${assignee}`;
    });

    if (queueLines.length === 0) queueLines = ["_Tidak ada antrian saat ini._"];

    const kursText = pricePerWL
        ? `${ARROW} Kurs: **1 ${WL} = Rp${fmt(Math.round(pricePerWL))}** | **1 DL = Rp${fmt(Math.round(pricePerDL))}**`
        : `${ARROW} Kurs: Harga belum tersedia`;

    const description =
        `**Last Update:** <t:${Math.floor(Date.now() / 1000)}:R>\n` +
        `${kursText}\n` +
        `${ARROW} Total Orders: ${fmt(totalOrders)}\n` +
        `${DIVIDER}\n\n` +
        serviceBlocks.join("\n") + `\n` +
        `${Queue} **SERVIS ANTRIAN / SERVICE QUEUE:**\n` +
        queueLines.join("\n");

    const embed = new EmbedBuilder()
        .setTitle(`${CROWN} ${panel.storeName || "Store"} — JASA ${CROWN}`)
        .setDescription(description.slice(0, 4096))
        .setColor(COLOR)
        .setImage(imageUrl2)
        .setTimestamp();

    const components = [];

    if (selectOptions.length > 0) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("jasaSelect")
                    .setPlaceholder("Click here to order jasa")
                    .addOptions(selectOptions.slice(0, 25))
            )
        );
    }

    components.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("Set GrowID").setStyle(ButtonStyle.Secondary).setEmoji(SetGrowID).setCustomId("growid23"),
            new ButtonBuilder().setLabel("Balance").setStyle(ButtonStyle.Secondary).setEmoji(BalanceButton).setCustomId("balance1"),
            new ButtonBuilder().setLabel("Deposit").setStyle(ButtonStyle.Secondary).setEmoji(Deposit).setCustomId("deposit"),
            new ButtonBuilder().setLabel("Deposit QRIS").setStyle(ButtonStyle.Success).setEmoji(DepositQRIS).setCustomId("depositqris_btn"),
            new ButtonBuilder().setLabel("Admin Panel").setStyle(ButtonStyle.Danger).setEmoji(AdminPanel).setCustomId("jasaAdminPanel")
        )
    );

    return { embeds: [embed], components };
}

/**
 * Build ulang panel dan langsung edit pesan yang sudah tersimpan di jasaPanel.
 * Aman dipanggil kapan saja (habis order masuk, order diambil, order selesai, dll) —
 * kalau channel/pesan belum pernah di-set lewat /setjasapanel, fungsi ini diam saja.
 */
async function refreshJasaPanel(client) {
    const panel = await jasaPanel.findOne({}).catch(() => null);
    if (!panel?.channelId || !panel?.messageId) return;

    const channel = await client.channels.fetch(panel.channelId).catch(() => null);
    if (!channel) return;

    const message = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (!message) return;

    const payload = await buildJasaPanel();
    await message.edit(payload).catch(console.error);
}

module.exports = { buildJasaPanel, refreshJasaPanel };
