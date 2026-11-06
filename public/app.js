"use strict";
const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat(gsLocale, { maximumFractionDigits: 2 }).format(n);
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
    if (!r.ok) throw Object.assign(new Error(gsT(j.error || "Terjadi kesalahan.")), { status: r.status });
    return j;
}
function toast(text, ok = true) {
    const t = h("div", { class: "t " + (ok ? "ok" : "err") }, text);
    $("toast").append(t); setTimeout(() => t.remove(), 4000);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, false); } };
const empty = (kind, title, sub) => h("div", { class: "empty" }, h("div", { class: "empty-ico empty-" + kind }), h("strong", {}, title), h("p", { class: "mut" }, sub));
const copyText = async (t) => { try { await navigator.clipboard.writeText(String(t)); toast(gsT("Tersalin.")); } catch { toast(gsT("Gagal menyalin. Salin manual ya."), false); } };
const copyBtn = (t, label = gsT("Salin")) => h("button", { type: "button", class: "copy-btn", title: gsT("Salin ke clipboard"), onclick: (e) => { e.stopPropagation(); copyText(t); } }, label);
const BOT_LABEL = { running: "Online", stopped: "Offline", crashed: "Error", starting: gsT("Memulai"), restarting: "Restart" };
function botIndicator() {
    if (me.hostedBot?.enabled) return { label: gsT("Bot GevraStore"), state: me.hostedBot.state };
    if (me.hostedBot && me.bot === "stopped") return { label: gsT("Bot GevraStore"), state: "stopped" };
    return { label: me.type === "service" ? "Bot Service" : gsT("Bot sendiri"), state: me.bot || "stopped" };
}
const botPill = () => {
    const { label, state } = botIndicator();
    return h("span", { class: "badge " + state }, label + ": " + (BOT_LABEL[state] || state));
};
const skeleton = () => h("div", { class: "skel-wrap", "aria-busy": "true", "aria-label": gsT("Memuat") }, h("div", { class: "skel skel-title" }), h("div", { class: "skel skel-line" }),
    h("div", { class: "skel-grid" }, h("div", { class: "skel skel-card" }), h("div", { class: "skel skel-card" }), h("div", { class: "skel skel-card" })), h("div", { class: "skel skel-block" }));
function renewBanner() {
    if (!me) return null;
    const contact = (typeof CONTACT_URL === "string" && /^https:\/\//i.test(CONTACT_URL)) ? h("a", { href: CONTACT_URL, target: "_blank", rel: "noopener noreferrer" }, gsT("Hubungi penjual")) : gsT("Hubungi penjual");
    const renewBtn = h("button", { type: "button", class: "pri sm", onclick: () => renewDialog() }, gsT("Perpanjang sekarang"));
    if (me.revoked) return h("div", { class: "notice bad", role: "alert" }, h("b", {}, gsT("Key dinonaktifkan.")), " ", contact, gsT(" untuk bantuan."));
    if (!me.valid || me.daysLeft <= 0) return h("div", { class: "notice bad", role: "alert" }, h("b", {}, gsT("Langganan sudah berakhir.")), " ", renewBtn, gsT(" atau "), contact, ".");
    if (me.daysLeft <= 7) return h("div", { class: "notice warn", role: "status" }, h("b", {}, gsT`Langganan berakhir dalam ${me.daysLeft} hari.`), " ", renewBtn, gsT(" atau "), contact, gsT(" sebelum bot berhenti."));
    return null;
}

// Perpanjang dari panel: pilih paket, buat pesanan perpanjangan, lalu lanjut bayar di halaman /beli.
async function renewDialog() {
    let pk;
    try { pk = (await api("GET", "/api/renew/options")).packages; } catch (e) { return toast(e.message, false); }
    if (!pk.length) return toast(gsT("Paket perpanjangan belum tersedia. Hubungi penjual."), false);
    const sel = h("select", {}, ...pk.map((p) => h("option", { value: p.id }, gsT`${p.name}: ${p.days} hari, Rp ${fmt(p.price)}`)));
    const m = modal(gsT("Perpanjang langganan"),
        h("p", { class: "mut" }, gsT("Pilih paket, lalu kamu diarahkan ke halaman pembayaran. Setelah lunas, masa aktif key ini bertambah (tanpa key baru). Sisa hari yang masih ada tetap dihitung.")),
        field(gsT("Paket"), sel),
        h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async (ev) => {
            const b = ev.currentTarget; if (b.disabled) return; b.disabled = true;
            try { const r = await api("POST", "/api/renew", { packageId: sel.value }); location.href = "/beli.html#" + r.id + "." + r.token; }
            finally { b.disabled = false; }
        }) }, gsT("Lanjut ke pembayaran")), h("button", { onclick: () => m.close() }, gsT("Batal"))));
}

// Modal bertumpuk: Esc menutup yang paling atas, Tab berputar di dalam modal, fokus kembali ke tombol pemicu.
const modalStack = [];
document.addEventListener("keydown", (e) => {
    const top = modalStack[modalStack.length - 1];
    if (!top) return;
    if (e.key === "Escape") { e.preventDefault(); top.close(); }
    else if (e.key === "Tab") {
        const f = [...top.dlg.querySelectorAll("a[href],button,input,select,textarea")].filter((x) => !x.disabled && x.type !== "hidden" && x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
});
function modal(title, ...body) {
    const prev = document.activeElement;
    const ov = h("div", { class: "overlay" });
    const dlg = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" },
        h("div", { class: "row sp" }, h("h2", { class: "m0" }, title), h("button", { onclick: () => close() }, gsT("Tutup"))), ...body);
    const entry = { close: () => close(), dlg };
    function close() {
        const i = modalStack.indexOf(entry); if (i >= 0) modalStack.splice(i, 1);
        ov.remove();
        if (prev && prev.focus && document.contains(prev)) prev.focus();
    }
    ov.append(dlg);
    ov.onmousedown = (e) => { if (e.target === ov) close(); };
    document.body.append(ov); modalStack.push(entry);
    (dlg.querySelector("input:not([disabled]):not([type=hidden]):not([type=file]):not([type=checkbox]),textarea,select") || dlg).focus();
    return { close, el: ov };
}
const field = (label, input, help) => h("label", {}, label, input, help && h("div", { class: "mut" }, help));
const head = (title, sub, action) => h("div", { class: "head" }, h("div", {}, h("h1", {}, title), h("p", { class: "mut" }, sub)), action);
const card = (...k) => h("div", { class: "card" }, ...k);

let me = null;
let logTimer = null;
const rpText = (wl, rate) => (rate ? "Rp " + fmt(wl * rate) : "-");

// ---------- Dashboard ----------
// Grafik batang penjualan (WL per hari). SVG dibuat lewat DOM, tanpa library.
function salesChart(daily, days) {
    const ns = "http://www.w3.org/2000/svg", W = 640, H = 190, pl = 8, pr = 8, pt = 14, pb = 26;
    const byDate = new Map(daily.map((d) => [d.date, d]));
    const pts = [];
    for (let i = days - 1; i >= 0; i--) { // tanggal WIB (UTC+7), sama dengan pengelompokan di server
        const key = new Date(Date.now() - i * 864e5 + 7 * 3600e3).toISOString().slice(0, 10);
        pts.push({ key, ...(byDate.get(key) || { orders: 0, qty: 0, wl: 0 }) });
    }
    const max = Math.max(1, ...pts.map((x) => x.wl)), bw = (W - pl - pr) / pts.length;
    const detail = h("p", { class: "mut chart-detail", "aria-live": "polite" }, gsLanguage === "en" ? "Select a bar to see daily details." : "Pilih batang untuk melihat detail harian.");
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "chart"); svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", `WL · ${days}`);
    const mk = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
    svg.append(mk("line", { x1: pl, x2: W - pr, y1: H - pb, y2: H - pb, class: "ch-axis" }));
    pts.forEach((x, i) => {
        const bh = Math.max(2, (x.wl / max) * (H - pt - pb)), w = Math.min(64, bw * 0.72);
        const bx = pl + i * bw + (bw - w) / 2;
        const label = gsT`${x.key}: ${fmt(x.orders)} order, ${fmt(x.qty)} item, ${fmt(x.wl)} WL`;
        const g = mk("g", { tabindex: 0, role: "button", "aria-label": label, "aria-pressed": "false" });
        const select = () => {
            svg.querySelector('[aria-pressed="true"]')?.setAttribute("aria-pressed", "false");
            g.setAttribute("aria-pressed", "true");
            detail.textContent = label;
        };
        g.addEventListener("click", select);
        g.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            select();
        });
        g.addEventListener("pointerenter", () => { detail.textContent = label; });
        g.addEventListener("focus", () => { detail.textContent = label; });
        g.append(mk("rect", { x: bx, y: H - pb - bh, width: w, height: Math.max(bh, 0), rx: 3, class: "ch-bar" }));
        g.append(mk("rect", { x: pl + i * bw, y: pt, width: bw, height: H - pt - pb, class: "ch-hit" })); // area sentuh untuk tooltip
        svg.append(g);
        if (i % Math.ceil(pts.length / 7) === 0 || i === pts.length - 1) svg.append(mk("text", { x: pl + i * bw + bw / 2, y: H - 8, "text-anchor": "middle", class: "ch-txt" }, x.key.slice(8) + "/" + x.key.slice(5, 7)));
    });
    svg.append(mk("text", { x: pl, y: 10, class: "ch-txt" }, fmt(max) + " WL"));
    return h("div", {}, svg, detail);
}

function productSalesDonut(products) {
    const sold = products.filter(product => product.qty > 0);
    const total = sold.reduce((sum, product) => sum + product.qty, 0);
    const detail = h("p", { class: "mut chart-detail", "aria-live": "polite" },
        total ? (gsLanguage === "en" ? "Choose a slice to see product sales." : "Pilih irisan untuk melihat penjualan produk.")
            : gsT("Belum ada penjualan tercatat"));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 160 160");
    svg.setAttribute("aria-hidden", "true");
    const ring = () => {
        const circle = document.createElementNS(svg.namespaceURI, "circle");
        for (const [key, value] of Object.entries({ cx: 80, cy: 80, r: 62, pathLength: 100, fill: "none" })) {
            circle.setAttribute(key, value);
        }
        svg.append(circle);
        return circle;
    };
    ring().setAttribute("class", "donut-track");
    const legend = h("div", { class: "donut-legend" });
    let offset = 0;
    sold.forEach((product, index) => {
        const share = product.qty / total * 100;
        const color = `hsl(${(165 + index * 137.5) % 360} 72% 59%)`;
        const slice = ring();
        slice.setAttribute("class", "donut-slice");
        slice.setAttribute("stroke", color);
        slice.setAttribute("stroke-dasharray", `${share} ${100 - share}`);
        slice.setAttribute("stroke-dashoffset", -offset);
        offset += share;
        const name = product.name || (gsLanguage === "en" ? "Unnamed product" : "Produk tanpa nama");
        const percentage = share < 0.01 ? "<0.01%" : fmt(share) + "%";
        const label = `${name} · ${fmt(product.qty)} item · ${fmt(product.wl)} WL · ${percentage}`;
        const dot = h("span", { class: "donut-dot" });
        dot.style.backgroundColor = color;
        const button = h("button", { type: "button", "aria-label": label, "aria-pressed": "false" }, dot, name + " · " + percentage);
        const show = () => { detail.textContent = label; };
        const select = () => {
            legend.querySelector('[aria-pressed="true"]')?.setAttribute("aria-pressed", "false");
            svg.querySelector(".selected")?.classList.remove("selected");
            button.setAttribute("aria-pressed", "true");
            slice.classList.add("selected");
            show();
        };
        slice.addEventListener("pointerenter", show);
        slice.addEventListener("click", select);
        button.addEventListener("focus", show);
        button.addEventListener("click", select);
        legend.append(button);
    });
    return h("div", {}, h("div", { class: "donut-figure" }, svg,
        h("div", { class: "donut-total" }, h("strong", {}, fmt(total)), h("span", { class: "mut" }, gsLanguage === "en" ? "items sold" : "item terjual"))),
        legend, detail);
}

