// Koneksi ke MongoDB milik pembeli (satu koneksi per pembeli, ditutup kalau lama tidak dipakai).
const { MongoClient } = require("mongodb");

const conns = new Map(); // licenseId -> { url, client, last }

// Nama koleksi = nama yang dibuat Mongoose di bot (model "list" -> "lists", dst.)
const COL = {
    list: "lists", price: "prices", shop: "shops", bal: "bals",
    discount: "discounts", bulk: "bulkdiscounts", wlrate: "wlrates", mt: "mts", api: "apisettings",
    orders: "orderhistories", // riwayat order, ditulis bot (bot/src/Schema/orderhistory.js)
};

async function getDb(id, url) {
    let c = conns.get(id);
    if (c && c.url !== url) { await c.client.close().catch(() => {}); conns.delete(id); c = null; }
    if (!c) {
        const client = new MongoClient(url, { serverSelectionTimeoutMS: 6000, maxPoolSize: 5 });
        await client.connect();
        c = { url, client, last: 0 };
        conns.set(id, c);
    }
    c.last = Date.now();
    return c.client.db();
}

function closeConn(id) {
    const c = conns.get(id);
    if (c) { c.client.close().catch(() => {}); conns.delete(id); }
}

setInterval(() => {
    for (const [id, c] of conns) if (Date.now() - c.last > 10 * 60 * 1000) closeConn(id);
}, 60000).unref();

module.exports = { getDb, closeConn, COL };
