const { Schema, model } = require("mongoose")

const sche = new Schema({
    code: String,
    minQty: Number,
    cut: Number
})

const bulk = model("bulkdiscount", sche)

module.exports = bulk
