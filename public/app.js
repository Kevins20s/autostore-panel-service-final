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
let logTimer = null;
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
    const listBox = h("div", {}), info = h("div", { class: "mut stock-summary" });
    const isScript = String(p.type).includes("script");
    const ta = h("textarea", { class: "stock-textarea", placeholder: isScript ? "Tempel isi script (dihitung sebagai 1 stok)" : "Tempel stok manual di sini — satu item per baris" , rows: "5" });
    const fileInput = h("input", { type: "file", accept: ".txt,text/plain,.csv" , class: "stock-file-input" });
    const fileName = h("div", { class: "stock-file-name" }, "Belum ada file dipilih");
    const fileCount = h("div", { class: "stock-file-count" }, isScript ? "File script akan dihitung sebagai 1 stok." : "File .txt dibaca per baris; baris kosong akan dilewati.");
    const count = h("input", { type: "number", min: "1", value: "1", class: "w80" });
    const enc = encodeURIComponent(p.code);
    let fileText = null;
    fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        fileText = null;
        if (!file) {
            fileName.textContent = "Belum ada file dipilih";
            fileCount.textContent = isScript ? "File script akan dihitung sebagai 1 stok." : "File .txt dibaca per baris; baris kosong akan dilewati.";
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            fileInput.value = "";
            fileName.textContent = "File terlalu besar (maksimal 10 MB)";
            fileCount.textContent = "Pilih file teks yang lebih kecil.";
            return;
        }
        try {
            fileText = await file.text();
            const lines = fileText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            fileName.textContent = file.name;
            fileCount.textContent = isScript
                ? `Siap diimpor · ${fileText.length.toLocaleString("id-ID")} karakter · dihitung 1 stok`
                : `Siap diimpor · ${lines.length.toLocaleString("id-ID")} item dari baris file`;
            ta.value = fileText;
        } catch {
            fileText = null;
            fileName.textContent = "File tidak dapat dibaca";
            fileCount.textContent = "Coba simpan ulang sebagai file teks UTF-8 (.txt).";
        }
    };
    async function load() {
        const s = await api("GET", `/api/shop/products/${enc}/stock`);
        info.textContent = `Total stok: ${fmt(s.total)}` + (s.total > s.items.length ? ` (menampilkan ${s.items.length} item terlama)` : "");
        const checks = s.items.map((i) => ({ i, c: h("input", { type: "checkbox", class: "ck" }) }));
        listBox.replaceChildren(h("div", { class: "row gap mt stock-toolbar" },
            h("button", { class: "sm", onclick: guard(async () => {
                const ids = checks.filter((x) => x.c.checked).map((x) => x.i.id);
                if (!ids.length) throw new Error("Pilih item dulu.");
                const r = await api("DELETE", `/api/shop/products/${enc}/stock`, { ids }); toast(`${r.removed} stok dihapus.`); load(); reload();
            }) }, "Hapus terpilih"),
            h("span", { class: "mut" }, "atau hapus"), count, h("span", { class: "mut" }, "item terlama"),
            h("button", { class: "sm", onclick: guard(async () => {
                const r = await api("DELETE", `/api/shop/products/${enc}/stock`, { count: Number(count.value) }); toast(`${r.removed} stok dihapus.`); load(); reload();
            }) }, "Hapus"),
            h("button", { class: "sm bad", onclick: guard(async () => {
                if (!confirm(`Hapus SEMUA stok ${p.code}?`)) return;
                const r = await api("DELETE", `/api/shop/products/${enc}/stock`, { all: true }); toast(`${r.removed} stok dihapus.`); load(); reload();
            }) }, "Hapus semua")),
            h("div", { class: "tbl mt stock-list" }, h("table", {}, h("tbody", {}, ...checks.map((x) => h("tr", {}, h("td", {}, x.c), h("td", { class: "mono" }, x.i.data + (x.i.len > 120 ? "…" : ""))))))));
    }
    const addFromText = async () => {
        const useFile = Boolean(fileText !== null);
        const text = useFile ? fileText : ta.value;
        if (!String(text || "").trim()) throw new Error("Pilih file atau isi stok terlebih dahulu.");
        const payload = { text };
        if (useFile && !isScript) payload.lineMode = true;
        const r = await api("POST", `/api/shop/products/${enc}/stock`, payload);
        ta.value = ""; fileInput.value = ""; fileText = null;
        fileName.textContent = "Belum ada file dipilih";
        fileCount.textContent = isScript ? "File script akan dihitung sebagai 1 stok." : "File .txt dibaca per baris; baris kosong akan dilewati.";
        toast(`${r.added} stok berhasil ditambahkan.`); await load(); reload();
    };
    const fileCard = h("div", { class: "stock-upload-card" },
        h("div", { class: "stock-upload-title" }, h("span", { class: "stock-upload-icon" }, "↑"), h("div", {}, h("strong", {}, "Tambah stok dari file"), h("div", { class: "mut" }, isScript ? "Impor satu file sebagai satu stok script." : "Setiap baris non-kosong menjadi satu item stok."))),
        fileInput,
        h("label", { class: "stock-file-picker", onclick: () => fileInput.click() }, h("span", {}, "Pilih file .txt")),
        fileName, fileCount);
    modal(`Stok ${p.code} — ${p.name}`,
        h("div", { class: "stock-modal-intro" }, h("span", { class: "stock-modal-icon" }, "▦"), h("div", {}, h("strong", {}, "Kelola inventori"), h("p", { class: "mut" }, "Tambahkan stok manual atau impor banyak item sekaligus. File tidak diunggah ke server terpisah; isinya dibaca di browser lalu dikirim ke API stok."))),
        info,
        fileCard,
        field("Atau tambah manual", ta, isScript ? "Tipe script disimpan sebagai satu stok utuh." : "Mode manual tetap mengikuti pemisahan stok lama; gunakan file untuk membaca satu item per baris."),
        h("div", { class: "row mt stock-add-actions" }, h("button", { class: "pri", onclick: guard(addFromText) }, "Tambah stok")),
        h("h3", { class: "stock-existing-heading" }, "Stok tersedia"), listBox);
    // Hide the standalone input; the visible label opens the same file chooser.
    fileInput.classList.add("stock-file-hidden");
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
    let settings = { services: [] };
    try { settings = await api("GET", "/api/service/settings"); } catch {}
    const stat = (l, v) => h("div", { class: "stat svc-stat" }, h("span", { class: "mut" }, l), h("b", {}, v));
    const services = settings.services || [];
    const open = services.filter(x => String(x.status).toUpperCase() === "OPEN").length;
    return h("div", { class: "svc-page" },
        h("div", { class: "svc-hero" },
            h("div", {}, h("div", { class: "svc-kicker" }, "AUTOSTORE SERVICE"), h("h1", {}, "Kelola jasa lebih mudah."), h("p", { class: "mut" }, "Atur harga, buka/tutup jasa, dan pantau Service bot dari satu panel.")),
            h("div", { class: "svc-live " + (me.bot === "running" ? "is-on" : "") }, h("span", {}, "●"), me.bot === "running" ? "ONLINE" : String(me.bot || "OFFLINE").toUpperCase())
        ),
        h("div", { class: "svc-stats" }, stat("Status Key", me.valid ? "Aktif" : "Tidak aktif"), stat("Masa aktif", `${me.daysLeft} hari`), stat("Bot Service", me.bot), stat("Jasa OPEN", `${open}/${services.length || 6}`)),
        h("div", { class: "svc-actions" },
            h("button", { class: "svc-action primary", onclick: () => location.hash = "#/service-settings" }, h("b", {}, "Harga & Status Jasa"), h("span", {}, "Atur harga dan OPEN/CLOSED →")),
            h("button", { class: "svc-action", onclick: () => location.hash = "#/bot" }, h("b", {}, "Bot & Server"), h("span", {}, "Token, MongoDB, dan kontrol bot →")),
            h("button", { class: "svc-action", onclick: () => location.hash = "#/subscription" }, h("b", {}, "Subscription"), h("span", {}, "Lihat masa aktif key →"))
        ),
        card(h("div", { class: "row sp" }, h("div", {}, h("h2", {}, "Daftar Jasa"), h("p", { class: "mut" }, "Harga dan status yang aktif di Service bot.")), h("button", { class: "sm", onclick: () => location.hash = "#/service-settings" }, "Kelola")),
            h("div", { class: "svc-service-grid" }, ...(services.length ? services : [
                {type:"PLANT",label:"PLANT",price:30,status:"OPEN",unit:"World"},{type:"HARVEST",label:"HARVEST",price:30,status:"OPEN",unit:"World"},{type:"HARVEST MOVE",label:"HARVEST MOVE",price:40,status:"OPEN",unit:"World"},{type:"MOVE",label:"MOVE",price:1,status:"OPEN",unit:"Item / 200"},{type:"PROVIDER",label:"PROVIDER",price:40,status:"OPEN",unit:"World"},{type:"SPLICE",label:"SPLICE",price:45,status:"OPEN",unit:"World"}
            ]).map(x => h("div", { class: "svc-service-card" }, h("div", { class: "row sp" }, h("b", {}, x.label || x.type), h("span", { class: "svc-status " + (String(x.status).toUpperCase()==="OPEN" ? "open" : "closed") }, String(x.status || "CLOSED").toUpperCase())), h("strong", {}, `${fmt(Number(x.price || 0))} WL`), h("span", { class: "mut" }, `per ${x.unit || "unit"}`), h("small", { class: "mut" }, `${fmt(Number(x.completed || 0))} selesai`))))),
        card(h("h2", {}, "Tips"), h("p", { class: "mut" }, "Gunakan Harga & Status Jasa untuk mengubah harga dari web. Perubahan akan tersimpan ke database Service yang digunakan bot."))
    );
}

