const mongoose = require("mongoose");
const { serverId } = require("../../config/config.json");
let {
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ApplicationCommandOptionType,
    ButtonBuilder,
    StringSelectMenuBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MessageFlags,
    escapeMarkdown,
    resolveColor,
} = require("discord.js");
let shop = require("../../Schema/shop.js");
let mt = require("../../Schema/maintenance.js");
let Price = require("../../Schema/priceproduct.js");
let list = require("../../Schema/list.js");
let disc = require("../../Schema/discount.js");
let RealtimeChannel = require("../../Schema/RealtimeChannel.js");
let order = require("../../Schema/orderproduct.js");
let { getEffectiveWLPrice } = require("../../utils/gtidPrice.js");
const { imageUrl2, COLOR } = require("../../config/configemoji.json");
const { collection, models, buttons, menuId, menuActions, qrisBuyPrefix, qrisSelectId, emojiFields, resolveStorefrontEmojis, storefrontModel, componentEmoji } = require("../../config/storefront");

const jobs = new Map();
const validDelay = delay => Number.isFinite(delay) && delay >= 1 && delay <= 86400;

async function catalogMessage(client, guildId, target) {
    const channel = await client.channels.fetch(target.channelId).catch(() => null);
    if (channel?.guildId !== guildId || !channel.messages) return null;
    const message = await channel.messages.fetch(target.messageId).catch(() => null);
    return message?.author?.id === client.user.id ? message : null;
}

function scheduleCatalog(client, guildId, kategori, target, delay) {
    const key = guildId + ":" + kategori;
    clearTimeout(jobs.get(key)?.timer);
    const job = {};
    jobs.set(key, job);
    async function refresh() {
        try {
            const current = await RealtimeChannel.findOne({ kategori }).lean();
            if (jobs.get(key) !== job) return;
            if (current?.messageId !== target.messageId) {
                jobs.delete(key);
                return;
            }
            const message = await catalogMessage(client, guildId, target);
            if (message && jobs.get(key) === job) await renderCatalog(message, guildId, kategori);
        } catch (error) {
            console.error("[STOREFRONT] Gagal memperbarui katalog:", error.code || error.name);
        } finally {
            if (jobs.get(key) === job) {
                job.timer = setTimeout(refresh, delay * 1000);
                job.timer.unref();
            }
        }
    }
    void refresh();
}

async function resumeRealtime(client) {
    if (!/^\d{17,20}$/.test(serverId)) return;
    const catalogs = await RealtimeChannel.find({ messageId: { $type: "string" } }).lean();
    for (const target of catalogs) {
        const message = await catalogMessage(client, serverId, target);
        const published = message?.components.some(row => row.components?.some(item => ["Howmanys", qrisSelectId].includes(item.customId)));
        // Legacy catalogs did not save an interval. Resume only if they were already published.
        if (message && (validDelay(target.intervalSeconds) || published) && !jobs.has(serverId + ":" + target.kategori)) {
            scheduleCatalog(client, serverId, target.kategori, target, validDelay(target.intervalSeconds) ? target.intervalSeconds : 60);
        }
    }
}

function buySelectRow(options, maintenance, emojis, qris = false) {
    const available = options.filter(option => option.hasStock);
    const soldOut = !available.length;
    const displayed = (options.length > 25 ? [...available, ...options.filter(option => !option.hasStock)] : options).slice(0, 25)
        .map(({ hasStock, ...option }) => ({ ...option, emoji: componentEmoji(hasStock ? emojis.inStock : emojis.outOfStock) }));
    const icon = soldOut ? emojis.outOfStock : emojis.cart;
    const placeholderIcon = componentEmoji(icon).id ? (soldOut ? "❌" : "🛒") : icon;
    const select = new StringSelectMenuBuilder().setCustomId(qris ? qrisSelectId : "Howmanys")
        .setPlaceholder(maintenance ? "Under Maintenance" : placeholderIcon + (soldOut
            ? (qris ? " Tidak ada produk yang bisa dibeli" : " Semua produk sedang habis") : " Select product to buy..."))
        .setDisabled(maintenance || soldOut)
        .addOptions(displayed.length ? displayed : [{ label: "Semua produk sedang habis", value: "none" }]);
    return new ActionRowBuilder().addComponents(select);
}

