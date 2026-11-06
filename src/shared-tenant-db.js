'use strict';

/**
 * Tenant-scoped Mongoose connection manager for shared-bot mode.
 *
 * This module intentionally does not import the application's legacy schema
 * modules: those currently register models on the process-global Mongoose
 * singleton. Callers must supply schema factories and pass the returned tenant
 * context into every command/event. It is not safe to wire this into legacy
 * handlers until that conversion is complete.
 */
const DISCORD_ID = /^\d{17,20}$/;
const PRODUCTS = new Set(['autostore', 'service']);

function createTenantDbManager(mongoose, options = {}) {
    if (!mongoose || typeof mongoose.createConnection !== 'function') {
        throw new TypeError('Mongoose instance dengan createConnection wajib diberikan.');
    }
    const connectTimeoutMS = Number.isInteger(options.connectTimeoutMS) ? options.connectTimeoutMS : 10000;
    const serverSelectionTimeoutMS = Number.isInteger(options.serverSelectionTimeoutMS) ? options.serverSelectionTimeoutMS : 10000;
    const cache = new Map();

    function keyFor(tenant) {
        if (!tenant || !tenant.licenseId || !tenant.guildId || !tenant.product) {
            throw new TypeError('Konteks tenant wajib berisi licenseId, guildId, dan product.');
        }
        if (!DISCORD_ID.test(String(tenant.guildId)) || !PRODUCTS.has(tenant.product)) {
            throw new TypeError('Konteks tenant memiliki ID server atau produk yang tidak valid.');
        }
        if (!tenant.config || typeof tenant.config.mongoUrl !== 'string' || !/^mongodb(?:\+srv)?:\/\//.test(tenant.config.mongoUrl)) {
            throw new TypeError('Tenant MongoDB URL tidak valid.');
        }
        // License ID is the identity. Guild/product are also included to fail
        // closed if an ID is accidentally reused for a different tenant.
        return `${tenant.product}:${tenant.guildId}:${tenant.licenseId}`;
    }

    async function get(tenant, schemaFactories = {}) {
        const key = keyFor(tenant);
        let item = cache.get(key);
        if (!item) {
            const connection = mongoose.createConnection(tenant.config.mongoUrl, {
                ...(tenant.dbName ? { dbName: tenant.dbName } : {}),
                connectTimeoutMS,
                serverSelectionTimeoutMS,
                maxPoolSize: 5,
                appName: `autostore-${tenant.product}-${tenant.licenseId}`,
            });
            item = { key, licenseId: String(tenant.licenseId), guildId: String(tenant.guildId), product: tenant.product, connection, ready: null, models: Object.create(null) };
            item.ready = Promise.resolve(connection.asPromise()).catch((err) => {
                cache.delete(key);
                try { connection.destroy?.(); } catch {}
                throw err;
            });
            cache.set(key, item);
        }
        await item.ready;
        for (const [name, factory] of Object.entries(schemaFactories)) {
            if (typeof factory !== 'function') throw new TypeError(`Schema factory ${name} wajib berupa fungsi.`);
            if (!item.models[name]) {
                const schema = factory(mongoose);
                if (!schema) throw new TypeError(`Schema factory ${name} tidak mengembalikan schema.`);
                item.models[name] = item.connection.models?.[name] || item.connection.model(name, schema);
            }
        }
        return Object.freeze({
            licenseId: item.licenseId,
            guildId: item.guildId,
            product: item.product,
            connection: item.connection,
            models: Object.freeze({ ...item.models }),
        });
    }

    async function closeTenant(tenant) {
        const key = keyFor(tenant);
        const item = cache.get(key);
        if (!item) return false;
        cache.delete(key);
        try { await item.ready; } catch { /* failed connection is already being removed */ }
        await item.connection.close();
        return true;
    }

    async function closeAll() {
        const items = [...cache.values()];
        cache.clear();
        await Promise.all(items.map(async (item) => {
            try { await item.ready; } catch { /* still attempt close */ }
            try { await item.connection.close(); } catch { /* best-effort shutdown */ }
        }));
    }

    return Object.freeze({ get, closeTenant, closeAll, size: () => cache.size });
}

module.exports = { createTenantDbManager };
