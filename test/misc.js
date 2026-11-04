// Tes kecil tanpa server/jaringan: loader .env, Turnstile, batas klaim dan batas per IP: node test/misc.js
process.env.MASTER_KEY = process.env.MASTER_KEY || "d".repeat(64);
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { parse, loadEnv } = require("../src/loadenv");
const { createTurnstile } = require("../src/turnstile");
const { createOrders, OrderError } = require("../src/orders");
const { encrypt, decrypt, sha256 } = require("../src/crypto");

(async () => {
    // loadenv
    assert.deepStrictEqual(parse('A=1\r\n# c\r\nB="x y"\r\nC=3 # k\r\nexport D=4\r\n=bad\r\n'), { A: "1", B: "x y", C: "3", D: "4" });
    const f = path.join(os.tmpdir(), `env-${Date.now()}.env`);
    fs.writeFileSync(f, "\uFEFFGS_TEST_A=dari-file\nGS_TEST_B=dari-file\n");
    process.env.GS_TEST_B = "dari-lingkungan";
    const r = loadEnv(f);
    assert.strictEqual(process.env.GS_TEST_A, "dari-file", "BOM dan variabel baru terbaca");
    assert.strictEqual(process.env.GS_TEST_B, "dari-lingkungan", "variabel yang sudah ada tidak ditimpa");
    assert.strictEqual(r.loaded, 1); fs.unlinkSync(f);
    assert.strictEqual(loadEnv(path.join(os.tmpdir(), "tidak-ada.env")).loaded, 0, "file tidak ada = aman");
    console.log("ok  loader .env");

    // turnstile
    assert.strictEqual(createTurnstile({}).enabled, false); assert.strictEqual(await createTurnstile({}).verify(""), true);
    let seen; const fake = (ok) => async (url, init) => { seen = { url, body: String(init.body) }; return { json: async () => ({ success: ok }) }; };
    const on = createTurnstile({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET: "rahasia" }, fake(true));
    assert.strictEqual(on.enabled, true); assert.strictEqual(on.siteKey, "site");
    await assert.rejects(on.verify(""), /verifikasi/i);
    assert.strictEqual(await on.verify("token-ok", "1.2.3.4"), true);
    assert.match(seen.url, /siteverify/); assert.match(seen.body, /secret=rahasia/); assert.match(seen.body, /response=token-ok/); assert.match(seen.body, /remoteip=1.2.3.4/);
    await assert.rejects(createTurnstile({ TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET: "x" }, fake(false)).verify("t"), (e) => e.status === 400 && e.expose);
    await assert.rejects(createTurnstile({ TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET: "x" }, async () => { throw new Error("jaringan"); }).verify("t"), (e) => e.status === 503);
    console.log("ok  Turnstile (aktif/nonaktif, token salah, gateway down)");

    // batas klaim + per IP
    let clock = 1_700_000_000_000; const now = () => clock;
    const store = { data: { licenses: [], nextPort: 1 }, save() {} };
    const issueLicense = (name, type, days) => { const key = "AS-" + crypto.randomBytes(6).toString("hex"); store.data.licenses.push({ id: crypto.randomBytes(3).toString("hex"), buyer: name, type, keyHash: sha256(key), expiresAt: now() + days * 864e5 }); return key; };
    const o = createOrders({ store, issueLicense, encrypt, decrypt, now, notify: async () => {} });
    const ipA = "aaaa", ipB = "bbbb";
    const mk = (i, ip) => o.create({ type: "autostore", name: "Orang" + i, contact: "k" + i + ip, ip });
    const a = []; for (let i = 0; i < 5; i++) a.push(mk(i, ipA));
    assert.throws(() => mk(9, ipA), (e) => e instanceof OrderError && e.status === 429, "IP yang sama kena batas");
    assert.doesNotThrow(() => mk(1, ipB), "IP lain tidak ikut terblokir");
    for (let i = 0; i < 3; i++) o.claim(a[i].order.id, a[i].token);
    assert.throws(() => o.claim(a[3].order.id, a[3].token), (e) => e.status === 429, "klaim ke-4 dari IP sama ditahan (anti spam notifikasi)");
    clock += 11 * 60e3; assert.doesNotThrow(() => mk(20, ipA) || true);
    console.log("ok  batas per IP dan batas klaim");
    console.log("\nSemua tes kecil lulus.");
})().catch((e) => { console.error("GAGAL:", e); process.exit(1); });
