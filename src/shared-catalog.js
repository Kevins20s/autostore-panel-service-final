"use strict";

const { tenantForGuild } = require("./shared-tenants");
const { getDb, COL } = require("./shopdb");
const { purchaseOne, PurchaseError } = require("./shared-purchase");

const projectCommands = [
    { name: "help", description: "Lihat perintah toko yang tersedia" },
    { name: "leaderboard", description: "Lihat lima saldo WL tertinggi di toko ini" },
    { name: "checkstock", description: "Lihat jumlah stok suatu produk", defaultMemberPermissions: "32", options: [
        { type: 3, name: "code", description: "Kode produk", required: true, maxLength: 32 },
    ] },
    { name: "checkuser", description: "Lihat saldo pelanggan di toko ini", defaultMemberPermissions: "32", options: [
        { type: 6, name: "user", description: "Pelanggan Discord", required: true },
    ] },
];

const commands = [
    { name: "katalog", description: "Lihat katalog toko GevraStore" },
    { name: "beli", description: "Beli satu stok dengan saldo WL", options: [
        { type: 3, name: "kode", description: "Kode produk", required: true, maxLength: 32 },
    ] },
    { name: "ambil", description: "Ambil kembali hasil pembelian terakhir di toko ini" },
    { name: "isi-saldo", description: "Isi saldo WL dengan QRIS", options: [
        { type: 4, name: "rupiah", description: "Nominal pembayaran dalam rupiah", required: true, minValue: 1 },
    ] },
    ...projectCommands,
];

