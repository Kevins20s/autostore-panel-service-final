let { Owner } = require("../../config/config.json");
let {
    ActivityType,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ApplicationCommandOptionType,
    ButtonBuilder,
    StringSelectMenuBuilder,
} = require("discord.js");
let shop = require("../../Schema/shop.js");
let mt = require("../../Schema/maintenance.js");
let Price = require("../../Schema/priceproduct.js");
let list = require("../../Schema/list.js");
let disc = require("../../Schema/discount.js");
let RealtimeChannel = require("../../Schema/RealtimeChannel.js");
let order = require("../../Schema/orderproduct.js");
let WLRate = require("../../Schema/wlrate.js");
let { getEffectiveWLPrice } = require("../../utils/gtidPrice.js");
let { Warning, Benar, Salah, Megaphone, WL, CROWN, Dolar, EARTH, BOT, Buy, BALANCE, imageUrl, imageUrl2, COLOR, ARROW } = require("../../config/configemoji.json");

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
        let delay = interaction.options.getNumber("delay");
        let kategoriInput = interaction.options.getString("kategori");
        let kategori = kategoriInput ? kategoriInput.trim() : "ALL";

        let user = await client.users.fetch(Owner);
        let check = await RealtimeChannel.findOne({ kategori }).catch(console.error);

        if (!check?.channelId) return interaction.reply({
            content: `/setrealtime dulu buat kategori **${kategori}** sebelum pakai command ini!`,
            ephemeral: true
        });

        // Filter produk sesuai kategori. "ALL" = tampilin semua produk (mode lama).
        let productFilter = kategori === "ALL" ? {} : { kategori: kategori };

        let getCodesa = await list.find(productFilter).catch(console.error);

        if (!getCodesa || getCodesa.length < 1) return interaction.reply({
            content: kategori === "ALL"
                ? `**/addproduct first before use this commands!**`
                : `**Belum ada produk dengan kategori (type) "${kategori}"!** Cek lagi field 'type' di /addproduct.`,
            ephemeral: true
        });

        await interaction.reply({
            content: `Started Editing The Realtime Stock (Kategori: **${kategori}**) Delay **${delay}s**`,
            ephemeral: true
        });

        try {
            setInterval(async () => {
                if (!check?.channelId || !check?.messageId) return;

                let channel = await client.channels.fetch(check.channelId).catch(() => null);
                let messageid = channel ? await channel.messages.fetch(check.messageId).catch(() => null) : null;

                if (!channel || !messageid) {
                    return user.send({ content: `Have Problem For Channel Or MessageID (Kategori: ${kategori})` });
                }

                let MT = await mt.findOne({}).then((d) => d?.mt).catch(console.error);

                // Ambil harga 1 WL sekarang dalam Rupiah (live gtid.pro kalau nyala, atau manual /setwlprice kalau API dimatikan/down)
                let { pricePerWL, pricePerDL } = await getEffectiveWLPrice();

                await order
                    .findOneAndUpdate({}, { $inc: { OdeOder: 1 } }, { upsert: true, new: true })
                    .catch(console.error);

                let getCodes = await list.find(productFilter).catch(console.error);

                let now = new Date();
                let format = `<t:${Math.floor(now.getTime() / 1000)}:R>`;

                const DIVIDER = "-".repeat(40);

                // ── Build product list ──
                let productBlocks = [];
                let selectOptions = [];
                for (let i = 0; i < getCodes.length; i++) {
                    let code = getCodes[i];

                    let stock = await shop.find({ code: code.code }).catch(console.error) || [];
                    let priceDoc = await Price.findOne({ code: code.code }).catch(console.error);
                    let discount = await disc.findOne({ code: code.code }).then((r) => r?.discount).catch(console.error);

                    let hasStock = stock.length > 0;
                    let basePrice = priceDoc ? Number(priceDoc.price) : null;
                    let priceText = "Not Set Yet";
                    let rupiahText = "";

                    if (basePrice !== null) {
                        let effectivePrice = basePrice;
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

                    let statusEmoji = hasStock ? Benar : Salah;
                    let stockText = hasStock ? `**${stock.length}** ${statusEmoji}` : `**0** ${statusEmoji}`;
                    let soldText = `**${code.sold ?? 0}**`;

                    productBlocks.push(
`${CROWN} **${code.name.toUpperCase()}** ${CROWN}
${ARROW} Code: **${code.code}**
${ARROW} Stock: ${stockText}
${ARROW} Sold: ${soldText} ${Buy}
${ARROW} Price: ${priceText} ${WL}${rupiahText}
${DIVIDER}`
                    );

                    if (selectOptions.length < 25) {
                        let plainPrice = priceText.replace(/\*\*/g, "").replace(/~~[^~]*~~/g, "").trim();
                        selectOptions.push({
                            label: code.name.length > 100 ? code.name.slice(0, 97) + "..." : code.name,
                            description: `Stock: ${stock.length} | Price: ${plainPrice}`.slice(0, 100),
                            value: code.code
                        });
                    }
                }

                let howToBuySection =
`${Warning} **HOW TO BUY** ${Warning}
${ARROW} Click Button **Set GrowID**
${ARROW} Click Button **Balance** To Check Your GrowID
${ARROW} Click Button **Deposit** To See World Deposit
${ARROW} Click The **Dropdown Menu** Below To Buy An Item`;

                let kursText = pricePerWL
                    ? `${ARROW} Kurs: **1 ${WL} = Rp${Math.round(pricePerWL).toLocaleString("id-ID")}** | **1 DL = Rp${Math.round(pricePerDL).toLocaleString("id-ID")}**`
                    : `${ARROW} Kurs: Harga belum tersedia`;

                let titleText = kategori === "ALL" ? "PRODUCT LIST" : `PRODUCT LIST — ${kategori.toUpperCase()}`;

                let description =
`**Last Update:** ${format}
${kursText}
${DIVIDER}
${productBlocks.join("\n")}
${howToBuySection}`;

                let productEmbed = new EmbedBuilder()
                    .setTitle(`${CROWN} ${titleText} ${CROWN}`)
                    .setDescription(description)
                    .setColor(COLOR)
                    .setImage(imageUrl2)
                    .setTimestamp();

                let selectRow = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("Howmanys")
                        .setPlaceholder("Click here to buy products")
                        .setDisabled(selectOptions.length < 1)
                        .addOptions(
                            selectOptions.length > 0
                                ? selectOptions
                                : [{ label: "No product available", value: "none" }]
                        )
                );

                let buttonRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel("Set GrowID")
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji("<a:SHRules:1269199498320809996>")
                        .setCustomId("growid23"),
                    new ButtonBuilder()
                        .setLabel("Balance")
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji("<a:uang:1269199494063456256>")
                        .setCustomId("balance1"),
                    new ButtonBuilder()
                        .setLabel("Deposit")
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji("<a:planet2:1269199500673683466>")
                        .setCustomId("deposit"),
                    new ButtonBuilder()
                        .setLabel("Deposit QRIS")
                        .setStyle(ButtonStyle.Success)
                        .setEmoji("💳")
                        .setCustomId("depositqris_btn")
                );

                let maintenanceSelectRow = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("Howmanys")
                        .setPlaceholder("Under Maintenance")
                        .setDisabled(true)
                        .addOptions([{ label: "Under Maintenance", value: "none" }])
                );

                let maintenanceRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel("Maintenance")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                        .setEmoji("<a:SHRules:1269199498320809996>")
                        .setCustomId("growid23"),
                    new ButtonBuilder()
                        .setLabel("Maintenance")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                        .setEmoji("<a:uang:1269199494063456256>")
                        .setCustomId("balance1"),
                    new ButtonBuilder()
                        .setLabel("Maintenance")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true)
                        .setEmoji("<a:planet2:1269199500673683466>")
                        .setCustomId("deposit")
                );

                messageid.edit({
                    content: null,
                    embeds: [productEmbed],
                    components: MT ? [maintenanceSelectRow, maintenanceRow] : [selectRow, buttonRow]
                });
            }, delay * 1000);
        } catch (err) {
            console.error(err);
        }
    }
}
