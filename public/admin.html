"use strict";
const $ = (id) => document.getElementById(id);
const { h, toast, modal, confirmDialog, copyText } = UI;
const DAY = 86400000, SOON = 7; // key dianggap hampir habis kalau sisa 7 hari atau kurang

async function api(method, url, body) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "Terjadi kesalahan."), { status: r.status });
    return j;
}
function msg(id, t, ok) { const e = $(id); e.textContent = t; e.className = "msg " + (ok ? "ok" : "err"); e.style.display = "block"; }
const td = (content, cls) => { const e = h("td", cls ? { class: cls } : {}); e.append(content); return e; };

let licenses = [];
let query = "";

// Status satu key: habis / dicabut / hampir habis / aman
function statusOf(l) {
    const left = Math.ceil((l.expiresAt - Date.now()) / DAY);
    if (l.revoked) return { kind: "revoked", left, text: "dicabut" };
    if (left <= 0) return { kind: "expired", left, text: "habis" };
    if (left <= SOON) return { kind: "soon", left, text: `${left} hari lagi` };
    return { kind: "ok", left, text: `${left} hari lagi` };
}
// Nomor WhatsApp dari kolom kontak (hanya kalau isinya terlihat seperti nomor telepon)
function waNumber(contact) {
    const raw = String(contact || "").trim();
    if (!/^\+?[\d\s-]{8,20}$/.test(raw)) return null;
    let d = raw.replace(/\D/g, "");
    if (d.startsWith("0")) d = "62" + d.slice(1);
    return d.length >= 9 ? d : null;
}

function drawSummary() {
    const c = { all: licenses.length, ok: 0, soon: 0, expired: 0 };
    for (const l of licenses) { const k = statusOf(l).kind; if (k === "ok") c.ok++; else if (k === "soon") c.soon++; else c.expired++; }
    const item = (label, v, cls) => h("div", { class: "sum-item " + (cls || "") }, h("b", {}, String(v)), h("span", { class: "mut" }, label));
    $("summary").replaceChildren(item("Total pembeli", c.all), item("Aktif", c.ok), item("Hampir habis", c.soon, c.soon ? "warn" : ""), item("Habis / dicabut", c.expired, c.expired ? "bad" : ""));
}

function drawRows() {
    const body = $("rows"); body.replaceChildren();
    const needle = query.toLowerCase();
    const shown = licenses.filter((l) => !needle || [l.buyer, l.contact, l.keyPrefix].some((x) => String(x || "").toLowerCase().includes(needle)));
    const empty = $("emptyRows");
    empty.classList.toggle("hide", shown.length > 0);
    empty.textContent = licenses.length ? "Tidak ada pembeli yang cocok dengan pencarian." : "Belum ada pembeli. Buat key pertama di atas.";
    for (const l of shown) {
        const st = statusOf(l);
        const tr = h("tr", { class: st.kind === "soon" ? "row-soon" : st.kind === "ok" ? "" : "row-bad" });
        const wa = waNumber(l.contact);
        const contact = h("div", { class: "contact-cell" }, h("span", {}, l.contact || "-"),
            wa && st.kind !== "ok" ? h("a", { class: "wa-link", href: `https://wa.me/${wa}?text=${encodeURIComponent(st.kind === "soon" ? `Halo ${l.buyer}, key bot kamu tinggal ${st.left} hari lagi. Mau diperpanjang?` : `Halo ${l.buyer}, key bot kamu sudah tidak aktif. Mau diperpanjang?`)}`, target: "_blank", rel: "noopener" }, "Chat WA") : null);
        tr.append(
            td(l.buyer + (l.configured ? "" : " (belum setup)")), td(contact), td(l.type === "service" ? "AutoStore Service" : "AutoStore"), td(l.keyPrefix + "…"),
            td(h("span", { class: "pill " + (st.kind === "ok" ? "ok" : st.kind === "soon" ? "no" : "bad") }, st.text)),
            td(l.bot, l.bot));
        const act = h("div", { class: "row gap" },
            h("button", { class: "sm", onclick: () => extendModal(l) }, "Perpanjang"),
            h("button", { class: "sm", onclick: () => editModal(l) }, "Edit"),
            h("button", { class: "sm", onclick: run(async () => {
                if (!l.revoked && !(await confirmDialog({ title: `Cabut key ${l.buyer}?`, message: "Bot pembeli akan dimatikan sampai key diaktifkan lagi.", confirmText: "Cabut", danger: true }))) return;
                await api("POST", `/api/admin/licenses/${l.id}/revoke`, { revoked: !l.revoked });
            }) }, l.revoked ? "Aktifkan" : "Cabut"),
            h("button", { class: "sm bad", onclick: run(async () => {
                if (!(await confirmDialog({ title: `Hapus ${l.buyer}?`, message: "Bot akan dimatikan dan key ini dihapus permanen.", confirmText: "Hapus", danger: true }))) return;
                await api("DELETE", `/api/admin/licenses/${l.id}`);
            }) }, "Hapus"));
        tr.append(td(act));
        body.append(tr);
    }
}

