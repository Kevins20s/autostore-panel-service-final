"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const clients = [];
class FakeMongoClient {
    constructor(url) { this.url = url; clients.push(this); }
    connect() {
        return new Promise((resolve, reject) => {
            this.connected = resolve;
            this.failed = reject;
        });
    }
    db(name) { return { url: this.url, name }; }
    async close() { this.closed = true; }
}
const context = {
    module: { exports: {} },
    require: () => ({ MongoClient: FakeMongoClient }),
    setInterval: () => ({ unref() {} }),
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/shopdb.js"), "utf8"), context);
const { getDb, closeConn } = context.module.exports;

(async () => {
    const reads = Array.from({ length: 20 }, () => getDb("hosted:A", "mongo-a", "storeA"));
    assert.equal(clients.length, 1);
    const separate = getDb("hosted:B", "mongo-b", "storeB");
    assert.equal(clients.length, 2);
    clients[0].connected();
    clients[1].connected();
    assert.ok((await Promise.all(reads)).every(db => db.name === "storeA" && db.url === "mongo-a"));
    assert.equal((await separate).name, "storeB");

    const waiting = getDb("C", "old-url", "storeC");
    const rejected = assert.rejects(waiting, /Koneksi toko sudah berubah/);
    const replacement = getDb("C", "new-url", "storeC");
    clients[2].connected();
    clients[3].connected();
    await rejected;
    assert.equal((await replacement).url, "new-url");
    assert.equal(clients[2].closed, true);
    assert.equal(clients[3].closed, undefined);

    const failing = getDb("D", "broken", "storeD");
    const failed = assert.rejects(failing, /connect failed/);
    clients[4].failed(new Error("connect failed"));
    await failed;
    const retry = getDb("D", "fixed", "storeD");
    clients[5].connected();
    assert.equal((await retry).url, "fixed");
    closeConn("D");
    await Promise.resolve();
    assert.equal(clients[5].closed, true);
    console.log("OK: concurrent shop requests share one connection per tenant; replaced and failed connections are closed");
})().catch(error => { console.error(error); process.exitCode = 1; });
