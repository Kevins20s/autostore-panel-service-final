"use strict";

const { Schema, model } = require("mongoose");

const claim = new Schema({
    requestId: { type: String, required: true },
    start: { type: Number, required: true },
    quantity: { type: Number, required: true },
    createdAt: { type: Date, required: true },
}, { _id: false });

const schema = new Schema({
    guildId: { type: String, required: true, index: true },
    requestId: { type: String, required: true },
    code: { type: String, required: true },
    buyerId: { type: String, required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1, max: 10000 },
    status: { type: String, enum: ["open", "closed", "cancelled"], default: "open" },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    ticketLeaseUntil: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    paidBy: String,
    handledBy: { type: String, default: null },
    items: { type: [String], default: [] },
    depositedQty: { type: Number, default: 0 },
    collectedQty: { type: Number, default: 0 },
    dataBytes: { type: Number, default: 0 },
    depositRequests: { type: [String], default: [] },
    claims: { type: [claim], default: [] },
    summaryDirty: { type: Boolean, default: true },
    revision: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    closedAt: Date,
    closedBy: String,
    cancelReason: String,
});
schema.index({ guildId: 1, requestId: 1 }, { unique: true });
schema.index({ guildId: 1, code: 1 }, { unique: true });
schema.index({ guildId: 1, buyerId: 1, status: 1 });

const settings = new Schema({
    guildId: { type: String, required: true, unique: true },
    panelChannelId: String,
    panelMessageId: String,
    categoryId: String,
    staffRoleId: { type: String, default: null },
    panelPage: { type: Number, default: 0 },
    panelDirty: { type: Boolean, default: true },
    panelRevision: { type: Number, default: 0 },
});

module.exports = { Order: model("preorder", schema), Settings: model("preordersetting", settings) };