async function dashboard() {
    const [s, st] = await Promise.all([api("GET", "/api/shop/summary"), api("GET", "/api/shop/stats?days=14").catch(() => null)]);
    const stat = (l, v) => h("div", { class: "stat" }, h("span", { class: "mut" }, l), h("b", {}, v));
    const charts = h("div", { class: "desk-columns sales-charts" });
    const insights = h("div");
    const periodLabel = gsLanguage === "en" ? "Sales period" : "Periode penjualan";
    const period = h("select", { "aria-label": periodLabel }, ...[1, 3, 7, 14, 30].map(days =>
        h("option", { value: days }, gsT`${days} hari`)));
    period.value = "14";
    const left = h("div"), right = h("div");
    charts.append(card(h("div", { class: "row sp" }, h("h2", {}, gsLanguage === "en" ? "Sales (WL)" : "Penjualan (WL)"), period), left),
        card(h("h2", {}, gsLanguage === "en" ? "Sales by product" : "Penjualan per produk"), right));
    function draw(stats) {
        if (!stats) {
            left.replaceChildren(h("p", { class: "mut" }, gsT("Data penjualan belum dapat dimuat.")));
            right.replaceChildren();
            insights.replaceChildren();
            return;
        }
        const st = stats;
        const tot = st.daily.reduce((a, d) => ({ orders: a.orders + d.orders, qty: a.qty + d.qty, wl: a.wl + d.wl }), { orders: 0, qty: 0, wl: 0 });
        left.replaceChildren(h("p", { class: "mut" }, gsT`${fmt(tot.orders)} order, ${fmt(tot.qty)} item, ${fmt(tot.wl)} WL`),
            salesChart(st.daily, st.days));
        right.replaceChildren(productSalesDonut(st.productSales || []));
        const top = st.top.length
            ? h("ol", { class: "rank" }, ...st.top.map((t) => h("li", {}, h("span", {}, h("b", {}, t.name), " ", h("span", { class: "mut" }, t.code)), h("span", { class: "mut" }, gsT`${fmt(t.qty)} terjual`))))
            : h("p", { class: "mut" }, gsT("Belum ada data."));
        const low = st.low.length
            ? h("ul", { class: "rank" }, ...st.low.map((p) => h("li", {}, h("span", {}, h("b", {}, p.name), " ", h("span", { class: "mut" }, p.code)), h("span", { class: "pill " + (p.stock ? "no" : "bad") }, p.stock ? gsT`sisa ${p.stock}` : gsT("habis")))))
            : h("p", { class: "mut" }, gsT`Semua produk berharga punya stok lebih dari ${st.lowAt}.`);
        insights.replaceChildren(h("div", { class: "desk-insights" }, card(h("h2", {}, gsT("Produk terlaris")), top),
            card(h("div", { class: "row sp" }, h("h2", { class: "m0" }, gsT("Stok menipis")), st.low.length ? h("a", { href: "#/products" }, gsT("Isi stok")) : null), low)));
    }
    draw(st);
    let request = 0;
    period.addEventListener("change", async () => {
        const version = ++request;
        const next = await api("GET", "/api/shop/stats?days=" + period.value).catch(() => null);
        if (version === request) draw(next);
    });
    return h("div", { class: "store-overview" },
        h("section", { class: "desk-header head" },
            h("div", {}, h("h1", {}, gsT("Ringkasan toko")),
                h("p", { class: "mut" }, gsT("Penjualan, inventaris, dan bot Discord."))),
            h("a", { class: "desk-bot-link", href: "#/bot" }, botPill(),
                h("span", { class: "mut" }, me.valid ? (me.lifetime ? gsT("Lisensi seumur hidup") : gsT`Lisensi aktif · ${me.daysLeft} hari lagi`) : gsT("Lisensi tidak aktif")))),
        s ? h("section", { class: "desk-metrics", "aria-label": gsT("Ringkasan toko") },
            stat(gsT("Terjual"), fmt(s.sold)), stat(gsT("Stok tersedia"), fmt(s.stock)),
            stat(gsT("Produk"), fmt(s.products)), stat(gsT("Pelanggan"), fmt(s.users)),
            stat(gsT("Saldo pelanggan (WL)"), fmt(s.balance)), stat(gsT("Mode toko"), s.maintenance ? "Maintenance" : "Normal"))
            : null,
        charts,
        insights);
}

// ---------- Orders (riwayat pembelian di Discord) ----------
async function storeOrders() {
    let q = "", skip = 0, timer = null;
    const body = h("tbody", {}), sum = h("div", { class: "grid" }), more = h("button", { class: "sm hide" }, gsT("Muat lebih banyak")), host = h("div", {});
    const search = h("input", { type: "search", placeholder: gsT("Cari produk, kode, Grow ID, atau ID Discord"), autocomplete: "off", "aria-label": gsT("Cari order") });
    const stat = (l, v) => h("div", { class: "stat" }, h("span", { class: "mut" }, l), h("b", {}, v));
    async function load(reset) {
        if (reset) { skip = 0; body.replaceChildren(); }
        const r = await api("GET", `/api/shop/orders?skip=${skip}&q=${encodeURIComponent(q)}`);
        sum.replaceChildren(stat(q ? gsT("Order cocok") : gsT("Total order"), fmt(r.total)), stat(gsT("Item terjual"), fmt(r.qty)), stat("Total (WL)", fmt(r.wl)));
        for (const o of r.orders) body.append(h("tr", {},
            h("td", {}, o.number != null ? "#" + o.number : "-"), h("td", {}, when(o.at)),
            h("td", {}, h("div", {}, o.growId || "-"), h("div", { class: "mut mono" }, o.discordId)),
            h("td", {}, h("div", {}, o.name), h("div", { class: "mut" }, o.code)), h("td", {}, fmt(o.qty)), h("td", {}, fmt(o.total) + " WL")));
        skip += r.orders.length;
        more.classList.toggle("hide", skip >= r.total);
        host.replaceChildren(body.children.length ? h("div", { class: "tbl" }, h("table", {}, h("thead", {}, h("tr", {}, ...["Order", gsT("Waktu"), gsT("Pembeli"), gsT("Produk"), gsT("Jumlah"), "Total"].map((x) => h("th", {}, x)))), body))
            : empty("clipboard", q ? gsT("Tidak ada order yang cocok") : gsT("Belum ada order tercatat"), q ? gsT("Coba kata kunci lain.") : gsT("Riwayat mulai tercatat sejak bot diperbarui ke versi ini. Pembelian lama tidak ikut tampil.")));
    }
    more.onclick = guard(() => load(false));
    search.oninput = () => { clearTimeout(timer); timer = setTimeout(guard(() => { q = search.value.trim(); return load(true); }), 300); };
    await load(true);
    return h("div", {}, head("Orders", gsT("Riwayat pembelian produk di Discord.")), sum, card(h("div", { class: "toolbar" }, search), host, h("div", { class: "row mt" }, more)));
}

// ---------- Products ----------
async function products() {
    const wrap = h("div", {});
    let data = null;
    const q = h("input", { type: "search", placeholder: gsT("Cari kode, nama, atau kategori"), autocomplete: "off", "aria-label": gsT("Cari produk") });
    const flt = h("select", { "aria-label": gsT("Filter status") },
        h("option", { value: "all" }, gsT("Semua status")), h("option", { value: "ready" }, gsT("Siap jual")),
        h("option", { value: "nostock" }, gsT("Stok kosong")), h("option", { value: "noprice" }, gsT("Belum ada harga")));
    const tableHost = h("div", {});
    const matches = (p) => {
        const t = q.value.trim().toLowerCase();
        if (t && !`${p.code} ${p.name} ${p.kategori}`.toLowerCase().includes(t)) return false;
        if (flt.value === "ready") return p.price && p.stock > 0;
        if (flt.value === "nostock") return p.price && p.stock <= 0;
        if (flt.value === "noprice") return !p.price;
        return true;
    };
    function draw() {
        const { products: list, rate } = data;
        const manualRate = rate.pricePerWL;
        const shown = list.filter(matches);
        const body = h("tbody", {});
        for (const p of shown) {
            const ready = p.price && p.stock > 0;
            body.append(h("tr", {},
                h("td", {}, h("b", {}, p.code), " ", copyBtn(p.code)),
                h("td", {}, h("div", {}, p.name), h("div", { class: "mut" }, gsT`${p.kategori}  tipe ${p.type}`)),
                h("td", {}, p.price ? h("div", {}, fmt(p.price) + " WL", p.discount ? h("span", { class: "mut" }, ` (-${p.discount}%)`) : null,
                    h("div", { class: "mut" }, `${fmt(p.price / 100)} DL  ${rpText(p.price, manualRate)}`)) : h("span", { class: "pill no" }, gsT("Belum ada harga"))),
                h("td", {}, `${fmt(p.stock)} / ${fmt(p.sold)}`),
                h("td", { class: "mut" }, p.role),
                h("td", {}, h("span", { class: "pill " + (ready ? "ok" : "no") }, ready ? gsT("Siap jual") : p.price ? gsT("Stok kosong") : gsT("Atur harga"))),
                h("td", {}, h("div", { class: "row gap" },
                    h("button", { class: "sm", onclick: () => stockModal(p, load) }, gsT("Stok")),
                    h("button", { class: "sm", onclick: () => discountModal(p, load) }, gsT("Diskon")),
                    h("button", { class: "sm", onclick: () => productModal(p, load) }, "Edit"),
                    h("button", { class: "sm bad", onclick: guard(async () => {
                        if (!(await gsConfirm(gsT`Hapus produk ${p.code}? Harga, diskon, dan ${p.stock} stok miliknya ikut terhapus.`, { danger: true, okText: gsT("Hapus produk") }))) return;
                        await api("DELETE", "/api/shop/products/" + encodeURIComponent(p.code)); toast(gsT("Produk dihapus.")); load();
                    }) }, gsT("Hapus"))))));
        }
        tableHost.replaceChildren(shown.length
            ? h("div", { class: "tbl" }, h("table", {}, h("thead", {}, h("tr", {}, ...[gsT("Kode"), gsT("Detail produk"), gsT("Harga"), gsT("Stok / Terjual"), "Auto role", "Status", gsT("Aksi")].map((x) => h("th", {}, x)))), body))
            : list.length ? empty("box", gsT("Tidak ada produk yang cocok"), gsT("Ubah kata kunci atau filter status."))
                : empty("box", gsT("Belum ada produk"), gsT('Klik "Tambah Produk Baru" untuk menambahkan produk pertamamu.')));
    }
    async function load() {
        data = await api("GET", "/api/shop/products");
        const { products: list, rate } = data;
        wrap.replaceChildren(
            head(gsT("Manajemen Produk"), gsT("Kelola katalog produk, harga (WL/DL/Rp), stok, dan auto-role Discord."),
                h("button", { class: "pri", onclick: () => productModal(null, load) }, gsT("+ Tambah Produk Baru"))),
            card(list.length > 5 ? h("div", { class: "toolbar" }, q, flt) : null, tableHost),
            rate.useLiveApi ? h("p", { class: "mut" }, gsT("Harga Rp memakai kurs manual di Settings. Saat harga live aktif, bot memakai kurs live sehingga angka Rp di bot bisa berbeda.")) : null);
        draw();
    }
    q.oninput = () => data && draw(); flt.onchange = () => data && draw();
    await load();
    return wrap;
}

