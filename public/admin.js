const $ = (id) => document.getElementById(id);
async function api(method, url, body) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(gsT(j.error || "Terjadi kesalahan."));
    return j;
}
function msg(id, t, ok) { const e = $(id); e.textContent = t; e.className = "msg " + (ok ? "ok" : "err"); e.style.display = "block"; }
function td(text, cls) { const e = document.createElement("td"); e.textContent = text; if (cls) e.className = cls; return e; }
function pillTd(text, state) { const e = document.createElement("td"); const sp = document.createElement("span"); sp.className = "adm-pill adm-" + state; sp.textContent = text; e.append(sp); return e; }
const BOT_TXT = { running: "Online", stopped: "Offline", crashed: "Error", starting: gsT("Memulai"), restarting: "Restart" };
const BOT_STATE = { running: "ok", stopped: "off", crashed: "bad", starting: "warn", restarting: "warn" };
function stats(list) {
    const now = Date.now(); let active = 0, soon = 0, dead = 0;
    for (const l of list) {
        const left = Math.ceil((l.expiresAt - now) / 86400000);
        if (l.revoked || left <= 0) dead++; else { active++; if (left <= 7) soon++; }
    }
    $("stTotal").textContent = list.length; $("stActive").textContent = active; $("stSoon").textContent = soon; $("stDead").textContent = dead;
}
function btn(text, fn, cls) { const b = document.createElement("button"); b.textContent = text; if (cls) b.className = cls; b.onclick = async () => { try { await fn(); } catch (e) { await gsAlert(e.message); } load(); }; return b; }

