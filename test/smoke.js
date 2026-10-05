const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");

const P = 5055, base = `http://127.0.0.1:${P}`;
const data = path.join(os.tmpdir(), `panel-${Date.now()}.json`);
const MASTER = "a".repeat(64);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
async function call(method, url, body, ck) {
    const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(ck ? { Cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie");
    return { status: r.status, json: await r.json().catch(() => ({})), cookie: sc ? sc.split(";")[0] : null };
}
const waitBot = async (ck, want, ms = 6000) => {
    const t = Date.now();
    while (Date.now() - t < ms) { const m = await call("GET", "/api/me", null, ck); if (m.json.bot === want) return true; await sleep(200); }
    return false;
};

(async () => {
    const srv = spawn(process.execPath, ["server.js"], {
        env: { ...process.env, PANEL_PORT: P, MASTER_KEY: MASTER, ADMIN_PASSWORD: "supersecret1", DATA_FILE: data,
               BOT_DIR: path.join(__dirname, "fakebot"), SKIP_VALIDATE: "1", WATCH_MS: "300", BASE_PORT: "4500" },
        stdio: "inherit",
    });
    try {
        await sleep(1200);
        // admin
        assert.strictEqual((await call("POST", "/api/admin/login", { password: "salah" })).status, 401);
        const a = await call("POST", "/api/admin/login", { password: "supersecret1" });
        assert.strictEqual(a.status, 200); const adm = a.cookie;
        assert.strictEqual((await call("GET", "/api/admin/licenses")).status, 401, "tanpa cookie harus ditolak");
        const created = await call("POST", "/api/admin/licenses", { buyer: "Budi", days: 30 }, adm);
        const key = created.json.key; assert.match(key, /^AS-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
        console.log("ok  admin buat key");

        // buyer login
        assert.strictEqual((await call("POST", "/api/login", { key: "AS-SALAH" })).status, 401);
        const b = await call("POST", "/api/login", { key }); assert.strictEqual(b.status, 200); const ck = b.cookie;
        assert.strictEqual((await call("GET", "/api/me", null, adm)).status, 401, "cookie admin bukan akses pembeli");
        console.log("ok  login pembeli + pemisahan akses");

        // validasi input
        const bad = await call("PUT", "/api/config", { botToken: "TOKEN-RAHASIA-123", clientId: "abc", mongoUrl: "mongodb://x", ownerId: "123" }, ck);
        assert.strictEqual(bad.status, 400);
        const start0 = await call("POST", "/api/bot/start", null, ck); assert.strictEqual(start0.status, 400, "belum setup tidak boleh start");
        const cfg = { botToken: "TOKEN-RAHASIA-123", clientId: "123456789012345678", mongoUrl: "mongodb://user:PASSMONGO99@host/db", ownerId: "987654321098765432" };
        assert.strictEqual((await call("PUT", "/api/config", cfg, ck)).status, 200);
        const me = (await call("GET", "/api/me", null, ck)).json;
        assert.ok(me.config.has.botToken && !JSON.stringify(me).includes("TOKEN-RAHASIA"), "secret tidak boleh bocor ke browser");
        console.log("ok  simpan config, secret tidak dikembalikan");

        // start bot
        assert.strictEqual((await call("POST", "/api/bot/start", null, ck)).status, 200);
        assert.ok(await waitBot(ck, "running"), "bot harus running");
        await sleep(500);
        const logs = (await call("GET", "/api/logs", null, ck)).json.lines.join("\n");
        assert.ok(logs.includes("fakebot up") && logs.includes("owner=987654321098765432"), "env sampai ke bot");
        assert.ok(!logs.includes("TOKEN-RAHASIA-123"), "token harus disensor di log");
        assert.ok(!logs.includes("PASSMONGO99"), "password mongo harus disensor di log");
        assert.ok(logs.includes("leak=none"), "MASTER_KEY tidak boleh bocor ke bot");
        console.log("ok  bot jalan, env benar, log tersensor, tidak ada kebocoran env panel");

        // webhook proxy
        const hook = new URL(me.webhookUrl).pathname;
        const wr = await fetch(base + hook, { method: "POST", headers: { "content-type": "application/json", "x-webhook-signature": "abc" }, body: '{"status":"completed"}' });
        assert.strictEqual(wr.status, 200);
        assert.strictEqual((await fetch(base + "/hook/tidakada", { method: "POST", body: "{}" })).status, 404);
        console.log("ok  webhook diteruskan ke bot");

        // cabut -> mati, aktifkan -> hidup lagi sendiri
        const id = (await call("GET", "/api/admin/licenses", null, adm)).json.licenses[0].id;
        await call("POST", `/api/admin/licenses/${id}/revoke`, { revoked: true }, adm);
        assert.ok(await waitBot(ck, "stopped"), "dicabut -> bot mati");
        assert.strictEqual((await call("POST", "/api/bot/start", null, ck)).status, 403);
        await call("POST", `/api/admin/licenses/${id}/revoke`, { revoked: false }, adm);
        assert.ok(await waitBot(ck, "running"), "diaktifkan -> bot hidup lagi");
        console.log("ok  cabut/aktifkan key mengendalikan bot");

        // kadaluarsa: tulis ulang file lalu restart panel tidak perlu; cek lewat data file
        const raw = fs.readFileSync(data, "utf8");
        assert.ok(!raw.includes("TOKEN-RAHASIA") && !raw.includes("PASSMONGO99") && !raw.includes(key), "data file tidak boleh berisi plaintext");
        console.log("ok  data.json terenkripsi, key hanya tersimpan sebagai hash");

        // stop manual
        await call("POST", "/api/bot/stop", null, ck);
        assert.ok(await waitBot(ck, "stopped"));
        console.log("ok  stop manual\n\nSEMUA TES LULUS");
    } catch (e) { console.error("GAGAL:", e.message); process.exitCode = 1; }
    finally { srv.kill("SIGTERM"); await sleep(300); fs.rmSync(data, { force: true }); }
})();