function productModal(p, reload) {
    const edit = !!p;
    const f = {
        code: h("input", { value: p?.code || "", disabled: edit, autocomplete: "off" }),
        name: h("input", { value: p?.name || "", autocomplete: "off" }),
        type: h("select", {}, h("option", { value: "yes" }, gsT("yes — stok habis saat terjual (akun, RDP, VPN, dll)")), h("option", { value: "script" }, "script — satu isi utuh, tidak habis")),
        role: h("input", { value: p?.role || "", autocomplete: "off" }),
        kategori: h("input", { value: p && p.kategori !== "ALL" ? p.kategori : "", autocomplete: "off" }),
        price: h("input", { value: p?.price ?? "", autocomplete: "off", inputmode: "decimal" }),
    };
    f.type.value = p?.type || "yes";
    const m = modal(edit ? gsT("Edit Produk") : gsT("Tambah Produk Baru"),
        field(gsT("Kode"), f.code, gsT("Huruf, angka, - dan _. Tidak bisa diubah setelah dibuat.")),
        field(gsT("Nama produk"), f.name), field(gsT("Tipe"), f.type),
        field(gsT("ID Role Discord (diberikan ke pembeli)"), f.role, gsT("Aktifkan Developer Mode di Discord, klik kanan role, Copy Role ID.")),
        field(gsT("Kategori (opsional)"), f.kategori, gsT("Kosong = ALL.")),
        field(gsT("Harga (dalam WL)"), f.price, gsT("Contoh: 20 atau 9,5. 100 WL = 1 DL.")),
        h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async () => {
            const body = { code: f.code.value, name: f.name.value, type: f.type.value, role: f.role.value, kategori: f.kategori.value, price: f.price.value };
            if (edit) await api("PUT", "/api/shop/products/" + encodeURIComponent(p.code), body); else await api("POST", "/api/shop/products", body);
            toast(gsT("Tersimpan.")); m.close(); reload();
        }) }, gsT("Simpan"))));
}

function stockModal(p, reload) {
    const listBox = h("div", {}), info = h("div", { class: "mut stock-summary" });
    const isScript = String(p.type).includes("script");
    const ta = h("textarea", { class: "stock-textarea", placeholder: isScript ? gsT("Tempel isi script (dihitung sebagai 1 stok)") : gsT("Tempel stok manual di sini — satu item per baris") , rows: "5" });
    const fileInput = h("input", { type: "file", accept: ".txt,text/plain,.csv" , class: "stock-file-input" });
    const fileName = h("div", { class: "stock-file-name" }, gsT("Belum ada file dipilih"));
    const fileCount = h("div", { class: "stock-file-count" }, isScript ? gsT("File script akan dihitung sebagai 1 stok.") : gsT("File .txt dibaca per baris; baris kosong akan dilewati."));
    const count = h("input", { type: "number", min: "1", value: "1", class: "w80" });
    const enc = encodeURIComponent(p.code);
    let fileText = null, reveal = false;
    const dd = h("input", { type: "checkbox", id: "stockDedupe" });
    const maskData = (v) => { v = String(v); return v.length <= 6 ? "\u2022".repeat(v.length) : v.slice(0, 3) + "\u2022\u2022\u2022\u2022\u2022" + v.slice(-2); };
    fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        fileText = null;
        if (!file) {
            fileName.textContent = gsT("Belum ada file dipilih");
            fileCount.textContent = isScript ? gsT("File script akan dihitung sebagai 1 stok.") : gsT("File .txt dibaca per baris; baris kosong akan dilewati.");
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            fileInput.value = "";
            fileName.textContent = gsT("File terlalu besar (maksimal 10 MB)");
            fileCount.textContent = gsT("Pilih file teks yang lebih kecil.");
            return;
        }
        try {
            fileText = await file.text();
            const lines = fileText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            fileName.textContent = file.name;
            fileCount.textContent = isScript
                ? gsT`Siap diimpor · ${fileText.length.toLocaleString(gsLocale)} karakter · dihitung 1 stok`
                : gsT`Siap diimpor · ${lines.length.toLocaleString(gsLocale)} item dari baris file`;
            ta.value = fileText;
        } catch {
            fileText = null;
            fileName.textContent = gsT("File tidak dapat dibaca");
            fileCount.textContent = gsT("Coba simpan ulang sebagai file teks UTF-8 (.txt).");
        }
    };
    async function load() {
        const s = await api("GET", `/api/shop/products/${enc}/stock`);
        info.textContent = gsT`Total stok: ${fmt(s.total)}` + (s.total > s.items.length ? gsT` (menampilkan ${s.items.length} item terlama)` : "");
        const checks = s.items.map((i) => ({ i, c: h("input", { type: "checkbox", class: "ck" }), cell: h("td", { class: "mono" }) }));
        const paintCells = () => checks.forEach((x) => { x.cell.textContent = reveal ? String(x.i.data) : maskData(x.i.data); });
        listBox.replaceChildren(h("div", { class: "row gap mt stock-toolbar" },
            h("button", { class: "sm", onclick: (ev) => { reveal = !reveal; ev.currentTarget.textContent = reveal ? gsT("Sembunyikan isi") : gsT("Tampilkan isi"); paintCells(); } }, reveal ? gsT("Sembunyikan isi") : gsT("Tampilkan isi")),
            h("button", { class: "sm", onclick: guard(async () => {
                const ids = checks.filter((x) => x.c.checked).map((x) => x.i.id);
                if (!ids.length) throw new Error(gsT("Pilih item dulu."));
                if (!(await gsConfirm(gsT`Hapus ${ids.length} stok terpilih? Tindakan ini tidak bisa dibatalkan.`, { danger: true, okText: gsT("Hapus stok") }))) return;
                const r = await api("DELETE", `/api/shop/products/${enc}/stock`, { ids }); toast(gsT`${r.removed} stok dihapus.`); load(); reload();
            }) }, gsT("Hapus terpilih")),
            h("span", { class: "mut" }, gsT("atau hapus")), count, h("span", { class: "mut" }, "item terlama"),
            h("button", { class: "sm", onclick: guard(async () => {
                if (!(await gsConfirm(gsT`Hapus ${Number(count.value) || 0} stok terlama? Tindakan ini tidak bisa dibatalkan.`, { danger: true, okText: gsT("Hapus stok") }))) return;
                const r = await api("DELETE", `/api/shop/products/${enc}/stock`, { count: Number(count.value) }); toast(gsT`${r.removed} stok dihapus.`); load(); reload();
            }) }, gsT("Hapus")),
            h("button", { class: "sm bad", onclick: guard(async () => {
                if (!(await gsConfirm(gsT`Hapus SEMUA stok ${p.code}? Tindakan ini tidak bisa dibatalkan.`, { danger: true, okText: gsT("Hapus semua") }))) return;
                const r = await api("DELETE", `/api/shop/products/${enc}/stock`, { all: true }); toast(gsT`${r.removed} stok dihapus.`); load(); reload();
            }) }, gsT("Hapus semua"))),
            h("div", { class: "tbl mt stock-list" }, h("table", {}, h("tbody", {}, ...checks.map((x) => h("tr", {}, h("td", {}, x.c), x.cell))))));
        paintCells();
    }
    const addFromText = async () => {
        const useFile = Boolean(fileText !== null);
        const text = useFile ? fileText : ta.value;
        if (!String(text || "").trim()) throw new Error(gsT("Pilih file atau isi stok terlebih dahulu."));
        const payload = { text };
        if (useFile && !isScript) payload.lineMode = true;
        if (dd.checked) payload.dedupe = true;
        const r = await api("POST", `/api/shop/products/${enc}/stock`, payload);
        ta.value = ""; fileInput.value = ""; fileText = null;
        fileName.textContent = gsT("Belum ada file dipilih");
        fileCount.textContent = isScript ? gsT("File script akan dihitung sebagai 1 stok.") : gsT("File .txt dibaca per baris; baris kosong akan dilewati.");
        toast(gsT`${r.added} stok berhasil ditambahkan.` + (r.skipped ? gsT` ${r.skipped} duplikat dilewati.` : "")); await load(); reload();
    };
    const fileCard = h("div", { class: "stock-upload-card" },
        h("div", { class: "stock-upload-title" }, h("span", { class: "stock-upload-icon" }, "↑"), h("div", {}, h("strong", {}, gsT("Tambah stok dari file")), h("div", { class: "mut" }, isScript ? gsT("Impor satu file sebagai satu stok script.") : gsT("Setiap baris non-kosong menjadi satu item stok.")))),
        fileInput,
        h("label", { class: "stock-file-picker", onclick: () => fileInput.click() }, h("span", {}, gsT("Pilih file .txt"))),
        fileName, fileCount);
    modal(gsT`Stok ${p.code} — ${p.name}`,
        h("div", { class: "stock-modal-intro" }, h("span", { class: "stock-modal-icon" }, "▦"), h("div", {}, h("strong", {}, gsT("Kelola inventori")), h("p", { class: "mut" }, gsT("Tambahkan stok manual atau impor banyak item sekaligus. File tidak diunggah ke server terpisah; isinya dibaca di browser lalu dikirim ke API stok.")))),
        info,
        fileCard,
        field(gsT("Atau tambah manual"), ta, isScript ? gsT("Tipe script disimpan sebagai satu stok utuh.") : gsT("Mode manual tetap mengikuti pemisahan stok lama; gunakan file untuk membaca satu item per baris.")),
        h("label", { class: "check-row", for: "stockDedupe" }, dd, h("span", {}, gsT("Buang duplikat (lewati item yang sudah ada di stok atau dobel di input)"))),
        h("div", { class: "row mt stock-add-actions" }, h("button", { class: "pri", onclick: guard(addFromText) }, gsT("Tambah stok"))),
        h("h3", { class: "stock-existing-heading" }, gsT("Stok tersedia")), listBox);
    // Hide the standalone input; the visible label opens the same file chooser.
    fileInput.classList.add("stock-file-hidden");
    load().catch((e) => toast(e.message, false));
}

