// Koneksi ke MongoDB milik pembeli (satu koneksi per pembeli, ditutup kalau lama tidak dipakai).
const { MongoClient } = require("mongodb");

const conns = new Map(); // licenseId -> { url, client, last }

// Nama koleksi = nama yang dibuat Mongoose di bot (model "list" -> "lists", dst.)
const COL = {
    list: "lists", price: "prices", shop: "shops", bal: "bals",
    discount: "discounts", bulk: "bulkdiscounts", wlrate: "wlrates", mt: "mts", api: "apisettings", orderlog: "orderlogs",
};

async function getDb(id, url, dbName) {
    let c = conns.get(id);
    if (c && c.url !== url) { closeConn(id); c = null; }
    if (!c) {
        const client = new MongoClient(url, { serverSelectionTimeoutMS: 6000, maxPoolSize: 5 });
        c = { url, client, last: Date.now(), ready: client.connect() };
        conns.set(id, c);
        const entry = c;
        entry.ready = entry.ready.catch(async error => {
            if (conns.get(id) === entry) conns.delete(id);
            await client.close().catch(() => {});
            throw error;
        });
    }
    c.last = Date.now();
    await c.ready;
    if (conns.get(id) !== c) throw new Error("Koneksi toko sudah berubah.");
    return c.client.db(dbName);
}

function closeConn(id) {
    const c = conns.get(id);
    if (c) {
        conns.delete(id);
        c.ready.then(() => c.client.close()).catch(() => {});
    }
}

setInterval(() => {
    for (const [id, c] of conns) if (Date.now() - c.last > 10 * 60 * 1000) closeConn(id);
}, 60000).unref();

module.exports = { getDb, closeConn, COL };
