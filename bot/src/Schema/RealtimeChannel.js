const { Schema, model } = require("mongoose");

const schema = new Schema({
    kategori: {
        type: String,
        required: true,
        unique: true, // "ALL" = mode lama (semua produk jadi 1), atau nama kategori spesifik
    },
    channelId: String,
    messageId: String,
});

module.exports = model("realtimechannel", schema);
