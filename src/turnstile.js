// Verifikasi Cloudflare Turnstile (CAPTCHA gratis) untuk form pesanan di /beli.
// Aktif hanya kalau TURNSTILE_SITE_KEY dan TURNSTILE_SECRET diisi. Kalau kosong, form berjalan seperti biasa.
"use strict";

class TurnstileError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}

function createTurnstile(env = process.env, fetchFn = (...a) => fetch(...a)) {
    const siteKey = String(env.TURNSTILE_SITE_KEY || "");
    const secret = String(env.TURNSTILE_SECRET || "");
    const enabled = !!(siteKey && secret);

    async function verify(token, ip = "") {
        if (!enabled) return true;
        const t = String(token || "");
        if (!t || t.length > 2048) throw new TurnstileError("Selesaikan verifikasi keamanan dulu, lalu coba lagi.");
        const form = new URLSearchParams({ secret, response: t });
        if (ip) form.set("remoteip", String(ip));
        let r;
        try {
            r = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(8000) });
        } catch {
            throw new TurnstileError("Verifikasi keamanan sedang gangguan. Coba lagi sebentar lagi.", 503);
        }
        const j = await r.json().catch(() => ({}));
        if (!j.success) throw new TurnstileError("Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi.");
        return true;
    }

    return { enabled, siteKey: enabled ? siteKey : "", verify };
}

module.exports = { createTurnstile, TurnstileError };