async function serviceSettings() {
    const data = await api("GET", "/api/service/settings");
    const defs = {
        "PLANT": ["PLANT", "World"], "HARVEST": ["HARVEST", "World"], "HARVEST MOVE": ["HARVEST MOVE", "World"],
        "MOVE": ["MOVE", "Item / 200"], "PROVIDER": ["PROVIDER", "World"], "SPLICE": ["SPLICE", "World"]
    };
    const source = data.services || [];
    const map = new Map(source.map(x => [x.type, x]));
    const rows = Object.keys(defs).map(type => map.get(type) || { type, price: 0, status: "OPEN", completed: 0 });
    const controls = rows.map(x => {
        const price = h("input", { type: "number", min: "0", step: "1", value: x.price ?? 0 });
        const status = h("select", {}, h("option", { value: "OPEN" }, "OPEN"), h("option", { value: "CLOSED" }, "CLOSED"));
        status.value = String(x.status || "OPEN").toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN";
        return { x, price, status };
    });
    const save = h("button", { class: "pri" }, "Simpan Semua");
    save.onclick = guard(async () => {
        save.disabled = true; save.textContent = "Menyimpan…";
        try {
            await api("PUT", "/api/service/settings", { services: controls.map(({x, price, status}) => ({ type: x.type, price: price.value, status: status.value })) });
            toast("Pengaturan jasa berhasil disimpan.");
            location.hash = "#/service";
        } finally { save.disabled = false; save.textContent = "Simpan Semua"; }
    });
    return h("div", { class: "svc-page" },
        head("Harga & Status Jasa", "Atur harga Service dan buka/tutup jasa tanpa perlu mengetik command Discord."),
        card(h("div", { class: "svc-settings-head" }, h("div", {}, h("h2", {}, "Pengaturan jasa"), h("p", { class: "mut" }, "Harga menggunakan satuan WL. MOVE dihitung per 200 item sesuai sistem Service.")), save)),
        h("div", { class: "svc-settings-grid" }, ...controls.map(({x, price, status}) => h("div", { class: "svc-setting-card" },
            h("div", { class: "row sp" }, h("div", {}, h("b", {}, defs[x.type][0]), h("div", { class: "mut" }, `Satuan: ${defs[x.type][1]}`)), h("span", { class: "svc-status " + (status.value === "OPEN" ? "open" : "closed") }, status.value)),
            field("Harga (WL)", price), field("Status", status), h("div", { class: "mut mt" }, `Selesai: ${fmt(Number(x.completed || 0))}`)
        )))
    );
}


