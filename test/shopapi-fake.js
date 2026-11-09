// Tes rute baru shopapi (riwayat order, statistik, buang duplikat stok) dengan database tiruan: node test/shopapi-fake.js
// Yang diuji: bentuk respons dan alur kode. Sintaks pipeline MongoDB tetap perlu diuji ke database asli (test/shop.js dengan SHOP_TEST_MONGO).
const assert = require("assert"), http = require("http"), express = require("express");
const shopdb = require("../src/shopdb");
const { emojiDefaults, resolveEmojis, resolveRestockEmojis, componentEmoji, customEmojiId, menuActions, menuId, storefrontAction } = require("../bot/src/config/storefront");
const model1Preset = require("../bot/src/config/model1-emoji-preset.json");
const model2Preset = require("../bot/src/config/model2-emoji-preset.json");

const inserted = []; let lastFind = null;
const cur = (rows) => { const c = { sort: () => c, skip: () => c, limit: () => c, project: () => c, toArray: async () => rows }; return c; };
const now = Date.now();
const storefronts = new Map();
const guildA = "123456789012345678", guildB = "223456789012345678";
const botId = "323456789012345678", serverEmoteId = "423456789012345678", botEmoteId = "523456789012345678";
const sourceGuild = "723456789012345678", sourceEmoteId = "823456789012345678";
const sourceCode = `<a:source_gem:${sourceEmoteId}>`;
Object.assign(process.env, {
    DISCORD_HOSTED_PILOT_LICENSE_ID: "", DISCORD_HOSTED_TEST_LICENSE_IDS: `${guildA},${guildB}`,
    DISCORD_HOSTED_PILOT_GUILD_IDS: `${guildA},${guildB}`, DISCORD_CATALOG_PILOT_MONGO_URL: "mongodb://tiruan",
    DISCORD_HOSTED_BOT_CLIENT_ID: botId, DISCORD_CATALOG_PILOT_TOKEN: "synthetic", DISCORD_HOSTED_EMOTE_SOURCE_GUILD_ID: sourceGuild,
});
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
    if (!url.startsWith("https://discord.com/api/v10/")) return nativeFetch(url, options);
    const path = new URL(url).pathname;
    if (path.endsWith(`/applications/${botId}/emojis`)) return Promise.resolve(Response.json({ items: [{ id: botEmoteId, name: "bot_gem" }] }));
    if (path.endsWith(`/guilds/${guildA}/emojis`)) return Promise.resolve(Response.json([
        { id: serverEmoteId, name: "gem", animated: true }, { id: "623456789012345678", name: "locked", roles: [guildA] },
    ]));
    if (path.endsWith(`/guilds/${guildB}/emojis`)) return Promise.resolve(Response.json([]));
    if (path.endsWith(`/guilds/${sourceGuild}`)) return Promise.resolve(Response.json({ name: "Source store", roles: [{ id: guildA, permissions: "32" }] }));
    if (path.endsWith(`/guilds/${sourceGuild}/members/${guildA}`)) return Promise.resolve(Response.json({ roles: [guildA] }));
    if (path.endsWith(`/guilds/${sourceGuild}/members/${guildB}`)) return Promise.resolve(Response.json({ roles: [] }));
    if (path.endsWith(`/guilds/${sourceGuild}/emojis`)) return Promise.resolve(Response.json([{ id: sourceEmoteId, name: "source_gem", animated: true }]));
    return Promise.resolve(new Response(null, { status: 404 }));
};
const cols = {
    mts: { findOne: async () => null },
    wlrates: { findOne: async () => null },
    apisettings: { findOne: async () => null },
    setchannels: { findOne: async () => null },
    storefronts: {
        findOne: async ({ _id }) => storefronts.get(_id),
        updateOne: async ({ _id }, { $set }) => storefronts.set(_id, { ...storefronts.get(_id), ...$set }),
    },
    lists: { findOne: async (f) => ({ code: f.code }), find: () => cur([{ code: "P1", name: "Akun A" }, { code: "P2", name: "Akun B" }, { code: "P3", name: "Akun C", priceIdr: 25000 }]) },
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
            if (g._id.$dateToString) { assert.strictEqual(g._id.$dateToString.timezone, "Asia/Jakarta"); assert.strictEqual(g.idr.$sum, "$totalIdr"); return [{ _id: "2026-11-04", orders: 1, qty: 1, wl: 900 }, { _id: "2026-11-05", orders: 1, qty: 2, wl: 4000, idr: 25000 }]; }
            return [{ _id: "P2", name: "Akun B", qty: 2, wl: 4000 }];
        } }),
    },
};
shopdb.getDb = async () => ({ collection: (n) => cols[n] });
const createShopRouter = require("../src/shopapi");

