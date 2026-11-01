const express = require("express");
const crypto = require("crypto");
const config = require("./config/config.json");
const Qris = require("./Schema/qris.js");
const { creditDeposit } = require("./utils/depositWatcher.js");

function verifySignature(rawBody, signature) {
    // Dua sumber yang sah: gateway milik pembeli sendiri (PaymentWebhookSecret) dan panel (PanelWebhookSecret, QRIS otomatis).
    const secrets = [config.PaymentWebhookSecret, config.PanelWebhookSecret].filter(Boolean);
    if (!signature || !secrets.length) return false;
    return secrets.some((secret) => {
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

        // Wajib balas 200 dalam < 10 detik, proses sisanya di background
        res.sendStatus(200);

        try {
            const { status, externalId, amount } = req.body;
            if (status !== "completed" || !externalId) return;

            const trx = await Qris.findOne({ orderId: externalId });
            if (!trx) {
                console.warn(`[WEBHOOK] Order ${externalId} tidak ditemukan di database.`);
                return;
            }
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
        }
    });

    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`[WEBHOOK] Server siap menerima notifikasi di port ${port}`.green);
    });
}

module.exports = { startWebhookServer };