// ---------- AutoStore Service: Custom Emoji ----------
const SERVICE_EMOJI_FIELDS = [
    ["WL", "World Lock", "Mata uang WL"], ["DL", "Diamond Lock", "Mata uang DL"], ["BGL", "Blue Gem Lock", "Mata uang BGL"],
    ["CROWN", "Crown", "Judul panel"], ["ARROW", "Arrow", "Info / pemisah"], ["Benar", "Berhasil / OPEN", "Status sukses"],
    ["Salah", "Error / CLOSE", "Status gagal"], ["Warning", "Warning", "Peringatan"], ["Loading", "Loading", "Proses"],
    ["Buy", "Buy / Completed", "Pembelian / selesai"], ["Megaphone", "Order Notification", "Notifikasi order"], ["BALANCE", "Balance", "Saldo"],
    ["BOT", "Bot", "Bot / service"], ["EARTH", "World", "World"], ["Dolar", "Dollar", "Harga"],
    ["SetGrowID", "Set GrowID", "Tombol GrowID"], ["BalanceButton", "Balance Button", "Tombol saldo"],
    ["Deposit", "Deposit", "Tombol deposit"], ["DepositQRIS", "Deposit QRIS", "Pembayaran QRIS"], ["AdminPanel", "Admin Panel", "Panel admin"],
    ["Queue", "Queue", "Antrian"], ["Waiting", "Waiting", "Status menunggu"], ["COLOR", "Embed Color", "Warna #RRGGBB"]
];
const EMOJI_PALETTE = ["😀","😎","🔥","✨","💎","💰","🪙","👑","🌎","🌱","🌾","🚚","📦","🛒","💳","💵","📢","🔔","⚡","✅","❌","⚠️","⏳","🔄","🎯","🛠️","📋","🎮","🟢","🔴"];
function validServiceEmoji(value, key) {
    const v = String(value || '').trim();
    if (key === 'COLOR') return /^#[0-9A-Fa-f]{6}$/.test(v) || v === '';
    if (!v) return false;
    if (/^<a?:[A-Za-z0-9_~]+:\d{17,20}>$/.test(v)) return true;
    return Array.from(v).length <= 12;
}

