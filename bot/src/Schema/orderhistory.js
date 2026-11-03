// Riwayat order: satu dokumen per pembelian yang berhasil. Dibaca oleh halaman Orders dan Dashboard di panel web.
const { Schema, model } = require("mongoose");

const schema = new Schema({
  orderNumber: Number,
  discordId: String,
  username: String,
  growId: String,
  code: String,
  productName: String,
  qty: Number,
  total: Number, // total WL yang dipotong dari saldo pembeli
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = model("orderhistory", schema);