function discountModal(p, reload) {
    const enc = encodeURIComponent(p.code);
    const disc = h("input", { value: p.discount ?? "", inputmode: "decimal", placeholder: "1 - 100" });
    const minQty = h("input", { inputmode: "numeric", placeholder: gsT("Min. jumlah") }), cut = h("input", { inputmode: "decimal", placeholder: gsT("Potongan (WL)") });
    const bulkBox = h("div", {});
    const drawBulk = () => {
        if (!p.bulk.length) return bulkBox.replaceChildren(h("p", { class: "mut" }, gsT("Belum ada bulk discount.")));
        bulkBox.replaceChildren(...p.bulk.map((b) => h("div", { class: "row sp mt" },
            h("span", {}, gsT`Beli ≥ ${b.minQty}: potong ${fmt(b.cut)} WL per item`),
            h("button", { class: "sm bad", onclick: guard(async () => {
                await api("DELETE", `/api/shop/products/${enc}/bulk/${b.minQty}`);
                p.bulk = p.bulk.filter((x) => x !== b); drawBulk(); reload();
            }) }, gsT("Hapus")))));
    };
    drawBulk();
    modal(gsT`Diskon ${p.code}`,
        !p.price ? h("p", { class: "mut" }, gsT("Atur harga produk dulu sebelum membuat diskon.")) : null,
        field(gsT("Diskon (%)"), disc),
        h("div", { class: "row mt gap" },
            h("button", { class: "pri", onclick: guard(async () => { await api("PUT", `/api/shop/products/${enc}/discount`, { discount: disc.value }); toast(gsT("Diskon tersimpan.")); reload(); }) }, gsT("Simpan diskon")),
            h("button", { onclick: guard(async () => { await api("DELETE", `/api/shop/products/${enc}/discount`); disc.value = ""; toast(gsT("Diskon dihapus.")); reload(); }) }, gsT("Hapus diskon"))),
        h("h2", { class: "mt" }, "Bulk discount"), bulkBox,
        h("div", { class: "row mt gap" }, minQty, cut, h("button", { class: "sm", onclick: guard(async () => {
            await api("PUT", `/api/shop/products/${enc}/bulk`, { minQty: minQty.value, cut: cut.value });
            const mq = Number(minQty.value), ct = Number(String(cut.value).replace(",", "."));
            p.bulk = [...p.bulk.filter((b) => b.minQty !== mq), { minQty: mq, cut: ct }].sort((a, b) => a.minQty - b.minQty);
            minQty.value = cut.value = ""; drawBulk(); toast(gsT("Bulk discount tersimpan.")); reload();
        }) }, gsT("Tambah"))));
}

// ---------- Users ----------
async function users() {
    let skip = 0, q = "";
    const wrap = h("div", {}), search = h("input", { placeholder: gsT("Cari GrowID atau ID Discord") });
    const box = h("div", {});
    async function load() {
        const r = await api("GET", `/api/shop/users?q=${encodeURIComponent(q)}&skip=${skip}`);
        const body = h("tbody", {}, ...r.users.map((u) => h("tr", {}, h("td", { class: "mono" }, u.discordId, " ", copyBtn(u.discordId)), h("td", {}, u.growId), h("td", {}, fmt(u.balance) + " WL"), h("td", {}, fmt(u.deposit) + " WL"),
            h("td", {}, h("div", { class: "row gap" },
                h("button", { class: "sm", onclick: () => balanceModal(u, "add", load) }, gsT("Tambah")),
                h("button", { class: "sm", onclick: () => balanceModal(u, "remove", load) }, gsT("Kurangi")))))));
        box.replaceChildren(r.users.length ? h("div", { class: "tbl" }, h("table", {}, h("thead", {}, h("tr", {}, ...[gsT("ID Discord"), "GrowID", gsT("Saldo"), "Total deposit", gsT("Aksi")].map((x) => h("th", {}, x)))), body)) : empty("users", gsT("Tidak ada pengguna"), gsT("Coba kata kunci lain, atau pengguna belum terdaftar di bot toko.")),
            h("div", { class: "row sp mt" }, h("span", { class: "mut" }, gsT`${fmt(r.total)} user`),
                h("div", { class: "row gap" }, h("button", { class: "sm", disabled: skip === 0, onclick: () => { skip = Math.max(0, skip - 50); load(); } }, "‹"), h("button", { class: "sm", disabled: skip + 50 >= r.total, onclick: () => { skip += 50; load(); } }, "›"))));
    }
    search.onkeydown = (e) => { if (e.key === "Enter") { q = search.value.trim(); skip = 0; load().catch((x) => toast(x.message, false)); } };
    wrap.append(head("Users", gsT("Saldo dan data user toko.")), card(search, box));
    await load();
    return wrap;
}
function balanceModal(u, mode, reload) {
    const amt = h("input", { inputmode: "decimal", placeholder: gsT("Jumlah WL") });
    const add = mode === "add";
    const m = modal(gsT`${add ? gsT("Tambah") : gsT("Kurangi")} saldo — ${u.growId || u.discordId}`, field(gsT("Jumlah (WL)"), amt, gsT`Saldo sekarang ${fmt(u.balance)} WL.` + (add ? gsT(" Total deposit ikut bertambah.") : "")),
        h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async () => {
            await api("POST", `/api/shop/users/${u.discordId}/balance`, { amount: amt.value, mode }); toast(gsT("Saldo diperbarui.")); m.close(); reload();
        }) }, gsT("Simpan"))));
}

// ---------- Settings ----------
async function settings() {
    const s = await api("GET", "/api/shop/settings");
    const mt = h("input", { type: "checkbox", checked: s.maintenance }), live = h("input", { type: "checkbox", checked: s.useLiveApi });
    mt.onchange = guard(async () => { await api("PUT", "/api/shop/settings/maintenance", { on: mt.checked }); toast(mt.checked ? gsT("Mode maintenance aktif.") : gsT("Maintenance dimatikan.")); });
    live.onchange = guard(async () => { await api("PUT", "/api/shop/settings/liveapi", { on: live.checked }); toast(gsT("Tersimpan.")); });
    const rate = h("input", { value: s.pricePerWL ?? "", inputmode: "decimal" });
    return h("div", {}, head("Settings", gsT("Pengaturan toko.")),
        card(h("h2", {}, "Maintenance"), h("p", { class: "mut" }, gsT("Saat aktif, pembelian di toko dinonaktifkan.")), h("label", { class: "sw" }, mt, gsT("Aktifkan mode maintenance"))),
        card(h("h2", {}, gsT("Kurs World Lock")), h("label", { class: "sw" }, live, gsT("Pakai harga live (gtid.pro), kurs manual jadi cadangan")),
            field(gsT("Harga 1 WL dalam Rupiah (kurs manual)"), rate), h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async () => { await api("PUT", "/api/shop/settings/wlrate", { pricePerWL: rate.value }); toast(gsT("Kurs tersimpan.")); }) }, gsT("Simpan kurs")))));
}

// ---------- Bot & Server ----------
let botFilled = false;
const BOT_FIELDS = ["botToken", "clientId", "mongoUrl", "ownerId", "adminIds", "guildId", "paymentUrl", "paymentApiKey", "paymentSecret"];
const SECRETS = ["botToken", "mongoUrl", "paymentApiKey", "paymentSecret"];

function hostedBotCard(outcome) {
    const content = h("div", { class: "hosted-bot-setup" });
    const connect = h("a", { class: "bot-mode-cta", href: "/api/auth/discord" }, gsT("Hubungkan akun Discord"));
    function showSaved(setup) {
        const status = h("p", { class: "mut", role: "status" });
        const update = () => {
            const current = me.hostedBot || setup;
            status.textContent = gsT(current.enabled ? (current.state === "running" ? "Bot aktif di server ini." : "Server tersimpan. Bot GevraStore sedang offline.") : "Bot dinonaktifkan.");
        };
        content.onhostedstatus = update;
        const manage = h("a", { class: "bot-mode-cta", href: connect.href }, gsLanguage === "en" ? "Manage Discord servers" : "Kelola server Discord");
        const stop = setup.enabled ? h("button", { type: "button", onclick: guard(async event => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                ({ setup: me.hostedBot } = await api("PUT", "/api/discord-install/setup", { guildId: setup.guildId, enabled: false }));
                updateSide();
                showSaved(me.hostedBot);
            } finally { button.disabled = false; }
        }) }, gsT("Nonaktifkan bot")) : null;
        content.replaceChildren(h("span", { class: "bot-mode-status" }, gsT("Discord terhubung")),
            h("strong", {}, setup.name || (gsLanguage === "en" ? "Saved server" : "Server tersimpan") + " · " + setup.guildId),
            status, h("div", { class: "hosted-bot-actions" }, manage, stop));
        update();
    }
    content.addEventListener("hosted-status", () => content.onhostedstatus?.());
    const load = h("button", { type: "button" }, gsT("Tampilkan server Discord"));
    load.onclick = guard(async () => {
        load.disabled = true;
        try {
            const result = await api("GET", "/api/discord-install/servers");
            const { reconnect, servers, canActivate } = result;
            let { setup } = result;
            if (reconnect) {
                if (me.hostedBot?.guildId) return showSaved(me.hostedBot);
                content.replaceChildren(h("a", { class: "bot-mode-cta", href: "/api/auth/discord" }, gsT("Hubungkan akun Discord")));
                return;
            }
            if (!servers.length) {
                content.replaceChildren(h("p", { class: "mut" }, gsT("Tidak ada server yang bisa kamu kelola dengan akun ini.")));
                return;
            }
            const select = h("select", {}, ...servers.map(server => h("option", { value: server.id }, server.name)));
            if (servers.some(server => server.id === setup?.guildId)) select.value = setup.guildId;
            const actions = h("div", { class: "hosted-bot-actions" });
            const status = h("p", { class: "mut", role: "status" });
            const updateStatus = () => {
                const server = servers.find(item => item.id === select.value);
                const active = setup?.guildId === server.id && setup.enabled;
                const state = me.hostedBot?.guildId === setup?.guildId ? me.hostedBot?.state : setup?.state;
                status.textContent = gsT(active ? (state === "running" ? "Bot aktif di server ini." : "Server tersimpan. Bot GevraStore sedang offline.") : server.installed
                    ? "Bot sudah terpasang. Simpan pilihan untuk mengaktifkannya."
                    : "Undang bot terlebih dahulu agar bisa dipakai di server ini.");
                return { server, active };
            };
            const draw = () => {
                const { server, active } = updateStatus();
                if (!server.installed) {
                    actions.replaceChildren(h("a", { class: "bot-mode-cta", href: server.invite, target: "_blank", rel: "noopener" }, gsT("Undang bot ke server")),
                        load);
                    return;
                }
                if (!canActivate) { actions.replaceChildren(); return; }
                const button = h("button", { type: "button", class: active ? "" : "pri" },
                    gsT(active ? "Nonaktifkan bot" : "Simpan & aktifkan bot"));
                button.onclick = guard(async () => {
                    button.disabled = select.disabled = true;
                    try {
                        ({ setup } = await api("PUT", "/api/discord-install/setup", { guildId: server.id, enabled: !active }));
                        me.hostedBot = setup;
                        updateSide();
                        draw();
                    } finally {
                        button.disabled = select.disabled = false;
                    }
                });
                actions.replaceChildren(button);
            };
            select.onchange = draw;
            content.replaceChildren(h("span", { class: "bot-mode-status" }, gsT("Discord terhubung")),
                field(gsT("Pilih server Discord"), select), status, actions);
            draw();
            content.onhostedstatus = updateStatus;
        } finally {
            load.disabled = false;
        }
    });
    content.append(h("div", { class: "hosted-bot-actions" }, connect, load));
    if (outcome === "connected") load.click();
    else if (me.hostedBot?.guildId) showSaved(me.hostedBot);
    const notice = {
        error: "Discord gagal terhubung. Coba lagi.",
        conflict: "Lisensi ini sudah terhubung ke akun Discord lain.",
        unavailable: "Bot GevraStore belum tersedia untuk lisensi ini.",
    }[outcome];
    return card(h("h2", {}, gsT("Undang bot GevraStore")),
        h("p", { class: "mut" }, gsT("Pilih server yang kamu kelola dan konfirmasi undangan di Discord.")),
        notice ? h("p", { class: "mut", role: "status" }, gsT(notice)) : null, content);
}

