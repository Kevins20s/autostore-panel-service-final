const { Schema, model } = require("mongoose");

const schema = new Schema({
  world: String,
  owner: String,
  botName: String,
  status: String,
  reason: String,
  saweria: {
    type: String,
    sparse: true,
  },
});

const depo = model("depo", schema);

module.exports = depo;
