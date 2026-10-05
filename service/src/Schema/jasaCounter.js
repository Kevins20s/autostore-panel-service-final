const { Schema, model } = require("mongoose");

const schema = new Schema({
    count: { type: Number, default: 0 },
});

module.exports = model("jasaCounter", schema);
