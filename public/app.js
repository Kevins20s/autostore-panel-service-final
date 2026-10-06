"use strict";
const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(n);
const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") e.className = v;
        else if (k.startsWith("on")) e[k] = v;
        else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
};

async function api(method, url, body) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "Terjadi kesalahan."), { status: r.status });
    return j;
}
function toast(text, ok = true) {
    const t = h("div", { class: "t " + (ok ? "ok" : "err") }, text);
    $("toast").append(t); setTimeout(() => t.remove(), 4000);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, false); } };

function modal(title, ...body) {
    const ov = h("div", { class: "overlay" });
    const close = () => ov.remove();
    ov.append(h("div", { class: "modal" }, h("div", { class: "row sp" }, h("h2", { class: "m0" }, title), h("button", { onclick: close }, "Tutup")), ...body));
    ov.onmousedown = (e) => { if (e.target === ov) close(); };
    document.body.append(ov);
    return { close, el: ov };
}
const field = (label, input, help) => h("label", {}, label, input, help && h("div", { class: "mut" }, help));
const head = (title, sub, action) => h("div", { class: "head" }, h("div", {}, h("h1", {}, title), h("p", { class: "mut" }, sub)), action);
const card = (...k) => h("div", { class: "card" }, ...k);

let me = null;
const rpText = (wl, rate) => (rate ? "Rp " + fmt(wl * rate) : "-");

// ---------- Dashboard ----------
async function dashboard() {
    const s = await api("GET", "/api/shop/summary");
    const stat = (l, v) => h("div", { class: "stat" }, h("span", { class: "mut" }, l), h("b", {}, v));
    return h("div", {}, head("Dashboard", "Ringkasan toko kamu"),
        h("div", { class: "grid" }, stat("Produk", fmt(s.products)), stat("Stok tersedia", fmt(s.stock)), stat("Terjual", fmt(s.sold)),
            stat("User", fmt(s.users)), stat("Total saldo user (WL)", fmt(s.balance)), stat("Mode toko", s.maintenance ? "Maintenance" : "Normal")),
        card(h("h2", {}, "Langganan"), h("p", { class: "mut" }, me.valid ? `Key aktif, sisa ${me.daysLeft} hari. Bot: ${me.bot}.` : "Key tidak aktif.")));
}

// ---------- Products ----------
async function products() {
    const wrap = h("div", {});
    async function load() {
        const { products: list, rate } = await api("GET", "/api/shop/products");
        const manualRate = rate.pricePerWL;
        const body = h("tbody", {});
        for (const p of list) {
            const ready = p.price && p.stock > 0;
            body.append(h("tr", {},
                h("td", {}, h("b", {}, p.code)),
                h("td", {}, h("div", {}, p.name), h("div", { class: "mut" }, `${p.kategori} · tipe ${p.type}`)),
                h("td", {}, p.price ? h("div", {}, fmt(p.price) + " WL", p.discount ? h("span", { class: "mut" }, ` (-${p.discount}%)`) : null,
                    h("div", { class: "mut" }, `${fmt(p.price / 100)} DL · ${rpText(p.price, manualRate)}`)) : h("span", { class: "pill no" }, "Belum ada harga")),
                h("td", {}, `${fmt(p.stock)} / ${fmt(p.sold)}`),
                h("td", { class: "mut" }, p.role),
                h("td", {}, h("span", { class: "pill " + (ready ? "ok" : "no") }, ready ? "Siap jual" : p.price ? "Stok kosong" : "Atur harga")),
                h("td", {}, h("div", { class: "row gap" },
                    h("button", { class: "sm", onclick: () => stockModal(p, load) }, "Stok"),
                    h("button", { class: "sm", onclick: () => discountModal(p, load) }, "Diskon"),
                    h("button", { class: "sm", onclick: () => productModal(p, load) }, "Edit"),
                    h("button", { class: "sm bad", onclick: guard(async () => {
                        if (!confirm(`Hapus produk ${p.code}? Harga, diskon, dan ${p.stock} stok miliknya ikut terhapus.`)) return;
                        await api("DELETE", "/api/shop/products/" + encodeURIComponent(p.code)); toast("Produk dihapus."); load();
                    }) }, "Hapus")))));
        }
        const table = list.length
            ? h("div", { class: "tbl" }, h("table", {}, h("thead", {}, h("tr", {}, ...["Kode", "Detail produk", "Harga", "Stok / Terjual", "Auto role", "Status", "Aksi"].map((x) => h("th", {}, x)))), body))
            : h("p", { class: "mut" }, 'Belum ada produk. Klik "Tambah Produk Baru" untuk menambahkan.');
        wrap.replaceChildren(
            head("Manajemen Produk", "Kelola katalog produk, harga (WL/DL/Rp), stok, dan auto-role Discord.",
                h("button", { class: "pri", onclick: () => productModal(null, load) }, "+ Tambah Produk Baru")),
            card(table),
            rate.useLiveApi ? h("p", { class: "mut" }, "Harga Rp memakai kurs manual di Settings. Saat harga live aktif, bot memakai kurs live sehingga angka Rp di bot bisa berbeda.") : null);
    }
    await load();
    return wrap;
}

