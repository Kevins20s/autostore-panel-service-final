const { Schema, model } = require("mongoose")

const schema = new Schema({
    ChanelTesti: String,
    ChannelDonation: String,
    ChannelStock: String,
    ChannelRestock: String,
    MessageID: String,
    QrisImageChannelId: String,
    QrisImageMessageId: String,
});

const setchannel = model("setchannel", schema)

module.exports = setchannel
