const { Schema, model } = require("mongoose");

const schema = new Schema({
  GrowID: {
    type: String,
    required: true,
  },
  GrowIDNow: {
    type: String,
    required: true,
  },
  DiscordID: {
    type: String,
    required: true,
  },
  Balance: {
    type: Number,
    default: 0,
    required: true,
  },
  Deposit: {
    type: Number,
    default: 0,
    required: true,
  },
  BalanceRp: { type: Number, default: 0 },
  RupiahCreditIds: { type: [String], default: undefined },
});

const Bal = model("Bal", schema);

module.exports = Bal;
