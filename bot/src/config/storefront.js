"use strict";

const collection = "storefronts";
const models = Object.freeze({ classic: "classic", model1: "model1" });
const buttons = Object.freeze({
    profile: "storefront_profile", balance: "storefront_balance", history: "storefront_history",
    deposit: "storefront_deposit", qris: "storefront_qris", convert: "storefront_convert",
});
const rupiahCredit = "idr";

module.exports = { collection, models, buttons, rupiahCredit };
