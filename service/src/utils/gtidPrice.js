/**
 * Ambil harga live dari api.gtid.pro
 * Tingkatan currency Growtopia: 100 WL = 1 DL, 100 DL = 1 Bgl (Gold Lock)
 *
 * Response API:
 * { buy, sell, buyBgl, sellBgl, spread: { dl, bgl }, posts24h, sources, updatedAt }
 * "buy"/"sell" = harga per 1 DL dalam Rupiah
 * "buyBgl"/"sellBgl" = harga per 1 Bgl (100 DL) dalam Rupiah
 */

const GTID_PRICE_URL = "https://api.gtid.pro/price";
const FETCH_TIMEOUT_MS = 8 * 1000; // batas waktu tunggu response gtid.pro

/**
 * Ambil harga 1 WL sekarang dalam Rupiah, berdasarkan harga "buy" per DL dari API
 * @returns {Promise<{ pricePerWL: Number, pricePerDL: Number, raw: Object }>}
 */
async function getLiveWLPrice() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res;
    try {
        res = await fetch(GTID_PRICE_URL, { signal: controller.signal });
    } catch (err) {
        if (err.name === "AbortError") {
            throw new Error(`gtid.pro tidak merespon dalam ${FETCH_TIMEOUT_MS / 1000} detik (timeout)`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        throw new Error(`Gagal mengambil harga dari gtid.pro (status ${res.status})`);
    }

    const data = await res.json();

    if (typeof data.buy !== "number") {
        throw new Error("Format response gtid.pro tidak sesuai (field 'buy' tidak ditemukan)");
    }

    const pricePerDL = data.buy;
    const pricePerWL = pricePerDL / 100; // 100 WL = 1 DL

    return { pricePerWL, pricePerDL, raw: data };
}

/**
 * Ambil harga 1 WL yang seharusnya dipakai saat ini, dengan menghormati
 * status API gtid.pro (bisa dimatikan lewat command /setapi).
 *
 * Alur:
 * 1. Kalau API di-set MATI oleh admin -> langsung pakai harga manual (/setwlprice), tidak fetch ke gtid.pro sama sekali.
 * 2. Kalau API NYALA -> coba fetch live ke gtid.pro, kalau gagal/timeout -> fallback ke harga manual.
 *
 * @returns {Promise<{ pricePerWL: Number|null, pricePerDL: Number|null, source: "live"|"manual"|"none" }>}
 */
async function getEffectiveWLPrice() {
    const ApiSetting = require("../Schema/apiSetting.js");
    const WLRate = require("../Schema/wlrate.js");

    const setting = await ApiSetting.findOne({}).catch(() => null);
    const useLiveApi = setting?.useLiveApi ?? true; // default: nyala kalau belum pernah di-set

    if (useLiveApi) {
        try {
            const live = await getLiveWLPrice();
            return { pricePerWL: live.pricePerWL, pricePerDL: live.pricePerDL, source: "live" };
        } catch (err) {
            console.error("Gagal ambil harga live gtid.pro, fallback ke harga manual:", err.message);
        }
    }

    const manualRate = await WLRate.findOne({}).catch(() => null);
    const pricePerWL = manualRate?.pricePerWL || null;

    if (!pricePerWL) {
        return { pricePerWL: null, pricePerDL: null, source: "none" };
    }

    return { pricePerWL, pricePerDL: pricePerWL * 100, source: "manual" };
}

module.exports = { getLiveWLPrice, getEffectiveWLPrice };