const ORD = { pending: [gsT("Menunggu bayar"), "off"], claimed: [gsT("Sudah klik bayar"), "warn"], done: [gsT("Selesai"), "ok"], rejected: [gsT("Ditolak"), "bad"], expired: [gsT("Kedaluwarsa"), "off"] };
const rp = (n) => "Rp" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
function ago(t) { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? gsT("baru saja") : m < 60 ? gsT`${m} menit lalu` : m < 1440 ? gsT`${Math.round(m / 60)} jam lalu` : gsT`${Math.round(m / 1440)} hari lalu`; }
function showOrderKey(key, note) { $("orderKeyText").textContent = key; $("orderKeyNote").textContent = note; $("orderKey").classList.remove("hide"); }
const ADM = { mock: false, pk: "" };
function pkgCell(o) {
    const c = td(o.lifetime ? o.packageName : gsT`${o.packageName} ${o.days} hari`);
    for (const [on, txt, st] of [[o.auto, gsT("Otomatis"), "ok"], [o.paymentMethod === "dl", "DL / Discord", "warn"], [o.renew, gsT("Perpanjangan"), "warn"]]) if (on) { const sp = document.createElement("span"); sp.className = "adm-pill adm-" + st; sp.textContent = txt; sp.style.marginLeft = "6px"; c.append(sp); }
    return c;
}
async function loadPackages() {
    let r; try { r = await api("GET", "/api/admin/packages"); } catch { return; }
    ADM.mock = !!r.mock;
    $("pkAutoInfo").textContent = r.auto ? (r.mock ? gsT("aktif (MODE UJI COBA, QRIS palsu)") : gsT("aktif")) : gsT("nonaktif (isi ORDER_AUTO=1 dan aktifkan Autoko untuk menyalakan)");
    const sig = JSON.stringify(r.packages);
    const box = $("pkRows");
    if (sig === ADM.pk || box.contains(document.activeElement)) return; // jangan menimpa isian yang sedang diketik
    ADM.pk = sig; box.replaceChildren();
    for (const p of r.packages) {
        const row = document.createElement("div"); row.className = "adm-pkrow";
        const name = document.createElement("div"); name.className = "adm-pkname"; const b1 = document.createElement("b"); b1.textContent = p.name; const sm = document.createElement("div"); sm.className = "mut"; sm.textContent = p.lifetime ? gsT("Seumur hidup") : gsT`${p.days} hari, key ${p.type}`; name.append(b1, sm);
        const price = document.createElement("input"); price.type = "number"; price.min = "1000"; price.max = "1000000"; price.step = "500"; price.value = p.price; price.setAttribute("aria-label", gsT("Harga ") + p.name);
        const lab = document.createElement("label"); lab.className = "check-row"; const ck = document.createElement("input"); ck.type = "checkbox"; ck.checked = p.sellable; const sp = document.createElement("span"); sp.textContent = gsT("Dijual"); lab.append(ck, sp);
        const save = btn(gsT("Simpan"), async () => { await api("PUT", "/api/admin/packages/" + p.id, { price: Number(price.value), sellable: ck.checked }); ADM.pk = ""; msg("pkMsg", gsT`${p.name} tersimpan.`, true); }, "pri");
        const priceField = document.createElement("label");
        priceField.className = "adm-price-field";
        priceField.append(gsLanguage === "en" ? "Price (IDR)" : "Harga (Rp)", price);
        row.append(name, priceField, lab, save); box.append(row);
    }
}
async function loadOrders() {
    let r; try { r = await api("GET", "/api/admin/orders"); } catch { return; }
    const list = r.orders, body = $("orderRows"); body.replaceChildren();
    const waiting = list.filter((o) => o.status === "claimed").length;
    $("stPending").textContent = waiting;
    $("ordCount").textContent = waiting ? gsT`${waiting} perlu dicek` : ""; $("ordCount").classList.toggle("hide", !waiting);
    document.title = (waiting ? `(${waiting}) ` : "") + "GevraStore Admin";
    $("emptyOrders").classList.toggle("hide", list.length > 0);
    for (const o of list) {
        const tr = document.createElement("tr");
        const who = td(""); const b1 = document.createElement("b"); b1.textContent = o.name; const sm = document.createElement("div"); sm.className = "mut"; sm.textContent = o.contact; who.append(b1, sm);
        const [lbl, st] = ORD[o.status] || [o.status, "off"];
        const code = td(""); const c1 = document.createElement("b"); c1.textContent = o.code; const t1 = document.createElement("div"); t1.className = "mut"; t1.textContent = ago(o.claimedAt || o.createdAt); code.append(c1, t1);
        const amt = td(""); const a1 = document.createElement("b"); a1.textContent = o.paymentMethod === "dl" ? `${Math.floor(o.amountWL / 100)} DL ${o.amountWL % 100} WL` : rp(o.amount); amt.append(a1);
        tr.append(code, pkgCell(o), amt, who, pillTd(lbl, st));
        const act = document.createElement("td"); act.className = "row";
        if (o.status === "rejected") {
            const label = gsLanguage === "en" ? "Remove from list" : "Hapus dari daftar";
            act.append(btn(label, async () => {
                const question = gsLanguage === "en" ? `Remove rejected order ${o.code} from the list?` : `Hapus pesanan ditolak ${o.code} dari daftar?`;
                if (!(await gsConfirm(question, { danger: true, okText: label }))) return;
                await api("DELETE", `/api/admin/orders/${o.id}`);
                msg("ordMsg", gsLanguage === "en" ? "Order removed from the list." : "Pesanan dihapus dari daftar.", true);
            }, "bad"));
        } else if (o.status !== "done") {
            const lunas = o.paymentMethod === "dl" ? gsT("Sudah menerima {0} untuk pesanan {1} di Discord?", a1.textContent, o.code) :
                o.auto ? gsT("Pesanan otomatis seharusnya lunas sendiri. Tetap konfirmasi manual sekarang?") : gsT`Sudah cek mutasi DANA sebesar ${rp(o.amount)} dari ${o.name}?`;
            act.append(
                btn(gsT("Konfirmasi"), async () => {
                    const what = o.renew ? gsT("Masa aktif key akan ditambah.") : gsT("Key akan dibuat sekarang.");
                    if (!(await gsConfirm(`${lunas}\n${what}`, { okText: gsT("Konfirmasi") }))) return;
                    const out = await api("POST", `/api/admin/orders/${o.id}/confirm`);
                    if (out.renewed) { msg("ordMsg", gsT`Perpanjangan ${o.name} (${o.code}) selesai. Berlaku sampai ${new Date(out.expiresAt).toLocaleString(gsLocale)}.`, true); return; }
                    $("ordMsg").style.display = "none";
                    showOrderKey(out.key, gsT`Key untuk ${o.name} (${o.code}). Key juga muncul otomatis di halaman pembeli selama 24 jam:`);
                }, "pri"),
                ...(o.auto && ADM.mock ? [btn(gsT("Simulasi bayar"), () => api("POST", `/api/admin/orders/${o.id}/mock-pay`))] : []),
                btn(gsT("Tolak"), async () => { if (await gsConfirm(gsT`Tolak pesanan ${o.code}?`, { danger: true, okText: gsT("Tolak") })) await api("POST", `/api/admin/orders/${o.id}/reject`); }, "bad"));
        }
        tr.append(act); body.append(tr);
    }
}
const copyBtn = (text, label) => btn(label, async () => { await navigator.clipboard.writeText(text); });
async function loadWallet() {
    let ov; try { ov = await api("GET", "/api/admin/wallet/overview"); } catch { return; }
    $("walletCard").classList.toggle("hide", !ov.enabled); $("stWdBox").classList.toggle("hide", !ov.enabled);
    if (!ov.enabled) return;
    $("walletInfo").textContent = gsT`Kewajiban ke pembeli: ${rp(ov.owed)} (tersedia ${rp(ov.available)}, ditahan ${rp(ov.pending)}, sedang ditarik ${rp(ov.locked)}). Saldo di Autoko harus minimal sebesar ini. Autoko: ${ov.autoko === "mock" ? gsT("MODE UJI COBA (QRIS palsu)") : ov.autokoReady ? gsT("aktif") : gsT("belum aktif")}.`;
    $("mockBox").classList.toggle("hide", ov.autoko !== "mock");
    $("stWd").textContent = ov.openWithdrawals;
    $("wdCount").textContent = ov.openWithdrawals ? gsT`${ov.openWithdrawals} perlu diproses` : ""; $("wdCount").classList.toggle("hide", !ov.openWithdrawals);
    let list; try { list = (await api("GET", "/api/admin/withdrawals?status=pending")).withdrawals; } catch { return; }
    const body = $("wdRows"); body.replaceChildren(); $("emptyWd").classList.toggle("hide", list.length > 0);
    for (const w of list) {
        const tr = document.createElement("tr");
        const who = td(""); const b1 = document.createElement("b"); b1.textContent = w.buyer; const s1 = document.createElement("div"); s1.className = "mut"; s1.textContent = gsT`diminta ${rp(w.amount)}` + (w.fee ? gsT`, biaya ${rp(w.fee)}` : ""); who.append(b1, s1);
        const pay = td(""); const p1 = document.createElement("b"); p1.textContent = rp(w.payout); pay.append(p1);
        const bk = td(""); const k1 = document.createElement("b"); k1.textContent = `${w.bankFull.bankName} ${w.bankFull.accountNo}`; const k2 = document.createElement("div"); k2.className = "mut"; k2.textContent = gsT("a.n. ") + w.bankFull.accountName; bk.append(k1, k2);
        tr.append(who, pay, bk, td(ago(w.createdAt)));
        const act = document.createElement("td"); act.className = "row";
        act.append(
            copyBtn(w.bankFull.accountNo, gsT("Salin no.")), copyBtn(String(w.payout), gsT("Salin nominal")),
            btn(gsT("Sudah ditransfer"), async () => {
                const ref = await gsPrompt(gsT`Transfer ${rp(w.payout)} ke ${w.bankFull.bankName} ${w.bankFull.accountNo} a.n. ${w.bankFull.accountName} sudah dilakukan?\nCatatan/ref transfer (opsional):`);
                if (ref === null) return;
                await api("POST", `/api/admin/withdrawals/${w.id}/paid`, { reference: ref });
            }, "pri"),
            btn(gsT("Tolak"), async () => { const why = await gsPrompt(gsT`Tolak penarikan ${rp(w.amount)} dari ${w.buyer}? Saldo dikembalikan.\nAlasan (opsional):`); if (why === null) return; await api("POST", `/api/admin/withdrawals/${w.id}/reject`, { reason: why }); }, "bad"));
        tr.append(act); body.append(tr);
    }
}
const workspaces = [...document.querySelectorAll(".adm-workspace")];
const workspaceLinks = [...document.querySelectorAll(".adm-jump a")];
function showWorkspace() {
    const active = workspaces.find(section => "#" + section.id === location.hash) || workspaces[0];
    for (const section of workspaces) section.classList.toggle("hide", section !== active);
    for (const link of workspaceLinks) {
        if (link.hash === "#" + active.id) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    }
}
window.addEventListener("hashchange", showWorkspace);
showWorkspace();

