// Backup otomatis data.json ke Discord (webhook). Isi data.json sudah terenkripsi dengan MASTER_KEY,
// tapi tetap pakai channel privat. MASTER_KEY sendiri TIDAK pernah dikirim.
const fs = require("fs");

function createBackup({ file, url }) {
    let last = { at: 0, ok: null, error: "" };
    const enabled = () => /^https:\/\/((ptb|canary)\.)?(discord|discordapp)\.com\/api\/webhooks\//.test(url || "");

    async function send(reason = "manual") {
        if (!enabled()) throw new Error("BACKUP_WEBHOOK_URL belum diisi atau bukan URL webhook Discord.");
        if (!fs.existsSync(file)) throw new Error("data.json belum ada.");
        const buf = fs.readFileSync(file);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const form = new FormData();
        form.append("content", `Backup data.json (${reason}) - ${new Date().toISOString()}`);
        form.append("files[0]", new Blob([buf], { type: "application/json" }), `data-${stamp}.json`);
        try {
            const r = await fetch(url, { method: "POST", body: form });
            if (!r.ok) throw new Error(`Discord menolak (HTTP ${r.status})`);
            last = { at: Date.now(), ok: true, error: "" };
        } catch (e) {
            last = { at: Date.now(), ok: false, error: e.message };
            throw e;
        }
    }

    // Kirim berkala (default tiap 12 jam). Kalau kiriman berhenti masuk ke Discord, berarti server bermasalah.
    function schedule(hours) {
        const ms = Math.max(1, Number(hours) || 12) * 3600000;
        setInterval(() => send("terjadwal").catch((e) => console.error("[BACKUP]", e.message)), ms).unref();
    }

    return { enabled, send, schedule, status: () => ({ enabled: enabled(), ...last }) };
}

module.exports = { createBackup };
