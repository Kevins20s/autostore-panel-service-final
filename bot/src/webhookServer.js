const express = require("express");
const crypto = require("crypto");
const config = require("./config/config.json");
const Qris = require("./Schema/qris.js");
const { creditDeposit } = require("./utils/depositWatcher.js");
const { rupiahCredit } = require("./config/storefront");

function verifySignature(rawBody, signature, secrets = [config.PaymentWebhookSecret, config.PanelWebhookSecret]) {
    // Dua sumber yang sah: gateway milik pembeli sendiri (PaymentWebhookSecret) dan panel (PanelWebhookSecret, QRIS otomatis).
    if (!signature) return false;
    return secrets.filter(Boolean).some((secret) => {
        const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
        try {
            return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
        } catch {
            return false;
        }
    });
}

/**
 * Ambil ulang pesan DM dari channelId + messageId yang tersimpan di dokumen Qris.
 * Webhook jalan di luar konteks interaction Discord, jadi harus fetch manual.
 */
async function fetchDmMessage(client, trx) {
    if (!trx.dmChannelId || !trx.dmMessageId) return null;
    const channel = await client.channels.fetch(trx.dmChannelId).catch(() => null);
    if (!channel) return null;
    return channel.messages.fetch(trx.dmMessageId).catch(() => null);
}

function startWebhookServer(client) {
    const app = express();

    app.use(
        express.json({
            verify: (req, res, buf) => {
                req.rawBody = buf;
            },
        })
    );

    app.post("/webhook", async (req, res) => {
        const signature = req.headers["x-webhook-signature"];

        if (!verifySignature(req.rawBody, signature)) {
            console.warn("[WEBHOOK] Signature tidak valid, request ditolak.");
            return res.status(401).send("Invalid signature");
        }

        try {
            const { status, externalId, amount, creditCurrency } = req.body;
            if (status !== "completed" || !externalId) return res.sendStatus(200);

            const trx = await Qris.findOne({ orderId: externalId });
            if (!trx) {
                console.warn(`[WEBHOOK] Order ${externalId} tidak ditemukan di database.`);
                return res.sendStatus(creditCurrency === rupiahCredit ? 503 : 200);
            }
            if (creditCurrency === rupiahCredit && trx.creditCurrency !== rupiahCredit) return res.sendStatus(409);
            if (trx.creditCurrency === rupiahCredit) {
                if (trx.panelManaged || amount == null || Number(amount) !== trx.grossAmount) return res.sendStatus(409);
                if (trx.status === "credited") return res.sendStatus(200);
                const allowCancelled = trx.mode === "auto" &&
                    verifySignature(req.rawBody, signature, [config.PanelWebhookSecret]);
                const credited = await creditDeposit(trx, undefined, undefined, { allowCancelled, background: true });
                const complete = credited || await Qris.exists({ orderId: externalId, status: "credited" });
                return res.sendStatus(complete ? 200 : 503);
            }
            res.sendStatus(200);
            if (trx.status !== "pending") return; // sudah diproses lewat jalur lain (watcher/tombol manual)
            if (amount != null && Number(amount) !== trx.grossAmount) {
                console.warn(`[WEBHOOK] Nominal order ${externalId} tidak cocok (webhook ${amount}, tercatat ${trx.grossAmount}), diabaikan.`);
                return;
            }

            const message = await fetchDmMessage(client, trx);
            await creditDeposit(trx, message);
            console.log(`[WEBHOOK] Order ${externalId} berhasil dikredit lewat webhook.`);
        } catch (err) {
            console.error("[WEBHOOK] Error memproses notifikasi:", err);
            if (!res.headersSent) res.sendStatus(503);
        }
    });

    const port = process.env.PORT || 3000;
    return app.listen(port, () => {
        console.log(`[WEBHOOK] Server siap menerima notifikasi di port ${port}`.green);
    });
}

module.exports = { startWebhookServer };
