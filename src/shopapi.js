// API kelola toko (produk, stok, user, pengaturan) langsung ke MongoDB pembeli.
const express = require("express");
const { ObjectId } = require("mongodb");
const { getDb, COL } = require("./shopdb");
const { hostedTenant } = require("./shared-tenants");
const { collection: storefrontCollection, models: storefrontModels, emojiDefaults, customEmojiId } = require("../bot/src/config/storefront");

const CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ID_RE = /^\d{17,20}$/;
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").trim().replace(",", ".")));
const okNum = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;

async function discordEmotes(guildId, token, botId, sourceGuildId, discordUserId) {
    if (!token) return { library: null };
    const get = async path => {
        try {
            const response = await fetch("https://discord.com/api/v10" + path, {
                headers: { Authorization: "Bot " + token }, signal: AbortSignal.timeout(5000),
            });
            return response.ok ? await response.json() : null;
        } catch { return null; }
    };
    const guildEmotes = async id => {
        const server = `/guilds/${id}`;
        const emojis = await get(server + "/emojis");
        if (!Array.isArray(emojis)) return null;
        const member = ID_RE.test(botId) && emojis.some(emoji => emoji.roles?.length) ? await get(server + "/members/" + botId) : null;
        return emojis.filter(emoji => emoji.available !== false &&
            (!emoji.roles?.length || emoji.roles.some(role => member?.roles?.includes(role))));
    };
    const extraGuild = async () => {
        if (!ID_RE.test(sourceGuildId) || !ID_RE.test(discordUserId) || sourceGuildId === guildId) return null;
        const [server, member] = await Promise.all([
            get(`/guilds/${sourceGuildId}`), get(`/guilds/${sourceGuildId}/members/${discordUserId}`),
        ]);
        if (!server?.roles || !member) return null;
        const roleIds = new Set([sourceGuildId, ...(member.roles || [])]);
        const managePermissions = (1n << 3n) | (1n << 5n) | (1n << 30n);
        const canManage = server.owner_id === discordUserId || server.roles.some(role =>
            roleIds.has(role.id) && (BigInt(role.permissions) & managePermissions) !== 0n);
        if (!canManage) return null;
        const emojis = await guildEmotes(sourceGuildId);
        return emojis ? { name: server.name, id: sourceGuildId, emojis } : null;
    };
    const [guild, application, extra] = await Promise.all([
        guildEmotes(guildId), ID_RE.test(botId) ? get(`/applications/${botId}/emojis`) : null, extraGuild(),
    ]);
    if (!guild && !Array.isArray(application?.items) && !extra) return { library: null };
    const toEntry = source => ({ id, name, animated }) => ({ name, source, code: `<${animated ? "a" : ""}:${name}:${id}>` });
    const library = [...(application?.items || []).map(toEntry("bot")), ...(guild || []).map(toEntry("server")),
        ...(extra?.emojis || []).map(toEntry("external"))]
        .filter(emoji => customEmojiId(emoji.code)).sort((a, b) => a.name.localeCompare(b.name));
    return { library, extraSource: extra && { id: extra.id, name: extra.name } };
}

