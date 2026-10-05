const { Schema, model } = require("mongoose");

const schema = new Schema({
    orderNumber: { type: Number, required: true, unique: true },
    buyerId: { type: String, required: true }, // Discord ID pembeli
    type: { type: String, required: true }, // PLANT / HARVEST / HARVEST MOVE / MOVE / PROVIDER / SPLICE
    amount: { type: Number, required: true }, // jumlah World, atau jumlah Item untuk MOVE
    unit: { type: String, default: "World" }, // "World" atau "Item"
    details: { type: Schema.Types.Mixed, default: {} }, // isian world asal/tujuan/farm/seed dll (lihat jasaTypes.js)
    promoCode: { type: String, default: null },
    price: { type: Number, required: true }, // total harga WL yang sudah dipotong dari balance
    status: { type: String, default: "waiting" }, // "waiting" | "in_progress" | "done"
    assignedTo: { type: String, default: null }, // Discord ID staff yang megang order ini
    createdAt: { type: Date, default: Date.now },
});

module.exports = model("jasaOrder", schema);
