// Tes pesanan key (tanpa server/jaringan): node test/orders.js
process.env.MASTER_KEY = process.env.MASTER_KEY || "b".repeat(64);
const assert = require("assert");
const crypto = require("crypto");
const { createOrders, OrderError } = require("../src/orders");
const { encrypt, decrypt, sha256 } = require("../src/crypto");
const registerOrderRoutes = require("../src/ordersapi");

let clock = 1_700_000_000_000;
const now = () => clock;
const mk = () => {
    const store = { data: { licenses: [], nextPort: 4000 }, saves: 0, save() { this.saves++; } };
    const sent = [];
    const issueLicense = (name, type, days, { save = true } = {}) => {
        const key = (type === "service" ? "SV" : "AS") + "-" + crypto.randomBytes(8).toString("hex").toUpperCase();
        store.data.licenses.push({ id: crypto.randomBytes(4).toString("hex"), buyer: name, type, keyHash: sha256(key), expiresAt: now() + days * 864e5, port: store.data.nextPort++ });
        if (save) store.save();
        return key;
    };
    const o = createOrders({ store, issueLicense, encrypt, decrypt, now, ttlMin: 30, notify: async (m) => { sent.push(m); }, publicUrl: "https://panel.example" });
    return { store, sent, o };
};
const throwsMsg = (fn, re, status) => { try { fn(); } catch (e) { assert(e instanceof OrderError, "harus OrderError: " + e.message); assert.match(e.message, re); if (status) assert.strictEqual(e.status, status); return; } assert.fail("seharusnya error " + re); };

// 1. validasi
{ const { o } = mk();
  throwsMsg(() => o.create({ type: "x", name: "Budi", contact: "0812" }), /Paket/);
  throwsMsg(() => o.create({ type: "autostore", name: "B", contact: "0812" }), /Nama/);
  throwsMsg(() => o.create({ type: "service" }), /Paket/);
  console.log("ok  validasi input"); }

// 2. alur normal + nominal unik + token
{ const { o, store, sent } = mk();
  const a = o.create({ type: "autostore", name: "Budi", contact: "0812-3456" });
  assert(a.order.amount > 15000 && a.order.amount <= 15499, "nominal 15.001-15.499");
  assert.strictEqual(a.order.status, "pending");
  assert(!JSON.stringify(store.data.orders).includes(a.token), "token mentah tidak boleh tersimpan");
  assert.strictEqual(o.get(a.order.id, a.token).status, "pending");
  throwsMsg(() => o.get(a.order.id, "salah"), /tidak ditemukan/, 404);
  throwsMsg(() => o.get(a.order.id, ""), /tidak ditemukan/, 404);
  assert.strictEqual(sent.length, 0, "belum ada notifikasi sebelum klik sudah bayar");
  o.claim(a.order.id, a.token);
  assert.strictEqual(sent.length, 1); assert.match(sent[0].text, /GS-/); assert.match(sent[0].text, /Rp15\.\d{3}/); assert.match(sent[0].text, /admin\.html/);
  o.claim(a.order.id, a.token); assert.strictEqual(sent.length, 1, "klik ganda tidak mengirim notifikasi ganda");
  assert.strictEqual(store.data.licenses.length, 0, "key BELUM dibuat sebelum admin konfirmasi");
  assert.strictEqual(o.get(a.order.id, a.token).key, undefined);
  const c = o.confirm(a.order.id);
  assert.match(c.key, /^AS-/); assert.strictEqual(store.data.licenses.length, 1);
  assert.strictEqual(store.data.licenses[0].buyer, "Budi");
  assert.strictEqual(o.get(a.order.id, a.token).key, c.key, "pembeli melihat key setelah konfirmasi");
  const c2 = o.confirm(a.order.id);
  assert.strictEqual(store.data.licenses.length, 1, "konfirmasi dua kali tidak membuat key kedua"); assert.strictEqual(c2.already, true); assert.strictEqual(c2.key, c.key);
  console.log("ok  alur pesan > bayar > konfirmasi > key"); }

// 3. key hanya tampil 24 jam
{ const { o } = mk();
  const a = o.create({ type: "autostore", name: "Sari", contact: "sari#1234" });
  o.claim(a.order.id, a.token); const { key } = o.confirm(a.order.id);
  assert.match(key, /^AS-/);
  clock += 23 * 3600e3; assert.strictEqual(o.get(a.order.id, a.token).key, key);
  clock += 2 * 3600e3; const v = o.get(a.order.id, a.token); assert.strictEqual(v.key, undefined); assert.strictEqual(v.status, "done");
  console.log("ok  key hilang dari halaman pembeli setelah 24 jam"); }

