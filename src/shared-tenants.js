'use strict';

// Foundation for shared-bot routing. This module is deliberately not wired into
// production startup until command/event handlers have been converted to use a
// tenant-scoped database and config context.
const DISCORD_ID = /^\d{17,20}$/;
const PRODUCTS = new Set(['autostore', 'service']);

function productOf(license) {
    const type = license?.type || 'autostore';
    if (!PRODUCTS.has(type)) throw new Error(`Tipe produk tidak valid: ${type}`);
    return type;
}

/**
 * Build a strict guild -> tenant registry for one shared bot product.
 * `getConfig` must decrypt the license config in the caller; this helper never
 * stores or logs secrets. Duplicate guild bindings fail closed rather than
 * choosing one buyer silently.
 */
function buildTenantRegistry(licenses, product, getConfig) {
    if (!PRODUCTS.has(product)) throw new Error('Produk shared bot tidak valid.');
    if (!Array.isArray(licenses)) throw new TypeError('Daftar license harus berupa array.');
    if (typeof getConfig !== 'function') throw new TypeError('getConfig wajib berupa fungsi.');

    const tenants = new Map();
    for (const license of licenses) {
        if (productOf(license) !== product) continue;
        if (license.revoked || !(Number(license.expiresAt) > Date.now())) continue;
        if (license.runMode !== 'central') continue;

        const cfg = getConfig(license.config, license);
        const guildId = String(cfg?.guildId || '').trim();
        if (!DISCORD_ID.test(guildId)) {
            throw new Error(`License ${license.id || '(tanpa ID)'} mode terpusat wajib memiliki ID server Discord yang valid.`);
        }
        if (!cfg?.mongoUrl || !/^mongodb(?:\+srv)?:\/\//.test(cfg.mongoUrl)) {
            throw new Error(`License ${license.id || '(tanpa ID)'} mode terpusat wajib memiliki MongoDB URL yang valid.`);
        }
        if (tenants.has(guildId)) {
            const existing = tenants.get(guildId);
            throw new Error(`Server Discord ${guildId} terikat ke lebih dari satu license (${existing.licenseId}, ${license.id}).`);
        }
        tenants.set(guildId, Object.freeze({
            licenseId: String(license.id),
            product,
            guildId,
            config: Object.freeze({ ...cfg }),
        }));
    }
    return tenants;
}

function tenantForGuild(registry, guildId) {
    const id = String(guildId || '').trim();
    if (!DISCORD_ID.test(id)) return null;
    return registry.get(id) || null;
}

module.exports = { buildTenantRegistry, tenantForGuild, productOf };
