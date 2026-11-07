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

const csv = value => (value || "").split(",").map(item => item.trim()).filter(Boolean);

function eligibleHostedLicense(license, env = process.env) {
    return !!(license?.id && (license.type || "autostore") === "autostore" && !license.revoked &&
        Number(license.expiresAt) > Date.now() && env.DISCORD_CATALOG_PILOT_MONGO_URL &&
        (license.id === env.DISCORD_HOSTED_PILOT_LICENSE_ID ||
            csv(env.DISCORD_HOSTED_TEST_LICENSE_IDS).includes(license.id)));
}

function eligibleHostedGuild(guildId, license, env = process.env) {
    if (!DISCORD_ID.test(guildId)) return false;
    if (csv(env.DISCORD_HOSTED_PILOT_GUILD_IDS).includes(guildId)) return true;
    return env.DISCORD_HOSTED_TEST_MANAGED_GUILDS === "1" &&
        license?.id !== env.DISCORD_HOSTED_PILOT_LICENSE_ID &&
        csv(env.DISCORD_HOSTED_TEST_LICENSE_IDS).includes(license?.id);
}

// Reserve a saved server even when its license is paused or expired. This
// prevents renewal or reactivation from displacing another shop.
function hostedGuildClaimed(guildId, licenseId, licenses) {
    return licenses.some(item => item.id !== licenseId && item.hostedBot?.guildId === guildId);
}

function hostedTenant(license, licenses = [], env = process.env) {
    const guildId = license?.hostedBot?.guildId;
    if (!license?.hostedBot?.enabled || !eligibleHostedLicense(license, env) ||
        !eligibleHostedGuild(guildId, license, env) || hostedGuildClaimed(guildId, license.id, licenses)) return null;
    const legacy = license.id === env.DISCORD_HOSTED_PILOT_LICENSE_ID;
    const namespace = env.DISCORD_HOSTED_PILOT_DB_NAMESPACE;
    if (legacy && !namespace) return null;
    // Keep existing pilot data and receipts at their original addresses.
    const tenantId = legacy ? namespace + "-" + csv(env.DISCORD_HOSTED_PILOT_GUILD_IDS).indexOf(guildId)
        : license.id + ":" + guildId;
    return { licenseId: license.id, tenantId, guildId, legacy, dbName: hostedDbName("autostore", tenantId),
        config: { mongoUrl: env.DISCORD_CATALOG_PILOT_MONGO_URL } };
}

function pilotTenant(license, env = process.env) {
    if (license?.id !== env.DISCORD_HOSTED_PILOT_LICENSE_ID) return null;
    const tenant = hostedTenant(license, [], env);
    return tenant && { ...tenant, licenseId: tenant.tenantId };
}

module.exports = { buildTenantRegistry, tenantForGuild, productOf, hostedDbName, pilotTenant,
    eligibleHostedLicense, eligibleHostedGuild, hostedGuildClaimed, hostedTenant };
