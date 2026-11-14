"use strict";

const defaults = require("../bot/src/config/configemoji.json");

const discordId = /^\d{17,20}$/;
const safeText = value => String(value || "").replace(/[<>]/g, "").replace(/([\\*_~`|])/g, "\\$1").replace(/@/g, "@\u200b").slice(0, 100);

function createOrderTestimonial({ env = process.env, discordFetch = global.fetch } = {}) {
    const channelId = env.ORDER_TESTIMONIAL_CHANNEL_ID;
    const token = env.DISCORD_CATALOG_PILOT_TOKEN;
    const botId = env.DISCORD_HOSTED_BOT_CLIENT_ID;
    const enabled = discordId.test(channelId || "") && discordId.test(botId || "") && !!token;

    async function previousMessage(order) {
        let before;
        for (let page = 0; page < 20; page++) {
            const params = new URLSearchParams({ limit: "100" });
            if (before) params.set("before", before);
            const response = await discordFetch(`https://discord.com/api/v10/channels/${channelId}/messages?${params}`, {
                headers: { Authorization: "Bot " + token }, signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) throw new Error("Testimonial history HTTP " + response.status);
            const messages = await response.json();
            const existing = messages.find(message => message.author?.id === botId &&
                Date.parse(message.timestamp) >= order.confirmedAt - 60000 &&
                message.embeds?.some(embed => embed.title === "#Order Number: " + order.code));
            if (existing) return existing.id;
            const last = messages.at(-1);
            if (messages.length < 100 || Date.parse(last.timestamp) < order.confirmedAt - 60000) return null;
            if (!discordId.test(last.id) || last.id === before) throw new Error("Invalid testimonial history page");
            before = last.id;
        }
        throw new Error("Testimonial history needs manual review before retrying");
    }

    async function send(order) {
        if (!enabled) throw new Error("Order testimonial is not configured");
        if (order.retry) {
            const existing = await previousMessage(order);
            if (existing) return existing;
        }
        const duration = order.lifetime ? "Lifetime" : ({ 30: "1 bulan", 90: "3 bulan", 365: "1 tahun" }[order.days] || order.days + " hari");
        const buyer = discordId.test(order.discordId || "") ? `<@${order.discordId}>` : safeText(order.buyer) || "Pembeli web";
        let price = "Rp" + order.amount.toLocaleString("id-ID");
        if (order.paymentMethod === "dl") {
            price += ` (${Math.floor(order.amountWL / 100)} DL ${order.amountWL % 100} WL)`;
        }
        const description = `${defaults.ARROW} Buyer: **${buyer}**\n` +
            `${defaults.ARROW} Product: **${safeText(order.packageName)} · ${duration}**\n` +
            `${defaults.ARROW} Quantity: **1**\n` +
            `${defaults.ARROW} Total Price: **${price}**\n\n` +
            `**Thanks For Purchasing Our Product** ${defaults.Benar}`;
        const embed = {
            title: "#Order Number: " + order.code,
            description,
            color: Number.parseInt(defaults.COLOR.replace(/^#/, ""), 16),
            timestamp: new Date(order.confirmedAt).toISOString(),
        };
        if (defaults.imageUrl) embed.image = { url: defaults.imageUrl };
        const response = await discordFetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: "POST",
            headers: { Authorization: "Bot " + token, "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] }, nonce: "license-" + order.id, enforce_nonce: true }),
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("Order testimonial HTTP " + response.status);
        const message = await response.json();
        if (!discordId.test(message.id || "")) throw new Error("Invalid testimonial message response");
        return message.id;
    }

    return { enabled, send };
}

module.exports = { createOrderTestimonial };
