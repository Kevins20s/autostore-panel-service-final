const { Schema, model, models } = require("mongoose")

const sche = new Schema({
	pricePerWL: { type: Number, default: 0 }
})

const wlrate = models.wlrate || model("wlrate", sche)

module.exports = wlrate