function productModal(p, reload) {
    const edit = !!p;
    const f = {
        code: h("input", { value: p?.code || "", disabled: edit, autocomplete: "off" }),
        name: h("input", { value: p?.name || "", autocomplete: "off" }),
        type: h("select", {}, h("option", { value: "yes" }, "yes — stok habis saat terjual (akun, RDP, VPN, dll)"), h("option", { value: "script" }, "script — satu isi utuh, tidak habis")),
        role: h("input", { value: p?.role || "", autocomplete: "off" }),
        kategori: h("input", { value: p && p.kategori !== "ALL" ? p.kategori : "", autocomplete: "off" }),
        price: h("input", { value: p?.price ?? "", autocomplete: "off", inputmode: "decimal" }),
    };
    f.type.value = p?.type || "yes";
    const m = modal(edit ? "Edit Produk" : "Tambah Produk Baru",
        field("Kode", f.code, "Huruf, angka, - dan _. Tidak bisa diubah setelah dibuat."),
        field("Nama produk", f.name), field("Tipe", f.type),
        field("ID Role Discord (diberikan ke pembeli)", f.role, "Aktifkan Developer Mode di Discord, klik kanan role, Copy Role ID."),
        field("Kategori (opsional)", f.kategori, "Kosong = ALL."),
        field("Harga (dalam WL)", f.price, "Contoh: 20 atau 9,5. 100 WL = 1 DL."),
        h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async () => {
            const body = { code: f.code.value, name: f.name.value, type: f.type.value, role: f.role.value, kategori: f.kategori.value, price: f.price.value };
            if (edit) await api("PUT", "/api/shop/products/" + encodeURIComponent(p.code), body); else await api("POST", "/api/shop/products", body);
            toast("Tersimpan."); m.close(); reload();
        }) }, "Simpan")));
}

function stockModal(p, reload) {
    const listBox = h("div", {}), info = h("div", { class: "mut" });
    const ta = h("textarea", { placeholder: p.type === "script" ? "Tempel isi script (dihitung 1 stok)" : "Satu item per baris atau dipisah spasi" });
    const count = h("input", { type: "number", min: "1", value: "1", class: "w80" });
    const enc = encodeURIComponent(p.code);
    async function load() {
        const s = await api("GET", `/api/shop/products/${enc}/stock`);
        info.textContent = `Total stok: ${fmt(s.total)}` + (s.total > s.items.length ? ` (menampilkan ${s.items.length} terlama)` : "");
        const checks = s.items.map((i) => ({ i, c: h("input", { type: "checkbox", class: "ck" }) }));
        listBox.replaceChildren(h("div", { class: "row gap mt" },
            h("button", { class: "sm", onclick: guard(async () => {
                const ids = checks.filter((x) => x.c.checked).map((x) => x.i.id);
                if (!ids.length) throw new Error("Pilih item dulu.");
                const r = await api("DELETE", `/api/shop/products/${enc}/stock`, { ids }); toast(`${r.removed} stok dihapus.`); load(); reload();
            }) }, "Hapus terpilih"),
            h("span", { class: "mut" }, "atau hapus"), count, h("span", { class: "mut" }, "terlama"),
            h("button", { class: "sm", onclick: guard(async () => {
                const r = await api("DELETE", `/api/shop/products/${enc}/stock`, { count: Number(count.value) }); toast(`${r.removed} stok dihapus.`); load(); reload();
            }) }, "Hapus"),
            h("button", { class: "sm bad", onclick: guard(async () => {
                if (!confirm(`Hapus SEMUA stok ${p.code}?`)) return;
                const r = await api("DELETE", `/api/shop/products/${enc}/stock`, { all: true }); toast(`${r.removed} stok dihapus.`); load(); reload();
            }) }, "Hapus semua")),
            h("div", { class: "tbl mt" }, h("table", {}, h("tbody", {}, ...checks.map((x) => h("tr", {}, h("td", {}, x.c), h("td", { class: "mono" }, x.i.data + (x.i.len > 120 ? "…" : ""))))))));
    }
    modal(`Stok ${p.code} — ${p.name}`, info,
        field("Tambah stok", ta),
        h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async () => {
            const r = await api("POST", `/api/shop/products/${enc}/stock`, { text: ta.value }); ta.value = ""; toast(`${r.added} stok ditambahkan.`); load(); reload();
        }) }, "Tambah")), listBox);
    load().catch((e) => toast(e.message, false));
}