function discordEmojiUrl(v) {
    const text = String(v || '').trim();
    const m = text.match(/^<([a]?):[A-Za-z0-9_~]+:(\d{17,20})>$/);
    if (!m) return null;

    const animated = m[1] === 'a';
    const id = m[2];

    return [
        `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=128&quality=lossless`,
        `https://media.discordapp.net/emojis/${id}.${animated ? 'gif' : 'png'}?size=128&quality=lossless`
    ];
}

function emojiVisual(v, size = 52) {
    const text = String(v || '').trim();
    const urls = discordEmojiUrl(text);

    if (!text) {
        return h('span', {
            style: `font-size:${Math.max(18, Math.round(size * .55))}px;line-height:1`
        }, '—');
    }

    if (urls) {
        const img = h('img', {
            alt: '',
            title: text,
            width: size,
            height: size,
            style: `width:${size}px;height:${size}px;object-fit:contain;display:block`
        });

        img.dataset.emojiUrls = JSON.stringify(urls);
        img.dataset.emojiAttempt = '0';

        img.onerror = () => {
            const list = JSON.parse(img.dataset.emojiUrls || '[]');
            const next = Number(img.dataset.emojiAttempt || '0') + 1;
            img.dataset.emojiAttempt = String(next);

            if (next < list.length) {
                img.src = list[next];
            } else {
                // Keep the actual Discord emoji code visible instead of crashing
                // the page when Discord's CDN rejects the image.
                img.replaceWith(h('span', {
                    title: text,
                    style: `font-size:12px;line-height:1.2;max-width:${size}px;text-align:center;word-break:break-all`
                }, text));
            }
        };

        img.src = urls[0];
        return img;
    }

    return h('span', {
        style: `font-size:${Math.max(18, Math.round(size * .55))}px;line-height:1;display:block;white-space:nowrap`
    }, text);
}

