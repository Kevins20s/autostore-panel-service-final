const { Schema, model, models } = require("mongoose")

const sche = new Schema({
	// true = pakai harga live dari gtid.pro, false = paksa pakai harga manual (/setwlprice)
	useLiveApi: { type: Boolean, default: true }
})

const apiSetting = models.apiSetting || model("apiSetting", sche)

module.exports = apiSetting