function discountModal(p, reload) {
    const enc = encodeURIComponent(p.code);
    const disc = h("input", { value: p.discount ?? "", inputmode: "decimal", placeholder: "1 - 100" });
    const minQty = h("input", { inputmode: "numeric", placeholder: "Min. jumlah" }), cut = h("input", { inputmode: "decimal", placeholder: "Potongan (WL)" });
    const bulkBox = h("div", {});
    const drawBulk = () => {
        if (!p.bulk.length) return bulkBox.replaceChildren(h("p", { class: "mut" }, "Belum ada bulk discount."));
        bulkBox.replaceChildren(...p.bulk.map((b) => h("div", { class: "row sp mt" },
            h("span", {}, `Beli ≥ ${b.minQty}: potong ${fmt(b.cut)} WL per item`),
            h("button", { class: "sm bad", onclick: guard(async () => {
                await api("DELETE", `/api/shop/products/${enc}/bulk/${b.minQty}`);
                p.bulk = p.bulk.filter((x) => x !== b); drawBulk(); reload();
            }) }, "Hapus"))));
    };
    drawBulk();
    modal(`Diskon ${p.code}`,
        !p.price ? h("p", { class: "mut" }, "Atur harga produk dulu sebelum membuat diskon.") : null,
        field("Diskon (%)", disc),
        h("div", { class: "row mt gap" },
            h("button", { class: "pri", onclick: guard(async () => { await api("PUT", `/api/shop/products/${enc}/discount`, { discount: disc.value }); toast("Diskon tersimpan."); reload(); }) }, "Simpan diskon"),
            h("button", { onclick: guard(async () => { await api("DELETE", `/api/shop/products/${enc}/discount`); disc.value = ""; toast("Diskon dihapus."); reload(); }) }, "Hapus diskon")),
        h("h2", { class: "mt" }, "Bulk discount"), bulkBox,
        h("div", { class: "row mt gap" }, minQty, cut, h("button", { class: "sm", onclick: guard(async () => {
            await api("PUT", `/api/shop/products/${enc}/bulk`, { minQty: minQty.value, cut: cut.value });
            const mq = Number(minQty.value), ct = Number(String(cut.value).replace(",", "."));
            p.bulk = [...p.bulk.filter((b) => b.minQty !== mq), { minQty: mq, cut: ct }].sort((a, b) => a.minQty - b.minQty);
            minQty.value = cut.value = ""; drawBulk(); toast("Bulk discount tersimpan."); reload();
        }) }, "Tambah")));
}

