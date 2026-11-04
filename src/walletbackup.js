// Backup database WALLET (ledger uang) ke Discord, terpisah dari backup data.json.
// Isi: wallets, deposits, ledger, withdrawals dalam satu file JSON yang di-gzip.
// Catatan: isi ledger bukan rahasia pembayaran, tapi tetap kirim ke channel privat.
"use strict";
const zlib = require("zlib");

const MAX_BYTES = 8 * 1024 * 1024; // batas aman unggahan webhook Discord

async function exportWallet(getCols) {
    const c = await getCols();
    const [wallets, deposits, ledger, withdrawals] = await Promise.all([
        c.wallets.find({}).toArray(), c.deposits.find({}).toArray(), c.ledger.find({}).toArray(), c.withdrawals.find({}).toArray(),
    ]);
    const payload = { exportedAt: new Date().toISOString(), counts: { wallets: wallets.length, deposits: deposits.length, ledger: ledger.length, withdrawals: withdrawals.length }, wallets, deposits, ledger, withdrawals };
    return { gz: zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8")), counts: payload.counts };
}

function createWalletBackup({ getCols, sendFile, enabled }) {
    let last = { at: 0, ok: null, error: "", counts: null, bytes: 0 };
    async function send(reason = "manual") {
        if (!enabled()) throw new Error("BACKUP_WEBHOOK_URL belum diisi atau bukan URL webhook Discord.");
        try {
            const { gz, counts } = await exportWallet(getCols);
            if (gz.length > MAX_BYTES) throw new Error(`Backup wallet terlalu besar untuk Discord (${(gz.length / 1048576).toFixed(1)} MB). Pakai mongodump manual.`);
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            await sendFile(gz, `wallet-${stamp}.json.gz`, `Backup database wallet (${reason}) - ${new Date().toISOString()} - ledger ${counts.ledger}, deposit ${counts.deposits}, penarikan ${counts.withdrawals}`);
            last = { at: Date.now(), ok: true, error: "", counts, bytes: gz.length };
            return last;
        } catch (e) {
            last = { ...last, at: Date.now(), ok: false, error: e.message };
            throw e;
        }
    }
    function schedule(hours) {
        const ms = Math.max(1, Number(hours) || 12) * 3600000;
        setInterval(() => send("terjadwal").catch((e) => console.error("[WALLET-BACKUP]", e.message)), ms).unref();
    }
    return { send, schedule, status: () => ({ ...last }) };
}

module.exports = { createWalletBackup, exportWallet };