function hostedBotUnavailable() {
    return card(h("h2", {}, gsT("Bot GevraStore")),
        h("p", { class: "mut" }, gsT("Bot GevraStore belum tersedia untuk lisensi ini. Saat aktif, kamu bisa memilih server Discord tanpa menyiapkan token atau MongoDB.")));
}

function botModePicker(ownBot, hostedBot, showHosted) {
    const own = h("input", { type: "radio", name: "botMode", value: "own", checked: !showHosted });
    const hosted = h("input", { type: "radio", name: "botMode", value: "hosted", checked: showHosted });
    const hostedPanel = hostedBot || hostedBotUnavailable();
    const show = () => {
        ownBot.classList.toggle("hide", hosted.checked);
        hostedPanel.classList.toggle("hide", !hosted.checked);
    };
    own.addEventListener("change", show);
    hosted.addEventListener("change", show);
    show();
    return [
        card(h("fieldset", { class: "bot-mode-options" },
            h("legend", {}, gsT("Pilih cara menjalankan bot")),
            h("label", {}, own, h("span", {}, h("strong", {}, gsT("Bot sendiri")), h("small", { class: "mut" }, gsT("Gunakan token Discord dan MongoDB milikmu.")))),
            h("label", {}, hosted, h("span", {}, h("strong", {}, gsT("Bot GevraStore")), h("small", { class: "mut" }, gsT("Pilih server Discord. Hosting dan database disiapkan GevraStore.")))))),
        ownBot,
        hostedPanel,
    ];
}

async function bot() {
    me = await api("GET", "/api/me");
    const url = new URL(location.href);
    const outcome = url.searchParams.get("discord");
    if (outcome) {
        url.searchParams.delete("discord");
        history.replaceState(null, "", url);
    }
    const inp = {};
    const mk = (k, type = "text") => (inp[k] = h("input", { type, autocomplete: "off", placeholder: SECRETS.includes(k) && me.config.has[k] ? gsT("(tersimpan)") : "", value: SECRETS.includes(k) ? "" : me.config[k] || "" }));
    const pre = h("pre", {}, "-"), msg = h("div", { class: "mut mt" });
    const act = (a) => guard(async () => { await api("POST", "/api/bot/" + a); toast(gsT("Perintah dikirim.")); me = await api("GET", "/api/me"); drawState(); });
    const state = h("span", { class: "badge" });
    const drawState = () => { state.textContent = me.bot; state.className = "badge " + me.bot; updateSide(); };
    drawState();
    const invite = me.config.clientId ? `https://discord.com/oauth2/authorize?client_id=${me.config.clientId}&scope=bot%20applications.commands&permissions=8` : null;
    async function refreshLogs() {
        if (!pre.isConnected) { clearInterval(logTimer); return; }
        try {
            me = await api("GET", "/api/me"); drawState();
            const hostedSetup = $("view").querySelector(".hosted-bot-setup");
            hostedSetup?.dispatchEvent(new Event("hosted-status"));
            const { lines } = await api("GET", "/api/logs"), end = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
            pre.textContent = lines.length ? lines.join("\n") : "-"; if (end) pre.scrollTop = pre.scrollHeight;
        } catch {}
    }
    clearInterval(logTimer); logTimer = setInterval(refreshLogs, 5000); setTimeout(refreshLogs, 50);
    const isService = me.type === "service";
    const ownBot = h("div", {},
        card(h("div", { class: "row sp" }, h("div", { class: "row" }, h("b", {}, gsT(isService ? "Status bot" : "Status bot sendiri")), state),
            h("div", { class: "row gap" }, h("button", { class: "pri", onclick: act("start") }, "Start"), h("button", { onclick: act("restart") }, "Restart"), h("button", { class: "bad", onclick: act("stop") }, "Stop"))),
            invite ? h("p", { class: "mut" }, gsT("Belum masuk ke server? "), h("a", { href: invite, target: "_blank", rel: "noopener" }, gsT("Undang bot ke server")), " ", copyBtn(invite, gsT("Salin link"))) : null),
        card(h("h2", {}, gsT("Pengaturan bot")), h("p", { class: "mut" }, gsT("Kolom rahasia yang sudah tersimpan tidak ditampilkan. Kosongkan jika tidak ingin mengubahnya.")),
            field("Bot Token", mk("botToken", "password"), gsT("Developer Portal → Bot → Reset Token. Aktifkan semua Privileged Gateway Intents.")),
            field("Client ID (Application ID)", mk("clientId")), field("MongoDB URL", mk("mongoUrl", "password"), gsT("MongoDB Atlas → Connect → Drivers. Izinkan IP server di Network Access.")),
            field(gsT("Owner ID (ID Discord kamu)"), mk("ownerId")), field(gsT("Admin ID (opsional, pisahkan koma)"), mk("adminIds")), field(gsT("ID Server Discord"), mk("guildId")),
            isService ? null : field(gsT("URL Payment Gateway (opsional)"), mk("paymentUrl")), isService ? null : field(gsT("API Key Payment Gateway (opsional)"), mk("paymentApiKey", "password")), isService ? null : field(gsT("Webhook Secret (opsional)"), mk("paymentSecret", "password")),
            isService ? null : h("p", { class: "mut" }, gsT("URL webhook untuk payment gateway kamu: "), h("b", {}, me.webhookUrl)),
            h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async (ev) => {
                const btn = ev.currentTarget;
                if (btn.disabled) return;
                const body = {}; BOT_FIELDS.forEach((k) => { if (inp[k]) body[k] = inp[k].value; });
                btn.disabled = true; btn.textContent = gsT("Memeriksa…");
                msg.textContent = gsT("Memeriksa token & database, tunggu beberapa detik…");
                try { const r = await api("PUT", "/api/config", body); SECRETS.forEach((k) => { if (inp[k] && inp[k].value) { inp[k].value = ""; inp[k].placeholder = gsT("(tersimpan)"); } }); msg.textContent = r.restartNeeded ? gsT("Tersimpan. Tekan Restart agar berlaku.") : gsT("Tersimpan. Sekarang tekan Start."); }
                catch (e) { msg.textContent = ""; throw e; }
                finally { btn.disabled = false; btn.textContent = gsT("Simpan"); }
            }) }, gsT("Simpan"))), msg),
        card(h("h2", {}, gsT("Log bot")), pre));
    return h("div", {},
        head(isService ? "Service Bot & Server" : "Bot & Server", isService ? gsT("Hubungkan bot AutoStore Service dan database kamu.") : gsT("Pilih bot untuk server tokomu.")),
        isService ? ownBot : botModePicker(ownBot, me.discordInstallEnabled ? hostedBotCard(outcome) : null, !!outcome || me.hostedBotConfigured));
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
            h("div", {}, h("div", { class: "svc-kicker" }, "AUTOSTORE SERVICE"), h("h1", {}, gsT("Kelola jasa lebih mudah.")), h("p", { class: "mut" }, gsT("Atur harga, buka/tutup jasa, dan pantau Service bot dari satu panel."))),
            h("div", { class: "svc-live " + (me.bot === "running" ? "is-on" : "") }, h("span", {}, "●"), me.bot === "running" ? "ONLINE" : String(me.bot || "OFFLINE").toUpperCase())
        ),
        h("div", { class: "svc-stats" }, stat(gsT("Status Key"), me.valid ? gsT("Aktif") : gsT("Tidak aktif")), stat(gsT("Masa aktif"), gsT`${me.daysLeft} hari`), stat(gsT("Bot Service"), me.bot), stat(gsT("Jasa OPEN"), `${open}/${services.length || 6}`)),
        h("div", { class: "svc-actions" },
            h("button", { class: "svc-action primary", onclick: () => location.hash = "#/service-settings" }, h("b", {}, gsT("Harga & Status Jasa")), h("span", {}, gsT("Atur harga dan OPEN/CLOSED →"))),
            h("button", { class: "svc-action", onclick: () => location.hash = "#/bot" }, h("b", {}, "Bot & Server"), h("span", {}, gsT("Token, MongoDB, dan kontrol bot →"))),
            h("button", { class: "svc-action", onclick: () => location.hash = "#/subscription" }, h("b", {}, "Subscription"), h("span", {}, gsT("Lihat masa aktif key →")))
        ),
        card(h("div", { class: "row sp" }, h("div", {}, h("h2", {}, gsT("Daftar Jasa")), h("p", { class: "mut" }, gsT("Harga dan status yang aktif di Service bot."))), h("button", { class: "sm", onclick: () => location.hash = "#/service-settings" }, gsT("Kelola"))),
            h("div", { class: "svc-service-grid" }, ...(services.length ? services : [
                {type:"PLANT",label:"PLANT",price:30,status:"OPEN",unit:"World"},{type:"HARVEST",label:"HARVEST",price:30,status:"OPEN",unit:"World"},{type:"HARVEST MOVE",label:"HARVEST MOVE",price:40,status:"OPEN",unit:"World"},{type:"MOVE",label:"MOVE",price:1,status:"OPEN",unit:"Item / 200"},{type:"PROVIDER",label:"PROVIDER",price:40,status:"OPEN",unit:"World"},{type:"SPLICE",label:"SPLICE",price:45,status:"OPEN",unit:"World"}
            ]).map(x => h("div", { class: "svc-service-card" }, h("div", { class: "row sp" }, h("b", {}, x.label || x.type), h("span", { class: "svc-status " + (String(x.status).toUpperCase()==="OPEN" ? "open" : "closed") }, String(x.status || "CLOSED").toUpperCase())), h("strong", {}, `${fmt(Number(x.price || 0))} WL`), h("span", { class: "mut" }, `per ${x.unit || "unit"}`), h("small", { class: "mut" }, gsT`${fmt(Number(x.completed || 0))} selesai`))))),
        card(h("h2", {}, "Tips"), h("p", { class: "mut" }, gsT("Gunakan Harga & Status Jasa untuk mengubah harga dari web. Perubahan akan tersimpan ke database Service yang digunakan bot.")))
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
    const save = h("button", { class: "pri" }, gsT("Simpan Semua"));
    save.onclick = guard(async () => {
        save.disabled = true; save.textContent = gsT("Menyimpan…");
        try {
            await api("PUT", "/api/service/settings", { services: controls.map(({x, price, status}) => ({ type: x.type, price: price.value, status: status.value })) });
            toast(gsT("Pengaturan jasa berhasil disimpan."));
            location.hash = "#/service";
        } finally { save.disabled = false; save.textContent = gsT("Simpan Semua"); }
    });
    return h("div", { class: "svc-page" },
        head(gsT("Harga & Status Jasa"), gsT("Atur harga Service dan buka/tutup jasa tanpa perlu mengetik command Discord.")),
        card(h("div", { class: "svc-settings-head" }, h("div", {}, h("h2", {}, gsT("Pengaturan jasa")), h("p", { class: "mut" }, gsT("Harga menggunakan satuan WL. MOVE dihitung per 200 item sesuai sistem Service."))), save)),
        h("div", { class: "svc-settings-grid" }, ...controls.map(({x, price, status}) => h("div", { class: "svc-setting-card" },
            h("div", { class: "row sp" }, h("div", {}, h("b", {}, defs[x.type][0]), h("div", { class: "mut" }, gsT`Satuan: ${defs[x.type][1]}`)), h("span", { class: "svc-status " + (status.value === "OPEN" ? "open" : "closed") }, status.value)),
            field(gsT("Harga (WL)"), price), field("Status", status), h("div", { class: "mut mt" }, gsT`Selesai: ${fmt(Number(x.completed || 0))}`)
        )))
    );
}


