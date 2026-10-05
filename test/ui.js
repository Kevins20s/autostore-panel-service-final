// Tes tampilan: menjalankan app.js di jsdom melawan server + MongoDB sungguhan.
let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch { console.log("SKIP: jsdom belum terpasang (npm i --no-save jsdom)"); process.exit(0); }
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert");
const { MongoClient } = require("mongodb");

const MONGO = process.env.SHOP_TEST_MONGO || "mongodb://127.0.0.1:27018/uitest";
const P = 5057, base = `http://127.0.0.1:${P}`, data = path.join(os.tmpdir(), `panel-ui-${Date.now()}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, url, body, ck) {
    const r = await fetch(base + url, { method, headers: { "Content-Type": "application/json", ...(ck ? { Cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie");
    return { json: await r.json().catch(() => ({})), cookie: sc ? sc.split(";")[0] : null };
}

(async () => {
    const mc = new MongoClient(MONGO, { serverSelectionTimeoutMS: 3000 });
    try { await mc.connect(); } catch { console.log("SKIP: Mongo tes tidak tersedia"); return; }
    await mc.db().dropDatabase();
    await mc.db().collection("bals").insertOne({ GrowID: "siti", GrowIDNow: "Siti", DiscordID: "333333333333333333", Balance: 120, Deposit: 200 });
    const srv = spawn(process.execPath, ["server.js"], { env: { ...process.env, PANEL_PORT: P, MASTER_KEY: "c".repeat(64), ADMIN_PASSWORD: "supersecret1", DATA_FILE: data, BOT_DIR: path.join(__dirname, "fakebot"), SKIP_VALIDATE: "1", WATCH_MS: "60000", BASE_PORT: "4700" }, stdio: "inherit" });
    const step = (m) => console.log("ok  " + m);
    let dom;
    try {
        await sleep(1200);
        const adm = (await call("POST", "/api/admin/login", { password: "supersecret1" })).cookie;
        const key = (await call("POST", "/api/admin/licenses", { buyer: "Toko UI", days: 30 }, adm)).json.key;
        const ck = (await call("POST", "/api/login", { key })).cookie;
        await call("PUT", "/api/config", { botToken: "TOK-123456", clientId: "123456789012345678", mongoUrl: MONGO, ownerId: "987654321098765432" }, ck);

        let cookie = "";
        dom = await JSDOM.fromURL(base + "/", {
            runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
            beforeParse(win) {
                win.confirm = () => true;
                win.fetch = async (u, o = {}) => {
                    const r = await fetch(new URL(u, base), { ...o, headers: { ...(o.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
                    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
                    return r;
                };
            },
        });
        const w = dom.window, d = w.document;
        const errors = []; w.addEventListener("error", (e) => errors.push(e.message));
        const until = async (fn, what, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = fn(); if (v) return v; } catch {} await sleep(50); } throw new Error("timeout: " + what); };
        const txt = () => d.getElementById("view").textContent;
        const btn = (label, root = d) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
        const setVal = (el, v) => { el.value = v; };

        // login lewat UI
        await until(() => !d.getElementById("login").classList.contains("hide"), "form login tampil");
        const press = (el, k) => { const ev = new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented; };
        assert.strictEqual(press(d.getElementById("key"), "a"), false, "ketikan huruf tidak boleh dibatalkan (bug: tidak bisa mengetik)");
        setVal(d.getElementById("key"), "AS-SALAH"); d.getElementById("btnLogin").click();
        await until(() => d.getElementById("loginMsg").textContent.includes("tidak ditemukan"), "pesan key salah");
        setVal(d.getElementById("key"), key); d.getElementById("btnLogin").click();
        await until(() => !d.getElementById("app").classList.contains("hide"), "dashboard tampil");
        await until(() => txt().includes("Ringkasan toko"), "judul dashboard");
        assert.ok(d.querySelectorAll("#nav a").length >= 8, "menu sidebar");
        step("login via UI (key salah ditolak, key benar masuk) + sidebar");

        // produk: kosong -> tambah
        w.location.hash = "#/products";
        await until(() => txt().includes("Belum ada produk"), "daftar produk kosong");
        btn("+ Tambah Produk Baru").click();
        const m = await until(() => d.querySelector(".modal"), "modal tambah");
        const [code, name, , role, kat, price] = m.querySelectorAll("input,select");
        setVal(code, "RDP1"); setVal(name, "RDP Murah"); setVal(role, "222222222222222222"); setVal(kat, "RDP"); setVal(price, "20");
        btn("Simpan", m).click();
        await until(() => !d.querySelector(".modal") && txt().includes("RDP Murah"), "produk muncul di tabel");
        assert.ok(txt().includes("20 WL") && txt().includes("0,2 DL"), "harga WL dan DL tampil");
        assert.ok(txt().includes("Stok kosong"), "status stok kosong");
        step("tambah produk lewat modal, harga WL/DL tampil");

        // validasi error dari server tampil sebagai toast
        btn("+ Tambah Produk Baru").click();
        const m2 = await until(() => d.querySelector(".modal"), "modal 2");
        const f2 = m2.querySelectorAll("input,select"); setVal(f2[0], "RDP1"); setVal(f2[1], "Dobel"); setVal(f2[3], "222222222222222222");
        btn("Simpan", m2).click();
        await until(() => d.getElementById("toast").textContent.includes("sudah dipakai"), "toast kode dobel");
        m2.parentElement.querySelector("button").click(); // Tutup
        step("error server tampil sebagai toast");

        // stok
        btn("Stok").click();
        const sm = await until(() => d.querySelector(".modal"), "modal stok");
        setVal(sm.querySelector("textarea"), "a:1\nb:2\nc:3"); btn("Tambah", sm).click();
        await until(() => sm.textContent.includes("Total stok: 3"), "stok bertambah jadi 3");
        assert.strictEqual(sm.querySelectorAll("tbody .ck").length, 3);
        sm.querySelector("tbody .ck").checked = true; btn("Hapus terpilih", sm).click();
        await until(() => sm.textContent.includes("Total stok: 2"), "hapus terpilih");
        sm.parentElement.querySelector("button").click();
        await until(() => txt().includes("Siap jual") && txt().includes("2 / 0"), "tabel produk ikut update");
        step("kelola stok: tambah, hapus terpilih, tabel ikut update");

        // diskon
        btn("Diskon").click();
        const dm = await until(() => d.querySelector(".modal"), "modal diskon");
        setVal(dm.querySelector("input"), "15"); btn("Simpan diskon", dm).click();
        await until(() => d.getElementById("toast").textContent.includes("Diskon tersimpan"), "diskon tersimpan");
        dm.parentElement.querySelector("button").click();
        await until(() => txt().includes("-15%"), "diskon tampil di tabel");
        step("diskon tersimpan dan tampil");

        // users
        w.location.hash = "#/users";
        await until(() => txt().includes("Siti") && txt().includes("120 WL"), "daftar user");
        btn("Tambah").click();
        const bm = await until(() => d.querySelector(".modal"), "modal saldo");
        setVal(bm.querySelector("input"), "30"); btn("Simpan", bm).click();
        await until(() => txt().includes("150 WL"), "saldo bertambah");
        step("user: saldo bertambah dari UI");

        // settings
        w.location.hash = "#/settings";
        await until(() => txt().includes("Maintenance"), "halaman settings");
        const mt = d.querySelector('.sw input[type=checkbox]'); mt.checked = true; mt.onchange();
        await until(() => d.getElementById("toast").textContent.includes("maintenance aktif"), "maintenance aktif");
        w.location.hash = "#/dashboard";
        await until(() => txt().includes("Maintenance") && txt().includes("Mode toko"), "dashboard menampilkan maintenance");
        assert.ok(txt().includes("150"), "total saldo di dashboard");
        step("settings + dashboard sinkron");

        // bot & tutorial & subscription
        w.location.hash = "#/bot";
        await until(() => txt().includes("Pengaturan bot") && d.querySelector("a[href*='oauth2/authorize']"), "halaman bot + link undang");
        assert.ok(!txt().includes("TOK-123456"), "token tidak tampil");
        w.location.hash = "#/tutorial"; await until(() => txt().includes("Buat bot Discord"), "tutorial");
        w.location.hash = "#/subscription"; await until(() => txt().includes("Toko UI") && txt().includes("30 hari") || txt().includes("29 hari"), "subscription");
        step("halaman bot, tutorial, subscription");

        // halaman admin: bisa mengetik di kolom password dan Enter = masuk
        const dom2 = await JSDOM.fromURL(base + "/admin.html", { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
            beforeParse(win) { win.fetch = (u, o = {}) => fetch(new URL(u, base), o); } });
        const d2 = dom2.window.document;
        await until(() => !d2.getElementById("login").classList.contains("hide"), "form login admin tampil");
        assert.strictEqual(press(d2.getElementById("pw"), "a"), false, "admin: ketikan huruf tidak boleh dibatalkan");
        let loginClicked = false; d2.getElementById("btnLogin").addEventListener("click", () => (loginClicked = true));
        const evEnter = new dom2.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        d2.getElementById("pw").dispatchEvent(evEnter);
        assert.ok(loginClicked, "Enter di kolom password memicu tombol Masuk");
        dom2.window.close();
        step("kolom key/password bisa diketik (ketikan tidak dibatalkan), Enter = masuk");

        assert.deepStrictEqual(errors, [], "tidak ada error JS: " + errors.join("; "));
        step("tidak ada error JavaScript\n\nSEMUA TES UI LULUS");
    } catch (e) { console.error("GAGAL:", e.stack.split("\n").slice(0, 3).join("\n")); process.exitCode = 1; }
    finally { dom?.window.close(); srv.kill("SIGTERM"); await sleep(300); await mc.close(); fs.rmSync(data, { force: true }); }
})();
