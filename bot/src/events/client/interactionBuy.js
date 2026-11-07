const { InteractionType, EmbedBuilder } = require("discord.js");
const mongoose = require("mongoose");
const { Owner, Admin } = require("../../config/config.json");
const { WL, COLOR, imageUrl } = require("../../config/configemoji.json");
const Balance = require("../../Schema/balance.js");
const Stock = require("../../Schema/shop.js");
const Product = require("../../Schema/list.js");
const Price = require("../../Schema/priceproduct.js");
const Counter = require("../../Schema/orderproduct.js");
const OrderLog = require("../../Schema/orderlog.js");
const Maintenance = require("../../Schema/maintenance.js");
const Settings = require("../../Schema/SettingChannel.js");
const Discount = require("../../Schema/discount.js");
const BulkDiscount = require("../../Schema/bulkdiscount.js");
const client = require("../../index.js");

class PurchaseError extends Error {}

async function purchase({ code, qty, discordId }, session) {
    const options = session ? { session } : {};
    if (await Maintenance.exists({ mt: true }).setOptions(options)) throw new PurchaseError("Toko sedang dalam pemeliharaan.");
    const product = await Product.findOne({ code }, null, options);
    if (!product) throw new PurchaseError("Kode produk tidak ditemukan.");
    const price = (await Price.findOne({ code }, null, options))?.price;
    if (!Number.isFinite(price) || price <= 0) throw new PurchaseError("Harga produk belum diatur.");
    const script = product.type?.includes("script");
    if (script && qty !== 1) throw new PurchaseError("Produk script hanya bisa dibeli satu per pesanan.");
    const discount = script ? 0 : (await Discount.findOne({ code }, null, options))?.discount ?? 0;
    const tier = script ? null : await BulkDiscount.findOne({ code, minQty: { $lte: qty } }, null, options).sort({ minQty: -1 });
    if (!Number.isFinite(discount) || discount < 0 || discount > 1 ||
        (tier && (!Number.isFinite(tier.cut) || tier.cut < 0))) throw new PurchaseError("Diskon produk tidak valid. Hubungi admin.");
    const total = Math.max(0, price - (tier?.cut || 0)) * (1 - discount) * qty;
    const filter = { code, data: { $type: "string", $ne: "" } };
    const stock = await Stock.find(filter, null, options).sort({ _id: 1 }).limit(qty).lean();
    if (stock.length < qty) throw new PurchaseError("Stok tidak mencukupi.");
    const buyer = await Balance.findOneAndUpdate({ DiscordID: discordId, Balance: { $gte: total } },
        { $inc: { Balance: -total } }, { ...options, new: true });
    if (!buyer) throw new PurchaseError("Saldo tidak cukup atau GrowID belum terdaftar.");

    if (!script) {
        if (session) {
            const removed = await Stock.deleteMany({ code, _id: { $in: stock.map(item => item._id) } }, options);
            if (removed.deletedCount !== qty) throw new PurchaseError("Stok baru saja berubah. Coba beli lagi.");
        } else {
            const claimed = [];
            try {
                for (const item of stock) {
                    const removed = await Stock.findOneAndDelete({ code, _id: item._id }).lean();
                    if (!removed) throw new PurchaseError("Stok baru saja berubah. Coba beli lagi.");
                    claimed.push(removed);
                }
            } catch (error) {
                await Balance.updateOne({ _id: buyer._id }, { $inc: { Balance: total } });
                if (claimed.length) await Stock.insertMany(claimed);
                throw error;
            }
        }
    }
    const count = await Counter.findOneAndUpdate({}, { $inc: { Order: 1 } }, { ...options, upsert: true, new: true });
    await Product.updateOne({ _id: product._id }, { $inc: { sold: qty } }, options);
    await OrderLog.create([{
        orderNumber: count.Order, discordId, growId: buyer.GrowIDNow || buyer.GrowID || "",
        code, productName: product.name, qty, total,
    }], options);
    return { orderNumber: count.Order, product, qty, total, balance: buyer.Balance, data: stock.map(item => item.data).join("\n") };
}

async function handlePurchase(interaction) {
    const customId = interaction.customId || "";
    if (interaction.type !== InteractionType.ModalSubmit ||
        (customId !== "buys" && !customId.startsWith("buysamount::"))) return;
    await interaction.deferReply({ ephemeral: true });
    const rawQty = interaction.fields.getTextInputValue("jumlah").trim();
    const qty = Number(rawQty);
    const code = customId === "buys" ? interaction.fields.getTextInputValue("code").trim() : customId.slice("buysamount::".length);
    let result, channel;
    try {
        if (!/^\d+$/.test(rawQty) || !Number.isSafeInteger(qty) || qty < 1) throw new PurchaseError("Masukkan jumlah bulat lebih dari nol.");
        const settings = await Settings.findOne({});
        channel = interaction.guild?.channels.cache.get(settings?.ChanelTesti);
        if (!channel?.isTextBased()) throw new PurchaseError("Channel testimoni belum tersedia. Hubungi admin.");
        const input = { code, qty, discordId: interaction.user.id };
        result = process.env.HOSTED_PILOT_BINDING
            ? await mongoose.connection.transaction(session => purchase(input, session))
            : await purchase(input);
    } catch (error) {
        if (!(error instanceof PurchaseError)) console.error("[PURCHASE]", error.code || error.name);
        await interaction.editReply(error instanceof PurchaseError ? error.message : "Pembelian gagal diproses. Hubungi admin jika saldo berubah.");
        return;
    }

    const { orderNumber, product, total, balance, data } = result;
    const amount = `${total.toFixed(1)} ${WL}`;
    const files = [{ attachment: Buffer.from(data), name: `order-${orderNumber}.txt` }];
    let deliveredByDm = true;
    try {
        await interaction.user.send({ content: `Pesanan #${orderNumber} · ${product.name} × ${qty} · ${amount}`, files });
    } catch { deliveredByDm = false; }
    const reply = deliveredByDm
        ? { content: `Pesanan #${orderNumber} berhasil. Cek DM. Total ${amount} · Sisa saldo ${balance} WL.` }
        : { content: `Pesanan #${orderNumber} berhasil. DM tidak tersedia, unduh file pesanan di sini.`, files };
    await interaction.editReply(reply).catch(() => console.error("[PURCHASE] Balasan Discord gagal untuk order", orderNumber));

    const member = interaction.guild.members.cache.get(interaction.user.id);
    if (member && product.role && !member.roles.cache.has(product.role)) {
        await member.roles.add(product.role).catch(() => console.error("[PURCHASE] Gagal memberikan role untuk order", orderNumber));
    }
    const embed = new EmbedBuilder().setTitle("#Order Number: " + orderNumber)
        .setDescription(`Buyer: <@${interaction.user.id}>\nProduct: ${product.name}\nQuantity: ${qty}\nTotal: ${amount}`)
        .setColor(COLOR).setTimestamp().setImage(imageUrl);
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } })
        .catch(() => console.error("[PURCHASE] Testimoni gagal untuk order", orderNumber));
    for (const id of new Set([Owner, ...(Admin || [])].filter(Boolean))) {
        try {
            const staff = await client.users.fetch(id);
            await staff.send({ content: `Pesanan #${orderNumber} untuk <@${interaction.user.id}>`, files });
        } catch { console.error("[PURCHASE] Notifikasi admin gagal untuk order", orderNumber); }
    }
}

module.exports = { name: "Buying Item Of Menu", handlePurchase };
client.on("interactionCreate", interaction => {
    handlePurchase(interaction).catch(error => console.error("[PURCHASE] Interaksi gagal:", error.code || error.name));
});
