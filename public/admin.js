const $ = (id) => document.getElementById(id);
async function api(method, url, body) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Terjadi kesalahan.");
    return j;
}
function msg(id, t, ok) { const e = $(id); e.textContent = t; e.className = "msg " + (ok ? "ok" : "err"); e.style.display = "block"; }
function td(text, cls) { const e = document.createElement("td"); e.textContent = text; if (cls) e.className = cls; return e; }
function pillTd(text, state) { const e = document.createElement("td"); const sp = document.createElement("span"); sp.className = "adm-pill adm-" + state; sp.textContent = text; e.append(sp); return e; }
const BOT_TXT = { running: "Online", stopped: "Offline", crashed: "Error", starting: "Memulai", restarting: "Restart" };
const BOT_STATE = { running: "ok", stopped: "off", crashed: "bad", starting: "warn", restarting: "warn" };
function stats(list) {
    const now = Date.now(); let active = 0, soon = 0, dead = 0;
    for (const l of list) {
        const left = Math.ceil((l.expiresAt - now) / 86400000);
        if (l.revoked || left <= 0) dead++; else { active++; if (left <= 7) soon++; }
    }
    $("stTotal").textContent = list.length; $("stActive").textContent = active; $("stSoon").textContent = soon; $("stDead").textContent = dead;
}
function btn(text, fn, cls) { const b = document.createElement("button"); b.textContent = text; if (cls) b.className = cls; b.onclick = async () => { try { await fn(); } catch (e) { alert(e.message); } load(); }; return b; }

