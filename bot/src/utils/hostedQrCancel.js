"use strict";

const prefix = "qriscancel_";

function hostedQrCancelId(guildId, orderId) {
    return prefix + guildId + ":" + orderId;
}

function readHostedQrCancelId(customId, guildId, legacy) {
    if (typeof customId !== "string" || !customId.startsWith(prefix)) return null;
    const payload = customId.slice(prefix.length);
    const scope = guildId + ":";
    if (payload.startsWith(scope)) return payload.slice(scope.length) || null;
    return legacy && payload && !payload.includes(":") ? payload : null;
}

module.exports = { hostedQrCancelId, readHostedQrCancelId };
