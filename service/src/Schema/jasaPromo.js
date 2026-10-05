const { Schema, model } = require("mongoose");

const schema = new Schema({
    code: { type: String, required: true, unique: true }, // disimpan uppercase
    discount: { type: Number, required: true }, // desimal 0-1, contoh 0.1 = potongan 10%
});

module.exports = model("jasaPromo", schema);