const display = content => new TextDisplayBuilder().setContent(content);
const banner = () => new MediaGalleryBuilder().addItems({
    media: { url: /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//.test(imageUrl2) ? imageUrl2.split("?")[0] : imageUrl2 },
});

async function editModernCatalog(message, container, rows) {
    await message.edit({
        flags: message.flags.bitfield | MessageFlags.IsComponentsV2,
        content: null, embeds: [],
        components: [container, ...rows],
        allowedMentions: { parse: [] },
    });
}

function productCards({ title, header, footer, products, maintenance, emojis }) {
    const container = new ContainerBuilder().setAccentColor(resolveColor(COLOR)).addTextDisplayComponents(display(`## ${title}\n${header}`));
    for (const product of products.slice(0, 7)) {
        const { name, code, description, priceIdr, sold, stock } = product;
        const price = priceIdr ? `**Rp${priceIdr.toLocaleString("id-ID")}**` : "Belum diatur";
        const details = [
            `${emojis.crown} **${escapeMarkdown(name.toUpperCase())}** ${emojis.crown}`,
            `${emojis.arrow} ${description ? "Desc: " + escapeMarkdown(description) : "Code: " + escapeMarkdown(code)}`,
            `${emojis.arrow} Stock: **${stock}** ${stock ? emojis.stockAvailable : emojis.stockEmpty}`,
            `${emojis.arrow} Price: ${price}`,
            `${emojis.sold} Product Sold: **${sold}**`,
        ];
        const buy = new ButtonBuilder().setCustomId(qrisBuyPrefix + code).setLabel("Buy")
            .setEmoji(componentEmoji(emojis.cart)).setStyle(ButtonStyle.Success).setDisabled(maintenance || !stock || !priceIdr);
        container.addSeparatorComponents(new SeparatorBuilder()).addSectionComponents(
            new SectionBuilder().addTextDisplayComponents(display(details.join("\n"))).setButtonAccessory(buy));
    }
    if (products.length > 7) container.addTextDisplayComponents(display("-# Produk lainnya tersedia di dropdown atau katalog per kategori."));
    if (!products.length) container.addTextDisplayComponents(display("Belum ada produk."));
    return container.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(display(footer)).addMediaGalleryComponents(banner());
}

function editLegacyCatalog(message, embed, rows) {
    if (!message.flags.has(MessageFlags.IsComponentsV2)) {
        return message.edit({ content: null, embeds: [embed], components: rows });
    }
    // Discord keeps the Components V2 flag after Model 3 has been used on this message.
    const container = new ContainerBuilder().setAccentColor(resolveColor(COLOR)).addTextDisplayComponents(display("## " + embed.data.title));
    const chunks = embed.data.description.match(/[\s\S]{1,1800}(?:\n|$)|[\s\S]{1,1800}/g);
    for (const chunk of chunks) container.addTextDisplayComponents(display(chunk));
    return editModernCatalog(message, container.addMediaGalleryComponents(banner()), rows);
}

function compactActionRow(maintenance, emojis) {
    const actions = [
        [buttons.profile, "My Profile", emojis.profile],
        [buttons.deposit, "Top Up WL", emojis.deposit],
        [buttons.qris, "QRIS Top Up", emojis.qris],
        [buttons.history, "History", emojis.history],
    ];
    return new ActionRowBuilder().addComponents(
        actions.map(([id, label, emoji]) => new ButtonBuilder().setCustomId(id).setLabel(label)
            .setStyle(ButtonStyle.Success).setEmoji(componentEmoji(emoji)).setDisabled(maintenance)));
}

function storeMenuRow(maintenance, emojis) {
    const select = new StringSelectMenuBuilder().setCustomId(menuId)
        .setPlaceholder("🛒 Click here to select menu")
        .setDisabled(maintenance)
        .addOptions(menuActions.map(([value, label, description, key]) => ({
            value, label, description, emoji: componentEmoji(emojis[key]),
        })));
    return new ActionRowBuilder().addComponents(select);
}

module.exports = {
    name: "startrealtime",
    description: "sending realtime product (bisa dipisah per kategori/channel)",
    accessableby: "admin",
    options: [
        {
            name: "delay",
            description: "Delay For Seconds/Detik",
            type: ApplicationCommandOptionType.Number,
            required: true
        },
        {
            name: "kategori",
            description: "Kategori produk (harus sama persis kayak di /setrealtime). Kosongkan = semua produk.",
            type: ApplicationCommandOptionType.String,
            required: false
        }
    ],
    /**
     * @param {Client} client
     * @param {CommandInteraction} interaction
     * @param {String[]} args
     */
    run: async (client, interaction, args) => {
        const delay = interaction.options.getNumber("delay");
        if (!validDelay(delay)) return interaction.reply({ content: "Isi delay antara 1 dan 86400 detik.", ephemeral: true });
        const kategori = interaction.options.getString("kategori")?.trim() || "ALL";
        const check = await RealtimeChannel.findOne({ kategori }).lean();

        if (!check?.channelId || !check.messageId) return interaction.reply({
            content: `/setrealtime dulu buat kategori **${kategori}** sebelum pakai command ini!`,
            ephemeral: true
        });

        if (!await list.exists(kategori === "ALL" ? {} : { kategori })) return interaction.reply({
            content: kategori === "ALL"
                ? `**/addproduct first before use this commands!**`
                : `**Belum ada produk dengan kategori (type) "${kategori}"!** Cek lagi field 'type' di /addproduct.`,
            ephemeral: true
        });

        const target = await RealtimeChannel.findOneAndUpdate({ _id: check._id, messageId: check.messageId },
            { $set: { intervalSeconds: delay } }, { new: true }).lean();
        if (!target) return interaction.reply({ content: "Channel katalog berubah. Coba jalankan /startrealtime lagi.", ephemeral: true });
        scheduleCatalog(client, interaction.guildId, kategori, target, delay);
        await interaction.reply({
            content: `Started Editing The Realtime Stock (Kategori: **${kategori}**) Delay **${delay}s**`,
            ephemeral: true
        });
    },
    resumeRealtime,
};

async function renderCatalog(message, guildId, kategori) {
    const productFilter = kategori === "ALL" ? {} : { kategori };
    const [maintenance, storefront] = await Promise.all([
        mt.exists({ mt: true }),
        mongoose.connection.collection(collection).findOne({ _id: guildId }),
    ]);
    const MT = !!maintenance;
    const model = storefrontModel(storefront);
    const compact = model === models.model1;
    const qris = model === models.model3;
    const permissions = storefront?.[emojiFields(model).source] && message.guild?.members.me
        ? message.channel?.permissionsFor(message.guild.members.me) : null;
    const emojis = await resolveStorefrontEmojis(storefront, message.guild, permissions);

    // Ambil harga 1 WL sekarang dalam Rupiah (live gtid.pro kalau nyala, atau manual /setwlprice kalau API dimatikan/down)
    const { pricePerWL, pricePerDL } = await getEffectiveWLPrice();

    if (!compact && !qris) await order
        .findOneAndUpdate({}, { $inc: { OdeOder: 1 } }, { upsert: true, new: true })
        .catch(console.error);

    const getCodes = await list.find(productFilter);

    let now = new Date();
    let format = `<t:${Math.floor(now.getTime() / 1000)}:R>`;

    const DIVIDER = "-".repeat(40);

    // ── Build product list ──
    let productBlocks = [];
    let selectOptions = [];
    const cards = [];
    for (const code of getCodes) {
        const filter = { code: code.code };
        const [stock, priceDoc, discountDoc] = await Promise.all([
            shop.countDocuments({ ...filter, data: { $type: "string", $ne: "" } }),
            qris ? null : Price.findOne(filter), qris ? null : disc.findOne(filter),
        ]);
        const discount = discountDoc?.discount;
        let hasStock = stock > 0;
        let basePrice = priceDoc ? Number(priceDoc.price) : null;
        let effectivePrice = basePrice;
        let priceText = "Not Set Yet";
        let rupiahText = "";

        if (basePrice !== null) {
            if (discount) {
                let finalPrice = basePrice - basePrice * discount;
                priceText = `~~${new Intl.NumberFormat().format(basePrice)}~~ **${new Intl.NumberFormat().format(finalPrice)}**`;
                effectivePrice = finalPrice;
            } else {
                priceText = `**${new Intl.NumberFormat().format(basePrice)}**`;
            }

            if (pricePerWL) {
                let rupiah = Math.round(effectivePrice * pricePerWL);
                rupiahText = ` (≈ **Rp${rupiah.toLocaleString("id-ID")}**)`;
            }
        }

        let statusEmoji = hasStock ? emojis.stockAvailable : emojis.stockEmpty;
        let stockText = hasStock ? `**${stock}** ${statusEmoji}` : `**0** ${statusEmoji}`;
        let soldText = `**${code.sold ?? 0}**`;
        const priceIdr = Number.isSafeInteger(code.priceIdr) && code.priceIdr >= 1000 && code.priceIdr <= 1000000 ? code.priceIdr : null;
        if (qris) cards.push({ name: code.name, code: code.code, description: code.description, priceIdr, sold: code.sold ?? 0, stock });

        productBlocks.push(
`${emojis.crown} **${code.name.toUpperCase()}** ${emojis.crown}
${emojis.arrow} Code: **${code.code}**
${emojis.arrow} Stock: ${stockText}
${emojis.arrow} Sold: ${soldText} ${emojis.sold}
${emojis.arrow} Price: ${priceText} ${emojis.wl}${rupiahText}
${DIVIDER}`
        );

        selectOptions.push({
            label: code.name.length > 100 ? code.name.slice(0, 97) + "..." : code.name,
            description: `Code: ${code.code} | Stock: ${stock}${qris && !priceIdr ? " | Harga belum diatur" : ""}`.slice(0, 100),
            value: code.code,
            hasStock: hasStock && (!qris || !!priceIdr),
        });
    }

    let howToBuySection = compact
        ? `${emojis.warning} **HOW TO BUY** ${emojis.warning}\n${emojis.arrow} Buka **My Profile** untuk mengatur GrowID.\n${emojis.cart} Pilih produk yang bertanda ${emojis.inStock} dari dropdown.`
        : qris
        ? `${emojis.warning} **HOW TO BUY**\n${emojis.cart} Pilih **Buy** atau dropdown untuk membayar lewat QRIS.\n${emojis.arrow} File pesanan dikirim setelah pembayaran terkonfirmasi.`
        : model === models.model2
        ? `${emojis.warning} **HOW TO BUY** ${emojis.warning}\n${emojis.arrow} Buka menu untuk **Set GrowID**, **Deposit**, atau cek **Balance**.\n${emojis.cart} Pilih produk yang bertanda ${emojis.inStock} dari dropdown beli.`
        :
`${emojis.warning} **HOW TO BUY** ${emojis.warning}
${emojis.arrow} Click Button **Set GrowID**
${emojis.arrow} Click Button **Balance** To Check Your GrowID
${emojis.arrow} Click Button **Deposit** To See World Deposit
${emojis.cart} Click The **Dropdown Menu** Below To Buy An Item`;

    let kursText = pricePerWL
        ? `${emojis.arrow} Kurs: **1 ${emojis.wl} = Rp${Math.round(pricePerWL).toLocaleString("id-ID")}** | **1 DL = Rp${Math.round(pricePerDL).toLocaleString("id-ID")}**`
        : `${emojis.arrow} Kurs: Harga belum tersedia`;

    let titleText = kategori === "ALL" ? "PRODUCT LIST" : `PRODUCT LIST — ${kategori.toUpperCase()}`;

    const selectRow = buySelectRow(selectOptions, MT, emojis, qris);
    if (qris) {
        const container = productCards({ title: escapeMarkdown(titleText), header: `**Last Update:** ${format}\n${kursText}`,
            footer: howToBuySection, products: cards, maintenance: MT, emojis });
        return editModernCatalog(message, container, [storeMenuRow(MT, emojis), selectRow]);
    }

    const header = `**Last Update:** ${format}\n${kursText}\n${DIVIDER}\n`;
    const footer = "\n" + howToBuySection;
    const productText = productBlocks.join("\n");
    const room = 4096 - header.length - footer.length;
    const shownProducts = productText.length <= room ? productText
        : productText.slice(0, room - 40) + "\n… Lihat produk lainnya per kategori.";
    const description = header + shownProducts + footer;

    let productEmbed = new EmbedBuilder()
        .setTitle(`${emojis.crown} ${titleText} ${emojis.crown}`)
        .setDescription(description)
        .setColor(COLOR)
        .setImage(imageUrl2)
        .setTimestamp();

    if (compact || model === models.model2) {
        const components = compact ? [selectRow, compactActionRow(MT, emojis)] : [storeMenuRow(MT, emojis), selectRow];
        return editLegacyCatalog(message, productEmbed, components);
    }

    let buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel("Set GrowID")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(componentEmoji(emojis.growIdButton))
            .setCustomId("growid23"),
        new ButtonBuilder()
            .setLabel("Balance")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(componentEmoji(emojis.balanceButton))
            .setCustomId("balance1"),
        new ButtonBuilder()
            .setLabel("Deposit")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(componentEmoji(emojis.depositButton))
            .setCustomId("deposit"),
        new ButtonBuilder()
            .setLabel("Deposit QRIS")
            .setStyle(ButtonStyle.Success)
            .setEmoji(componentEmoji(emojis.qris))
            .setCustomId("depositqris_btn")
    );

    let maintenanceRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel("Maintenance")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
            .setEmoji(componentEmoji(emojis.growIdButton))
            .setCustomId("growid23"),
        new ButtonBuilder()
            .setLabel("Maintenance")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
            .setEmoji(componentEmoji(emojis.balanceButton))
            .setCustomId("balance1"),
        new ButtonBuilder()
            .setLabel("Maintenance")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
            .setEmoji(componentEmoji(emojis.depositButton))
            .setCustomId("deposit")
    );

    await editLegacyCatalog(message, productEmbed, [selectRow, MT ? maintenanceRow : buttonRow]);
}