async function load() {
    let data;
    try { data = await api("GET", "/api/admin/licenses"); } catch { $("dash").classList.add("hide"); $("login").classList.remove("hide"); return; }
    $("login").classList.add("hide"); $("dash").classList.remove("hide");
    loadOrders(); loadWallet(); loadPackages();
    const body = $("rows"); body.replaceChildren();
    stats(data.licenses);
    const qv = ($("q") ? $("q").value : "").trim().toLowerCase();
    const shown = data.licenses.filter((l) => !qv || (l.buyer + " " + l.keyPrefix).toLowerCase().includes(qv));
    $("emptyRows").classList.toggle("hide", shown.length > 0);
    for (const l of shown) {
        const tr = document.createElement("tr");
        const left = Math.ceil((l.expiresAt - Date.now()) / 86400000);
        tr.append(td(l.buyer + (l.configured ? "" : gsT(" (belum setup)"))), td(l.type === "service" ? "AutoStore Service" : "AutoStore"), td(l.keyPrefix + "…"),
            l.revoked ? pillTd(gsT("Dicabut"), "bad") : l.lifetime ? pillTd(gsT("Seumur hidup"), "ok") : left <= 0 ? pillTd(gsT("Habis"), "bad") : pillTd(gsT`${left} hari lagi`, left <= 7 ? "warn" : "ok"), pillTd(BOT_TXT[l.bot] || l.bot, BOT_STATE[l.bot] || "off"));
        const act = document.createElement("td"); act.className = "row";
        act.append(
            ...(l.lifetime ? [] : [btn(gsT("+30 hari"), () => api("POST", `/api/admin/licenses/${l.id}/extend`, { days: 30 }))]),
            ...(l.type === "service" ? [] : [btn(l.walletFrozen ? gsT("Buka wallet") : gsT("Bekukan wallet"), () => api("POST", `/api/admin/licenses/${l.id}/wallet-freeze`, { frozen: !l.walletFrozen }))]),
            btn(l.revoked ? gsT("Aktifkan") : gsT("Cabut"), () => api("POST", `/api/admin/licenses/${l.id}/revoke`, { revoked: !l.revoked })),
            btn(gsT("Hapus"), async () => { if (await gsConfirm(gsT`Hapus ${l.buyer}? Bot akan dimatikan.`, { danger: true, okText: gsT("Hapus") })) await api("DELETE", `/api/admin/licenses/${l.id}`); }, "bad"));
        tr.append(act); body.append(tr);
    }
}
$("btnLogin").onclick = async () => { try { await api("POST", "/api/admin/login", { password: $("pw").value }); load(); } catch (e) { msg("loginMsg", e.message); } };
$("pw").onkeydown = (e) => { if (e.key === "Enter") $("btnLogin").click(); };
$("btnNew").onclick = async () => {
    const b = $("btnNew"), old = b.textContent; b.disabled = true; b.textContent = gsT("Memproses...");
    try {
        const r = await api("POST", "/api/admin/licenses", { buyer: $("buyer").value, type: $("licenseType").value, days: Number($("days").value) });
        $("keyText").textContent = r.key; $("newKey").classList.remove("hide"); $("newMsg").style.display = "none"; $("buyer").value = ""; load();
    } catch (e) { msg("newMsg", e.message); }
    b.disabled = false; b.textContent = old;
};
$("btnCopyKey").onclick = async () => {
    const b = $("btnCopyKey");
    try { await navigator.clipboard.writeText($("keyText").textContent); b.textContent = gsT("Tersalin ✓"); } catch { b.textContent = gsT("Gagal, salin manual"); }
    setTimeout(() => { b.textContent = gsT("Salin key"); }, 1600);
};
$("q").oninput = () => load();
$("btnReconcile").onclick = async () => {
    try {
        const r = await api("POST", "/api/admin/wallet/reconcile", { fix: false });
        if (!r.diffs.length) return msg("wdMsg", gsT("Semua saldo cocok dengan ledger."), true);
        if (await gsConfirm(gsT`Ada ${r.diffs.length} saldo yang tidak cocok dengan ledger.\nPerbaiki sekarang berdasarkan ledger?`, { okText: gsT("Perbaiki") })) { await api("POST", "/api/admin/wallet/reconcile", { fix: true }); msg("wdMsg", gsT("Saldo diperbaiki dari ledger."), true); load(); }
    } catch (e) { msg("wdMsg", e.message); }
};
$("btnWalletBackup").onclick = async () => {
    const b = $("btnWalletBackup"); b.disabled = true;
    try { const r = await api("POST", "/api/admin/wallet/backup"); msg("wdMsg", gsT`Backup wallet terkirim ke Discord (ledger ${r.counts.ledger}, deposit ${r.counts.deposits}, penarikan ${r.counts.withdrawals}).`, true); }
    catch (e) { msg("wdMsg", e.message); }
    b.disabled = false;
};
$("btnMockPay").onclick = async () => { try { await api("POST", "/api/admin/wallet/mock-pay", { orderId: $("mockOrder").value.trim() }); msg("wdMsg", gsT("Disimulasikan sudah dibayar."), true); load(); } catch (e) { msg("wdMsg", e.message); } };
$("btnCopyOrderKey").onclick = async () => {
    const b = $("btnCopyOrderKey");
    try { await navigator.clipboard.writeText($("orderKeyText").textContent); b.textContent = gsT("Tersalin ✓"); } catch { b.textContent = gsT("Gagal, salin manual"); }
    setTimeout(() => { b.textContent = gsT("Salin key"); }, 1600);
};
$("btnSend").onclick = async () => { try { await api("POST", "/api/admin/backup/send"); msg("bkMsg", gsT("Backup terkirim ke Discord."), true); } catch (e) { msg("bkMsg", e.message); } };
$("btnRestore").onclick = () => $("fileRestore").click();
$("fileRestore").onchange = async (ev) => {
    const f = ev.target.files[0]; ev.target.value = "";
    if (!f) return;
    if (!(await gsConfirm(gsT("Restore akan MENGGANTI semua data pembeli di server ini dengan isi file. Lanjut?"), { danger: true, okText: "Restore" }))) return;
    try {
        const r = await fetch("/api/admin/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: await f.text() });
        const out = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(out.error || gsT("Restore gagal."));
        msg("bkMsg", gsT`Restore berhasil: ${out.count} pembeli.`, true); load();
    } catch (e) { msg("bkMsg", e.message); }
};
load(); setInterval(() => $("dash").classList.contains("hide") || load(), 10000);
