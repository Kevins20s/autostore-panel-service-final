// Tes rute baru shopapi (riwayat order, statistik, buang duplikat stok) dengan database tiruan: node test/shopapi-fake.js
// Yang diuji: bentuk respons dan alur kode. Sintaks pipeline MongoDB tetap perlu diuji ke database asli (test/shop.js dengan SHOP_TEST_MONGO).
const assert = require("assert"), http = require("http"), express = require("express");
const shopdb = require("../src/shopdb");
const { emojiDefaults, resolveEmojis, componentEmoji } = require("../bot/src/config/storefront");

const inserted = []; let lastFind = null;
const cur = (rows) => { const c = { sort: () => c, skip: () => c, limit: () => c, project: () => c, toArray: async () => rows }; return c; };
const now = Date.now();
const storefronts = new Map();
const guildA = "123456789012345678", guildB = "223456789012345678";
const botId = "323456789012345678", serverEmoteId = "423456789012345678", botEmoteId = "523456789012345678";
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
    if (!url.startsWith("https://discord.com/api/v10/")) return nativeFetch(url, options);
    const path = new URL(url).pathname;
    if (path.endsWith(`/applications/${botId}/emojis`)) return Promise.resolve(Response.json({ items: [{ id: botEmoteId, name: "bot_gem" }] }));
    if (path.endsWith(`/guilds/${guildA}/emojis`)) return Promise.resolve(Response.json([
        { id: serverEmoteId, name: "gem", animated: true }, { id: "623456789012345678", name: "locked", roles: [guildA] },
    ]));
    if (path.endsWith(`/guilds/${guildB}/emojis`)) return Promise.resolve(Response.json([]));
    return Promise.resolve(new Response(null, { status: 404 }));
};
const cols = {
    mts: { findOne: async () => null },
    wlrates: { findOne: async () => null },
    apisettings: { findOne: async () => null },
    storefronts: {
        findOne: async ({ _id }) => storefronts.get(_id),
        updateOne: async ({ _id }, { $set }) => storefronts.set(_id, { ...storefronts.get(_id), ...$set }),
    },
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
app.use("/api/shop", (req, res, next) => {
    const guildId = req.get("X-Test-Store") === "B" ? guildB : guildA;
    req.lic = { id: guildId, config: { guildId, mongoUrl: "mongodb://tiruan", clientId: botId, botToken: "synthetic" } };
    next();
}, createShopRouter({ valid: () => true, decrypt: config => config }));
const srv = http.createServer(app).listen(0, async () => {
    const base = `http://127.0.0.1:${srv.address().port}/api/shop`;
    const j = async (m, u, b, store = "A") => { const r = await fetch(base + u, { method: m, headers: { "Content-Type": "application/json", "X-Test-Store": store }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
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

        assert.deepStrictEqual((await j("GET", "/settings")).j.storefront, { guildId: guildA, model: "classic" });
        assert.strictEqual((await j("PUT", "/settings/storefront", { guildId: guildA, model: "model1" })).s, 200);
        assert.strictEqual((await j("PUT", "/settings/storefront", { guildId: guildA, model: "invalid" })).s, 400);
        assert.strictEqual((await j("PUT", "/settings/storefront", { guildId: guildA, model: "classic" }, "B")).s, 409);
        assert.deepStrictEqual((await j("GET", "/settings")).j.storefront, { guildId: guildA, model: "model1" });
        assert.deepStrictEqual((await j("GET", "/settings", null, "B")).j.storefront, { guildId: guildB, model: "classic" });
        console.log("ok  /settings/storefront: default klasik, simpan, validasi, dan isolasi server");

        const emojiPath = "/settings/storefront/emojis";
        const custom = `<a:gem:${serverEmoteId}>`, botEmote = `<:bot_gem:${botEmoteId}>`;
        const settings = { profile: botEmote, qris: custom };
        const initial = (await j("GET", emojiPath)).j;
        assert.deepStrictEqual(initial.emotes, {});
        assert.deepStrictEqual(initial.library.map(({ source, code }) => [source, code]), [["bot", botEmote], ["server", custom]]);
        assert.deepStrictEqual((await j("GET", emojiPath, null, "B")).j.library.map(x => x.code), [botEmote]);
        assert.strictEqual((await j("PUT", emojiPath, { guildId: guildA, emojis: settings }, "B")).s, 409);
        for (const emojis of [{ profile: "👑" }, { profile: "<:invalid:123>" }, { profile: "<:locked:623456789012345678>" }, { unknown: custom }]) {
            assert.strictEqual((await j("PUT", emojiPath, { guildId: guildA, emojis })).s, 400);
        }
        assert.strictEqual((await j("PUT", emojiPath, { guildId: guildB, emojis: { qris: custom } }, "B")).s, 400);
        assert.deepStrictEqual((await j("PUT", emojiPath, { guildId: guildA, emojis: { ...settings, qris: `<:old_name:${serverEmoteId}>` } })).j.emotes, settings);
        assert.deepStrictEqual((await j("GET", emojiPath, null, "B")).j.emotes, {});
        assert.strictEqual((await j("GET", "/settings")).j.storefront.model, "model1");
        assert.deepStrictEqual((await j("PUT", emojiPath, { guildId: guildA, emojis: {} })).j.emotes, {});
        assert.strictEqual((await resolveEmojis(settings)).qris, emojiDefaults.qris);
        assert.strictEqual((await resolveEmojis({ qris: "👑" })).qris, emojiDefaults.qris);
        const guild = { emojis: { cache: new Map([[serverEmoteId, { available: true, roles: { cache: new Map() }, toString: () => custom }]]) },
            client: { application: { emojis: { fetch: async () => new Map([[botEmoteId, { toString: () => botEmote }]]) } } } };
        const resolved = await resolveEmojis(settings, guild);
        assert.strictEqual(resolved.profile, botEmote);
        assert.deepStrictEqual(componentEmoji(resolved.qris), { animated: true, name: "gem", id: serverEmoteId });
        console.log("ok  emoji Model 1: simpan per server, reset, validasi, dan fallback emoji Discord");
        console.log("\nSemua tes shopapi (tiruan) lulus.");
    } catch (e) { console.error("GAGAL:", e); process.exitCode = 1; }
    srv.close();
});