async function serviceEmojiApi(method, action, body) {
    const endpoints = action === 'get' ? ['/api/service/emojis', '/api/emojis'] : action === 'save' ? ['/api/service/emojis', '/api/emojis'] : ['/api/service/emojis/reset', '/api/emojis/reset'];
    let lastError = null;
    for (const url of endpoints) {
        try { return await api(method, url, body); }
        catch (e) { lastError = e; if (e.status !== 404) throw e; }
    }
    throw lastError || new Error('Endpoint Custom Emoji tidak tersedia.');
}

async function serviceEmojis() {
    const r = await serviceEmojiApi('GET', 'get');
    const values = { ...(r.emojis || {}) };
    const selected = { value: SERVICE_EMOJI_FIELDS[0][0] };

    const select = h('select', { style: 'width:100%;max-width:520px' });
    for (const [key, label, help] of SERVICE_EMOJI_FIELDS) {
        select.append(h('option', { value: key }, `${label} — ${key}`));
    }

    const title = h('h2', { style: 'margin:0' }, 'Emoji yang sedang digunakan');
    const help = h('p', { class: 'mut', style: 'margin:6px 0 0' }, 'Pilih satu emoji di daftar. Preview di kanan menampilkan emoji yang sedang dipakai.');
    const previewBox = h('div', {
        style: 'width:96px;height:96px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.045);display:flex;align-items:center;justify-content:center;flex:none'
    });
    const previewName = h('b', {});
    const previewValue = h('div', { class: 'mut', style: 'font-family:monospace;font-size:12px;word-break:break-all;margin-top:6px' });
    const input = h('input', { autocomplete: 'off', spellcheck: 'false', style: 'width:100%' });
    const msg = h('div', { class: 'mut', style: 'margin-top:10px' });

    function draw() {
        const key = selected.value;
        const meta = SERVICE_EMOJI_FIELDS.find(x => x[0] === key);
        input.value = values[key] || '';
        previewBox.replaceChildren(emojiVisual(input.value, 58));
        previewName.textContent = meta ? `${meta[1]} (${key})` : key;
        previewValue.textContent = input.value || '—';
    }

    select.onchange = () => { selected.value = select.value; draw(); };
    input.oninput = () => {
        values[selected.value] = input.value;
        previewBox.replaceChildren(emojiVisual(input.value, 58));
        previewValue.textContent = input.value || '—';
    };

    const save = h('button', { class: 'pri', onclick: guard(async () => {
        const current = { ...values, [selected.value]: input.value.trim() };
        for (const [key] of SERVICE_EMOJI_FIELDS) {
            if (!validServiceEmoji(current[key], key)) throw new Error(`Format ${key} tidak valid.`);
        }
        const out = await serviceEmojiApi('PUT', 'save', { emojis: current });
        Object.assign(values, current);
        msg.textContent = out.restarted ? 'Tersimpan. Bot Service sedang restart dengan emoji baru.' : 'Tersimpan.';
        toast('Custom emoji tersimpan.');
        draw();
    }) }, '💾 Simpan Emoji');

    const reset = h('button', { onclick: guard(async () => {
        if (!confirm('Kembalikan semua emoji ke default?')) return;
        const out = await serviceEmojiApi('POST', 'reset');
        Object.assign(values, out.emojis || {});
        msg.textContent = out.restarted ? 'Default dipulihkan. Bot sedang restart.' : 'Default dipulihkan.';
        toast('Emoji default dipulihkan.');
        draw();
    }) }, 'Reset Default');

    draw();
    return h('div', {},
        head('Custom Emoji', 'Atur emoji AutoStore Service per key tanpa memenuhi halaman dengan banyak kotak.'),
        card(
            h('div', { style: 'display:flex;gap:24px;align-items:center;flex-wrap:wrap' },
                h('div', { style: 'flex:1;min-width:260px' }, title, help,
                    h('div', { style: 'margin-top:18px' }, select),
                    h('div', { style: 'margin-top:12px' }, input),
                    h('div', { class: 'mut', style: 'font-size:12px;margin-top:6px' }, 'Unicode atau custom Discord: <:nama:id> / <a:nama:id>')
                ),
                h('div', { style: 'width:140px;text-align:center' }, previewBox, h('div', { style: 'margin-top:10px' }, previewName), previewValue)
            ),
            h('div', { class: 'row gap', style: 'margin-top:18px' }, save, reset),
            msg
        )
    );
}

