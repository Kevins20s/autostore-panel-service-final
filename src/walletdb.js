// Koneksi ke database WALLET (uang). Sengaja terpisah dari data.json dan dari MongoDB milik pembeli.
// Taruh di MongoDB Atlas milikmu sendiri supaya aman walau akun/server Railway diganti.
// Isi WALLET_MONGO_URL di env. Kalau kosong, fitur wallet nonaktif (panel tetap jalan normal).
"use strict";
const { MongoClient } = require("mongodb");

class WalletError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

function createWalletDb({ url = process.env.WALLET_MONGO_URL, dbName = process.env.WALLET_DB_NAME || "autostore_wallet" } = {}) {
    const enabled = !!url;
    let client = null, pending = null;

    async function ensureIndexes(db) {
        await Promise.all([
            // key = kunci idempotensi: satu kejadian uang hanya boleh tercatat satu kali
            db.collection("ledger").createIndex({ key: 1 }, { unique: true }),
            db.collection("ledger").createIndex({ licenseId: 1, createdAt: -1 }),
            db.collection("ledger").createIndex({ type: 1, released: 1, releaseAt: 1 }),
            db.collection("deposits").createIndex({ orderId: 1 }, { unique: true }),
            db.collection("deposits").createIndex({ licenseId: 1, createdAt: -1 }),
            db.collection("deposits").createIndex({ status: 1, expiresAt: 1 }),
            db.collection("withdrawals").createIndex({ id: 1 }, { unique: true }),
            db.collection("withdrawals").createIndex({ licenseId: 1, createdAt: -1 }),
            db.collection("withdrawals").createIndex({ status: 1, createdAt: 1 }),
        ]);
    }

    // Mengembalikan koleksi. Koneksi dibuat sekali, dan diulang otomatis kalau sempat gagal.
    async function getCols() {
        if (!enabled) throw new WalletError("Fitur pembayaran otomatis belum diaktifkan oleh penjual.", 503);
        if (!pending) {
            pending = (async () => {
                client = new MongoClient(url, { serverSelectionTimeoutMS: 8000, maxPoolSize: 10 });
                await client.connect();
                const db = client.db(dbName);
                await ensureIndexes(db);
                return {
                    wallets: db.collection("wallets"),
                    deposits: db.collection("deposits"),
                    ledger: db.collection("ledger"),
                    withdrawals: db.collection("withdrawals"),
                };
            })().catch((e) => {
                pending = null;
                if (client) client.close().catch(() => {});
                console.error("[WALLET] Gagal konek database wallet:", e.message);
                throw new WalletError("Database wallet sedang tidak bisa dihubungi. Coba lagi sebentar lagi.", 503);
            });
        }
        return pending;
    }

    const close = async () => { if (client) await client.close().catch(() => {}); client = null; pending = null; };
    return { enabled, getCols, close };
}

module.exports = { createWalletDb, WalletError };