// ---------- AutoStore Service: Custom Emoji ----------
const SERVICE_EMOJI_FIELDS = [
    ["WL", "World Lock", gsT("Mata uang WL")], ["DL", "Diamond Lock", gsT("Mata uang DL")], ["BGL", "Blue Gem Lock", gsT("Mata uang BGL")],
    ["CROWN", "Crown", gsT("Judul panel")], ["ARROW", "Arrow", gsT("Info / pemisah")], [gsT("Benar"), gsT("Berhasil / OPEN"), gsT("Status sukses")],
    [gsT("Salah"), "Error / CLOSE", gsT("Status gagal")], ["Warning", "Warning", gsT("Peringatan")], ["Loading", "Loading", gsT("Proses")],
    ["Buy", "Buy / Completed", gsT("Pembelian / selesai")], ["Megaphone", "Order Notification", gsT("Notifikasi order")], ["BALANCE", "Balance", gsT("Saldo")],
    ["BOT", "Bot", "Bot / service"], ["EARTH", "World", "World"], ["Dolar", "Dollar", gsT("Harga")],
    ["SetGrowID", "Set GrowID", gsT("Tombol GrowID")], ["BalanceButton", "Balance Button", gsT("Tombol saldo")],
    ["Deposit", "Deposit", gsT("Tombol deposit")], ["DepositQRIS", "Deposit QRIS", gsT("Pembayaran QRIS")], ["AdminPanel", "Admin Panel", gsT("Panel admin")],
    ["Queue", "Queue", gsT("Antrian")], ["Waiting", "Waiting", gsT("Status menunggu")], ["COLOR", "Embed Color", gsT("Warna #RRGGBB")]
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
    throw lastError || new Error(gsT('Endpoint Custom Emoji tidak tersedia.'));
}