// ---------- AutoStore: Custom Emoji ----------
const STORE_EMOJI_FIELDS = [
    ["WL", "World Lock"], ["DL", "Diamond Lock"], ["BGL", "Blue Gem Lock"],
    ["CROWN", "Crown"], ["ARROW", "Arrow"], ["EARTH", "Earth"], ["BOT", "Bot"],
    ["Dolar", "Dollar"], ["BALANCE", "Balance"], ["Warning", "Warning"], ["Benar", "Berhasil"],
    ["Salah", "Gagal"], ["Megaphone", "Order Notification"], ["Loading", "Loading"], ["Buy", "Buy"],
    ["SetGrowID", "Set GrowID"], ["BalanceButton", "Balance Button"], ["Deposit", "Deposit"],
    ["DepositQRIS", "Deposit QRIS"], ["AdminPanel", "Admin Panel"], ["Queue", "Queue"], ["Waiting", "Waiting"],
    ["COLOR", "Warna Embed"]
];
function storeCustomEmojis() {
    return customEmojiEditor({
        title: "Custom Emoji AutoStore",
        subtitle: "Atur emoji yang digunakan bot AutoStore untuk produk, pembelian, saldo, dan notifikasi.",
        fields: STORE_EMOJI_FIELDS,
        endpoint: "/api/emojis",
        resetEndpoint: "/api/emojis/reset",
        includeBanner: false
    });
}

// ---------- AutoStore: Custom Banner ----------
function storeCustomBanner() {
    return customEmojiEditor({
        title: "Custom Banner",
        subtitle: "Atur gambar banner yang tampil pada embed toko AutoStore. Gunakan URL gambar HTTPS yang bisa diakses publik.",
        fields: [["imageUrl", "Banner utama"], ["imageUrl2", "Banner realtime"]],
        endpoint: "/api/emojis",
        resetEndpoint: "/api/emojis/reset",
        includeBanner: true
    });
}

