"use strict";

const collection = "storefronts";
const models = Object.freeze({ classic: "classic", model1: "model1" });
const buttons = Object.freeze({
    profile: "storefront_profile", balance: "storefront_balance", history: "storefront_history",
    deposit: "storefront_deposit", qris: "storefront_qris", convert: "storefront_convert",
});
const rupiahCredit = "idr";
const emojiDefaults = Object.freeze({
    profile: "👤", balance: "💰", history: "📜", deposit: "💎", qris: "💳", convert: "🔄", growId: "✏️",
    previous: "⬅️", next: "➡️", confirm: "✅", cart: "🛒", inStock: "✅", outOfStock: "❌",
    discord: "🪪", rupiah: "💵", spent: "🛍️", joined: "🗓️",
});
const customEmoji = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/;
const unicodeEmoji = /^(?:[#*\d]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|\p{Extended_Pictographic}[\p{Emoji_Component}\p{Extended_Pictographic}]*)$/u;
const segmenter = new Intl.Segmenter();

function validEmoji(value) {
    return typeof value === "string" && (customEmoji.test(value) ||
        (value.length <= 32 && unicodeEmoji.test(value) && [...segmenter.segment(value)].length === 1));
}

function resolveEmojis(config, guild) {
    const emojis = { ...emojiDefaults };
    for (const key of Object.keys(emojiDefaults)) {
        const value = config?.[key];
        if (!validEmoji(value)) continue;
        const id = customEmoji.exec(value)?.[3];
        if (!id) {
            emojis[key] = value;
            continue;
        }
        const emoji = guild?.emojis?.cache.get(id);
        if (emoji?.available && (!emoji.roles.cache.size || emoji.roles.cache.some(role => guild.members.me?.roles.cache.has(role.id)))) {
            emojis[key] = emoji.toString();
        }
    }
    return emojis;
}

function componentEmoji(value) {
    const custom = customEmoji.exec(value);
    return custom ? { animated: custom[1] === "a", name: custom[2], id: custom[3] } : { name: value };
}

module.exports = { collection, models, buttons, rupiahCredit, emojiDefaults, validEmoji, resolveEmojis, componentEmoji };