const ORD = { pending: ["Menunggu bayar", "off"], claimed: ["Sudah klik bayar", "warn"], done: ["Selesai", "ok"], rejected: ["Ditolak", "bad"], expired: ["Kedaluwarsa", "off"] };
const rp = (n) => "Rp" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
function ago(t) { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? "baru saja" : m < 60 ? `${m} menit lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`; }
function showOrderKey(key, note) { $("orderKeyText").textContent = key; $("orderKeyNote").textContent = note; $("orderKey").classList.remove("hide"); }
async function loadOrders() {
    let r; try { r = await api("GET", "/api/admin/orders"); } catch { return; }
    const list = r.orders, body = $("orderRows"); body.replaceChildren();
    const waiting = list.filter((o) => o.status === "claimed").length;
    $("stPending").textContent = waiting;
    $("ordCount").textContent = waiting ? `${waiting} perlu dicek` : ""; $("ordCount").classList.toggle("hide", !waiting);
    document.title = (waiting ? `(${waiting}) ` : "") + "GevraStore Admin";
    $("emptyOrders").classList.toggle("hide", list.length > 0);
    for (const o of list) {
        const tr = document.createElement("tr");
        const who = td(""); const b1 = document.createElement("b"); b1.textContent = o.name; const sm = document.createElement("div"); sm.className = "mut"; sm.textContent = o.contact; who.append(b1, sm);
        const [lbl, st] = ORD[o.status] || [o.status, "off"];
        const code = td(""); const c1 = document.createElement("b"); c1.textContent = o.code; const t1 = document.createElement("div"); t1.className = "mut"; t1.textContent = ago(o.claimedAt || o.createdAt); code.append(c1, t1);
        const amt = td(""); const a1 = document.createElement("b"); a1.textContent = rp(o.amount); amt.append(a1);
        tr.append(code, td(`${o.packageName} · ${o.days} hari`), amt, who, pillTd(lbl, st));
        const act = document.createElement("td"); act.className = "row";
        if (o.status !== "done" && o.status !== "rejected") {
            act.append(
                btn("Konfirmasi", async () => {
                    if (!confirm(`Sudah cek mutasi DANA sebesar ${rp(o.amount)} dari ${o.name}?\nKey akan dibuat sekarang.`)) return;
                    const out = await api("POST", `/api/admin/orders/${o.id}/confirm`);
                    showOrderKey(out.key, `Key untuk ${o.name} (${o.code}). Key juga muncul otomatis di halaman pembeli selama 24 jam:`);
                }, "pri"),
                btn("Tolak", async () => { if (confirm(`Tolak pesanan ${o.code}?`)) await api("POST", `/api/admin/orders/${o.id}/reject`); }, "bad"));
        }
        tr.append(act); body.append(tr);
    }
}
const copyBtn = (text, label) => btn(label, async () => { await navigator.clipboard.writeText(text); });
async function loadWallet() {
    let ov; try { ov = await api("GET", "/api/admin/wallet/overview"); } catch { return; }
    $("walletCard").classList.toggle("hide", !ov.enabled); $("stWdBox").classList.toggle("hide", !ov.enabled);
    if (!ov.enabled) return;
    $("walletInfo").textContent = `Kewajiban ke pembeli: ${rp(ov.owed)} (tersedia ${rp(ov.available)}, ditahan ${rp(ov.pending)}, sedang ditarik ${rp(ov.locked)}). Saldo di Autoko harus minimal sebesar ini. Autoko: ${ov.autoko === "mock" ? "MODE UJI COBA (QRIS palsu)" : ov.autokoReady ? "aktif" : "belum aktif"}.`;
    $("mockBox").classList.toggle("hide", ov.autoko !== "mock");
    $("stWd").textContent = ov.openWithdrawals;
    $("wdCount").textContent = ov.openWithdrawals ? `${ov.openWithdrawals} perlu diproses` : ""; $("wdCount").classList.toggle("hide", !ov.openWithdrawals);
    let list; try { list = (await api("GET", "/api/admin/withdrawals?status=pending")).withdrawals; } catch { return; }
    const body = $("wdRows"); body.replaceChildren(); $("emptyWd").classList.toggle("hide", list.length > 0);
    for (const w of list) {
        const tr = document.createElement("tr");
        const who = td(""); const b1 = document.createElement("b"); b1.textContent = w.buyer; const s1 = document.createElement("div"); s1.className = "mut"; s1.textContent = `diminta ${rp(w.amount)}` + (w.fee ? `, biaya ${rp(w.fee)}` : ""); who.append(b1, s1);
        const pay = td(""); const p1 = document.createElement("b"); p1.textContent = rp(w.payout); pay.append(p1);
        const bk = td(""); const k1 = document.createElement("b"); k1.textContent = `${w.bankFull.bankName} ${w.bankFull.accountNo}`; const k2 = document.createElement("div"); k2.className = "mut"; k2.textContent = "a.n. " + w.bankFull.accountName; bk.append(k1, k2);
        tr.append(who, pay, bk, td(ago(w.createdAt)));
        const act = document.createElement("td"); act.className = "row";
        act.append(
            copyBtn(w.bankFull.accountNo, "Salin no."), copyBtn(String(w.payout), "Salin nominal"),
            btn("Sudah ditransfer", async () => {
                const ref = prompt(`Transfer ${rp(w.payout)} ke ${w.bankFull.bankName} ${w.bankFull.accountNo} a.n. ${w.bankFull.accountName} sudah dilakukan?\nCatatan/ref transfer (opsional):`);
                if (ref === null) return;
                await api("POST", `/api/admin/withdrawals/${w.id}/paid`, { reference: ref });
            }, "pri"),
            btn("Tolak", async () => { const why = prompt(`Tolak penarikan ${rp(w.amount)} dari ${w.buyer}? Saldo dikembalikan.\nAlasan (opsional):`); if (why === null) return; await api("POST", `/api/admin/withdrawals/${w.id}/reject`, { reason: why }); }, "bad"));
        tr.append(act); body.append(tr);
    }
}
async function load() {
    let data;
    try { data = await api("GET", "/api/admin/licenses"); } catch { $("dash").classList.add("hide"); $("login").classList.remove("hide"); return; }
    $("login").classList.add("hide"); $("dash").classList.remove("hide");
    loadOrders(); loadWallet();
    const body = $("rows"); body.replaceChildren();
    stats(data.licenses);
    const qv = ($("q") ? $("q").value : "").trim().toLowerCase();
    const shown = data.licenses.filter((l) => !qv || (l.buyer + " " + l.keyPrefix).toLowerCase().includes(qv));
    $("emptyRows").classList.toggle("hide", shown.length > 0);
    for (const l of shown) {
        const tr = document.createElement("tr");
        const left = Math.ceil((l.expiresAt - Date.now()) / 86400000);
        tr.append(td(l.buyer + (l.configured ? "" : " (belum setup)")), td(l.type === "service" ? "AutoStore Service" : "AutoStore"), td(l.keyPrefix + "…"),
            l.revoked ? pillTd("Dicabut", "bad") : left <= 0 ? pillTd("Habis", "bad") : pillTd(`${left} hari lagi`, left <= 7 ? "warn" : "ok"), pillTd(BOT_TXT[l.bot] || l.bot, BOT_STATE[l.bot] || "off"));
        const act = document.createElement("td"); act.className = "row";
        act.append(
            btn("+30 hari", () => api("POST", `/api/admin/licenses/${l.id}/extend`, { days: 30 })),
            ...(l.type === "service" ? [] : [btn(l.walletFrozen ? "Buka wallet" : "Bekukan wallet", () => api("POST", `/api/admin/licenses/${l.id}/wallet-freeze`, { frozen: !l.walletFrozen }))]),
            btn(l.revoked ? "Aktifkan" : "Cabut", () => api("POST", `/api/admin/licenses/${l.id}/revoke`, { revoked: !l.revoked })),
            btn("Hapus", async () => { if (confirm(`Hapus ${l.buyer}? Bot akan dimatikan.`)) await api("DELETE", `/api/admin/licenses/${l.id}`); }, "bad"));
        tr.append(act); body.append(tr);
    }
}
$("btnLogin").onclick = async () => { try { await api("POST", "/api/admin/login", { password: $("pw").value }); load(); } catch (e) { msg("loginMsg", e.message); } };
$("pw").onkeydown = (e) => { if (e.key === "Enter") $("btnLogin").click(); };
$("btnNew").onclick = async () => {
    const b = $("btnNew"), old = b.textContent; b.disabled = true; b.textContent = "Memproses...";
    try {
        const r = await api("POST", "/api/admin/licenses", { buyer: $("buyer").value, type: $("licenseType").value, days: Number($("days").value) });
        $("keyText").textContent = r.key; $("newKey").classList.remove("hide"); $("newMsg").style.display = "none"; $("buyer").value = ""; load();
    } catch (e) { msg("newMsg", e.message); }
    b.disabled = false; b.textContent = old;
};
$("btnCopyKey").onclick = async () => {
    const b = $("btnCopyKey");
    try { await navigator.clipboard.writeText($("keyText").textContent); b.textContent = "Tersalin ✓"; } catch { b.textContent = "Gagal, salin manual"; }
    setTimeout(() => { b.textContent = "Salin key"; }, 1600);
};
$("q").oninput = () => load();
$("btnReconcile").onclick = async () => {
    try {
        const r = await api("POST", "/api/admin/wallet/reconcile", { fix: false });
        if (!r.diffs.length) return msg("wdMsg", "Semua saldo cocok dengan ledger.", true);
        if (confirm(`Ada ${r.diffs.length} saldo yang tidak cocok dengan ledger.\nPerbaiki sekarang berdasarkan ledger?`)) { await api("POST", "/api/admin/wallet/reconcile", { fix: true }); msg("wdMsg", "Saldo diperbaiki dari ledger.", true); load(); }
    } catch (e) { msg("wdMsg", e.message); }
};
$("btnMockPay").onclick = async () => { try { await api("POST", "/api/admin/wallet/mock-pay", { orderId: $("mockOrder").value.trim() }); msg("wdMsg", "Disimulasikan sudah dibayar.", true); load(); } catch (e) { msg("wdMsg", e.message); } };
$("btnCopyOrderKey").onclick = async () => {
    const b = $("btnCopyOrderKey");
    try { await navigator.clipboard.writeText($("orderKeyText").textContent); b.textContent = "Tersalin ✓"; } catch { b.textContent = "Gagal, salin manual"; }
    setTimeout(() => { b.textContent = "Salin key"; }, 1600);
};
$("btnSend").onclick = async () => { try { await api("POST", "/api/admin/backup/send"); msg("bkMsg", "Backup terkirim ke Discord.", true); } catch (e) { msg("bkMsg", e.message); } };
$("btnRestore").onclick = () => $("fileRestore").click();
$("fileRestore").onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = "";
    if (!f) return;
    if (!confirm("Restore akan MENGGANTI semua data pembeli di server ini dengan isi file. Lanjut?")) return;
    try {
        const r = await fetch("/api/admin/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: await f.text() });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || "Restore gagal.");
        msg("bkMsg", `Restore berhasil: ${out.count} pembeli.`, true); load();
    } catch (e) { msg("bkMsg", e.message); }
};
load(); setInterval(() => $("dash").classList.contains("hide") || load(), 10000);
