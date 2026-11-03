// Memanggil panel untuk membuat QRIS otomatis (wallet). Kalau bot dijalankan tanpa panel, selalu "manual".
const config = require("../config/config.json");

class PanelError extends Error {}

/**
 * @returns {Promise<{mode:"manual"} | {mode:"auto", orderId:string, amount:number, expiresAt:number, qrPng:string|null, qrImageUrl:string|null}>}
 * Melempar PanelError (pesan aman ditampilkan ke user) kalau mode auto tapi gagal.
 */
async function requestAutoDeposit({ amount, discordId }) {
    if (!config.PanelInternalUrl || !config.PanelInternalToken || !config.PanelLicenseId) return { mode: "manual" };

    let res;
    try {
        res = await fetch(`${config.PanelInternalUrl}/internal/wallet/deposit`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-License-Id": config.PanelLicenseId,
                Authorization: `Bearer ${config.PanelInternalToken}`,
            },
            body: JSON.stringify({ amount, discordId }),
            signal: AbortSignal.timeout(40000),
        });
    } catch (err) {
        console.error("[PANEL] Gagal menghubungi panel:", err.message);
        throw new PanelError("Sistem pembayaran otomatis sedang tidak bisa dihubungi. Coba lagi sebentar lagi.");
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new PanelError(json.error || "Gagal membuat QRIS. Coba lagi sebentar lagi.");
    return json;
}

module.exports = { requestAutoDeposit, PanelError };
