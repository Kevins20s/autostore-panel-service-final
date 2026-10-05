let client = require("../../index");
let { Owner } = require("../../config/runtime.js");
let Bal = require("../../Schema/balance.js");
let jasaOrder = require("../../Schema/jasaOrder.js");
let jasaConfig = require("../../Schema/jasaConfig.js");
let jasaCounter = require("../../Schema/jasaCounter.js");
let jasaPromo = require("../../Schema/jasaPromo.js");
let { getJasaType, calcJasaPrice } = require("../../utils/jasaTypes.js");
let { refreshJasaPanel } = require("../../utils/jasaPanelBuilder.js");

module.exports = {
    name: "Jasa Order Modal",
};

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith("jasaOrder::")) return;

    try {
        const type = interaction.customId.split("::")[1];
        const def = getJasaType(type);
        if (!def) return interaction.reply({ content: "Jenis jasa tidak dikenali.", ephemeral: true });

        const rawAmount = interaction.fields.getTextInputValue(def.amountField.id).trim();
        const amount = Number(rawAmount.replace(/[.,]/g, ""));

        if (!Number.isFinite(amount) || amount <= 0) {
            return interaction.reply({ content: `**${def.amountField.label}** harus berupa angka lebih dari 0!`, ephemeral: true });
        }

        const details = {};
        for (const f of def.fields) {
            const value = interaction.fields.getTextInputValue(f.id).trim();
            if (!value) return interaction.reply({ content: `**${f.label}** wajib diisi!`, ephemeral: true });
            details[f.label] = value;
        }

        let promoCode = null;
        try {
            promoCode = interaction.fields.getTextInputValue("promo").trim() || null;
        } catch (_) {
            promoCode = null;
        }

        const cfg = await jasaConfig.findOne({ type }).catch(() => null);
        if (!cfg || cfg.status !== "OPEN") {
            return interaction.reply({ content: `Jasa **${type}** sedang **CLOSE**, belum bisa di-order sekarang.`, ephemeral: true });
        }
        const unitPrice = cfg.price ?? def.defaultPrice;

        let discount = 0;
        if (promoCode) {
            const promo = await jasaPromo.findOne({ code: promoCode.toUpperCase() }).catch(() => null);
            if (!promo) {
                return interaction.reply({ content: `Kode promo **${promoCode}** tidak valid/tidak ditemukan.`, ephemeral: true });
            }
            discount = promo.discount;
        }

        const totalPrice = calcJasaPrice(type, amount, unitPrice, discount);

        const getBal = await Bal.findOne({ DiscordID: interaction.user.id }).catch(() => null);
        if (!getBal) {
            return interaction.reply({ content: "**Set GrowID** dulu sebelum order jasa!", ephemeral: true });
        }
        if ((getBal.Balance || 0) < totalPrice) {
            return interaction.reply({
                content: `Balance kamu tidak cukup! Butuh **${totalPrice} WL**, balance kamu **${getBal.Balance || 0} WL**.`,
                ephemeral: true,
            });
        }

        // Potong balance dulu (atomic-ish lewat findOneAndUpdate) baru bikin order,
        // biar gak ada race condition antara cek balance & potong balance.
        const deducted = await Bal.findOneAndUpdate(
            { DiscordID: interaction.user.id, Balance: { $gte: totalPrice } },
            { $inc: { Balance: -totalPrice } },
            { new: true }
        ).catch(() => null);

        if (!deducted) {
            return interaction.reply({ content: "Balance kamu berubah/tidak cukup, coba order ulang.", ephemeral: true });
        }

        const counter = await jasaCounter.findOneAndUpdate({}, { $inc: { count: 1 } }, { upsert: true, new: true });
        const orderNumber = counter.count;

        await jasaOrder.create({
            orderNumber,
            buyerId: interaction.user.id,
            type,
            amount,
            unit: def.blockSize ? "Item" : "World",
            details,
            promoCode: promoCode || null,
            price: totalPrice,
            status: "waiting",
        });

        // Balas dulu SEBELUM refresh panel — refresh panel ngambil kurs live dari
        // internet dan bisa lebih dari 3 detik, kalau reply nunggu itu dulu Discord
        // bakal keburu timeout ("The application did not respond").
        await interaction.reply({
            content: `✅ Order **${type}** (#${orderNumber}) berhasil dibuat! **${totalPrice} WL** sudah dipotong dari balance kamu. Silakan tunggu antrian.`,
            ephemeral: true,
        });

        refreshJasaPanel(client).catch(console.error);

        // Kabari Owner ada order baru masuk (kontrol jasa cuma buat Owner)
        client.users
            .fetch(Owner)
            .then((u) => u.send(`🔔 Order baru **${type}** (#${orderNumber}) dari <@${interaction.user.id}> — ${amount} ${def.blockSize ? "Item" : "World"}, ${totalPrice} WL.`).catch(() => {}))
            .catch(() => {});
    } catch (err) {
        console.error(err);
        if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: "Terjadi kesalahan saat memproses order.", ephemeral: true }).catch(() => {});
        }
    }
});
