// Tes rute baru shopapi (riwayat order, statistik, buang duplikat stok) dengan database tiruan: node test/shopapi-fake.js
// Yang diuji: bentuk respons dan alur kode. Sintaks pipeline MongoDB tetap perlu diuji ke database asli (test/shop.js dengan SHOP_TEST_MONGO).
const assert = require("assert"), http = require("http"), express = require("express");
const shopdb = require("../src/shopdb");

const inserted = []; let lastFind = null;
const cur = (rows) => { const c = { sort: () => c, skip: () => c, limit: () => c, project: () => c, toArray: async () => rows }; return c; };
const now = Date.now();
const cols = {
    lists: { findOne: async (f) => ({ code: f.code }), find: () => cur([{ code: "P1", name: "Akun A" }, { code: "P2", name: "Akun B" }, { code: "P3", name: "Akun C" }]) },
    prices: { find: () => cur([{ code: "P1", price: 1000 }, { code: "P2", price: 2000 }]) }, // P3 belum ada harga
    shops: {
        aggregate: () => ({ toArray: async () => [{ _id: "P1", n: 1 }, { _id: "P2", n: 10 }] }),
        find: (f) => { lastFind = f; return cur([{ data: "sudah-ada" }]); },
        insertMany: async (docs) => { inserted.push(...docs); },
    },
    orderlogs: {
        countDocuments: async () => 2,
        find: () => cur([{ orderNumber: 7, discordId: "111", growId: "Budi", code: "P2", productName: "Akun B", qty: 2, total: 4000, createdAt: new Date(now) }, { code: "P1", qty: 1, total: 900, createdAt: new Date(now - 864e5) }]),
        aggregate: (p) => ({ toArray: async () => {
            const g = p.find((s) => s.$group)?.$group;
            if (g._id === null) return [{ _id: null, qty: 3, wl: 4900 }];
            if (g._id.$dateToString) { assert.strictEqual(g._id.$dateToString.timezone, "Asia/Jakarta"); return [{ _id: "2026-11-04", orders: 1, qty: 1, wl: 900 }, { _id: "2026-11-05", orders: 1, qty: 2, wl: 4000 }]; }
            return [{ _id: "P2", name: "Akun B", qty: 2, wl: 4000 }];
        } }),
    },
};
shopdb.getDb = async () => ({ collection: (n) => cols[n] });
const createShopRouter = require("../src/shopapi");

const app = express(); app.use(express.json());
app.use("/api/shop", (req, res, next) => { req.lic = { id: "L1", config: { x: 1 } }; next(); }, createShopRouter({ valid: () => true, decrypt: () => ({ mongoUrl: "mongodb://tiruan" }) }));
const srv = http.createServer(app).listen(0, async () => {
    const base = `http://127.0.0.1:${srv.address().port}/api/shop`;
    const j = async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
    try {
        const o = await j("GET", "/orders?q=" + encodeURIComponent("a.b(")); // karakter regex harus di-escape
        assert.strictEqual(o.s, 200); assert.strictEqual(o.j.total, 2); assert.strictEqual(o.j.wl, 4900); assert.strictEqual(o.j.qty, 3);
        assert.deepStrictEqual(o.j.orders[0], { number: 7, discordId: "111", growId: "Budi", code: "P2", name: "Akun B", qty: 2, total: 4000, at: now });
        assert.strictEqual(o.j.orders[1].number, null);
        console.log("ok  /orders: bentuk respons, ringkasan, pencarian aman");

        const s = await j("GET", "/stats?days=14");
        assert.strictEqual(s.s, 200); assert.strictEqual(s.j.days, 14); assert.strictEqual(s.j.daily.length, 2); assert.strictEqual(s.j.top[0].code, "P2");
        assert.deepStrictEqual(s.j.low, [{ code: "P1", name: "Akun A", stock: 1 }], "stok menipis: hanya produk berharga dengan stok <= 3 (P3 tanpa harga tidak ikut)");
        const s2 = await j("GET", "/stats?days=9999&lowAt=-5"); assert.strictEqual(s2.j.days, 90, "days dibatasi 90"); assert.strictEqual(s2.j.lowAt, 0, "lowAt negatif dibatasi ke 0");
        console.log("ok  /stats: harian, terlaris, stok menipis, batas parameter");

        const a = await j("POST", "/products/P2/stock", { text: "a\nb\nsudah-ada\na", dedupe: true });
        assert.strictEqual(a.s, 200); assert.strictEqual(a.j.added, 2); assert.strictEqual(a.j.skipped, 2);
        assert.deepStrictEqual(inserted.map((d) => d.data), ["a", "b"]); assert.deepStrictEqual(lastFind.data.$in.sort(), ["a", "b", "sudah-ada"]);
        inserted.length = 0;
        const b = await j("POST", "/products/P2/stock", { text: "x\nx" });
        assert.strictEqual(b.j.added, 2, "tanpa dedupe, perilaku lama dipertahankan"); assert.strictEqual(b.j.skipped, 0);
        const c = await j("POST", "/products/P2/stock", { text: "sudah-ada", dedupe: true });
        assert.strictEqual(c.s, 400); assert.match(c.j.error, /duplikat/i);
        console.log("ok  stok: opsi buang duplikat (dan tanpa opsi = perilaku lama)");
        console.log("\nSemua tes shopapi (tiruan) lulus.");
    } catch (e) { console.error("GAGAL:", e); process.exitCode = 1; }
    srv.close();
});