async function serviceEmojis() {
    const r = await serviceEmojiApi('GET', 'get');
    const values = { ...(r.emojis || {}) };
    const selected = { value: SERVICE_EMOJI_FIELDS[0][0] };

    const select = h('select', { style: 'width:100%;max-width:520px' });
    for (const [key, label, help] of SERVICE_EMOJI_FIELDS) {
        select.append(h('option', { value: key }, `${label} — ${key}`));
    }

    const title = h('h2', { style: 'margin:0' }, gsT('Emoji yang sedang digunakan'));
    const help = h('p', { class: 'mut', style: 'margin:6px 0 0' }, gsT('Pilih satu emoji di daftar. Preview di kanan menampilkan emoji yang sedang dipakai.'));
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
            if (!validServiceEmoji(current[key], key)) throw new Error(gsT`Format ${key} tidak valid.`);
        }
        const out = await serviceEmojiApi('PUT', 'save', { emojis: current });
        Object.assign(values, current);
        msg.textContent = out.restarted ? gsT('Tersimpan. Bot Service sedang restart dengan emoji baru.') : gsT('Tersimpan.');
        toast(gsT('Custom emoji tersimpan.'));
        draw();
    }) }, gsT('💾 Simpan Emoji'));

    const reset = h('button', { onclick: guard(async () => {
        if (!(await gsConfirm(gsT('Kembalikan semua emoji ke default?'), { danger: true, okText: gsT('Kembalikan') }))) return;
        const out = await serviceEmojiApi('POST', 'reset');
        Object.assign(values, out.emojis || {});
        msg.textContent = out.restarted ? gsT('Default dipulihkan. Bot sedang restart.') : gsT('Default dipulihkan.');
        toast(gsT('Emoji default dipulihkan.'));
        draw();
    }) }, gsT('Reset Default'));

    draw();
    return h('div', {},
        head('Custom Emoji', gsT('Atur emoji AutoStore Service per key tanpa memenuhi halaman dengan banyak kotak.')),
        card(
            h('div', { style: 'display:flex;gap:24px;align-items:center;flex-wrap:wrap' },
                h('div', { style: 'flex:1;min-width:260px' }, title, help,
                    h('div', { style: 'margin-top:18px' }, select),
                    h('div', { style: 'margin-top:12px' }, input),
                    h('div', { class: 'mut', style: 'font-size:12px;margin-top:6px' }, gsT('Unicode atau custom Discord: <:nama:id> / <a:nama:id>'))
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
    ["Dolar", "Dollar"], ["BALANCE", "Balance"], ["Warning", "Warning"], [gsT("Benar"), gsT("Berhasil")],
    [gsT("Salah"), gsT("Gagal")], ["Megaphone", "Order Notification"], ["Loading", "Loading"], ["Buy", "Buy"],
    ["SetGrowID", "Set GrowID"], ["BalanceButton", "Balance Button"], ["Deposit", "Deposit"],
    ["DepositQRIS", "Deposit QRIS"], ["AdminPanel", "Admin Panel"], ["Queue", "Queue"], ["Waiting", "Waiting"],
    ["COLOR", gsT("Warna Embed")]
];
function storeCustomEmojis() {
    return customEmojiEditor({
        title: "Custom Emoji AutoStore",
        subtitle: gsT("Atur emoji yang digunakan bot AutoStore untuk produk, pembelian, saldo, dan notifikasi."),
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
        subtitle: gsT("Atur gambar banner yang tampil pada embed toko AutoStore. Gunakan URL gambar HTTPS yang bisa diakses publik."),
        fields: [["imageUrl", gsT("Banner utama")], ["imageUrl2", gsT("Banner realtime")]],
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
    const input = h("input", { autocomplete: "off", spellcheck: "false", style: "width:100%", placeholder: includeBanner ? "https://.../banner.png" : gsT("Emoji Unicode atau <:nama:id>") });
    const previewBox = h("div", { class: "store-media-preview" });
    const previewName = h("b", {});
    const previewValue = h("div", { class: "mut", style: "font-family:monospace;font-size:12px;word-break:break-all;margin-top:6px" });
    const msg = h("div", { class: "mut", style: "margin-top:10px" });
    const help = h("p", { class: "mut", style: "margin:6px 0 0" }, includeBanner ? gsT("Tempel URL gambar PNG, JPG, GIF, atau WEBP. Link harus dapat dibuka tanpa login.") : gsT("Masukkan emoji Unicode atau format custom Discord seperti <:nama:id> / <a:nama:id>."));

    function draw() {
        const key = selected.value;
        const meta = fields.find(x => x[0] === key);
        input.value = values[key] || "";
        previewBox.replaceChildren();
        if (includeBanner && input.value) {
            const img = h("img", { alt: gsT("Preview banner"), style: "width:100%;height:100%;object-fit:contain" });
            img.onerror = () => { previewBox.replaceChildren(h("span", { class: "mut", style: "padding:8px;text-align:center" }, gsT("Gambar tidak dapat dimuat"))); };
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
            if (!value) throw new Error(gsT`${key} tidak boleh kosong.`);
            if (includeBanner) {
                let u; try { u = new URL(value); } catch { throw new Error(gsT`${key} harus berupa URL yang valid.`); }
                if (u.protocol !== "https:") throw new Error(gsT`${key} harus menggunakan HTTPS.`);
            } else if (key === "COLOR") {
                if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(gsT("Warna harus menggunakan format #RRGGBB."));
            } else if (!/^<a?:[A-Za-z0-9_~]+:\d{17,20}>$/.test(value) && Array.from(value).length > 12) {
                throw new Error(gsT`Format ${key} terlalu panjang. Gunakan emoji Unicode atau format <:nama:id>.`);
            }
        }
        const out = await api("PUT", endpoint, { emojis: current });
        Object.assign(values, current);
        msg.textContent = out.restarted ? gsT("Tersimpan. Bot sedang restart dengan pengaturan baru.") : gsT("Tersimpan. Tekan Restart di menu Bot & Server agar perubahan diterapkan.");
        toast(includeBanner ? gsT("Custom banner tersimpan.") : gsT("Custom emoji tersimpan."));
        draw();
    }) }, includeBanner ? gsT("💾 Simpan Banner") : gsT("💾 Simpan Emoji"));
    const reset = h("button", { onclick: guard(async () => {
        if (!(await gsConfirm(includeBanner ? gsT("Kembalikan URL banner ke default? Emoji lain tidak akan diubah.") : gsT("Kembalikan semua emoji ke default?"), { danger: true, okText: gsT("Kembalikan") }))) return;
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
        msg.textContent = out.restarted ? gsT("Default dipulihkan. Bot sedang restart.") : gsT("Default dipulihkan.");
        toast(gsT("Pengaturan default dipulihkan."));
        draw();
    }) }, gsT("Reset Default"));
    draw();
    return h("div", {},
        head(title, subtitle),
        card(h("div", { style: "display:flex;gap:24px;align-items:center;flex-wrap:wrap" },
            h("div", { style: "flex:1;min-width:260px" }, h("h2", { style: "margin:0" }, includeBanner ? gsT("Gambar yang sedang digunakan") : gsT("Emoji yang sedang digunakan")), help,
                h("div", { style: "margin-top:18px" }, select), h("div", { style: "margin-top:12px" }, input)),
            h("div", { style: "width:150px;text-align:center" }, previewBox, h("div", { style: "margin-top:10px" }, previewName), previewValue)),
            h("div", { class: "row gap", style: "margin-top:18px" }, save, reset), msg),
        includeBanner ? h("p", { class: "mut" }, gsT("Catatan: reset banner juga mengembalikan konfigurasi emoji ke default karena keduanya disimpan bersama dalam konfigurasi AutoStore.")) : null
    );
}

// ---------- AutoStore Service: Orders ----------
const ORDER_STATUS = {
    all: [gsT("Semua"), ""], waiting: [gsT("Menunggu"), "waiting"], in_progress: [gsT("Diproses"), "in_progress"], done: [gsT("Selesai"), "done"]
};
function orderStatusBadge(status) {
    const map = { waiting: ["Waiting", "svc-status"], in_progress: [gsT("Diproses"), "svc-status open"], done: [gsT("Selesai"), "svc-status open"] };
    const x = map[status] || [status || "-", "svc-status"];
    return h("span", { class: x[1] }, x[0]);
}
async function serviceOrders() {
    const active = { value: "all" };
    const body = h("div", {});
    const render = async () => {
        body.replaceChildren(h("p", { class: "mut" }, gsT("Memuat order…")));
        const r = await api("GET", `/api/service/orders?status=${encodeURIComponent(active.value)}&limit=100`);
        const c = r.counts || {};
        const cards = h("div", { class: "grid" },
            h("div", { class: "stat" }, h("span", { class: "mut" }, "Total Orders"), h("b", {}, fmt(c.total || 0))),
            h("div", { class: "stat" }, h("span", { class: "mut" }, gsT("Menunggu")), h("b", {}, fmt(c.waiting || 0))),
            h("div", { class: "stat" }, h("span", { class: "mut" }, gsT("Diproses")), h("b", {}, fmt(c.in_progress || 0))),
            h("div", { class: "stat" }, h("span", { class: "mut" }, gsT("Selesai")), h("b", {}, fmt(c.done || 0)))
        );
        const filter = h("select", { value: active.value, onchange: guard(async e => { active.value = e.target.value; await render(); }) }, ...Object.entries(ORDER_STATUS).map(([k,v]) => h("option", { value:k }, v[0])));
        const rows = (r.orders || []).map(o => h("tr", {},
            h("td", {}, `#${o.orderNumber ?? "-"}`),
            h("td", {}, h("b", {}, o.type || "-"), h("div", { class: "mut" }, `${fmt(o.amount || 0)} ${o.unit || ""}`)),
            h("td", {}, `${fmt(o.price || 0)} WL`),
            h("td", {}, orderStatusBadge(o.status)),
            h("td", {}, o.assignedTo ? `<@${o.assignedTo}>` : gsT("Belum diambil")),
            h("td", {}, o.createdAt ? new Date(o.createdAt).toLocaleString(gsLocale) : "-")
        ));
        const table = card(h("div", { class: "row sp" }, h("div", {}, h("h2", {}, gsT("Order Terbaru")), h("p", { class: "mut" }, gsT("Data langsung dari collection jasaorders pada MongoDB Service."))), filter),
            h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Order"), h("th", {}, gsT("Jasa")), h("th", {}, gsT("Harga")), h("th", {}, "Status"), h("th", {}, "Staff"), h("th", {}, gsT("Dibuat")))), h("tbody", {}, ...(rows.length ? rows : [h("tr", {}, h("td", { colspan: "6" }, empty("clipboard", gsT("Belum ada order"), gsT("Order baru dari Discord akan tampil di sini."))))])))));
        body.replaceChildren(cards, table);
    };
    await render();
    return h("div", {}, head("Orders", gsT("Kelola dan pantau order Service dari panel web tanpa harus membuka Discord.")), body);
}

// ---------- Tutorial & Subscription ----------
async function tutorial() {
    const li = (...k) => h("li", {}, ...k);
    return h("div", {}, head(gsT("Tutorial Setup"), gsT("Langkah pertama dari nol sampai toko jalan.")),
        card(h("h2", {}, gsT("1. Buat bot Discord")), h("ol", { class: "steps" },
            li(gsT("Buka "), h("a", { href: "https://discord.com/developers/applications", target: "_blank", rel: "noopener" }, "Discord Developer Portal"), " → New Application."),
            li(gsT("Menu Bot → Reset Token, salin tokennya.")),
            li(gsT("Di halaman yang sama, aktifkan semua Privileged Gateway Intents (Presence, Server Members, Message Content).")),
            li(gsT("Menu General Information → salin Application ID (itu Client ID).")))),
        card(h("h2", {}, gsT("2. Siapkan database")), h("ol", { class: "steps" },
            li(gsT("Buat akun gratis di MongoDB Atlas, buat cluster.")),
            li(gsT("Database Access → buat user dan password.")),
            li(gsT("Network Access → izinkan IP server panel ini (tanya penjual IP-nya).")),
            li(gsT("Connect → Drivers → salin URL (mongodb+srv://…), ganti <password> dengan password user tadi.")))),
        card(h("h2", {}, gsT("3. Hubungkan")), h("ol", { class: "steps" },
            li(gsT("Buka menu Bot & Server, isi semua kolom, lalu Simpan.")),
            li(gsT("Pakai tautan 'Undang bot ke server', lalu Start.")),
            li(gsT("Di Discord, klik kanan role yang akan diberikan ke pembeli → Copy Role ID (aktifkan Developer Mode dulu).")))),
        card(h("h2", {}, gsT("4. Mulai jualan")), h("ol", { class: "steps" },
            li(gsT("Menu Products → Tambah Produk Baru, lalu isi harga dan stok.")),
            li(gsT("Menu Settings → atur kurs WL.")),
            li(gsT("Pastikan toko tidak dalam mode maintenance.")))));
}
async function subscription() {
    me = await api("GET", "/api/me");
    const row = (a, b) => h("tr", {}, h("td", { class: "mut" }, a), h("td", {}, b));
    return h("div", {}, head("Subscription", gsT("Status key kamu.")),
        card(h("table", {}, h("tbody", {}, row(gsT("Pemilik"), me.buyer), row("Key", me.keyPrefix + "…"),
            row("Status", me.revoked ? gsT("Dicabut") : me.valid ? gsT("Aktif") : gsT("Habis")),
            me.lifetime ? row(gsT("Masa aktif"), gsT("Seumur hidup")) : row(gsT("Berlaku sampai"), new Date(me.expiresAt).toLocaleString(gsLocale)),
            me.lifetime ? null : row(gsT("Sisa"), me.daysLeft + gsT(" hari"))))),
        h("div", { class: "row mt" }, me.revoked || me.lifetime ? null : h("button", { class: "pri", onclick: () => renewDialog() }, gsT("Perpanjang sekarang"))),
        h("p", { class: "mut" }, me.revoked ? gsT("Key dinonaktifkan penjual. Hubungi penjual untuk bantuan.") : me.lifetime ? gsT("Lisensi ini tidak memerlukan perpanjangan.") : gsT("Perpanjang lewat QRIS. Ada kendala? Hubungi penjual.")));
}

// ---------- Pembayaran: QRIS otomatis, saldo, rekening, penarikan ----------
const TX_STATUS = { pending: [gsT("Menunggu bayar"), "no"], paid: [gsT("Berhasil"), "ok"], expired: [gsT("Kedaluwarsa"), "no"], mismatch: [gsT("Perlu dicek"), "no"] };
const WD_STATUS = { pending: [gsT("Diproses"), "no"], paid: [gsT("Selesai"), "ok"], rejected: [gsT("Ditolak"), "no"] };
const rpf = (n) => "Rp " + fmt(n || 0);
const when = (t) => (t ? new Date(t).toLocaleString(gsLocale) : "-");
const pillOf = (map, k) => { const [label, cls] = map[k] || [k, "no"]; return h("span", { class: "pill " + cls }, label); };

async function payments() {
    const s = await api("GET", "/api/wallet/summary");
    if (!s.enabled) return h("div", {}, head(gsT("Pembayaran"), gsT("QRIS otomatis dan saldo toko kamu.")),
        card(empty("box", gsT("Belum diaktifkan"), gsT("Penjual belum mengaktifkan QRIS otomatis. Toko kamu tetap memakai QRIS manual lewat /setqris."))));
    const [tx, wd] = await Promise.all([api("GET", "/api/wallet/transactions?limit=50"), api("GET", "/api/wallet/withdrawals")]);
    const again = () => render();
    const stat = (l, v, cls) => h("div", { class: "stat" }, h("span", { class: "mut" }, l), h("b", { class: cls || "" }, v));

    const setMode = (mode) => guard(async () => { await api("PUT", "/api/wallet/mode", { mode }); toast(mode === "auto" ? gsT("QRIS otomatis aktif.") : gsT("Kembali ke QRIS manual.")); again(); });
    const modeCard = card(h("div", { class: "row sp" }, h("div", {}, h("h2", { class: "m0" }, gsT("Metode deposit")),
        h("p", { class: "mut" }, gsT("Pilih bagaimana user tokomu membayar saat menekan Deposit QRIS di Discord."))),
        h("span", { class: "pill " + (s.mode === "auto" ? "ok" : "no") }, s.mode === "auto" ? gsT("Otomatis aktif") : gsT("Manual aktif"))),
        h("div", { class: "seg mt" },
            h("button", { class: s.mode === "manual" ? "pri" : "", onclick: s.mode === "manual" ? undefined : setMode("manual") }, gsT("QRIS Manual (/setqris)")),
            h("button", { class: s.mode === "auto" ? "pri" : "", disabled: !s.autoReady && s.mode !== "auto", onclick: s.mode === "auto" ? undefined : setMode("auto") }, gsT("QRIS Otomatis"))),
        h("p", { class: "mut mt" }, s.mode === "auto"
            ? gsT("User membayar lewat QR dinamis, saldo WL mereka masuk sendiri beberapa saat setelah bayar. Uang masuk ke saldo di bawah ini.")
            : gsT("User scan QRIS statis milikmu, lalu admin toko menekan Success/Cancel di Discord. Uang langsung ke rekeningmu sendiri.")),
        !s.autoReady ? h("p", { class: "mut" }, gsT("QRIS otomatis belum tersedia dari penjual.")) : null);

    const withdrawModal = () => {
        const amt = h("input", { type: "number", min: s.minWithdraw, step: "1", placeholder: gsT("Nominal (Rp)"), inputmode: "numeric" });
        const m = modal(gsT("Tarik Saldo"), h("p", { class: "mut" }, gsT`Saldo tersedia ${rpf(s.available)}. Minimal ${rpf(s.minWithdraw)}.` + (s.withdrawFee ? gsT` Biaya penarikan ${rpf(s.withdrawFee)}.` : "")),
            field(gsT("Nominal penarikan"), amt), h("p", { class: "mut" }, gsT`Dikirim ke ${s.bank ? `${s.bank.bankName} ${s.bank.accountNoMasked} a.n. ${s.bank.accountName}` : "-"}. Diproses manual oleh penjual.`),
            h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async (ev) => {
                const b = ev.currentTarget; if (b.disabled) return; b.disabled = true;
                try { await api("POST", "/api/wallet/withdraw", { amount: Number(amt.value) }); m.close(); toast(gsT("Permintaan penarikan dikirim.")); again(); }
                finally { b.disabled = false; }
            }) }, gsT("Ajukan penarikan")), h("button", { onclick: () => m.close() }, gsT("Batal"))));
    };
    const canWithdraw = !s.frozen && s.bank && !s.openWithdrawal && s.available >= s.minWithdraw;
    const why = s.frozen ? gsT("Dibekukan penjual.") : !s.bank ? gsT("Isi rekening tujuan dulu.") : s.openWithdrawal ? gsT("Masih ada penarikan yang diproses.") : s.available < s.minWithdraw ? gsT`Minimal ${rpf(s.minWithdraw)}.` : "";

    const balance = card(h("div", { class: "pay-main" }, h("div", {}, h("span", { class: "mut" }, gsT("Saldo Tersedia")), h("b", { class: "pay-big" }, rpf(s.available))),
        h("div", {}, h("button", { class: "pri", disabled: !canWithdraw, onclick: withdrawModal }, gsT("Tarik Saldo")), why ? h("div", { class: "mut" }, why) : null)),
        h("div", { class: "grid" }, stat(gsT`Saldo Tertunda (Hold ${s.holdHours} jam)`, rpf(s.pending), "warnc"), stat(gsT("Total Saldo"), rpf(s.total)), stat(gsT("Sedang Ditarik"), rpf(s.locked)),
            stat(gsT("Total Transaksi"), fmt(s.totalTx)), stat(gsT("Transaksi Berhasil"), fmt(s.paidTx), "okc")),
        h("div", { class: "notice warn mt", role: "note" }, gsT`Setiap pembayaran masuk ditahan selama ${s.holdHours} jam sebelum bisa ditarik. Setelah itu saldo otomatis pindah ke Saldo Tersedia.`));

    const bn = h("input", { placeholder: gsT("Contoh: DANA, BCA"), value: "" }), an = h("input", { placeholder: gsT("Nomor rekening / e-wallet"), inputmode: "numeric", autocomplete: "off" }), nm = h("input", { placeholder: gsT("Nama pemilik") });
    const bank = card(h("h2", {}, gsT("Rekening Saya")),
        s.bank ? h("p", {}, h("b", {}, s.bank.bankName), ` ${s.bank.accountNoMasked} a.n. ${s.bank.accountName}`) : h("p", { class: "mut" }, gsT("Belum ada rekening tujuan.")),
        field("Bank / e-wallet", bn), field(gsT("Nomor"), an), field(gsT("Nama pemilik"), nm),
        h("p", { class: "mut" }, gsT("Mengganti rekening yang sudah ada menahan penarikan selama 24 jam demi keamanan.")),
        h("div", { class: "row mt" }, h("button", { class: "pri", onclick: guard(async () => { await api("PUT", "/api/wallet/bank", { bankName: bn.value, accountNo: an.value, accountName: nm.value }); toast(gsT("Rekening tersimpan.")); again(); }) }, s.bank ? gsT("Ganti rekening") : gsT("Simpan rekening"))));

    const txRows = tx.transactions.map((t) => h("tr", {}, h("td", { class: "mono" }, t.orderId), h("td", {}, t.discordId || "-"), h("td", {}, rpf(t.amount)),
        h("td", {}, t.status === "paid" ? rpf(t.net) : "-"), h("td", {}, pillOf(TX_STATUS, t.status)), h("td", {}, when(t.paidAt || t.createdAt))));
    const txCard = card(h("h2", {}, gsT("Transaksi QRIS")), h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ...["Order", gsT("User Discord"), gsT("Nominal"), gsT("Masuk saldo"), "Status", gsT("Waktu")].map((x) => h("th", {}, x)))),
        h("tbody", {}, ...(txRows.length ? txRows : [h("tr", {}, h("td", { colspan: "6" }, empty("clipboard", gsT("Belum ada transaksi"), gsT("Transaksi QRIS otomatis dari user tokomu akan tampil di sini."))))])))));

    const wdRows = wd.withdrawals.map((w) => h("tr", {}, h("td", {}, when(w.createdAt)), h("td", {}, rpf(w.amount)), h("td", {}, rpf(w.payout)),
        h("td", {}, w.bank ? `${w.bank.bankName} ${w.bank.accountNoMasked}` : "-"), h("td", {}, pillOf(WD_STATUS, w.status)), h("td", {}, w.reason || w.reference || "")));
    const wdCard = card(h("h2", {}, gsT("Riwayat penarikan")), h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, ...[gsT("Diajukan"), gsT("Nominal"), gsT("Dikirim"), gsT("Tujuan"), "Status", gsT("Catatan")].map((x) => h("th", {}, x)))),
        h("tbody", {}, ...(wdRows.length ? wdRows : [h("tr", {}, h("td", { colspan: "6" }, empty("box", gsT("Belum ada penarikan"), gsT("Permintaan tarik saldo kamu akan tampil di sini."))))])))));

    return h("div", {}, head(gsT("Pembayaran"), gsT("QRIS otomatis, saldo, dan penarikan.")),
        s.frozen ? h("div", { class: "notice bad", role: "alert" }, h("b", {}, gsT("Wallet dibekukan.")), gsT(" Deposit otomatis dan penarikan dinonaktifkan penjual.")) : null,
        s.mock ? h("div", { class: "notice warn", role: "status" }, h("b", {}, gsT("Mode uji coba.")), gsT(" QRIS di sini palsu dan tidak melibatkan uang sungguhan.")) : null,
        modeCard, balance, bank, txCard, wdCard);
}

