"use strict";

const pending = new Map();

function changeStorefrontPayment(licenseId, operation) {
    const previous = pending.get(licenseId);
    const current = (previous ? previous.catch(() => {}) : Promise.resolve()).then(operation);
    pending.set(licenseId, current);
    return current.finally(() => {
        if (pending.get(licenseId) === current) pending.delete(licenseId);
    });
}

module.exports = { changeStorefrontPayment };