async function customEmojiEditor({ title, subtitle, fields, endpoint, resetEndpoint, includeBanner }) {
    const r = await api("GET", endpoint);
    const values = { ...(r.emojis || {}) };
    const defaults = { ...(r.defaults || {}) };
    const selected = { value: fields[0][0] };
    const select = h("select", { style: "width:100%;max-width:520px" });
    fields.forEach(([key, label]) => select.append(h("option", { value: key }, `${label} — ${key}`)));
    const input = h("input", { autocomplete: "off", spellcheck: "false", style: "width:100%", placeholder: includeBanner ? "https://.../banner.png" : "Emoji Unicode atau <:nama:id>" });
    const previewBox = h("div", { style: "width:110px;height:110px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(255,255,255,.045);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none" });
    const previewName = h("b", {});
    const previewValue = h("div", { class: "mut", style: "font-family:monospace;font-size:12px;word-break:break-all;margin-top:6px" });
    const msg = h("div", { class: "mut", style: "margin-top:10px" });
    const help = h("p", { class: "mut", style: "margin:6px 0 0" }, includeBanner ? "Tempel URL gambar PNG, JPG, GIF, atau WEBP. Link harus dapat dibuka tanpa login." : "Masukkan emoji Unicode atau format custom Discord seperti <:nama:id> / <a:nama:id>.");

    function draw() {
        const key = selected.value;
        const meta = fields.find(x => x[0] === key);
        input.value = values[key] || "";
        previewBox.replaceChildren();
        if (includeBanner && input.value) {
            const img = h("img", { alt: "Preview banner", style: "width:100%;height:100%;object-fit:contain" });
            img.onerror = () => { previewBox.replaceChildren(h("span", { class: "mut", style: "padding:8px;text-align:center" }, "Gambar tidak dapat dimuat")); };
            img.src = input.value;
            previewBox.append(img);
        } else if (includeBanner) {
            previewBox.append(h("span", { class: "mut" }, "Preview"));
        } else {
            previewBox.append(emojiVisual(input.value, 62));
        }
        previewName.textContent = meta ? `${meta[1]} (${key})` : key;
        previewValue.textContent = input.value || "—";
    }
    select.onchange = () => { selected.value = select.value; draw(); };
    input.oninput = () => { values[selected.value] = input.value; draw(); };

    const save = h("button", { class: "pri", onclick: guard(async () => {
        const current = { ...values, [selected.value]: input.value.trim() };
        for (const [key] of fields) {
            const value = String(current[key] || "").trim();
            if (!value) throw new Error(`${key} tidak boleh kosong.`);
            if (includeBanner) {
                let u; try { u = new URL(value); } catch { throw new Error(`${key} harus berupa URL yang valid.`); }
                if (u.protocol !== "https:") throw new Error(`${key} harus menggunakan HTTPS.`);
            } else if (key === "COLOR") {
                if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error("Warna harus menggunakan format #RRGGBB.");
            } else if (!/^<a?:[A-Za-z0-9_~]+:\d{17,20}>$/.test(value) && Array.from(value).length > 12) {
                throw new Error(`Format ${key} terlalu panjang. Gunakan emoji Unicode atau format <:nama:id>.`);
            }
        }
        const out = await api("PUT", endpoint, { emojis: current });
        Object.assign(values, current);
        msg.textContent = out.restarted ? "Tersimpan. Bot sedang restart dengan pengaturan baru." : "Tersimpan. Tekan Restart di menu Bot & Server agar perubahan diterapkan.";
        toast(includeBanner ? "Custom banner tersimpan." : "Custom emoji tersimpan.");
        draw();
    }) }, includeBanner ? "💾 Simpan Banner" : "💾 Simpan Emoji");
    const reset = h("button", { onclick: guard(async () => {
        if (!confirm(includeBanner ? "Kembalikan URL banner ke default? Emoji lain tidak akan diubah." : "Kembalikan semua emoji ke default?")) return;
        let out;
        if (includeBanner) {
            const restored = { ...values };
            for (const [key] of fields) restored[key] = defaults[key] || "";
            out = await api("PUT", endpoint, { emojis: restored });
            Object.assign(values, restored);
        } else {
            out = await api("POST", resetEndpoint);
            Object.assign(values, out.emojis || {});
        }
        msg.textContent = out.restarted ? "Default dipulihkan. Bot sedang restart." : "Default dipulihkan.";
        toast("Pengaturan default dipulihkan.");
        draw();
    }) }, "Reset Default");
    draw();
    return h("div", {},
        head(title, subtitle),
        card(h("div", { style: "display:flex;gap:24px;align-items:center;flex-wrap:wrap" },
            h("div", { style: "flex:1;min-width:260px" }, h("h2", { style: "margin:0" }, includeBanner ? "Gambar yang sedang digunakan" : "Emoji yang sedang digunakan"), help,
                h("div", { style: "margin-top:18px" }, select), h("div", { style: "margin-top:12px" }, input)),
            h("div", { style: "width:150px;text-align:center" }, previewBox, h("div", { style: "margin-top:10px" }, previewName), previewValue)),
            h("div", { class: "row gap", style: "margin-top:18px" }, save, reset), msg),
        includeBanner ? h("p", { class: "mut" }, "Catatan: reset banner juga mengembalikan konfigurasi emoji ke default karena keduanya disimpan bersama dalam konfigurasi AutoStore.") : null
    );
}