// ---------- Users ----------
async function users() {
    let skip = 0, q = "";
    const wrap = h("div", {}), search = h("input", { placeholder: "Cari GrowID atau ID Discord" });
    const box = h("div", {});
    async function load() {
        const r = await api("GET", `/api/shop/users?q=${encodeURIComponent(q)}&skip=${skip}`);
        const body = h("tbody", {}, ...r.users.map((u) => h("tr", {}, h("td", { class: "mono" }, u.discordId), h("td", {}, u.growId), h("td", {}, fmt(u.balance) + " WL"), h("td", {}, fmt(u.deposit) + " WL"),
            h("td", {}, h("div", { class: "row gap" },
                h("button", { class: "sm", onclick: () => balanceModal(u, "add", load) }, "Tambah"),
                h("button", { class: "sm", onclick: () => balanceModal(u, "remove", load) }, "Kurangi"))))));
        box.replaceChildren(r.users.length ? h("div", { class: "tbl" }, h("table", {}, h("thead", {}, h("tr", {}, ...["ID Discord", "GrowID", "Saldo", "Total deposit", "Aksi"].map((x) => h("th", {}, x)))), body)) : h("p", { class: "mut" }, "Tidak ada user."),
            h("div", { class: "row sp mt" }, h("span", { class: "mut" }, `${fmt(r.total)} user`),
                h("div", { class: "row gap" }, h("button", { class: "sm", disabled: skip === 0, onclick: () => { skip = Math.max(0, skip - 50); load(); } }, "‹"), h("button", { class: "sm", disabled: skip + 50 >= r.total, onclick: () => { skip += 50; load(); } }, "›"))));
    }
    search.onkeydown = (e) => { if (e.key === "Enter") { q = search.value.trim(); skip = 0; load().catch((x) => toast(x.message, false)); } };
    wrap.append(head("Users", "Saldo dan data user toko."), card(search, box));
    await load();
    return wrap;
}
function balanceModal(u, mode, reload) {
    const amt = h("input", { inputmode: "decimal", placeholder: "Jumlah WL" });
    const add = mode === "add";
    const m = modal(`${add ? "Tambah" : "Kurangi"} saldo — ${u.growId || u.discordId}`, field("Jumlah (WL)", amt, `Saldo sekarang ${fmt(u.balance)} WL.` + (add ? " Total deposit ikut bertambah." : "")),
        h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async () => {
            await api("POST", `/api/shop/users/${u.discordId}/balance`, { amount: amt.value, mode }); toast("Saldo diperbarui."); m.close(); reload();
        }) }, "Simpan")));
}

// ---------- Settings ----------
async function settings() {
    const s = await api("GET", "/api/shop/settings");
    const mt = h("input", { type: "checkbox", checked: s.maintenance }), live = h("input", { type: "checkbox", checked: s.useLiveApi });
    mt.onchange = guard(async () => { await api("PUT", "/api/shop/settings/maintenance", { on: mt.checked }); toast(mt.checked ? "Mode maintenance aktif." : "Maintenance dimatikan."); });
    live.onchange = guard(async () => { await api("PUT", "/api/shop/settings/liveapi", { on: live.checked }); toast("Tersimpan."); });
    const rate = h("input", { value: s.pricePerWL ?? "", inputmode: "decimal" });
    return h("div", {}, head("Settings", "Pengaturan toko."),
        card(h("h2", {}, "Maintenance"), h("p", { class: "mut" }, "Saat aktif, pembelian di toko dinonaktifkan."), h("label", { class: "sw" }, mt, "Aktifkan mode maintenance")),
        card(h("h2", {}, "Kurs World Lock"), h("label", { class: "sw" }, live, "Pakai harga live (gtid.pro), kurs manual jadi cadangan"),
            field("Harga 1 WL dalam Rupiah (kurs manual)", rate), h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async () => { await api("PUT", "/api/shop/settings/wlrate", { pricePerWL: rate.value }); toast("Kurs tersimpan."); }) }, "Simpan kurs"))));
}

