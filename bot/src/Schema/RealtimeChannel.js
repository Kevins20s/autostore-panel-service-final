const { Schema, model } = require("mongoose");

const schema = new Schema({
    kategori: {
        type: String,
        required: true,
        unique: true, // "ALL" = mode lama (semua produk jadi 1), atau nama kategori spesifik
    },
    channelId: String,
    messageId: String,
    extraCatalogMessages: [{ _id: false, channelId: String, messageId: String }],
    intervalSeconds: Number,
});

module.exports = model("realtimechannel", schema);