// Jalankan aksi, tampilkan error sebagai toast, lalu muat ulang daftar
const run = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, false); } load(); };

function extendModal(l) {
    const days = h("input", { type: "number", min: "1", max: "3650", value: "30", "aria-label": "Jumlah hari" });
    const st = statusOf(l);
    const m = modal(`Perpanjang ${l.buyer}`,
        h("p", { class: "mut mt" }, st.kind === "expired" || st.kind === "revoked" ? "Key ini sudah tidak aktif. Hitungan hari dimulai dari hari ini." : `Sisa ${st.left} hari. Hari baru ditambahkan di atas sisa itu.`),
        h("label", {}, "Jumlah hari", days),
        h("div", { class: "chips mt" }, ...[7, 14, 30, 60, 90, 365].map((n) => h("button", { type: "button", class: "chip", onclick: () => { days.value = String(n); } }, `${n} hari`))),
        h("div", { class: "row mt" }, h("button", { class: "pri", onclick: run(async () => {
            const n = Math.floor(Number(days.value));
            if (!(n >= 1 && n <= 3650)) throw new Error("Jumlah hari harus 1 sampai 3650.");
            await api("POST", `/api/admin/licenses/${l.id}/extend`, { days: n });
            toast(`${l.buyer} diperpanjang ${n} hari.`); m.close();
        }) }, "Perpanjang")));
}

function editModal(l) {
    const name = h("input", { value: l.buyer, autocomplete: "off", "aria-label": "Nama pembeli" });
    const contact = h("input", { value: l.contact || "", placeholder: "Nomor WA (08…/62…) atau username Discord", autocomplete: "off", "aria-label": "Kontak" });
    const m = modal(`Edit ${l.buyer}`,
        h("label", {}, "Nama pembeli", name),
        h("label", {}, "Kontak", contact, h("div", { class: "mut" }, "Kalau berupa nomor WhatsApp, muncul tombol Chat WA untuk pengingat perpanjang.")),
        h("div", { class: "row mt" }, h("button", { class: "pri", onclick: run(async () => {
            await api("PUT", `/api/admin/licenses/${l.id}`, { buyer: name.value, contact: contact.value });
            toast("Tersimpan."); m.close();
        }) }, "Simpan")));
}

async function load() {
    let data;
    try { data = await api("GET", "/api/admin/licenses"); }
    catch { $("dash").classList.add("hide"); $("btnLogout").classList.add("hide"); $("login").classList.remove("hide"); return; }
    $("login").classList.add("hide"); $("dash").classList.remove("hide"); $("btnLogout").classList.remove("hide");
    licenses = data.licenses;
    drawSummary(); drawRows();
}

$("btnLogin").onclick = async () => { try { await api("POST", "/api/admin/login", { password: $("pw").value }); $("pw").value = ""; load(); } catch (e) { msg("loginMsg", e.message); } };
$("pw").onkeydown = (e) => { if (e.key === "Enter") $("btnLogin").click(); };
$("btnLogout").onclick = async () => { try { await api("POST", "/api/admin/logout"); } catch { /* tetap tampilkan form masuk */ } licenses = []; load(); };
$("search").oninput = () => { query = $("search").value.trim(); drawRows(); };
$("btnNew").onclick = async () => {
    try {
        const r = await api("POST", "/api/admin/licenses", { buyer: $("buyer").value, contact: $("contact").value, type: $("licenseType").value, days: Number($("days").value) });
        $("keyText").textContent = r.key; $("newKey").classList.remove("hide"); $("newMsg").style.display = "none"; $("buyer").value = ""; $("contact").value = ""; load();
    } catch (e) { msg("newMsg", e.message); }
};
$("btnCopyKey").onclick = async () => { const ok = await copyText($("keyText").textContent); toast(ok ? "Key disalin." : "Gagal menyalin, salin manual ya.", ok); };
$("btnSend").onclick = async () => { try { await api("POST", "/api/admin/backup/send"); msg("bkMsg", "Backup terkirim ke Discord.", true); } catch (e) { msg("bkMsg", e.message); } };
$("btnRestore").onclick = () => $("fileRestore").click();
$("fileRestore").onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = "";
    if (!f) return;
    if (!(await confirmDialog({ title: "Restore data?", message: "Restore akan MENGGANTI semua data pembeli di server ini dengan isi file. Lanjutkan?", confirmText: "Ya, restore", danger: true }))) return;
    try {
        const r = await fetch("/api/admin/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: await f.text() });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || "Restore gagal.");
        msg("bkMsg", `Restore berhasil: ${out.count} pembeli.`, true); load();
    } catch (e) { msg("bkMsg", e.message); }
};
load(); setInterval(() => $("dash").classList.contains("hide") || load(), 10000);
