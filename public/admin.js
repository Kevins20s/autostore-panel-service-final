const $ = (id) => document.getElementById(id);
async function api(method, url, body) {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Terjadi kesalahan.");
    return j;
}
function msg(id, t, ok) { const e = $(id); e.textContent = t; e.className = "msg " + (ok ? "ok" : "err"); e.style.display = "block"; }
function td(text, cls) { const e = document.createElement("td"); e.textContent = text; if (cls) e.className = cls; return e; }
function btn(text, fn, cls) { const b = document.createElement("button"); b.textContent = text; if (cls) b.className = cls; b.onclick = async () => { try { await fn(); } catch (e) { alert(e.message); } load(); }; return b; }

async function load() {
    let data;
    try { data = await api("GET", "/api/admin/licenses"); } catch { $("dash").classList.add("hide"); $("login").classList.remove("hide"); return; }
    $("login").classList.add("hide"); $("dash").classList.remove("hide");
    const body = $("rows"); body.replaceChildren();
    for (const l of data.licenses) {
        const tr = document.createElement("tr");
        const left = Math.ceil((l.expiresAt - Date.now()) / 86400000);
        tr.append(td(l.buyer + (l.configured ? "" : " (belum setup)")), td(l.type === "service" ? "AutoStore Service" : "AutoStore"), td(l.keyPrefix + "…"),
            td(l.revoked ? "dicabut" : left > 0 ? `${left} hari lagi` : "habis", l.revoked || left <= 0 ? "bad" : ""), td(l.bot, l.bot));
        const act = document.createElement("td"); act.className = "row";
        act.append(
            btn("+30 hari", () => api("POST", `/api/admin/licenses/${l.id}/extend`, { days: 30 })),
            btn(l.revoked ? "Aktifkan" : "Cabut", () => api("POST", `/api/admin/licenses/${l.id}/revoke`, { revoked: !l.revoked })),
            btn("Hapus", async () => { if (confirm(`Hapus ${l.buyer}? Bot akan dimatikan.`)) await api("DELETE", `/api/admin/licenses/${l.id}`); }, "bad"));
        tr.append(act); body.append(tr);
    }
}
$("btnLogin").onclick = async () => { try { await api("POST", "/api/admin/login", { password: $("pw").value }); load(); } catch (e) { msg("loginMsg", e.message); } };
$("pw").onkeydown = (e) => { if (e.key === "Enter") $("btnLogin").click(); };
$("btnNew").onclick = async () => {
    try {
        const r = await api("POST", "/api/admin/licenses", { buyer: $("buyer").value, type: $("licenseType").value, days: Number($("days").value) });
        $("keyText").textContent = r.key; $("newKey").classList.remove("hide"); $("newMsg").style.display = "none"; $("buyer").value = ""; load();
    } catch (e) { msg("newMsg", e.message); }
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
