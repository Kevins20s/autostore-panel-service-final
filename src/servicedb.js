const { MongoClient } = require("mongodb");

const cache = new Map();

async function getServiceDb(licenseId, mongoUrl) {
    if (!mongoUrl) throw new Error("MongoDB URL belum diatur.");

    const cur = cache.get(licenseId);
    if (cur && cur.uri === mongoUrl) {
        try {
            await cur.client.db().command({ ping: 1 });
            return cur.client.db();
        } catch {
            await closeServiceDb(licenseId);
        }
    }

    const client = new MongoClient(mongoUrl, {
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000,
    });
    await client.connect();
    await client.db().command({ ping: 1 });
    cache.set(licenseId, { uri: mongoUrl, client });
    return client.db();
}

async function closeServiceDb(licenseId) {
    const cur = cache.get(licenseId);
    if (!cur) return;
    cache.delete(licenseId);
    await cur.client.close().catch(() => {});
}

async function closeAllServiceDb() {
    const ids = [...cache.keys()];
    await Promise.all(ids.map(closeServiceDb));
}

module.exports = { getServiceDb, closeServiceDb, closeAllServiceDb };
