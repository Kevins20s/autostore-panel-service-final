"use strict";

const scale = 1000000n;

function conversionQuote(balanceRp, rate) {
    const scaledRate = Math.round(rate * Number(scale));
    if (!Number.isSafeInteger(balanceRp) || balanceRp < 0 ||
        !Number.isSafeInteger(scaledRate) || scaledRate < 1) return null;
    const price = BigInt(scaledRate);
    const units = BigInt(balanceRp) * scale / price;
    if (units > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const cost = Number((units * price + scale - 1n) / scale);
    return { rate: scaledRate / Number(scale), wl: Number(units), cost, remaining: balanceRp - cost };
}

module.exports = { conversionQuote };