// ---------- Bot & Server ----------
let botFilled = false;
const BOT_FIELDS = ["botToken", "clientId", "mongoUrl", "ownerId", "adminIds", "guildId", "paymentUrl", "paymentApiKey", "paymentSecret"];
const SECRETS = ["botToken", "mongoUrl", "paymentApiKey", "paymentSecret"];
let logTimer = null;
async function bot() {
    me = await api("GET", "/api/me");
    const inp = {};
    const mk = (k, type = "text") => (inp[k] = h("input", { type, autocomplete: "off", placeholder: SECRETS.includes(k) && me.config.has[k] ? "(tersimpan)" : "", value: SECRETS.includes(k) ? "" : me.config[k] || "" }));
    const pre = h("pre", {}, "-"), msg = h("div", { class: "mut mt" });
    const act = (a) => guard(async () => { await api("POST", "/api/bot/" + a); toast("Perintah dikirim."); me = await api("GET", "/api/me"); drawState(); });
    const state = h("span", { class: "badge" });
    const drawState = () => { state.textContent = me.bot; state.className = "badge " + me.bot; updateSide(); };
    drawState();
    const invite = me.config.clientId ? `https://discord.com/oauth2/authorize?client_id=${me.config.clientId}&scope=bot%20applications.commands&permissions=8` : null;
    async function refreshLogs() {
        if (!pre.isConnected) { clearInterval(logTimer); return; }
        try {
            me = await api("GET", "/api/me"); drawState();
            const { lines } = await api("GET", "/api/logs"), end = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
            pre.textContent = lines.length ? lines.join("\n") : "-"; if (end) pre.scrollTop = pre.scrollHeight;
        } catch {}
    }
    clearInterval(logTimer); logTimer = setInterval(refreshLogs, 5000); setTimeout(refreshLogs, 50);
    const isService = me.type === "service";
    return h("div", {}, head(isService ? "Service Bot & Server" : "Bot & Server", isService ? "Hubungkan bot AutoStore Service dan database kamu." : "Hubungkan bot Discord dan database kamu."),
        card(h("div", { class: "row sp" }, h("div", { class: "row" }, h("b", {}, "Status bot"), state),
            h("div", { class: "row gap" }, h("button", { class: "pri", onclick: act("start") }, "Start"), h("button", { onclick: act("restart") }, "Restart"), h("button", { class: "bad", onclick: act("stop") }, "Stop"))),
            invite ? h("p", { class: "mut" }, "Belum masuk ke server? ", h("a", { href: invite, target: "_blank", rel: "noopener" }, "Undang bot ke server")) : null),
        card(h("h2", {}, "Pengaturan bot"), h("p", { class: "mut" }, "Kolom rahasia yang sudah tersimpan tidak ditampilkan. Kosongkan jika tidak ingin mengubahnya."),
            field("Bot Token", mk("botToken", "password"), "Developer Portal → Bot → Reset Token. Aktifkan semua Privileged Gateway Intents."),
            field("Client ID (Application ID)", mk("clientId")), field("MongoDB URL", mk("mongoUrl", "password"), "MongoDB Atlas → Connect → Drivers. Izinkan IP server di Network Access."),
            field("Owner ID (ID Discord kamu)", mk("ownerId")), field("Admin ID (opsional, pisahkan koma)", mk("adminIds")), field("ID Server Discord", mk("guildId")),
            isService ? null : field("URL Payment Gateway (opsional)", mk("paymentUrl")), isService ? null : field("API Key Payment Gateway (opsional)", mk("paymentApiKey", "password")), isService ? null : field("Webhook Secret (opsional)", mk("paymentSecret", "password")),
            isService ? null : h("p", { class: "mut" }, "URL webhook untuk payment gateway kamu: ", h("b", {}, me.webhookUrl)),
            h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async (ev) => {
                const btn = ev.currentTarget;
                if (btn.disabled) return;
                const body = {}; BOT_FIELDS.forEach((k) => { if (inp[k]) body[k] = inp[k].value; });
                btn.disabled = true; btn.textContent = "Memeriksa…";
                msg.textContent = "Memeriksa token & database, tunggu beberapa detik…";
                try { const r = await api("PUT", "/api/config", body); SECRETS.forEach((k) => { if (inp[k] && inp[k].value) { inp[k].value = ""; inp[k].placeholder = "(tersimpan)"; } }); msg.textContent = r.restartNeeded ? "Tersimpan. Tekan Restart agar berlaku." : "Tersimpan. Sekarang tekan Start."; }
                catch (e) { msg.textContent = ""; throw e; }
                finally { btn.disabled = false; btn.textContent = "Simpan"; }
            }) }, "Simpan")), msg),
        card(h("h2", {}, "Log bot"), pre));
}


// ---------- AutoStore Service ----------
async function serviceDashboard() {
    me = await api("GET", "/api/me");
    const stat = (l, v) => h("div", { class: "stat" }, h("span", { class: "mut" }, l), h("b", {}, v));
    return h("div", {},
        head("AutoStore Service", "Panel khusus jasa / service.",
            h("button", { class: "pri", onclick: () => (location.hash = "#/service-settings") }, "⚙ Kelola Jasa")),
        h("div", { class: "grid" },
            stat("Mode", "Service"),
            stat("Status key", me.valid ? "Aktif" : "Tidak aktif"),
            stat("Sisa", me.daysLeft + " hari"),
            stat("Bot", me.bot)),
        card(h("h2", {}, "Fitur Service"),
            h("p", { class: "mut" }, "PLANT, HARVEST, HARVEST MOVE, MOVE, PROVIDER, SPLICE, queue order, promo, balance, GrowID, Take/Complete/Cancel & Refund, dan auto-refresh panel.")),
        card(h("h2", {}, "Kelola dari web"),
            h("p", {}, "Atur harga dan buka/tutup tiap jenis jasa langsung dari panel tanpa harus memakai command Discord."),
            h("div", { class: "row gap" },
                h("button", { class: "pri", onclick: () => (location.hash = "#/service-settings") }, "Buka Pengaturan Jasa"))),
        card(h("h2", {}, "Database"),
            h("p", { class: "mut" }, "Service memakai MongoDB yang kamu masukkan pada key ini. Perubahan harga/status dari web langsung memakai database Service yang sama dengan bot.")));
}

