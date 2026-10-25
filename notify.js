// Notifikasi pesanan ke HP admin. Semua saluran opsional; aktif kalau variabelnya diisi.
//  Telegram : TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
//  ntfy     : NTFY_TOPIC (opsional NTFY_SERVER, bawaan https://ntfy.sh)
//  Discord  : ORDER_WEBHOOK_URL
"use strict";

async function send(url, body, headers = {}) {
    try {
        const isText = typeof body === "string";
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": isText ? "text/plain; charset=utf-8" : "application/json", ...headers }, body: isText ? body : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
        if (!r.ok) console.error(`[NOTIFY] saluran menolak (HTTP ${r.status})`);
        return r.ok;
    } catch (e) { console.error("[NOTIFY] gagal mengirim:", e.name === "TimeoutError" ? "waktu habis" : e.message); return false; }
}

function createNotifier(env = process.env) {
    const channels = [];
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)
        channels.push(["telegram", (m) => send(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: env.TELEGRAM_CHAT_ID, text: m.text, disable_web_page_preview: true })]);
    if (env.NTFY_TOPIC) {
        const base = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, "");
        channels.push(["ntfy", (m) => send(`${base}/${encodeURIComponent(env.NTFY_TOPIC)}`, m.text, { Title: "Pesanan baru - GevraStore", Priority: "high", Tags: "moneybag", ...(m.url ? { Click: m.url } : {}) })]);
    }
    if (/^https:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(env.ORDER_WEBHOOK_URL || ""))
        channels.push(["discord", (m) => send(env.ORDER_WEBHOOK_URL, { content: m.text.slice(0, 1900), allowed_mentions: { parse: [] } })]);
    const notify = async (msg) => { await Promise.allSettled(channels.map(([, fn]) => fn(msg))); };
    notify.channels = channels.map(([n]) => n);
    return notify;
}

module.exports = { createNotifier };
