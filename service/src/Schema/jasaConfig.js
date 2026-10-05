const { Schema, model } = require("mongoose");

// Satu dokumen = satu jenis jasa (PLANT, HARVEST, HARVEST MOVE, MOVE, PROVIDER, SPLICE)
const schema = new Schema({
    type: { type: String, required: true, unique: true }, // harus match key di src/utils/jasaTypes.js
    status: { type: String, default: "OPEN" }, // "OPEN" atau "CLOSE"
    price: { type: Number, default: 0 }, // harga WL per unit (per World, atau per Block untuk MOVE)
    completed: { type: Number, default: 0 }, // total World/Item yang sudah selesai dikerjakan
});

module.exports = model("jasaConfig", schema);
