"use strict";

const collection = "storefronts";
const models = Object.freeze({ classic: "classic", model1: "model1", model2: "model2", model3: "model3" });
const qrisBuyPrefix = "storefront_qris_buy:";
const qrisSelectId = "storefront_qris_select";
const qrisPagePrefix = "storefront_qris_page:";
const qrisPriceMin = 1000;
const qrisPriceMax = 1000000;
const validQrisPrice = price => Number.isSafeInteger(price) && price >= qrisPriceMin && price <= qrisPriceMax;
const buttons = Object.freeze({
    profile: "storefront_profile", balance: "storefront_balance", history: "storefront_history",
    deposit: "storefront_deposit", qris: "storefront_qris", convert: "storefront_convert",
});
const menuId = "storefront_menu";
const menuActions = Object.freeze([
    ["growid23", "Set GrowID", "Set your GrowID", "growIdButton"],
    ["deposit", "Deposit", "View deposit info", "depositButton"],
    ["depositqris_btn", "Deposit QRIS", "Top-up via QRIS", "qris"],
    ["balance1", "Balance", "Check balance", "balanceButton"],
]);
const hostedPresets = {
    [models.model1]: require("./model1-emoji-preset.json"),
    [models.model2]: require("./model2-emoji-preset.json"),
};
const rupiahCredit = "idr";
const model1EmojiDefaults = Object.freeze({
    profile: "👤", balance: "💰", history: "📜", deposit: "💎", qris: "💳", convert: "🔄", growId: "✏️",
    previous: "⬅️", next: "➡️", confirm: "✅", cart: "🛒", inStock: "✅", outOfStock: "❌",
    discord: "🪪", rupiah: "💵", spent: "🛍️", joined: "🗓️",
});
const storefrontModel = storefront => Object.hasOwn(models, storefront?.model) ? models[storefront.model] : models.classic;
const discordBannerUrl = url => /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\//.test(url) ? url.split("?")[0] : url;
const storefrontBannerUrl = storefront => discordBannerUrl(storefront?.bannerUrl || require("./configemoji.json").imageUrl2);
const modelEmojiFields = {
    [models.classic]: { values: "classicEmojis", source: "classicEmojiSourceGuildId" },
    [models.model1]: { values: "emojis", source: "emojiSourceGuildId" },
    [models.model2]: { values: "model2Emojis", source: "model2EmojiSourceGuildId" },
    [models.model3]: { values: "model3Emojis", source: "model3EmojiSourceGuildId" },
};
const emojiFields = model => modelEmojiFields[model];

function storefrontAction(interaction, guildId) {
    if (interaction.customId !== menuId) return interaction.customId;
    if (interaction.guildId !== guildId || !interaction.isStringSelectMenu()) return;
    const value = interaction.values[0];
    return menuActions.some(([id]) => id === value) ? value : undefined;
}