const app = express(); app.use(express.json());
app.use("/api/shop", (req, res, next) => {
    const guildId = req.get("X-Test-Store") === "B" ? guildB : guildA;
    req.lic = { id: guildId, expiresAt: now + 60000, paymentMode: "auto", discordLoginId: guildId, hostedBot: { enabled: true, guildId } };
    next();
}, createShopRouter({ valid: () => true, decrypt: config => config }));
const srv = http.createServer(app).listen(0, async () => {
    const base = `http://127.0.0.1:${srv.address().port}/api/shop`;
    const j = async (m, u, b, store = "A") => { const r = await fetch(base + u, { method: m, headers: { "Content-Type": "application/json", "X-Test-Store": store }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
    try {
        const o = await j("GET", "/orders?q=" + encodeURIComponent("a.b(")); // karakter regex harus di-escape
        assert.strictEqual(o.s, 200); assert.strictEqual(o.j.total, 2); assert.strictEqual(o.j.wl, 4900); assert.strictEqual(o.j.qty, 3);
        assert.deepStrictEqual(o.j.orders[0], { number: 7, discordId: "111", growId: "Budi", code: "P2", name: "Akun B", qty: 2, total: 4000, totalIdr: 0, at: now });
        assert.strictEqual(o.j.orders[1].number, null);
        console.log("ok  /orders: bentuk respons, ringkasan, pencarian aman");

        const s = await j("GET", "/stats?days=14");
        assert.strictEqual(s.s, 200); assert.strictEqual(s.j.days, 14); assert.strictEqual(s.j.daily.length, 2); assert.strictEqual(s.j.top[0].code, "P2");
        assert.strictEqual(s.j.daily[1].idr, 25000);
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
        assert.strictEqual((await j("PUT", "/settings/storefront", { guildId: guildA, model: "model3" })).s, 200);
        assert.deepStrictEqual((await j("GET", "/stats")).j.low, [{ code: "P3", name: "Akun C", stock: 0 }]);
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
        assert.strictEqual(initial.model, "model1");
        assert.ok(initial.defaults.inStock && initial.defaults.crown && !initial.defaults.growIdButton);
        for (const [key, code] of Object.entries(model1Preset)) assert.strictEqual(initial.defaults[key], code);
        assert.deepStrictEqual(initial.emotes, {});
        assert.deepStrictEqual(initial.library.map(({ source, code }) => [source, code]), [["bot", botEmote], ["server", custom], ["external", sourceCode]]);
        assert.strictEqual(initial.extraSource, "Source store");
        assert.deepStrictEqual((await j("GET", emojiPath, null, "B")).j.library.map(x => x.code), [botEmote]);
        assert.strictEqual((await j("PUT", emojiPath, { guildId: guildB, emojis: { qris: sourceCode } }, "B")).s, 400);
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
        assert.strictEqual((await j("PUT", emojiPath, { guildId: guildA, emojis: { profile: sourceCode } })).s, 200);
        assert.strictEqual(storefronts.get(guildA).emojiSourceGuildId, sourceGuild);
        guild.client.guilds = { cache: new Map([[sourceGuild, {
            emojis: { cache: new Map([[sourceEmoteId, { available: true, roles: { cache: new Map() }, toString: () => sourceCode }]]) },
        }]]) };
        assert.strictEqual((await resolveEmojis({ profile: sourceCode }, guild, sourceGuild, { has: () => true })).profile, sourceCode);
        assert.strictEqual((await resolveEmojis({ profile: sourceCode }, guild, sourceGuild, { has: () => false })).profile, emojiDefaults.profile);
        const restock = { restockTitle: botEmote, restockProduct: custom, restockQuantity: sourceCode };
        assert.strictEqual(initial.defaults.restockTitle, "✅");
        assert.strictEqual((await j("PUT", emojiPath, { guildId: guildA, emojis: {}, restockEmojis: { restockTitle: "👑" } })).s, 400);
        const savedRestock = await j("PUT", emojiPath, { guildId: guildA, emojis: { profile: sourceCode }, restockEmojis: restock });
        assert.strictEqual(savedRestock.s, 200);
        assert.deepStrictEqual(savedRestock.j.restockEmotes, restock);
        assert.strictEqual(storefronts.get(guildA).restockEmojiSourceGuildId, sourceGuild);
        assert.deepStrictEqual(await resolveRestockEmojis(storefronts.get(guildA), guild, { has: () => true }), restock);
        assert.strictEqual((await resolveRestockEmojis(storefronts.get(guildA), guild, { has: () => false })).restockQuantity, "🟢");
        assert.deepStrictEqual((await j("GET", emojiPath, null, "B")).j.restockEmotes, {});
        assert.strictEqual((await j("PUT", "/settings/storefront", { guildId: guildA, model: "classic" })).s, 200);
        const classic = (await j("GET", emojiPath)).j;
        assert.strictEqual(classic.model, "classic");
        assert.ok(classic.defaults.growIdButton && classic.defaults.inStock === "✅");
        assert.deepStrictEqual(classic.emotes, {});
        assert.deepStrictEqual(classic.restockEmotes, restock, "emoji restock sama saat model toko diganti");
        assert.strictEqual((await j("PUT", emojiPath, { guildId: guildA, model: "model1", emojis: {} })).s, 409);
        assert.strictEqual((await j("PUT", emojiPath, { guildId: guildA, model: "classic", emojis: { growIdButton: botEmote } })).s, 200);
        assert.deepStrictEqual((await j("GET", emojiPath)).j.emotes, { growIdButton: botEmote });
        assert.strictEqual((await j("PUT", "/settings/storefront", { guildId: guildA, model: "model2" })).s, 200);
        const model2 = (await j("GET", emojiPath)).j;
        assert.strictEqual(model2.model, "model2");
        assert.deepStrictEqual(model2.emotes, {});
        for (const [key, code] of Object.entries(model2Preset)) assert.strictEqual(model2.defaults[key], code);
        assert.strictEqual((await j("PUT", emojiPath, { guildId: guildA, model: "model2", emojis: { inStock: custom } })).s, 200);
        assert.deepStrictEqual((await j("GET", emojiPath)).j.emotes, { inStock: custom });
        assert.deepStrictEqual((await j("PUT", emojiPath, { guildId: guildA, model: "model2", emojis: {} })).j.emotes, {});
        assert.deepStrictEqual((await j("GET", emojiPath)).j.restockEmotes, restock, "reset model tidak menghapus emoji restock");
        assert.deepStrictEqual((await j("PUT", emojiPath, { guildId: guildA, model: "model2", emojis: {}, restockEmojis: {} })).j.restockEmotes, {});
        assert.strictEqual((await j("GET", emojiPath)).j.defaults.inStock, model2Preset.inStock);
        assert.strictEqual((await j("PUT", emojiPath, { guildId: guildA, model: "model2", emojis: { inStock: custom } })).s, 200);
        for (const [value] of menuActions) {
            const interaction = { customId: menuId, guildId: guildA, values: [value], isStringSelectMenu: () => true };
            assert.strictEqual(storefrontAction(interaction, guildA), value);
            assert.strictEqual(storefrontAction(interaction, guildB), undefined);
            assert.strictEqual(storefrontAction({ ...interaction, values: ["Howmanys"] }, guildA), undefined);
        }
        assert.strictEqual((await j("PUT", "/settings/storefront", { guildId: guildA, model: "model1" })).s, 200);
        assert.deepStrictEqual((await j("GET", emojiPath)).j.emotes, { profile: sourceCode });
        assert.deepStrictEqual(storefronts.get(guildA).classicEmojis, { growIdButton: botEmote });
        assert.deepStrictEqual(storefronts.get(guildA).model2Emojis, { inStock: custom });
        const owned = new Map([model1Preset.profile, model2Preset.growIdButton]
            .map(code => [customEmojiId(code), { toString: () => code }]));
        guild.client.application.emojis = { fetch: async () => owned };
        process.env.HOSTED_PILOT_BINDING = "test";
        try {
            assert.strictEqual((await resolveEmojis({}, guild)).profile, model1Preset.profile);
            assert.strictEqual((await resolveEmojis({ profile: custom }, guild)).profile, custom);
            assert.strictEqual((await resolveEmojis({}, guild)).qris, emojiDefaults.qris);
            assert.strictEqual((await resolveEmojis({}, guild, null, null, "model2")).growIdButton, model2Preset.growIdButton);
            assert.strictEqual((await resolveEmojis({ growIdButton: custom }, guild, null, null, "model2")).growIdButton, custom);
            assert.strictEqual((await resolveEmojis({}, guild, null, null, "model2")).inStock, "✅");
        } finally {
            delete process.env.HOSTED_PILOT_BINDING;
        }
        console.log("ok  emoji Model 1: simpan per server, reset, validasi, dan fallback emoji Discord");
        console.log("\nSemua tes shopapi (tiruan) lulus.");
    } catch (e) { console.error("GAGAL:", e); process.exitCode = 1; }
    srv.close();
});
