const { Schema, model } = require("mongoose")

const sche = new  Schema({
	code: String,
	name: String,
	type: String,
	role: String,
	sold: { type: Number, default: 0 },
	kategori: { type: String, default: "ALL" }
})

const list = model("list", sche)

module.exports = list
