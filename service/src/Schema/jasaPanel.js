const { Schema, model } = require("mongoose");

const schema = new Schema({
    channelId: String,
    messageId: String,
    storeName: { type: String, default: "Store" },
    rateDL: { type: Number, default: 0 }, // Rp per 1 DL, ditampilkan di header panel (diisi manual lewat /setjasapanel)
});

module.exports = model("jasaPanel", schema);