function emojiDefaultsFor(model, hosted = false) {
    const defaults = require("./configemoji.json");
    const shared = {
        crown: defaults.CROWN, arrow: defaults.ARROW, wl: defaults.WL, sold: defaults.Buy,
        stockAvailable: defaults.Benar, stockEmpty: defaults.Salah, warning: defaults.Warning,
        success: defaults.Benar, price: defaults.Dolar, balanceMark: defaults.BALANCE,
        paymentOk: "✅", paymentWarning: "⚠️", paymentPending: "⏳", paymentCancelled: "⛔",
        paymentCancelButton: "❌", paymentLog: "📥", cart: "🛒", inStock: "✅", outOfStock: "❌",
    };
    const base = model === models.model1 ? { ...shared, ...model1EmojiDefaults } : {
        ...shared, qris: "💳", convert: "🔄", confirm: "✅", previous: "⬅️", next: "➡️",
        profile: "👤", balance: "💰", history: "📜", discord: "🪪", growId: defaults.BOT,
        rupiah: "💵", spent: "🛍️", joined: "🗓️", deposit: "💎",
        growIdButton: "<a:SHRules:1269199498320809996>", balanceButton: "<a:uang:1269199494063456256>",
        depositButton: "<a:planet2:1269199500673683466>", world: defaults.EARTH, bot: defaults.BOT,
        monitor: "<:monitor:1197853474973552691>", online: "<a:online:1197850211914088448>", offline: "<a:offline:1197850388846616586>",
        ...([models.model2, models.model3].includes(model) ? { growIdButton: "⚙️", depositButton: "🌍", balanceButton: "💰" } : {}),
    };
    return hosted ? { ...base, ...hostedPresets[model] } : base;
}
const emojiDefaults = Object.freeze(emojiDefaultsFor(models.model1));
const restockEmojiDefaults = Object.freeze({ restockTitle: "✅", restockProduct: "🎁", restockQuantity: "🟢" });
const hostedRestockEmojiDefaults = Object.freeze({
    restockTitle: "<a:Benar:1568807352159838281>",
    restockProduct: "<:productdet:1568808022988423220>",
    restockQuantity: "<a:a_online:1568807334707204177>",
});
const restockDefaultsFor = hosted => hosted ? hostedRestockEmojiDefaults : restockEmojiDefaults;
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

async function resolveConfiguredEmojis(emojis, preset, config, guild, sourceGuildId, permissions) {
    const configured = Object.keys(emojis).map(key => [key, customEmojiId(config?.[key]), customEmojiId(preset[key])]);
    const source = sourceGuildId && sourceGuildId === process.env.DISCORD_HOSTED_EMOTE_SOURCE_GUILD_ID && permissions?.has("UseExternalEmojis")
        ? guild?.client?.guilds?.cache.get(sourceGuildId) : null;
    const owned = configured.some(([, id, presetId]) => presetId || (id && !guild?.emojis?.cache.has(id) && !source?.emojis?.cache.has(id)))
        ? await applicationEmojis(guild) : null;
    for (const [key, id, presetId] of configured) {
        const override = id && (availableGuildEmoji(guild, id) || owned?.get(id) || availableGuildEmoji(source, id));
        const emoji = override || (presetId && owned?.get(presetId));
        if (emoji) emojis[key] = emoji.toString();
    }
    return emojis;
}

function resolveEmojis(config, guild, sourceGuildId, permissions, model = models.model1) {
    const preset = (process.env.HOSTED_PILOT_BINDING && hostedPresets[model]) || {};
    return resolveConfiguredEmojis(emojiDefaultsFor(model), preset, config, guild, sourceGuildId, permissions);
}

function resolveRestockEmojis(storefront, guild, permissions) {
    const preset = process.env.HOSTED_PILOT_BINDING ? hostedRestockEmojiDefaults : {};
    return resolveConfiguredEmojis({ ...restockEmojiDefaults }, preset, storefront?.restockEmojis, guild, storefront?.restockEmojiSourceGuildId, permissions);
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
        const active = storefrontModel(storefront);
        if (!model || (model === models.classic && [models.model2, models.model3].includes(active))) model = active;
        return await resolveStorefrontEmojis(storefront, interaction.guild, interaction.appPermissions, model);
    } catch {
        return emojiDefaultsFor(model || models.classic);
    }
}

function componentEmoji(value) {
    const custom = customEmoji.exec(value);
    return custom ? { animated: custom[1] === "a", name: custom[2], id: custom[3] } : { name: value };
}

module.exports = { collection, models, buttons, menuId, menuActions, qrisBuyPrefix, qrisSelectId, qrisPagePrefix, storefrontAction, rupiahCredit, emojiDefaults, emojiDefaultsFor, storefrontModel, storefrontBannerUrl, emojiFields,
    customEmojiId, resolveEmojis, resolveStorefrontEmojis, restockDefaultsFor, resolveRestockEmojis, interactionEmojis, componentEmoji, qrisPriceMin, qrisPriceMax, validQrisPrice };
