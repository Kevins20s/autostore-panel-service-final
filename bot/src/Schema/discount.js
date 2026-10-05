const { Schema, model } = require("mongoose")

const sche = new  Schema({
	code: String,
	discount: Number
})

const disc = model("discount", sche)

module.exports = disc