// Pilot commands use the guild binding. No legacy bot handlers run on this client.
function createCatalogHandler({ registry, openDb = getDb, createDeposit }) {
    return async (interaction) => {
        const command = interaction.commandName;
        if (!interaction.isChatInputCommand() || !commands.some(item => item.name === command)) return;
        const tenant = tenantForGuild(registry(), interaction.guildId);
        if (!tenant?.dbName) {
            await interaction.reply({ content: "Server ini belum terhubung ke lisensi GevraStore yang aktif.", flags: 64 });
            return;
        }
        if (projectCommands.some(item => item.name === command && item.defaultMemberPermissions) &&
            !interaction.memberPermissions?.has(32n)) {
            await interaction.reply({ content: "Perintah ini memerlukan izin Kelola Server.", flags: 64 });
            return;
        }
        await interaction.deferReply({ flags: 64 });
        const isActive = () => {
            const current = tenantForGuild(registry(), interaction.guildId);
            return current?.licenseId === tenant.licenseId && current?.dbName === tenant.dbName;
        };
        try {
            const db = await openDb("hosted:" + tenant.licenseId, tenant.config.mongoUrl, tenant.dbName);
            if (projectCommands.some(item => item.name === command)) {
                let content;
                if (command === "help") {
                    content = "Perintah toko: " + commands.filter(item => item.name !== "isi-saldo" || createDeposit)
                        .filter(item => !item.defaultMemberPermissions || interaction.memberPermissions?.has(32n))
                        .map(item => "/" + item.name).join(", ");
                } else if (command === "leaderboard") {
                    const users = await db.collection(COL.bal).find({ Balance: { $gt: 0 } })
                        .sort({ Balance: -1, _id: 1 }).limit(5).toArray();
                    content = users.map((user, index) => `${index + 1}. <@${user.DiscordID}> · ${user.Balance} WL`).join("\n") ||
                        "Belum ada pelanggan dengan saldo WL.";
                } else if (command === "checkstock") {
                    const code = interaction.options.getString("code", true).trim();
                    const product = await db.collection(COL.list).findOne({ code });
                    if (!product) throw new PurchaseError("Produk tidak ditemukan.");
                    const stock = await db.collection(COL.shop).countDocuments({ code });
                    content = `${product.name} · ${stock} stok`;
                } else {
                    const user = interaction.options.getUser("user", true);
                    const account = await db.collection(COL.bal).findOne({ DiscordID: user.id });
                    content = account ? `<@${user.id}> · ${account.Balance || 0} WL` : "Pelanggan belum terdaftar di toko ini.";
                }
                if (!isActive()) throw new PurchaseError("Lisensi server ini sudah berubah.");
                await interaction.editReply({ content, allowedMentions: { parse: [] } });
                return;
            }
            if (command === "isi-saldo") {
                if (!createDeposit) throw new PurchaseError("QRIS untuk bot GevraStore belum aktif.");
                const amount = interaction.options.getInteger("rupiah", true);
                const rate = await db.collection(COL.wlrate).findOne({});
                const pricePerWL = rate?.pricePerWL;
                if (!Number.isFinite(pricePerWL) || pricePerWL <= 0) throw new PurchaseError("Kurs WL toko belum diatur.");
                const hostedWL = Math.floor(amount / pricePerWL);
                if (hostedWL < 1) throw new PurchaseError("Nominal belum cukup untuk 1 WL.");
                if (!isActive()) throw new PurchaseError("Lisensi server ini sudah berubah.");
                const deposit = await createDeposit({ licenseId: tenant.licenseId, discordId: interaction.user.id, amount, hostedWL });
                const content = `Isi saldo ${hostedWL} WL · Rp${deposit.amount} · Order ${deposit.orderId}\nBayar sebelum <t:${Math.floor(deposit.expiresAt / 1000)}:t>.`;
                if (deposit.qrString) {
                    const attachment = await require("qrcode").toBuffer(deposit.qrString, { width: 512, margin: 2 });
                    await interaction.editReply({ content, files: [{ attachment, name: "qris.png" }] });
                } else {
                    await interaction.editReply({ content: content + "\n" + deposit.qrImageUrl });
                }
                return;
            }
            if (command === "beli" || command === "ambil") {
                const discordId = interaction.user.id;
                let receipt;
                if (command === "beli") {
                    const code = interaction.options.getString("kode", true).trim();
                    if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) throw new PurchaseError("Kode produk tidak valid.");
                    receipt = await purchaseOne(db, { id: interaction.id, discordId, code, isActive });
                } else {
                    receipt = await db.collection("hostedreceipts").findOne({ discordId }, { sort: { _id: -1 } });
                }
                if (!isActive()) throw new PurchaseError("Lisensi server ini sudah berubah.");
                if (!receipt) throw new PurchaseError("Belum ada pembelian di toko ini.");
                await interaction.editReply({
                    content: `Pesanan selesai. Total ${receipt.total} WL.`,
                    files: [{ attachment: Buffer.from(receipt.data, "utf8"), name: "pesanan.txt" }],
                    allowedMentions: { parse: [] },
                });
                return;
            }
            const products = await db.collection(COL.list)
                .find({}, { projection: { code: 1, name: 1 } }).sort({ code: 1 }).limit(15).toArray();
            // A license can be revoked or moved while MongoDB is connecting.
            if (!isActive()) {
                await interaction.editReply("Lisensi server ini berubah. Coba lagi.");
                return;
            }
            const lines = products.map(({ code, name }) =>
                String(code || "").replace(/[\r\n]/g, " ").slice(0, 32) + " · " +
                String(name || "").replace(/[\r\n]/g, " ").slice(0, 80));
            await interaction.editReply({
                content: lines.join("\n") || "Katalog toko ini masih kosong.",
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            const fallback = {
                katalog: "Katalog belum bisa dimuat. Coba lagi.",
                "isi-saldo": "QRIS belum bisa ditampilkan. Coba lagi nanti.",
                beli: "Pesanan belum bisa ditampilkan. Gunakan /ambil untuk memeriksa hasil pembelian terakhir.",
            }[command] || "Data belum bisa ditampilkan. Coba lagi.";
            await interaction.editReply(error instanceof PurchaseError ? error.message : fallback);
        }
    };
}

module.exports = { createCatalogHandler, commands };
