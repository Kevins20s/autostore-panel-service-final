// Tes integrasi pembelian key: QRIS otomatis (mode mock), webhook, perpanjangan, batas per IP, harga paket dari admin.
// Menjalankan server sungguhan tanpa MongoDB/Discord: node test/orders-auto.js
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert"), crypto = require("crypto");

const P = 5066, base = `http://127.0.0.1:${P}`;
const data = path.join(os.tmpdir(), `panel-auto-${Date.now()}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, url, { body, cookie, headers = {} } = {}) {
    const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie");
    return { status: r.status, json: await r.json().catch(() => ({})), cookie: sc ? sc.split(";")[0] : null };
}
const hook = (payload, secret = "mock-webhook-secret", sig) => {
    const raw = JSON.stringify(payload);
    return fetch(base + "/hook-autoko", { method: "POST", headers: { "Content-Type": "application/json", "x-webhook-signature": sig ?? crypto.createHmac("sha256", secret).update(raw).digest("hex") }, body: raw }).then((r) => r.status);
};

(async () => {
    const srv = spawn(process.execPath, ["server.js"], {
        env: { ...process.env, PANEL_PORT: P, MASTER_KEY: "c".repeat(64), ADMIN_PASSWORD: "supersecret1", DATA_FILE: data, BOT_DIR: path.join(__dirname, "fakebot"),
               SKIP_VALIDATE: "1", WATCH_MS: "60000", BASE_PORT: "4700", AUTOKO_MODE: "mock", ORDER_AUTO: "1", TRUST_PROXY: "1", WALLET_MONGO_URL: "", ENV_FILE: path.join(os.tmpdir(), "tidak-ada.env") },
        stdio: "inherit",
    });
    try {
        await sleep(1300);
        const adm = (await call("POST", "/api/admin/login", { body: { password: "supersecret1" } })).cookie;

        const info = await call("GET", "/api/shop-info");
        assert.strictEqual(info.json.auto, true); assert.deepStrictEqual(info.json.packages.map((p) => [p.id, p.price]), [["autostore", 15000], ["autostore90", 40000], ["autostore365", 125000], ["autostoreLifetime", 250000]]);
        assert.strictEqual(info.json.turnstileSiteKey, null);
        console.log("ok  /beli: QRIS otomatis aktif, paket Service tidak dijual");

        const o1 = await call("POST", "/api/orders", { body: { type: "autostore", name: "Budi", contact: "0812" } });
        assert.strictEqual(o1.status, 200); assert.strictEqual(o1.json.order.auto, true);
        assert.strictEqual(o1.json.order.qrisSimulation, true);
        assert.ok(!("qrPng" in o1.json.order), "pesanan simulasi tidak menampilkan QR untuk dibayar");
        assert.strictEqual(o1.json.order.amount, 15000);
        assert.ok(!("qrString" in o1.json.order), "teks QR mentah tidak perlu dikirim");
        const { id, token } = { id: o1.json.order.id, token: o1.json.token };
        const get = () => call("GET", "/api/orders/" + id, { headers: { "x-order-token": token } });
        assert.strictEqual((await get()).json.order.status, "pending");
        console.log("ok  pesanan membuat QRIS dinamis dengan nominal tepat (tanpa kode unik)");

        assert.strictEqual(await hook({ orderId: "KO-" + id, status: "paid", amount: 15000 }, "salah-secret"), 401);
        assert.strictEqual((await get()).json.order.status, "pending", "signature salah tidak boleh meluluskan pesanan");
        assert.strictEqual(await hook({ orderId: "KO-" + id, status: "paid", amount: 14999 }), 200);
        assert.strictEqual((await get()).json.order.status, "pending", "nominal tidak cocok tidak boleh meluluskan pesanan");
        assert.strictEqual(await hook({ orderId: "KO-" + id, status: "pending", amount: 15000 }), 200);
        assert.strictEqual((await get()).json.order.status, "pending");
        console.log("ok  webhook: signature salah, nominal salah, status belum lunas ditolak");

        assert.strictEqual(await hook({ orderId: "KO-" + id, status: "paid", amount: 15000 }), 200);
        const done = (await get()).json.order;
        assert.strictEqual(done.status, "done"); assert.match(done.key, /^AS-/);
        assert.strictEqual(await hook({ orderId: "KO-" + id, status: "paid", amount: 15000 }), 200);
        const lic = (await call("GET", "/api/admin/licenses", { cookie: adm })).json.licenses.filter((l) => l.buyer === "Budi");
        assert.strictEqual(lic.length, 1, "webhook ganda tidak boleh membuat key kedua");
        assert.strictEqual(await hook({ orderId: "KO-tidakada", status: "paid", amount: 1 }), 200, "order tak dikenal tidak membuat webhook error");
        console.log("ok  webhook lunas membuat key otomatis, webhook ganda aman");

        // perpanjangan dari panel pembeli
        const login = await call("POST", "/api/login", { body: { key: done.key } }); const ck = login.cookie;
        const before = (await call("GET", "/api/me", { cookie: ck })).json.expiresAt;
        const opts = await call("GET", "/api/renew/options", { cookie: ck });
        assert.deepStrictEqual(opts.json.packages.map((p) => p.id), ["autostore", "autostore90", "autostore365"]);
        assert.strictEqual((await call("GET", "/api/renew/options")).status, 401, "perpanjangan butuh login pembeli");
        const rn = await call("POST", "/api/renew", { cookie: ck, body: { packageId: "autostore90" } }); assert.strictEqual(rn.status, 200);
        const rget = () => call("GET", "/api/orders/" + rn.json.id, { headers: { "x-order-token": rn.json.token } });
        const rv = (await rget()).json.order; assert.strictEqual(rv.renew, true); assert.strictEqual(rv.auto, true); assert.strictEqual(rv.days, 90); assert.strictEqual(rv.amount, 40000);
        assert.strictEqual((await call("POST", "/api/renew", { cookie: ck, body: { packageId: "service" } })).status, 400, "paket beda jenis ditolak");
        assert.strictEqual((await call("POST", `/api/admin/orders/${rn.json.id}/mock-pay`, { cookie: adm })).status, 200);
        const rdone = (await rget()).json.order; assert.strictEqual(rdone.status, "done"); assert.ok(!rdone.key, "perpanjangan tidak membuat key baru");
        const after = (await call("GET", "/api/me", { cookie: ck })).json.expiresAt;
        assert.ok(Math.abs(after - before - 90 * 864e5) < 5000, "masa aktif bertambah 90 hari");
        assert.strictEqual((await call("GET", "/api/admin/licenses", { cookie: adm })).json.licenses.filter((l) => l.buyer === "Budi").length, 1);
        console.log("ok  perpanjangan dari panel menambah masa aktif key yang sama");

        const lifetime = await call("POST", "/api/orders", { body: { type: "autostoreLifetime" } });
        assert.strictEqual(lifetime.status, 200);
        assert.strictEqual(lifetime.json.order.amount, 250000);
        assert.strictEqual(lifetime.json.order.lifetime, true);
        const lifetimeId = lifetime.json.order.id;
        assert.strictEqual((await call("POST", `/api/admin/orders/${lifetimeId}/mock-pay`, { cookie: adm })).status, 200);
        const lifetimeOrder = await call("GET", "/api/orders/" + lifetimeId, { headers: { "x-order-token": lifetime.json.token } });
        const lifetimeLogin = await call("POST", "/api/login", { body: { key: lifetimeOrder.json.order.key } });
        const lifetimeMe = await call("GET", "/api/me", { cookie: lifetimeLogin.cookie });
        assert.strictEqual(lifetimeMe.json.valid, true);
        assert.strictEqual(lifetimeMe.json.lifetime, true);
        assert.deepStrictEqual((await call("GET", "/api/renew/options", { cookie: lifetimeLogin.cookie })).json.packages, []);
        console.log("ok  checkout tanpa data pembeli menerbitkan lisensi seumur hidup");

        // harga paket dari admin
        assert.strictEqual((await call("PUT", "/api/admin/packages/autostore", { body: { price: 25000 } })).status, 401);
        assert.strictEqual((await call("PUT", "/api/admin/packages/autostore", { cookie: adm, body: { price: 5 } })).status, 400);
        assert.strictEqual((await call("PUT", "/api/admin/packages/autostore", { cookie: adm, body: { price: 25000 } })).status, 200);
        assert.strictEqual((await call("PUT", "/api/admin/packages/autostore90", { cookie: adm, body: { sellable: false } })).status, 200);
        const info2 = (await call("GET", "/api/shop-info")).json; assert.deepStrictEqual(info2.packages.map((p) => [p.id, p.price]), [["autostore", 25000], ["autostore365", 125000], ["autostoreLifetime", 250000]]);
        assert.strictEqual((await call("POST", "/api/orders", { body: { type: "autostore90", name: "Budi", contact: "x1" } })).status, 400);
        assert.strictEqual((await call("PUT", "/api/admin/packages/autostore90", { cookie: adm, body: { sellable: true } })).status, 200);
        console.log("ok  admin bisa ubah harga dan buka/tutup penjualan paket");

        // batas per IP: dengan TRUST_PROXY=1 IP asli dibaca dari X-Forwarded-For
        const xff = (ip) => ({ "X-Forwarded-For": ip });
        let hit = 0;
        for (let i = 0; i < 8 && !hit; i++) { const r = await call("POST", "/api/orders", { headers: xff("203.0.113.9"), body: { type: "autostore", name: "Spam" + i, contact: "spam" + i } }); if (r.status === 429) hit = i + 1; }
        assert.strictEqual(hit, 6, "5 pesanan pertama dari IP yang sama lolos, yang ke-6 ditahan (kena di percobaan ke-" + hit + ")");
        const other = await call("POST", "/api/orders", { headers: xff("198.51.100.4"), body: { type: "autostore", name: "Orang Lain", contact: "lain1" } });
        assert.strictEqual(other.status, 200, "pengunjung dengan IP lain tidak ikut terblokir");
        console.log("ok  batas pesanan per IP (IP lain tidak ikut terblokir)");
        console.log("\nSemua tes pesanan otomatis lulus.");
    } catch (e) { console.error("GAGAL:", e); process.exitCode = 1; }
    finally { srv.kill(); try { fs.unlinkSync(data); } catch {} }
})();