// ---------- AutoStore Service: Orders ----------
const ORDER_STATUS = {
    all: ["Semua", ""], waiting: ["Menunggu", "waiting"], in_progress: ["Diproses", "in_progress"], done: ["Selesai", "done"]
};
function orderStatusBadge(status) {
    const map = { waiting: ["Waiting", "svc-status"], in_progress: ["Diproses", "svc-status open"], done: ["Selesai", "svc-status open"] };
    const x = map[status] || [status || "-", "svc-status"];
    return h("span", { class: x[1] }, x[0]);
}
async function serviceOrders() {
    const active = { value: "all" };
    const body = h("div", {});
    const render = async () => {
        body.replaceChildren(h("p", { class: "mut" }, "Memuat order…"));
        const r = await api("GET", `/api/service/orders?status=${encodeURIComponent(active.value)}&limit=100`);
        const c = r.counts || {};
        const cards = h("div", { class: "grid" },
            h("div", { class: "stat" }, h("span", { class: "mut" }, "Total Orders"), h("b", {}, fmt(c.total || 0))),
            h("div", { class: "stat" }, h("span", { class: "mut" }, "Menunggu"), h("b", {}, fmt(c.waiting || 0))),
            h("div", { class: "stat" }, h("span", { class: "mut" }, "Diproses"), h("b", {}, fmt(c.in_progress || 0))),
            h("div", { class: "stat" }, h("span", { class: "mut" }, "Selesai"), h("b", {}, fmt(c.done || 0)))
        );
        const filter = h("select", { value: active.value, onchange: guard(async e => { active.value = e.target.value; await render(); }) }, ...Object.entries(ORDER_STATUS).map(([k,v]) => h("option", { value:k }, v[0])));
        const rows = (r.orders || []).map(o => h("tr", {},
            h("td", {}, `#${o.orderNumber ?? "-"}`),
            h("td", {}, h("b", {}, o.type || "-"), h("div", { class: "mut" }, `${fmt(o.amount || 0)} ${o.unit || ""}`)),
            h("td", {}, `${fmt(o.price || 0)} WL`),
            h("td", {}, orderStatusBadge(o.status)),
            h("td", {}, o.assignedTo ? `<@${o.assignedTo}>` : "Belum diambil"),
            h("td", {}, o.createdAt ? new Date(o.createdAt).toLocaleString("id-ID") : "-")
        ));
        const table = card(h("div", { class: "row sp" }, h("div", {}, h("h2", {}, "Order Terbaru"), h("p", { class: "mut" }, "Data langsung dari collection jasaorders pada MongoDB Service.")), filter),
            h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Order"), h("th", {}, "Jasa"), h("th", {}, "Harga"), h("th", {}, "Status"), h("th", {}, "Staff"), h("th", {}, "Dibuat"))), h("tbody", {}, ...(rows.length ? rows : [h("tr", {}, h("td", { colspan:"6", class:"mut" }, "Belum ada order."))])))));
        body.replaceChildren(cards, table);
    };
    await render();
    return h("div", {}, head("Orders", "Kelola dan pantau order Service dari panel web tanpa harus membuka Discord."), body);
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
const STORE_NAV = [["dashboard", "Dashboard"], ["products", "Products"], ["users", "Users"], ["settings", "Settings"], ["emojis", "🎨 Custom Emoji"], ["banner", "🖼️ Custom Banner"], ["bot", "Bot & Server"], ["tutorial", "Tutorial Setup"], ["subscription", "Subscription"]];
const SERVICE_NAV = [["service", "⌂ Dashboard"], ["service-settings", "₩ Harga & Status"], ["service-emojis", "🎨 Custom Emoji"], ["orders", "🛒 Orders"], ["bot", "⚙ Bot & Server"], ["subscription", "◇ Subscription"]];
const VIEWS = { dashboard, products, users, settings, bot, tutorial, subscription, emojis: storeCustomEmojis, banner: storeCustomBanner, service: serviceDashboard, "service-settings": serviceSettings, "service-emojis": serviceEmojis, orders: serviceOrders };
function updateSide() { if (me) { $("botState").textContent = "Bot: " + me.bot; $("botState").className = "badge " + me.bot; } }
function drawNav(cur) {
    const nav = me?.type === "service" ? SERVICE_NAV : STORE_NAV;
    $("nav").replaceChildren(...nav.map(([k, l]) => h("a", { class: k === cur ? "on" : "", onclick: () => (location.hash = "#/" + k) }, l)), );
}
async function render() {
    const defaultView = me?.type === "service" ? "service" : "dashboard";
    let name = VIEWS[location.hash.slice(2)] ? location.hash.slice(2) : defaultView;
    if (me?.type === "service" && !["service", "service-settings", "service-emojis", "orders", "bot", "subscription"].includes(name)) name = "service";
    if (me?.type !== "service" && ["service", "service-settings", "service-emojis", "orders"].includes(name)) name = "dashboard";
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
