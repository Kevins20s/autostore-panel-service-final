"use strict";

const crypto = require("node:crypto");
const MAX_BYTES = 4 * 1024 * 1024;

class PreorderError extends Error {}

function quantity(value) {
    const text = String(value ?? "").trim();
    const number = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < 1 || number > 10000) {
        throw new PreorderError("Jumlah harus angka bulat antara 1 dan 10.000.");
    }
    return number;
}

function stockLines(text) {
    if (Buffer.byteLength(text, "utf8") > 1024 * 1024) throw new PreorderError("Maksimal 1 MB stok per setoran.");
    const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) throw new PreorderError("Stok kosong. Isi satu stok per baris.");
    if (lines.length > 10000 || lines.some(line => line.length > 4000 || line.includes("\0"))) {
        throw new PreorderError("Maksimal 10.000 baris, setiap baris maksimal 4.000 karakter.");
    }
    return lines;
}

function progress(order) {
    if (order.status === "closed") return order.collectedQty === order.quantity ? "Selesai" : "Dibatalkan";
    if (order.collectedQty === order.quantity) return "Selesai";
    if (!order.paidAt) return "Menunggu konfirmasi pembayaran";
    if (order.depositedQty === order.quantity) return "Siap semua";
    return order.depositedQty > order.collectedQty ? "Siap sebagian" : "Menunggu stok";
}

function createPreorders({ Order = require("../Schema/preorder").Order } = {}) {
    const filter = (guildId, id) => {
        if (!/^[a-f\d]{24}$/i.test(String(id))) throw new PreorderError("Preorder tidak ditemukan.");
        return { guildId, _id: id };
    };
    async function get(guildId, id) {
        const order = await Order.findOne(filter(guildId, id)).lean();
        if (!order) throw new PreorderError("Preorder tidak ditemukan di server ini.");
        return order;
    }
    async function byCode(guildId, code) {
        const order = await Order.findOne({ guildId, code: String(code || "").trim().toUpperCase() }).lean();
        if (!order) throw new PreorderError("Kode preorder tidak ditemukan di server ini.");
        return order;
    }
    async function create({ guildId, buyerId, requestId, productName, amount }) {
        const name = String(productName || "").trim();
        if (name.length < 2 || name.length > 100) throw new PreorderError("Nama produk harus 2–100 karakter.");
        const requested = quantity(amount);
        await Order.init();
        const existing = await Order.findOne({ guildId, requestId }).lean();
        if (existing) return existing;
        if (await Order.countDocuments({ guildId, buyerId, status: "open", $expr: { $lt: ["$collectedQty", "$quantity"] } }) >= 5) {
            throw new PreorderError("Kamu masih punya 5 preorder aktif. Selesaikan salah satunya dahulu.");
        }
        try {
            return (await Order.create({ guildId, buyerId, requestId, productName: name, quantity: requested,
                code: "PO-" + crypto.randomBytes(5).toString("hex").toUpperCase() })).toObject();
        } catch (error) {
            if (error.code === 11000) {
                const previous = await Order.findOne({ guildId, requestId }).lean();
                if (previous) return previous;
            }
            throw error;
        }
    }
    async function deposit(guildId, id, requestId, text) {
        const lines = stockLines(text);
        const bytes = Buffer.byteLength(lines.join("\n"), "utf8");
        const order = await Order.findOneAndUpdate({
            ...filter(guildId, id), status: "open", depositRequests: { $ne: requestId },
            $expr: { $and: [
                { $lte: [{ $add: ["$depositedQty", lines.length] }, "$quantity"] },
                { $lte: [{ $add: ["$dataBytes", bytes] }, MAX_BYTES] },
            ] },
        }, { $push: { items: { $each: lines }, depositRequests: requestId },
            $inc: { depositedQty: lines.length, dataBytes: bytes, revision: 1 }, $set: { updatedAt: new Date(), summaryDirty: true } }, { new: true }).lean();
        if (order) return order;
        const current = await get(guildId, id);
        if (current.depositRequests.includes(requestId)) return current;
        throw new PreorderError(`Setoran ditolak. Sisa kebutuhan ${current.quantity - current.depositedQty} stok. Periksa jumlah, status tiket, dan batas total data 4 MB.`);
    }
    async function markPaid(guildId, id, staffId) {
        const order = await Order.findOneAndUpdate({ ...filter(guildId, id), status: "open", paidAt: null },
            { $set: { paidAt: new Date(), paidBy: staffId, updatedAt: new Date(), summaryDirty: true }, $inc: { revision: 1 } }, { new: true }).lean();
        const current = order || await get(guildId, id);
        if (!current.paidAt) throw new PreorderError("Preorder sudah ditutup.");
        return current;
    }
    async function collect(guildId, id, buyerId, requestId, amount) {
        const count = quantity(amount);
        const scope = { ...filter(guildId, id), buyerId };
        const order = await Order.findOneAndUpdate({ ...scope, status: "open", paidAt: { $ne: null },
            "claims.requestId": { $ne: requestId }, $expr: { $lte: [{ $add: ["$collectedQty", count] }, "$depositedQty"] },
        }, [{ $set: {
            claims: { $concatArrays: ["$claims", [{ requestId: { $literal: requestId }, start: "$collectedQty", quantity: count, createdAt: "$$NOW" }]] },
            collectedQty: { $add: ["$collectedQty", count] }, revision: { $add: ["$revision", 1] }, updatedAt: "$$NOW", summaryDirty: true,
        } }], { new: true }).lean();
        const current = order || await Order.findOne(scope).lean();
        if (!current) throw new PreorderError("Preorder ini bukan milikmu atau berasal dari server lain.");
        const claim = current.claims.find(item => item.requestId === requestId);
        if (!claim) throw new PreorderError("Pengambilan ditolak. Pastikan pembayaran dikonfirmasi dan jumlah tidak melebihi stok siap. Cek status terbaru.");
        return { order: current, claim, lines: current.items.slice(claim.start, claim.start + claim.quantity) };
    }
    async function close(guildId, id, staffId) {
        const order = await Order.findOneAndUpdate({ ...filter(guildId, id), status: "open", $or: [
            { $expr: { $eq: ["$collectedQty", "$quantity"] } }, { paidAt: null, depositedQty: 0 },
        ] }, { $set: { status: "closed", closedAt: new Date(), closedBy: staffId, updatedAt: new Date(), summaryDirty: true }, $inc: { revision: 1 } }, { new: true }).lean();
        const current = order || await get(guildId, id);
        if (current.status !== "closed") throw new PreorderError("Preorder masih punya kewajiban atau stok. Selesaikan pengambilan sebelum menutup tiket.");
        return current;
    }
    return { get, byCode, create, deposit, markPaid, collect, close, Order };
}

module.exports = { createPreorders, PreorderError, stockLines, quantity, progress };
