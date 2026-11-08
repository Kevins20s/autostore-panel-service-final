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
const applicationEmojiLists = new WeakMap();

function customEmojiId(value) {
    return typeof value === "string" && value === value.trim() ? customEmoji.exec(value)?.[3] : undefined;
}

function applicationEmojis(guild) {
    const manager = guild?.client?.application?.emojis;
    if (!manager) return null;
    const current = applicationEmojiLists.get(manager);
    if (current && current.until > Date.now()) return current.list;
    const list = manager.fetch().catch(() => null);
    applicationEmojiLists.set(manager, { list, until: Date.now() + 30000 });
    return list;
}

function availableGuildEmoji(guild, id) {
    const emoji = guild?.emojis?.cache.get(id);
    if (emoji?.available && (!emoji.roles.cache.size || emoji.roles.cache.some(role => guild.members.me?.roles.cache.has(role.id)))) return emoji;
}

async function resolveEmojis(config, guild, sourceGuildId, permissions) {
    const emojis = { ...emojiDefaults };
    const configured = Object.keys(emojiDefaults).map(key => [key, customEmojiId(config?.[key])]).filter(([, id]) => id);
    const source = sourceGuildId && sourceGuildId === process.env.DISCORD_HOSTED_EMOTE_SOURCE_GUILD_ID && permissions?.has("UseExternalEmojis")
        ? guild?.client?.guilds?.cache.get(sourceGuildId) : null;
    const owned = configured.some(([, id]) => !guild?.emojis?.cache.has(id) && !source?.emojis?.cache.has(id))
        ? await applicationEmojis(guild) : null;
    for (const [key, id] of configured) {
        const emoji = availableGuildEmoji(guild, id) || owned?.get(id) || availableGuildEmoji(source, id);
        if (emoji) emojis[key] = emoji.toString();
    }
    return emojis;
}

function componentEmoji(value) {
    const custom = customEmoji.exec(value);
    return custom ? { animated: custom[1] === "a", name: custom[2], id: custom[3] } : { name: value };
}

module.exports = { collection, models, buttons, rupiahCredit, emojiDefaults, customEmojiId, resolveEmojis, componentEmoji };
