'use strict';

const { createHash } = require('node:crypto');

// Foundation for shared-bot routing. This module is deliberately not wired into
// production startup until command/event handlers have been converted to use a
// tenant-scoped database and config context.
const DISCORD_ID = /^\d{17,20}$/;
const PRODUCTS = new Set(['autostore', 'service']);
const hostedDbName = (product, licenseId) =>
    'gevra_' + createHash('sha256').update(`${product}:${licenseId}`).digest('hex').slice(0, 32);

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
function buildTenantRegistry(licenses, product, getConfig, { hostedMongoUrl } = {}) {
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
        const licenseId = String(license.id || '');
        if (!licenseId) throw new Error('License mode terpusat wajib memiliki ID.');
        const mongoUrl = hostedMongoUrl ?? cfg?.mongoUrl;
        if (typeof mongoUrl !== 'string' || !/^mongodb(?:\+srv)?:\/\//.test(mongoUrl)) {
            throw new Error(`License ${license.id || '(tanpa ID)'} mode terpusat wajib memiliki MongoDB URL yang valid.`);
        }
        if (tenants.has(guildId)) {
            const existing = tenants.get(guildId);
            throw new Error(`Server Discord ${guildId} terikat ke lebih dari satu license (${existing.licenseId}, ${license.id}).`);
        }
        const dbName = hostedMongoUrl != null
            ? hostedDbName(product, licenseId)
            : undefined;
        tenants.set(guildId, Object.freeze({
            licenseId,
            product,
            guildId,
            dbName,
            config: Object.freeze({ ...cfg, mongoUrl }),
        }));
    }
    return tenants;
}

function tenantForGuild(registry, guildId) {
    const id = String(guildId || '').trim();
    if (!DISCORD_ID.test(id)) return null;
    return registry.get(id) || null;
}

// Keep the databases created by the original two-server pilot.
function pilotTenant(license, env = process.env) {
    const guildId = license?.hostedBot?.guildId;
    const index = (env.DISCORD_HOSTED_PILOT_GUILD_IDS || "").split(",").indexOf(guildId);
    const namespace = env.DISCORD_HOSTED_PILOT_DB_NAMESPACE;
    const mongoUrl = env.DISCORD_CATALOG_PILOT_MONGO_URL;
    if (!license?.hostedBot?.enabled || license.type === "service" || license.revoked ||
        !(license.expiresAt > Date.now()) || license.id !== env.DISCORD_HOSTED_PILOT_LICENSE_ID ||
        !DISCORD_ID.test(guildId) || index < 0 || !namespace || !mongoUrl) return null;
    const licenseId = namespace + "-" + index;
    return { licenseId, guildId, dbName: hostedDbName("autostore", licenseId), config: { mongoUrl } };
}

module.exports = { buildTenantRegistry, tenantForGuild, productOf, hostedDbName, pilotTenant };