module.exports = function createShopRouter({ valid, decrypt, licenses = () => [] }) {
    const r = express.Router();
    const wrap = (fn) => (req, res) =>
        fn(req, res).catch((e) => {
            console.error("[SHOP]", e.message);
            res.status(500).json({ error: "Terjadi kesalahan saat mengakses database toko." });
        });
    const fail = (res, m, s = 400) => res.status(s).json({ error: m });

    // Semua rute: key harus aktif, config sudah diisi, lalu sambungkan ke Mongo pembeli
    r.use(async (req, res, next) => {
        const l = req.lic;
        if (!valid(l)) return fail(res, "Key sudah habis atau dicabut.", 403);
        const hosted = hostedTenant(l, licenses());
        if (!hosted && (l.hostedBot?.enabled || l.runMode === "central")) {
            return fail(res, "Database Bot GevraStore belum tersedia untuk server ini.", 503);
        }
        if (!hosted && !l.config) return fail(res, "Isi pengaturan bot dulu di menu Bot & Server.", 409);
        try {
            const config = hosted ? hosted.config : decrypt(l.config);
            req.shopGuildId = hosted?.guildId || config.guildId || "";
            req.shopDiscord = hosted
                ? { token: process.env.DISCORD_CATALOG_PILOT_TOKEN, botId: process.env.DISCORD_HOSTED_BOT_CLIENT_ID,
                    sourceGuildId: process.env.DISCORD_HOSTED_EMOTE_SOURCE_GUILD_ID, discordUserId: l.discordLoginId }
                : { token: config.botToken, botId: config.clientId };
            req.db = hosted
                ? await getDb("hosted:" + hosted.tenantId, config.mongoUrl, hosted.dbName)
                : await getDb(l.id, config.mongoUrl);
            if (hosted && hostedTenant(l, licenses())?.dbName !== hosted.dbName) {
                return fail(res, "Server toko berubah. Muat ulang halaman.", 409);
            }
        }
        catch { return fail(res, "Tidak bisa terhubung ke MongoDB toko. Cek pengaturan database.", 502); }
        next();
    });
    const c = (req, k) => req.db.collection(COL[k]);
    const storeEmotes = req => {
        const { token, botId, sourceGuildId, discordUserId } = req.shopDiscord;
        return discordEmotes(req.shopGuildId, token, botId, sourceGuildId, discordUserId);
    };

    // ---------- ringkasan ----------
    r.get("/summary", wrap(async (req, res) => {
        const [products, stock, users, sold, bal, mt] = await Promise.all([
            c(req, "list").countDocuments(), c(req, "shop").countDocuments(), c(req, "bal").countDocuments(),
            c(req, "list").aggregate([{ $group: { _id: null, t: { $sum: "$sold" } } }]).toArray(),
            c(req, "bal").aggregate([{ $group: { _id: null, t: { $sum: "$Balance" } } }]).toArray(),
            c(req, "mt").findOne({}),
        ]);
        res.json({ products, stock, users, sold: sold[0]?.t || 0, balance: bal[0]?.t || 0, maintenance: !!mt?.mt });
    }));

    // ---------- produk ----------
    r.get("/products", wrap(async (req, res) => {
        const [lists, prices, stocks, discs, bulks, rate, api] = await Promise.all([
            c(req, "list").find({}).sort({ code: 1 }).toArray(),
            c(req, "price").find({}).toArray(),
            c(req, "shop").aggregate([{ $group: { _id: "$code", n: { $sum: 1 } } }]).toArray(),
            c(req, "discount").find({}).toArray(),
            c(req, "bulk").find({}).sort({ minQty: 1 }).toArray(),
            c(req, "wlrate").findOne({}), c(req, "api").findOne({}),
        ]);
        const priceBy = Object.fromEntries(prices.map((p) => [p.code, p.price]));
        const stockBy = Object.fromEntries(stocks.map((s) => [s._id, s.n]));
        const discBy = Object.fromEntries(discs.map((d) => [d.code, d.discount]));
        res.json({
            rate: { pricePerWL: rate?.pricePerWL || null, useLiveApi: api?.useLiveApi ?? true },
            products: lists.map((p) => ({
                code: p.code, name: p.name, type: p.type, role: p.role, kategori: p.kategori || "ALL", sold: p.sold || 0,
                price: priceBy[p.code] ?? null, stock: stockBy[p.code] || 0, discount: discBy[p.code] ?? null,
                bulk: bulks.filter((b) => b.code === p.code).map((b) => ({ minQty: b.minQty, cut: b.cut })),
            })),
        });
    }));

    function readProduct(body, creating) {
        const out = {};
        const name = String(body?.name ?? "").trim();
        if (!name || name.length > 100) return { error: "Nama produk wajib diisi (maks 100 karakter)." };
        out.name = name;
        if (!["yes", "script"].includes(body?.type)) return { error: "Tipe harus yes atau script." };
        out.type = body.type;
        const role = String(body?.role ?? "").trim();
        if (!ID_RE.test(role)) return { error: "Role Discord harus berupa ID role (angka)." };
        out.role = role;
        const kat = String(body?.kategori ?? "").trim().slice(0, 40);
        out.kategori = kat || "ALL";
        if (body?.price !== undefined && body.price !== "" && body.price !== null) {
            const p = num(body.price);
            if (!okNum(p, 0.01, 1e9)) return { error: "Harga (WL) harus angka lebih dari 0." };
            out.price = p;
        } else if (creating) out.price = null;
        return { data: out };
    }

    r.post("/products", wrap(async (req, res) => {
        const code = String(req.body?.code ?? "").trim();
        if (!CODE_RE.test(code)) return fail(res, "Kode hanya boleh huruf, angka, - dan _ (maks 32).");
        const { data, error } = readProduct(req.body, true);
        if (error) return fail(res, error);
        if (await c(req, "list").findOne({ code })) return fail(res, "Kode sudah dipakai.", 409);
        const { price, ...fields } = data;
        await c(req, "list").insertOne({ code, ...fields, sold: 0, __v: 0 });
        if (price) await c(req, "price").updateOne({ code }, { $set: { code, price } }, { upsert: true });
        res.json({ ok: true });
    }));

    r.put("/products/:code", wrap(async (req, res) => {
        const code = req.params.code;
        if (!(await c(req, "list").findOne({ code }))) return fail(res, "Produk tidak ditemukan.", 404);
        const { data, error } = readProduct(req.body, false);
        if (error) return fail(res, error);
        const { price, ...fields } = data;
        await c(req, "list").updateOne({ code }, { $set: fields });
        if (price) await c(req, "price").updateOne({ code }, { $set: { code, price } }, { upsert: true });
        res.json({ ok: true });
    }));

    r.delete("/products/:code", wrap(async (req, res) => {
        const code = req.params.code;
        const del = await c(req, "list").deleteOne({ code });
        if (!del.deletedCount) return fail(res, "Produk tidak ditemukan.", 404);
        await Promise.all(["price", "discount", "bulk", "shop"].map((k) => c(req, k).deleteMany({ code })));
        res.json({ ok: true });
    }));

    // ---------- diskon ----------
    const needPrice = async (req, res) => {
        const p = await c(req, "price").findOne({ code: req.params.code });
        if (!p?.price) { fail(res, "Atur harga produk dulu."); return null; }
        return p.price;
    };
    r.put("/products/:code/discount", wrap(async (req, res) => {
        if (!(await needPrice(req, res))) return;
        const d = num(req.body?.discount);
        if (!okNum(d, 1, 100)) return fail(res, "Diskon harus 1 sampai 100 (%).");
        await c(req, "discount").updateOne({ code: req.params.code }, { $set: { code: req.params.code, discount: d } }, { upsert: true });
        res.json({ ok: true });
    }));
    r.delete("/products/:code/discount", wrap(async (req, res) => {
        await c(req, "discount").deleteMany({ code: req.params.code });
        res.json({ ok: true });
    }));
    r.put("/products/:code/bulk", wrap(async (req, res) => {
        const price = await needPrice(req, res); if (!price) return;
        const minQty = num(req.body?.minQty), cut = num(req.body?.cut);
        if (!Number.isInteger(minQty) || !okNum(minQty, 1, 1e6)) return fail(res, "Minimal jumlah harus bilangan bulat 1 atau lebih.");
        if (!okNum(cut, 0.01, 1e9) || cut >= price) return fail(res, "Potongan harus lebih dari 0 dan lebih kecil dari harga produk.");
        await c(req, "bulk").updateOne({ code: req.params.code, minQty }, { $set: { cut } }, { upsert: true });
        res.json({ ok: true });
    }));
    r.delete("/products/:code/bulk/:minQty", wrap(async (req, res) => {
        await c(req, "bulk").deleteMany({ code: req.params.code, minQty: Number(req.params.minQty) });
        res.json({ ok: true });
    }));

    // ---------- stok ----------
    r.get("/products/:code/stock", wrap(async (req, res) => {
        const code = req.params.code;
        const [total, items] = await Promise.all([
            c(req, "shop").countDocuments({ code }),
            c(req, "shop").find({ code }).sort({ _id: 1 }).limit(100).toArray(),
        ]);
        res.json({ total, items: items.map((i) => ({ id: typeof i._id === "string" ? "str:" + i._id : String(i._id), data: String(i.data).slice(0, 120), len: String(i.data).length })) });
    }));

    r.post("/products/:code/stock", wrap(async (req, res) => {
        const code = req.params.code;
        const prod = await c(req, "list").findOne({ code });
        if (!prod) return fail(res, "Produk tidak ditemukan.", 404);
        const text = String(req.body?.text ?? "");
        // Script selalu satu stok utuh. Impor file bisa memilih mode per baris;
        // input manual tetap mendukung pemisahan whitespace seperti versi sebelumnya.
        const items = String(prod.type).includes("script")
            ? [text.trim()].filter(Boolean)
            : req.body?.lineMode === true
                ? text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
                : text.split(/\s+/).filter(Boolean);
        if (!items.length) return fail(res, "Tidak ada isi stok.");
        if (items.length > 5000) return fail(res, "Maksimal 5000 item sekali tambah.");
        // Opsi buang duplikat (dedupe: true): duplikat di dalam input dan yang sudah ada di stok produk ini dilewati.
        let toInsert = items, skipped = 0;
        if (req.body?.dedupe === true) {
            const uniq = [...new Set(items)];
            const have = new Set((await c(req, "shop").find({ code, data: { $in: uniq } }).project({ data: 1 }).toArray()).map((x) => x.data));
            toInsert = uniq.filter((x) => !have.has(x));
            skipped = items.length - toInsert.length;
            if (!toInsert.length) return fail(res, "Semua item sudah ada di stok (duplikat), tidak ada yang ditambahkan.");
        }
        await c(req, "shop").insertMany(toInsert.map((data) => ({ code, data, __v: 0 })), { ordered: false });
        res.json({ ok: true, added: toInsert.length, skipped });
    }));

    r.delete("/products/:code/stock", wrap(async (req, res) => {
        const code = req.params.code, col = c(req, "shop");
        let removed = 0;
        if (Array.isArray(req.body?.ids)) {
            const ids = req.body.ids.filter(x => typeof x === "string" && /^(?:[0-9a-f]{24}|str:.+)$/i.test(x))
                .map(x => x.startsWith("str:") ? x.slice(4) : new ObjectId(x));
            removed = (await col.deleteMany({ code, _id: { $in: ids } })).deletedCount;
        } else if (req.body?.all === true) {
            removed = (await col.deleteMany({ code })).deletedCount;
        } else {
            const n = Math.floor(num(req.body?.count));
            if (!okNum(n, 1, 100000)) return fail(res, "Jumlah tidak valid.");
            const old = await col.find({ code }).sort({ _id: 1 }).limit(n).project({ _id: 1 }).toArray();
            removed = (await col.deleteMany({ _id: { $in: old.map((o) => o._id) } })).deletedCount;
        }
        res.json({ ok: true, removed });
    }));

    // ---------- user & saldo ----------
    r.get("/users", wrap(async (req, res) => {
        const q = String(req.query.q || "").trim().slice(0, 50);
        const skip = Math.max(0, Math.floor(Number(req.query.skip)) || 0);
        const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
        const filter = q ? { $or: [{ GrowID: rx }, { GrowIDNow: rx }, { DiscordID: rx }] } : {};
        const [total, rows] = await Promise.all([
            c(req, "bal").countDocuments(filter),
            c(req, "bal").find(filter).sort({ Balance: -1 }).skip(skip).limit(50).toArray(),
        ]);
        res.json({ total, users: rows.map((u) => ({ discordId: u.DiscordID, growId: u.GrowIDNow || u.GrowID || "", balance: u.Balance || 0, deposit: u.Deposit || 0 })) });
    }));

    r.post("/users/:discordId/balance", wrap(async (req, res) => {
        const id = req.params.discordId;
        if (!ID_RE.test(id)) return fail(res, "ID Discord tidak valid.");
        const a = num(req.body?.amount);
        if (!okNum(a, 1, 1e9)) return fail(res, "Jumlah harus angka 1 atau lebih.");
        const add = req.body?.mode === "add";
        // Tambah: Saldo & Deposit naik (sama seperti /addbalance). Kurangi: hanya Saldo, tidak boleh minus.
        const upd = add ? { $inc: { Balance: a, Deposit: a } } : { $inc: { Balance: -a } };
        const filter = add ? { DiscordID: id } : { DiscordID: id, Balance: { $gte: a } };
        const out = await c(req, "bal").updateOne(filter, upd);
        if (!out.matchedCount) return fail(res, add ? "User belum mengatur GrowID di bot." : "User tidak ditemukan atau saldo tidak cukup.", 404);
        res.json({ ok: true });
    }));

    // ---------- riwayat order & statistik (dicatat bot di koleksi orderlogs) ----------
    r.get("/orders", wrap(async (req, res) => {
        const q = String(req.query.q || "").trim().slice(0, 50);
        const skip = Math.max(0, Math.floor(Number(req.query.skip)) || 0);
        const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
        const filter = q ? { $or: [{ productName: rx }, { code: rx }, { discordId: rx }, { growId: rx }] } : {};
        const col = c(req, "orderlog");
        const [total, rows, sum] = await Promise.all([
            col.countDocuments(filter),
            col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(50).toArray(),
            col.aggregate([{ $match: filter }, { $group: { _id: null, qty: { $sum: "$qty" }, wl: { $sum: "$total" } } }]).toArray(),
        ]);
        res.json({
            total, qty: sum[0]?.qty || 0, wl: sum[0]?.wl || 0,
            orders: rows.map((o) => ({ number: o.orderNumber ?? null, discordId: o.discordId || "", growId: o.growId || "", code: o.code || "", name: o.productName || o.code || "", qty: o.qty || 0, total: o.total || 0, at: o.createdAt ? new Date(o.createdAt).getTime() : null })),
        });
    }));

    r.get("/stats", wrap(async (req, res) => {
        const days = Math.min(90, Math.max(1, Math.floor(Number(req.query.days)) || 14));
        const lowAt = Math.min(1000, Math.max(0, Math.floor(Number(req.query.lowAt)) || 3));
        const wibOffset = 7 * 3600000;
        const dayMs = 86400000;
        const today = Math.floor((Date.now() + wibOffset) / dayMs) * dayMs - wibOffset;
        const since = new Date(today - (days - 1) * dayMs);
        const col = c(req, "orderlog");
        const [daily, top, [lists, prices, stocks]] = await Promise.all([
            col.aggregate([{ $match: { createdAt: { $gte: since } } },
                { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Jakarta" } }, orders: { $sum: 1 }, qty: { $sum: "$qty" }, wl: { $sum: "$total" } } },
                { $sort: { _id: 1 } }]).toArray(),
            col.aggregate([{ $match: { createdAt: { $gte: since } } },
                { $group: { _id: "$code", name: { $first: "$productName" }, qty: { $sum: "$qty" }, wl: { $sum: "$total" } } },
                { $sort: { qty: -1, _id: 1 } }]).toArray(),
            Promise.all([
                c(req, "list").find({}).project({ code: 1, name: 1 }).toArray(),
                c(req, "price").find({}).project({ code: 1, price: 1 }).toArray(),
                c(req, "shop").aggregate([{ $group: { _id: "$code", n: { $sum: 1 } } }]).toArray(),
            ]),
        ]);
        const priced = new Set(prices.filter((p) => p.price).map((p) => p.code));
        const stockBy = Object.fromEntries(stocks.map((s) => [s._id, s.n]));
        const low = lists.filter((p) => priced.has(p.code) && (stockBy[p.code] || 0) <= lowAt).map((p) => ({ code: p.code, name: p.name, stock: stockBy[p.code] || 0 })).sort((a, b) => a.stock - b.stock).slice(0, 8);
        const productSales = top.map((t) => ({ code: t._id, name: t.name || t._id, qty: t.qty, wl: t.wl }));
        res.json({
            days, lowAt,
            daily: daily.map((d) => ({ date: d._id, orders: d.orders, qty: d.qty, wl: d.wl })),
            top: productSales.slice(0, 5),
            productSales,
            low,
        });
    }));

    // ---------- pengaturan toko ----------
    r.get("/settings", wrap(async (req, res) => {
        const [mt, rate, api, storefront] = await Promise.all([
            c(req, "mt").findOne({}), c(req, "wlrate").findOne({}), c(req, "api").findOne({}),
            req.shopGuildId ? req.db.collection(storefrontCollection).findOne({ _id: req.shopGuildId }) : null,
        ]);
        const channels = req.lic.hostedBot?.enabled ? await req.db.collection("setchannels").findOne({}) : null;
        res.json({ maintenance: !!mt?.mt, pricePerWL: rate?.pricePerWL || null, useLiveApi: api?.useLiveApi ?? true,
            donationWebhookId: channels?.DonationWebhookId || "",
            storefront: {
                guildId: req.shopGuildId,
                model: storefront?.model === storefrontModels.model1 ? storefrontModels.model1 : storefrontModels.classic,
            } });
    }));
    r.put("/settings/storefront", wrap(async (req, res) => {
        const { guildId, model } = req.body || {};
        if (!ID_RE.test(req.shopGuildId) || guildId !== req.shopGuildId) {
            return fail(res, "Server toko belum diatur atau sudah berubah. Muat ulang halaman.", 409);
        }
        if (typeof model !== "string" || !Object.hasOwn(storefrontModels, model)) return fail(res, "Model toko tidak dikenal.");
        await req.db.collection(storefrontCollection).updateOne({ _id: guildId }, { $set: { model } }, { upsert: true });
        res.json({ model });
    }));
    r.get("/settings/storefront/emojis", wrap(async (req, res) => {
        const guildId = req.shopGuildId;
        if (!ID_RE.test(guildId)) return fail(res, "Pilih server di menu Bot & Server dulu.", 409);
        const [storefront, { library, extraSource }] = await Promise.all([
            req.db.collection(storefrontCollection).findOne({ _id: guildId }), storeEmotes(req),
        ]);
        const emotes = Object.fromEntries(Object.entries(storefront?.emojis || {}).filter(
            ([key, value]) => Object.hasOwn(emojiDefaults, key) && customEmojiId(value)
        ));
        res.set("Cache-Control", "no-store").json({ guildId, emotes, library, extraSource: extraSource?.name || null });
    }));
    r.put("/settings/storefront/emojis", wrap(async (req, res) => {
        const { guildId, emojis } = req.body || {};
        if (!ID_RE.test(req.shopGuildId) || guildId !== req.shopGuildId) {
            return fail(res, "Server toko belum diatur atau sudah berubah. Muat ulang halaman.", 409);
        }
        if (!emojis || typeof emojis !== "object" || Array.isArray(emojis) || Object.entries(emojis).some(
            ([key, value]) => !Object.hasOwn(emojiDefaults, key) || !customEmojiId(value)
        )) return fail(res, "Pilih emote custom Discord dari server toko.");
        const entries = Object.entries(emojis);
        const { library, extraSource } = entries.length ? await storeEmotes(req) : { library: [] };
        if (!library) return fail(res, "Daftar emote dari Discord belum tersedia. Coba lagi.", 502);
        const byId = new Map(library.map(item => [customEmojiId(item.code), item]));
        const normalized = Object.fromEntries(entries.map(([key, code]) => [key, byId.get(customEmojiId(code))?.code]));
        if (Object.values(normalized).some(code => !code)) return fail(res, "Ada emote yang sudah tidak tersedia. Muat ulang daftar emote.");
        const usesExtraSource = Object.values(normalized).some(code => byId.get(customEmojiId(code))?.source === "external");
        await req.db.collection(storefrontCollection).updateOne({ _id: guildId }, { $set: {
            emojis: normalized, emojiSourceGuildId: usesExtraSource ? extraSource.id : null,
        } }, { upsert: true });
        res.json({ emotes: normalized });
    }));
    r.put("/settings/donation-webhook", wrap(async (req, res) => {
        if (!hostedTenant(req.lic, licenses())) return fail(res, "Pengaturan ini untuk Bot GevraStore.", 403);
        const id = String(req.body?.webhookId || "").trim();
        if (id && !ID_RE.test(id)) return fail(res, "Masukkan ID angka webhook donasi.");
        await req.db.collection("setchannels").updateOne({}, { $set: { DonationWebhookId: id } }, { upsert: true });
        res.json({ ok: true });
    }));
    r.put("/settings/maintenance", wrap(async (req, res) => {
        await c(req, "mt").updateOne({}, { $set: { mt: req.body?.on === true } }, { upsert: true });
        res.json({ ok: true });
    }));
    r.put("/settings/wlrate", wrap(async (req, res) => {
        const v = num(req.body?.pricePerWL);
        if (!okNum(v, 1, 1e9)) return fail(res, "Harga 1 WL harus angka 1 atau lebih.");
        await c(req, "wlrate").updateOne({}, { $set: { pricePerWL: v } }, { upsert: true });
        res.json({ ok: true });
    }));
    r.put("/settings/liveapi", wrap(async (req, res) => {
        await c(req, "api").updateOne({}, { $set: { useLiveApi: req.body?.on === true } }, { upsert: true });
        res.json({ ok: true });
    }));

    return r;
};
