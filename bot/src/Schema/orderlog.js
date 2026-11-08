const { Schema, model } = require("mongoose");

// Riwayat pembelian produk (dicatat oleh interactionBuy.js, dibaca panel web untuk halaman Orders dan grafik penjualan).
const schema = new Schema({
  orderNumber: Number,
  discordId: String,
  growId: String,
  code: String,
  productName: String,
  qty: Number,
  total: Number, // jumlah WL yang dipotong dari saldo
  totalIdr: Number,
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = model("orderlog", schema);