async function serviceSettings() {
    const wrap = h("div", {});
    let data = await api("GET", "/api/service/settings");
    let rows = [];

    const loadRows = () => {
        rows = data.services.map((x) => {
            const price = h("input", { value: x.price, inputmode: "decimal", class: "w80" });
            const status = h("select", {},
                h("option", { value: "OPEN", selected: x.status === "OPEN" }, "OPEN"),
                h("option", { value: "CLOSE", selected: x.status !== "OPEN" }, "CLOSE"));
            return { x, price, status };
        });
    };
    loadRows();

    const tableBox = h("div", {});
    const renderTable = () => {
        const body = h("tbody", {}, ...rows.map(({ x, price, status }) => h("tr", {},
            h("td", {}, h("b", {}, x.label)),
            h("td", {}, x.blockSize ? `Per ${x.blockSize} item` : `Per ${x.unit}`),
            h("td", {}, price),
            h("td", {}, status),
            h("td", {}, fmt(x.completed))
        )));
        tableBox.replaceChildren(h("div", { class: "tbl" }, h("table", {},
            h("thead", {}, h("tr", {}, ...["Jasa", "Satuan", "Harga (WL)", "Status", "Completed"].map((x) => h("th", {}, x)))),
            body)));
    };
    renderTable();

    const msg = h("div", { class: "mut mt" });
    const save = guard(async () => {
        const services = rows.map(({ x, price, status }) => ({ type: x.type, price: price.value, status: status.value }));
        const r = await api("PUT", "/api/service/settings", { services });
        msg.textContent = r.message || "Tersimpan.";
        toast("Pengaturan jasa tersimpan.");
        data = await api("GET", "/api/service/settings");
        loadRows();
        renderTable();
    });

    wrap.append(
        head("Pengaturan Jasa", "Atur harga dan OPEN/CLOSE setiap jasa Service.",
            h("button", { onclick: () => (location.hash = "#/service") }, "← Dashboard")),
        card(h("p", { class: "mut" }, "Harga MOVE dihitung per block sesuai aturan bot. Setelah disimpan, panel Discord Service akan mengikuti database yang sama; auto-refresh bot memperbarui panel maksimal sekitar 30 detik."), tableBox,
            h("div", { class: "row mt" }, h("button", { class: "pri", onclick: save }, "Simpan Semua"), msg)),
        card(h("h2", {}, "Catatan"),
            h("ul", { class: "steps" },
                h("li", {}, "OPEN = buyer dapat memilih jasa tersebut dari panel Discord."),
                h("li", {}, "CLOSE = jasa tidak ditampilkan sebagai pilihan order baru."),
                h("li", {}, "Harga disimpan langsung ke collection jasaConfig milik Service.")))
    );
    return wrap;
}

