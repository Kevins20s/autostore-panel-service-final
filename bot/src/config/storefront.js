"use strict";

const collection = "storefronts";
const models = Object.freeze({ classic: "classic", model1: "model1" });
const buttons = Object.freeze({
    profile: "storefront_profile", balance: "storefront_balance", history: "storefront_history",
    deposit: "storefront_deposit", qris: "storefront_qris", convert: "storefront_convert",
});
const rupiahCredit = "idr";
const model1EmojiDefaults = Object.freeze({
    profile: "👤", balance: "💰", history: "📜", deposit: "💎", qris: "💳", convert: "🔄", growId: "✏️",
    previous: "⬅️", next: "➡️", confirm: "✅", cart: "🛒", inStock: "✅", outOfStock: "❌",
    discord: "🪪", rupiah: "💵", spent: "🛍️", joined: "🗓️",
});
const storefrontModel = storefront => storefront?.model === models.model1 ? models.model1 : models.classic;
const emojiFields = model => model === models.model1
    ? { values: "emojis", source: "emojiSourceGuildId" }
    : { values: "classicEmojis", source: "classicEmojiSourceGuildId" };

function emojiDefaultsFor(model) {
    const defaults = require("./configemoji.json");
    const shared = {
        crown: defaults.CROWN, arrow: defaults.ARROW, wl: defaults.WL, sold: defaults.Buy,
        stockAvailable: defaults.Benar, stockEmpty: defaults.Salah, warning: defaults.Warning,
        success: defaults.Benar, price: defaults.Dolar, balanceMark: defaults.BALANCE,
        paymentOk: "✅", paymentWarning: "⚠️", paymentPending: "⏳", paymentCancelled: "⛔",
        paymentCancelButton: "❌", paymentLog: "📥", outOfStock: "❌",
    };
    return model === models.model1 ? { ...shared, ...model1EmojiDefaults } : {
        ...shared, qris: "💳", convert: "🔄", confirm: "✅", previous: "⬅️", next: "➡️",
        profile: "👤", balance: "💰", history: "📜", discord: "🪪", growId: defaults.BOT,
        rupiah: "💵", spent: "🛍️", joined: "🗓️", deposit: "💎",
        growIdButton: "<a:SHRules:1269199498320809996>", balanceButton: "<a:uang:1269199494063456256>",
        depositButton: "<a:planet2:1269199500673683466>", world: defaults.EARTH, bot: defaults.BOT,
        monitor: "<:monitor:1197853474973552691>", online: "<a:online:1197850211914088448>", offline: "<a:offline:1197850388846616586>",
    };
}
const emojiDefaults = Object.freeze(emojiDefaultsFor(models.model1));
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

async function resolveEmojis(config, guild, sourceGuildId, permissions, model = models.model1) {
    const emojis = emojiDefaultsFor(model);
    const configured = Object.keys(emojis).map(key => [key, customEmojiId(config?.[key])]).filter(([, id]) => id);
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

function resolveStorefrontEmojis(storefront, guild, permissions, model = storefrontModel(storefront)) {
    const fields = emojiFields(model);
    return resolveEmojis(storefront?.[fields.values], guild, storefront?.[fields.source], permissions, model);
}

async function interactionEmojis(interaction, model) {
    const guildId = interaction.guildId || interaction.guild?.id;
    if (!guildId) return emojiDefaultsFor(model || models.classic);
    try {
        const storefront = await require("mongoose").connection.collection(collection).findOne({ _id: guildId });
        model ||= storefrontModel(storefront);
        return await resolveStorefrontEmojis(storefront, interaction.guild, interaction.appPermissions, model);
    } catch {
        return emojiDefaultsFor(model || models.classic);
    }
}

function componentEmoji(value) {
    const custom = customEmoji.exec(value);
    return custom ? { animated: custom[1] === "a", name: custom[2], id: custom[3] } : { name: value };
}

module.exports = { collection, models, buttons, rupiahCredit, emojiDefaults, emojiDefaultsFor, storefrontModel, emojiFields,
    customEmojiId, resolveEmojis, resolveStorefrontEmojis, interactionEmojis, componentEmoji };
