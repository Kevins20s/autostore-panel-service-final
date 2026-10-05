// Tes API toko ke MongoDB sungguhan. Butuh server Mongo (atau FerretDB) yang jalan:
//   SHOP_TEST_MONGO=mongodb://127.0.0.1:27018/shoptest npm run test:shop
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const { MongoClient } = require("mongodb");

const MONGO = process.env.SHOP_TEST_MONGO || "mongodb://127.0.0.1:27018/shoptest";
const P = 5056, base = `http://127.0.0.1:${P}`, data = path.join(os.tmpdir(), `panel-shop-${Date.now()}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, url, body, ck) {
    const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(ck ? { Cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie");
    return { status: r.status, json: await r.json().catch(() => ({})), cookie: sc ? sc.split(";")[0] : null };
}

(async () => {
    const mc = new MongoClient(MONGO, { serverSelectionTimeoutMS: 3000 });
    try { await mc.connect(); } catch { console.log("SKIP: Mongo tes tidak tersedia di " + MONGO); return; }
    await mc.db().dropDatabase();
    const db = mc.db();
    // data yang meniru dokumen buatan bot (Mongoose)
    await db.collection("bals").insertOne({ GrowID: "budi", GrowIDNow: "Budi", DiscordID: "111111111111111111", Balance: 50, Deposit: 50, __v: 0 });
    await db.collection("mts").insertOne({ mt: false, __v: 0 });

    const srv = spawn(process.execPath, ["server.js"], {
        env: { ...process.env, PANEL_PORT: P, MASTER_KEY: "b".repeat(64), ADMIN_PASSWORD: "supersecret1", DATA_FILE: data,
               BOT_DIR: path.join(__dirname, "fakebot"), SKIP_VALIDATE: "1", WATCH_MS: "60000", BASE_PORT: "4600" },
        stdio: "inherit",
    });
    const step = (m) => console.log("ok  " + m);
    try {
        await sleep(1200);
        const adm = (await call("POST", "/api/admin/login", { password: "supersecret1" })).cookie;
        const key = (await call("POST", "/api/admin/licenses", { buyer: "Toko A", days: 30 }, adm)).json.key;
        const ck = (await call("POST", "/api/login", { key })).cookie;

        assert.strictEqual((await call("GET", "/api/shop/products")).status, 401, "tanpa login ditolak");
        assert.strictEqual((await call("GET", "/api/shop/products", null, ck)).status, 409, "belum setup");
        await call("PUT", "/api/config", { botToken: "TOK-123456", clientId: "123456789012345678", mongoUrl: MONGO, ownerId: "987654321098765432" }, ck);
        step("akses toko dikunci sampai login + setup");

        const role = "222222222222222222";
        const bad = await call("POST", "/api/shop/products", { code: "a b", name: "X", type: "yes", role }, ck);
        assert.strictEqual(bad.status, 400);
        assert.strictEqual((await call("POST", "/api/shop/products", { code: "RDP1", name: "RDP Murah", type: "yes", role: "abc" }, ck)).status, 400);
        assert.strictEqual((await call("POST", "/api/shop/products", { code: "RDP1", name: "RDP Murah", type: "yes", role, price: "9,5", kategori: "RDP" }, ck)).status, 200);
        assert.strictEqual((await call("POST", "/api/shop/products", { code: "RDP1", name: "Dobel", type: "yes", role }, ck)).status, 409);
        assert.strictEqual((await call("POST", "/api/shop/products", { code: "SCR1", name: "Script Bot", type: "script", role }, ck)).status, 200);
        let list = (await call("GET", "/api/shop/products", null, ck)).json.products;
        const rdp = list.find((p) => p.code === "RDP1");
        assert.deepStrictEqual([rdp.price, rdp.kategori, rdp.stock, rdp.sold], [9.5, "RDP", 0, 0]);
        assert.strictEqual(list.find((p) => p.code === "SCR1").kategori, "ALL");
        // dokumen harus cocok dengan skema bot
        const doc = await db.collection("lists").findOne({ code: "RDP1" });
        assert.deepStrictEqual([doc.name, doc.type, doc.role, doc.sold], ["RDP Murah", "yes", role, 0]);
        step("tambah produk + validasi + harga koma + dokumen sesuai skema bot");

        assert.strictEqual((await call("PUT", "/api/shop/products/RDP1", { name: "RDP Baru", type: "yes", role, price: 12, kategori: "" }, ck)).status, 200);
        const e = (await call("GET", "/api/shop/products", null, ck)).json.products.find((p) => p.code === "RDP1");
        assert.deepStrictEqual([e.name, e.price, e.kategori], ["RDP Baru", 12, "ALL"]);
        step("edit produk");

        // stok: tipe yes dipecah per spasi/baris, tipe script satu utuh
        assert.strictEqual((await call("POST", "/api/shop/products/RDP1/stock", { text: "a:1\nb:2  c:3" }, ck)).json.added, 3);
        assert.strictEqual((await call("POST", "/api/shop/products/SCR1/stock", { text: "print('hi')\nprint('dua')" }, ck)).json.added, 1);
        assert.strictEqual((await call("POST", "/api/shop/products/RDP1/stock", { text: "   " }, ck)).status, 400);
        let st = (await call("GET", "/api/shop/products/RDP1/stock", null, ck)).json;
        assert.strictEqual(st.total, 3);
        assert.strictEqual((await db.collection("shops").findOne({ code: "SCR1" })).data, "print('hi')\nprint('dua')");
        assert.strictEqual((await call("DELETE", "/api/shop/products/RDP1/stock", { ids: [st.items[1].id] }, ck)).json.removed, 1);
        assert.strictEqual((await call("DELETE", "/api/shop/products/RDP1/stock", { count: 1 }, ck)).json.removed, 1);
        const left = await db.collection("shops").find({ code: "RDP1" }).toArray();
        assert.deepStrictEqual(left.map((x) => x.data), ["c:3"], "hapus paling lama dulu");
        step("stok: tambah, hapus per id, hapus N paling lama");

        // diskon & bulk
        assert.strictEqual((await call("PUT", "/api/shop/products/SCR1/discount", { discount: 10 }, ck)).status, 400, "butuh harga dulu");
        assert.strictEqual((await call("PUT", "/api/shop/products/RDP1/discount", { discount: 150 }, ck)).status, 400);
        assert.strictEqual((await call("PUT", "/api/shop/products/RDP1/discount", { discount: 10 }, ck)).status, 200);
        assert.strictEqual((await call("PUT", "/api/shop/products/RDP1/bulk", { minQty: 5, cut: 20 }, ck)).status, 400, "potongan >= harga");
        assert.strictEqual((await call("PUT", "/api/shop/products/RDP1/bulk", { minQty: 5, cut: 2 }, ck)).status, 200);
        assert.strictEqual((await call("PUT", "/api/shop/products/RDP1/bulk", { minQty: 5, cut: 3 }, ck)).status, 200);
        const d = (await call("GET", "/api/shop/products", null, ck)).json.products.find((p) => p.code === "RDP1");
        assert.deepStrictEqual([d.discount, d.bulk], [10, [{ minQty: 5, cut: 3 }]]);
        step("diskon dan bulk discount");

        // user & saldo
        let u = (await call("GET", "/api/shop/users?q=bud", null, ck)).json;
        assert.deepStrictEqual([u.total, u.users[0].balance], [1, 50]);
        assert.strictEqual((await call("POST", "/api/shop/users/111111111111111111/balance", { amount: 25, mode: "add" }, ck)).status, 200);
        let b = await db.collection("bals").findOne({ DiscordID: "111111111111111111" });
        assert.deepStrictEqual([b.Balance, b.Deposit], [75, 75]);
        assert.strictEqual((await call("POST", "/api/shop/users/111111111111111111/balance", { amount: 100, mode: "remove" }, ck)).status, 404, "tidak boleh minus");
        assert.strictEqual((await call("POST", "/api/shop/users/111111111111111111/balance", { amount: 5, mode: "remove" }, ck)).status, 200);
        b = await db.collection("bals").findOne({ DiscordID: "111111111111111111" });
        assert.deepStrictEqual([b.Balance, b.Deposit], [70, 75]);
        assert.strictEqual((await call("GET", "/api/shop/users?q=.*", null, ck)).json.total, 0, "regex disaring");
        assert.strictEqual((await call("POST", "/api/shop/users/999999999999999999/balance", { amount: 5, mode: "add" }, ck)).status, 404);
        step("saldo: tambah, kurangi, tidak minus, pencarian aman");

        // pengaturan
        await call("PUT", "/api/settings/maintenance".replace("/api/settings", "/api/shop/settings"), { on: true }, ck);
        await call("PUT", "/api/shop/settings/wlrate", { pricePerWL: "150" }, ck);
        await call("PUT", "/api/shop/settings/liveapi", { on: false }, ck);
        assert.strictEqual((await call("PUT", "/api/shop/settings/wlrate", { pricePerWL: 0 }, ck)).status, 400);
        const s = (await call("GET", "/api/shop/settings", null, ck)).json;
        assert.deepStrictEqual(s, { maintenance: true, pricePerWL: 150, useLiveApi: false });
        assert.strictEqual((await call("GET", "/api/shop/summary", null, ck)).json.maintenance, true);
        assert.strictEqual((await db.collection("mts").countDocuments()), 1, "tidak membuat dokumen maintenance ganda");
        step("pengaturan: maintenance, kurs WL, harga live");

        const sum = (await call("GET", "/api/shop/summary", null, ck)).json;
        assert.deepStrictEqual([sum.products, sum.stock, sum.users, sum.balance], [2, 2, 1, 70]);
        step("ringkasan dashboard");

        // hapus produk membersihkan data terkait
        assert.strictEqual((await call("DELETE", "/api/shop/products/RDP1", null, ck)).status, 200);
        for (const col of ["lists", "prices", "discounts", "bulkdiscounts", "shops"]) assert.strictEqual(await db.collection(col).countDocuments({ code: "RDP1" }), 0, col);
        assert.strictEqual((await call("DELETE", "/api/shop/products/RDP1", null, ck)).status, 404);
        step("hapus produk membersihkan harga, diskon, bulk, dan stok");

        // key dicabut -> akses toko ditutup
        const id = (await call("GET", "/api/admin/licenses", null, adm)).json.licenses[0].id;
        await call("POST", `/api/admin/licenses/${id}/revoke`, { revoked: true }, adm);
        assert.strictEqual((await call("GET", "/api/shop/products", null, ck)).status, 403);
        step("key dicabut = akses toko ditutup\n\nSEMUA TES TOKO LULUS");
    } catch (e) { console.error("GAGAL:", e.stack.split("\n").slice(0, 4).join("\n")); process.exitCode = 1; }
    finally { srv.kill("SIGTERM"); await sleep(300); await mc.close(); fs.rmSync(data, { force: true }); }
})();