// ---------- router ----------
const STORE_NAV = [
    [gsT("Operasional"), [
        ["dashboard", gsT("Ringkasan"), "dashboard"], ["sales", gsT("Pesanan"), "shopping-bag"],
        ["products", gsT("Produk & stok"), "package"], ["users", gsT("Pelanggan"), "users"], ["payments", gsT("Pembayaran"), "wallet"]
    ]],
    [gsT("Konfigurasi"), [
        ["bot", "Bot & server", "server"], ["settings", gsT("Pengaturan toko"), "settings"],
        ["emojis", "Emoji", "palette"], ["banner", "Banner", "image"]
    ]],
    [gsT("Panduan"), [["tutorial", gsT("Panduan setup"), "book"], ["commands", "Slash Command List", "terminal"],
        ["deposit-script", gsT("Script Deposit"), "script"]]],
    [gsT("Akun"), [["subscription", gsT("Langganan"), "credit-card"]]]
];
const SERVICE_NAV = [
    [gsT("Operasional"), [
        ["service", gsT("Ringkasan"), "dashboard"], ["orders", gsT("Pesanan"), "shopping-bag"], ["service-settings", gsT("Harga & status"), "sliders"]
    ]],
    [gsT("Konfigurasi"), [["bot", "Bot & server", "server"], ["service-emojis", "Emoji", "palette"]]],
    [gsT("Akun"), [["subscription", gsT("Langganan"), "credit-card"]]]
];
const NAV_ICON_PATHS = {
    dashboard: ['M3 3h7v7H3z','M14 3h7v4h-7z','M14 10h7v11h-7z','M3 14h7v7H3z'],
    package: ['m12 3 9 5-9 5-9-5 9-5Z','m3 8 9 5 9-5','M12 13v8','M7.5 5.5 16.5 10.5'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2','M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M20 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],
    settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z','M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.08-.02a1.7 1.7 0 0 0-1.74.68l-.04.07h-3.4l-.04-.07a1.7 1.7 0 0 0-1.74-.68l-.08.02-1.7-2.94.06-.06A1.7 1.7 0 0 0 9.7 15l-.08-.03v-3.4l.08-.03a1.7 1.7 0 0 0-.34-1.88L9.3 9.6 11 6.66l.08.02a1.7 1.7 0 0 0 1.74-.68l.04-.07h3.4l.04.07a1.7 1.7 0 0 0 1.74.68l.08-.02 1.7 2.94-.06.06A1.7 1.7 0 0 0 19.4 11.5l.08.03v3.4z'],
    palette: ['M12 3a9 9 0 1 0 0 18h1.1a2 2 0 0 0 1.5-3.3 1.7 1.7 0 0 1 1.3-2.8H18a3 3 0 0 0 3-3c0-4.9-4-8.9-9-8.9Z','M7.5 10h.01','M10 6.5h.01','M15 7.5h.01','M17 11h.01'],
    image: ['M4 4h16v16H4z','m4 15 4-4 4 4 3-3 5 5','M9 8h.01'],
    server: ['M4 4h16v6H4z','M4 14h16v6H4z','M8 7h.01','M8 17h.01','M12 7h4','M12 17h4'],
    book: ['M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z','M4 4.5v15A2.5 2.5 0 0 1 6.5 17H20','M8 6h8'],
    terminal: ['M3 5h18v14H3z','m7 9 3 3-3 3','M13 15h4'],
    script: ['M6 3h9l3 3v15H6z','M9 10h6','M9 14h6','M9 17h4'],
    'credit-card': ['M3 5h18v14H3z','M3 10h18','M7 15h4'],
    sliders: ['M4 21v-7','M4 10V3','M12 21v-9','M12 8V3','M20 21v-5','M20 12V3','M2 14h4','M10 8h4','M18 16h4'],
    'shopping-bag': ['M5 8h14l1 13H4L5 8Z','M9 8V6a3 3 0 0 1 6 0v2'],
    wallet: ['M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z','M3 7l2-3h12v3','M16 13h2']
};
function navIcon(name) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    (NAV_ICON_PATHS[name] || NAV_ICON_PATHS.dashboard).forEach(d => {
        const node = document.createElementNS(ns, d.includes(".") && d.startsWith("M") ? "path" : "path");
        node.setAttribute("d", d); svg.append(node);
    });
    return h("span", { class: "nav-icon nav-icon-" + name }, svg);
}
const VIEWS = { dashboard, products, users, sales: storeOrders, payments, settings, bot, tutorial, commands: commandGuide, "deposit-script": depositScript, subscription, emojis: storeCustomEmojis, banner: storeCustomBanner, service: serviceDashboard, "service-settings": serviceSettings, "service-emojis": serviceEmojis, orders: serviceOrders };
// Menu HP: sidebar jadi header ringkas dengan tombol buka/tutup menu.
function syncNavToggle() { const b = $("navToggle"); if (b) b.setAttribute("aria-expanded", String(!!document.querySelector(".side")?.classList.contains("open"))); }
function setupNavToggle() {
    const side = document.querySelector(".side");
    if (!side || $("navToggle")) return;
    const b = h("button", { id: "navToggle", type: "button", class: "nav-toggle", "aria-controls": "nav", "aria-expanded": "false", "aria-label": gsT("Buka menu"), onclick: () => { side.classList.toggle("open"); syncNavToggle(); } },
        h("span", { class: "nav-toggle-bars", "aria-hidden": "true" }), h("span", { class: "nav-toggle-txt" }, "Menu"));
    side.append(b);
}
function updateSide() {
    if (!me) return;
    const pill = botPill();
    $("botState").textContent = pill.textContent;
    $("botState").className = pill.className;
}
function drawNav(cur) {
    const nav = me?.type === "service" ? SERVICE_NAV : STORE_NAV;
    $("nav").replaceChildren(...nav.map(([group, links]) => h("div", { class: "panel-nav-group", role: "group", "aria-label": group },
        h("span", { class: "panel-nav-caption", "aria-hidden": "true" }, group),
        ...links.map(([k, label, icon]) => h("a", { class: k === cur ? "on" : "", href: "#/" + k, "aria-current": k === cur ? "page" : null },
            navIcon(icon), h("span", { class: "nav-label" }, label))))));
}
async function render() {
    const defaultView = me?.type === "service" ? "service" : "dashboard";
    let name = VIEWS[location.hash.slice(2)] ? location.hash.slice(2) : defaultView;
    if (me?.type === "service" && !["service", "service-settings", "service-emojis", "orders", "bot", "subscription"].includes(name)) name = "service";
    if (me?.type !== "service" && ["service", "service-settings", "service-emojis", "orders"].includes(name)) name = "dashboard";
    drawNav(name);
    document.querySelector(".side")?.classList.remove("open"); syncNavToggle();
    if (name !== "bot") clearInterval(logTimer);
    const view = $("view");
    view.replaceChildren(skeleton());
    try { view.replaceChildren(await VIEWS[name]()); const nb = renewBanner(); if (nb) view.prepend(nb); }
    catch (e) {
        if (e.status === 401) return showLogin();
        view.replaceChildren(card(h("h2", {}, gsT("Tidak bisa membuka halaman ini")), h("p", {}, e.message),
            e.status === 409 || e.status === 502 ? h("button", { class: "pri", onclick: () => (location.hash = "#/bot") }, gsT("Buka Bot & Server")) : null));
    }
}
function landingSection() {
    return document.getElementById(location.hash.slice(1))?.closest(".landing-section");
}
function showLogin() {
    $("app").classList.add("hide");
    $("login").classList.remove("hide");
    landingSection()?.scrollIntoView?.();
}
async function boot() {
    try { me = await api("GET", "/api/me"); } catch { return showLogin(); }
    if (landingSection()) {
        history.replaceState(null, "", location.pathname + location.search);
        window.scrollTo(0, 0);
    }
    $("login").classList.add("hide"); $("app").classList.remove("hide"); setupNavToggle(); updateSide(); render();
}
window.addEventListener("hashchange", () => {
    if (!$("app").classList.contains("hide")) render();
});
$("btnLogin").onclick = async () => {
    const m = $("loginMsg");
    try { await api("POST", "/api/login", { key: $("key").value }); boot(); }
    catch (e) { m.textContent = gsT(e.message); m.className = "msg err"; m.style.display = "block"; }
};
$("key").onkeydown = (e) => { if (e.key === "Enter") $("btnLogin").click(); };
$("btnOut").onclick = async () => { await api("POST", "/api/logout"); location.hash = ""; location.reload(); };
boot();