// 4. kedaluwarsa, tolak, nominal unik
{ const { o, store } = mk();
  const a = o.create({ type: "autostore", name: "Andi", contact: "andi@x" });
  clock += 31 * 60e3; assert.strictEqual(o.get(a.order.id, a.token).status, "expired");
  throwsMsg(() => o.claim(a.order.id, a.token), /kedaluwarsa/, 409);
  const b = o.create({ type: "autostore", name: "Rina", contact: "rina" }); o.reject(b.order.id);
  assert.strictEqual(o.get(b.order.id, b.token).status, "rejected");
  throwsMsg(() => o.confirm(b.order.id), /ditolak/, 409);
  assert.strictEqual(store.data.licenses.length, 0);
  const seen = new Set();
  for (let i = 0; i < 15; i++) { const x = o.create({ type: "autostore", name: "U" + i, contact: "kontak" + i }); assert(!seen.has(x.order.amount), "nominal tidak boleh kembar"); seen.add(x.order.amount); }
  console.log("ok  kedaluwarsa, tolak, nominal unik"); }

// 5. batas
{ const { o } = mk();
  for (let i = 0; i < 3; i++) o.create({ type: "autostore", name: "Budi", contact: "SAMA" });
  throwsMsg(() => o.create({ type: "autostore", name: "Budi", contact: "sama" }), /belum dibayar/, 429);
  const m = mk();
  for (let i = 0; i < 20; i++) m.o.create({ type: "autostore", name: "U" + i, contact: "kontak" + i });
  throwsMsg(() => m.o.create({ type: "autostore", name: "Lagi", contact: "kontakx" }), /Terlalu banyak/, 429);
  console.log("ok  batas pesanan per kontak dan per waktu"); }

// 6. pembersihan riwayat lama
{ const { o, store } = mk();
  const a = o.create({ type: "autostore", name: "Lama", contact: "lama" }); o.reject(a.order.id);
  clock += 31 * 86400e3; o.sweep(); assert.strictEqual(store.data.orders.length, 0);
  console.log("ok  riwayat selesai dibersihkan setelah 30 hari"); }

// 7. lapisan HTTP (app tiruan)
(async () => {
    const { o } = mk(); const routes = {};
    const app = {
        get: (p, ...f) => (routes["GET " + p] = f),
        post: (p, ...f) => (routes["POST " + p] = f),
        put: (p, ...f) => (routes["PUT " + p] = f),
        delete: (p, ...f) => (routes["DELETE " + p] = f),
    };
    let isAdmin = false; const admin = (req, res, next) => (isAdmin ? next() : res.status(401).json({ error: "Belum login admin." }));
    registerOrderRoutes(app, { admin, orders: o, ttlMin: 30 });
    const call = (key, { body, headers = {}, params = {} } = {}) => new Promise((resolve) => {
        const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, json: j, headers: this.headers }); }, redirect(u) { resolve({ code: 302, json: { to: u }, headers: {} }); } };
        const req = { body, headers, params };
        const chain = routes[key]; let i = 0;
        const next = () => { const fn = chain[i++]; fn(req, res, next); };
        next();
    });
    const info = await call("GET /api/shop-info"); assert.deepStrictEqual(info.json.packages.map(p => p.price), [15000, 40000, 125000, 250000]); assert.strictEqual(info.headers["Cache-Control"], "no-store");
    const bad = await call("POST /api/orders", { body: { type: "service" } }); assert.strictEqual(bad.code, 400);
    const mkd = await call("POST /api/orders", { body: { type: "autostore", name: "Budi", contact: "0812" } }); assert.strictEqual(mkd.code, 200);
    const { token, order } = mkd.json;
    assert.strictEqual((await call("GET /api/orders/:id", { params: { id: order.id }, headers: { "x-order-token": "salah" } })).code, 404);
    assert.strictEqual((await call("GET /api/orders/:id", { params: { id: order.id }, headers: { "x-order-token": token } })).json.order.status, "pending");
    assert.strictEqual((await call("POST /api/orders/:id/paid", { params: { id: order.id }, headers: { "x-order-token": token } })).json.order.status, "claimed");
    assert.strictEqual((await call("GET /api/admin/orders")).code, 401);
    assert.strictEqual((await call("POST /api/admin/orders/:id/confirm", { params: { id: order.id } })).code, 401, "konfirmasi tanpa login admin harus ditolak");
    isAdmin = true;
    const list = await call("GET /api/admin/orders"); assert.strictEqual(list.json.orders[0].status, "claimed"); assert.strictEqual(list.json.orders[0].name, "Budi");
    const cf = await call("POST /api/admin/orders/:id/confirm", { params: { id: order.id } }); assert.match(cf.json.key, /^AS-/);
    const fin = await call("GET /api/orders/:id", { params: { id: order.id }, headers: { "x-order-token": token } }); assert.strictEqual(fin.json.order.key, cf.json.key);
    assert.strictEqual((await call("GET /beli")).json.to, "/beli.html");
    console.log("ok  rute HTTP (publik, admin, token, hak akses)");
    console.log("\nSemua tes pesanan lulus.");
})().catch((e) => { console.error("GAGAL:", e); process.exit(1); });
