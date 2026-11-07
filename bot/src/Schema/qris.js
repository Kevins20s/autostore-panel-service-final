const { Schema, model } = require("mongoose");

const schema = new Schema({
  orderId: {
    type: String,
    required: true,
    unique: true,
  },
  invoiceCode: {
    type: String, // sudah tidak dipakai di alur manual, dibiarkan opsional untuk data lama
  },
  discordId: {
    type: String,
    required: true,
  },
  growId: {
    type: String,
  },
  dmChannelId: {
    type: String,
  },
  dmMessageId: {
    type: String,
  },
  grossAmount: {
    type: Number,
    required: true,
  },
  wlAmount: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    default: "pending", // pending | credited | cancelled
  },
  processedBy: {
    type: String, // Discord ID admin/owner yang menekan Success/Cancel
  },
  logChannelId: {
    type: String,
  },
  logMessageId: {
    type: String,
  },
  mode: {
    type: String,
    default: "manual", // manual | auto (QRIS otomatis lewat panel)
  },
  panelManaged: { type: Boolean, default: false },
  notificationPending: { type: Boolean, default: false },
  statusCheckedAt: { type: Date, default: () => new Date(0) },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Qris = model("qris", schema);

module.exports = Qris;