// ---------- Tutorial & Subscription ----------
async function tutorial() {
    const li = (...k) => h("li", {}, ...k);
    return h("div", {}, head("Tutorial Setup", "Langkah pertama dari nol sampai toko jalan."),
        card(h("h2", {}, "1. Buat bot Discord"), h("ol", { class: "steps" },
            li("Buka ", h("a", { href: "https://discord.com/developers/applications", target: "_blank", rel: "noopener" }, "Discord Developer Portal"), " → New Application."),
            li("Menu Bot → Reset Token, salin tokennya."),
            li("Di halaman yang sama, aktifkan semua Privileged Gateway Intents (Presence, Server Members, Message Content)."),
            li("Menu General Information → salin Application ID (itu Client ID)."))),
        card(h("h2", {}, "2. Siapkan database"), h("ol", { class: "steps" },
            li("Buat akun gratis di MongoDB Atlas, buat cluster."),
            li("Database Access → buat user dan password."),
            li("Network Access → izinkan IP server panel ini (tanya penjual IP-nya)."),
            li("Connect → Drivers → salin URL (mongodb+srv://…), ganti <password> dengan password user tadi."))),
        card(h("h2", {}, "3. Hubungkan"), h("ol", { class: "steps" },
            li("Buka menu Bot & Server, isi semua kolom, lalu Simpan."),
            li("Pakai tautan 'Undang bot ke server', lalu Start."),
            li("Di Discord, klik kanan role yang akan diberikan ke pembeli → Copy Role ID (aktifkan Developer Mode dulu)."))),
        card(h("h2", {}, "4. Mulai jualan"), h("ol", { class: "steps" },
            li("Menu Products → Tambah Produk Baru, lalu isi harga dan stok."),
            li("Menu Settings → atur kurs WL."),
            li("Pastikan toko tidak dalam mode maintenance."))));
}
async function subscription() {
    me = await api("GET", "/api/me");
    const row = (a, b) => h("tr", {}, h("td", { class: "mut" }, a), h("td", {}, b));
    return h("div", {}, head("Subscription", "Status key kamu."),
        card(h("table", {}, h("tbody", {}, row("Pemilik", me.buyer), row("Key", me.keyPrefix + "…"),
            row("Status", me.revoked ? "Dicabut" : me.valid ? "Aktif" : "Habis"),
            row("Berlaku sampai", new Date(me.expiresAt).toLocaleString("id-ID")), row("Sisa", me.daysLeft + " hari")))),
        h("p", { class: "mut" }, "Untuk perpanjang, hubungi penjual."));
}

// ---------- router ----------
const STORE_NAV = [["dashboard", "Dashboard"], ["products", "Products"], ["users", "Users"], ["settings", "Settings"], ["bot", "Bot & Server"], ["tutorial", "Tutorial Setup"], ["subscription", "Subscription"]];
const SERVICE_NAV = [["service", "Service Dashboard"], ["service-settings", "⚙ Pengaturan Jasa"], ["bot", "Bot & Server"], ["subscription", "Subscription"]];
const VIEWS = { dashboard, products, users, settings, bot, tutorial, subscription, service: serviceDashboard, "service-settings": serviceSettings };
function updateSide() { if (me) { $("botState").textContent = "Bot: " + me.bot; $("botState").className = "badge " + me.bot; } }
function drawNav(cur) {
    const nav = me?.type === "service" ? SERVICE_NAV : STORE_NAV;
    $("nav").replaceChildren(...nav.map(([k, l]) => h("a", { class: k === cur ? "on" : "", onclick: () => (location.hash = "#/" + k) }, l)), h("a", { class: "off", title: "Segera hadir" }, "Orders (segera)"));
}
async function render() {
    const defaultView = me?.type === "service" ? "service" : "dashboard";
    let name = VIEWS[location.hash.slice(2)] ? location.hash.slice(2) : defaultView;
    if (me?.type === "service" && !["service", "service-settings", "bot", "subscription"].includes(name)) name = "service";
    drawNav(name);
    if (name !== "bot") clearInterval(logTimer);
    const view = $("view");
    view.replaceChildren(h("p", { class: "mut" }, "Memuat…"));
    try { view.replaceChildren(await VIEWS[name]()); }
    catch (e) {
        if (e.status === 401) return showLogin();
        view.replaceChildren(card(h("h2", {}, "Tidak bisa membuka halaman ini"), h("p", {}, e.message),
            e.status === 409 || e.status === 502 ? h("button", { class: "pri", onclick: () => (location.hash = "#/bot") }, "Buka Bot & Server") : null));
    }
}
function showLogin() { $("app").classList.add("hide"); $("login").classList.remove("hide"); }
async function boot() {
    try { me = await api("GET", "/api/me"); } catch { return showLogin(); }
    $("login").classList.add("hide"); $("app").classList.remove("hide"); updateSide(); render();
}
window.addEventListener("hashchange", render);
$("btnLogin").onclick = async () => {
    const m = $("loginMsg");
    try { await api("POST", "/api/login", { key: $("key").value }); boot(); } catch (e) { m.textContent = e.message; m.className = "msg err"; m.style.display = "block"; }
};
$("key").onkeydown = (e) => { if (e.key === "Enter") $("btnLogin").click(); };
$("btnOut").onclick = async () => { await api("POST", "/api/logout"); location.hash = ""; location.reload(); };
boot();
