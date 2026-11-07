// Wallet merchant: uang dari QRIS otomatis masuk ke saldo tiap pembeli (per licenseId), ditahan beberapa jam,
// lalu bisa ditarik lewat antrean yang kamu proses manual di /admin.html.
//
// Prinsip yang dijaga:
//  - LEDGER adalah sumber kebenaran. Angka saldo di dokumen "wallets" hanyalah ringkasan yang bisa dihitung ulang (reconcile).
//  - Setiap kejadian uang punya kunci unik (ledger.key). Webhook ganda / retry tidak bisa menambah saldo dua kali.
//  - Saldo hanya berkurang lewat update atomik bersyarat (available >= jumlah), jadi dua permintaan serentak tidak bisa lolos.
//  - Semua nominal adalah bilangan bulat rupiah.
"use strict";
const crypto = require("crypto");
const { WalletError } = require("./walletdb");

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const rp = (n) => "Rp" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const isDup = (e) => e && (e.code === 11000 || /E11000|duplicate key/i.test(String(e.message)));
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function createWallet(opts) {
    const {
        getCols, autoko, notify = async () => {}, forwardToBot = async () => false, creditHosted = async () => false, isFrozen = () => false, now = Date.now,
        holdMs = 3 * 3600e3, feePercent = 0, feeFlat = 0,
        minDeposit = 1000, maxDeposit = 5_000_000, depositTtlMs = 15 * 60e3,
        minWithdraw = 10000, withdrawFee = 0, bankCooldownMs = 24 * 3600e3,
        maxOpenDeposits = 10, maxOpenPerUser = 3, maxBotAttempts = 30, publicUrl = "",
    } = opts;

    const adminUrl = publicUrl ? publicUrl.replace(/\/+$/, "") + "/admin.html" : "";
    const tell = (title, lines) => Promise.resolve(notify({ title, text: [title, ...lines, adminUrl].filter(Boolean).join("\n"), url: adminUrl })).catch(() => {});
    const newOrderId = () => "DP-" + Array.from(crypto.randomBytes(10), (b) => ALPHA[b % ALPHA.length]).join("");

    async function ensure(c, id) {
        await c.wallets.updateOne({ _id: id }, { $setOnInsert: { available: 0, pending: 0, locked: 0, openWithdrawal: null, bank: null, bankChangedAt: null, createdAt: now() } }, { upsert: true });
    }
    const feeOf = (amount) => Math.min(amount, Math.round(amount * feePercent / 100) + feeFlat);
    const needInt = (v, label) => {
        const n = Number(v);
        if (!Number.isSafeInteger(n) || n <= 0) throw new WalletError(`${label} tidak valid.`);
        return n;
    };

    // ---------------------------------------------------------------- Deposit
    async function createDeposit({ licenseId, amount, discordId = "", hostedWL, hostedTenantId }) {
        if (!autoko.enabled) throw new WalletError("Pembayaran otomatis belum aktif.", 503);
        if (isFrozen(licenseId)) throw new WalletError("Pembayaran otomatis toko ini sedang dibekukan penjual.", 403);
        const amt = needInt(amount, "Nominal");
        if (amt < minDeposit) throw new WalletError(`Nominal minimal ${rp(minDeposit)}.`);
        if (amt > maxDeposit) throw new WalletError(`Nominal maksimal ${rp(maxDeposit)}.`);
        const c = await getCols();
        const t = now(), live = { status: "pending", expiresAt: { $gt: t } };
        if ((await c.deposits.countDocuments({ licenseId, ...live })) >= maxOpenDeposits) throw new WalletError("Terlalu banyak QRIS yang belum dibayar. Tunggu sebentar lalu coba lagi.", 429);
        const did = clean(discordId, 25);
        if (hostedWL !== undefined && (!Number.isSafeInteger(hostedWL) || hostedWL < 1 || !/^\d{17,20}$/.test(did))) {
            throw new WalletError("Nominal saldo atau akun Discord tidak valid.");
        }
        if (did && (await c.deposits.countDocuments({ licenseId, discordId: did, ...live })) >= maxOpenPerUser) throw new WalletError("Kamu masih punya beberapa QRIS yang belum dibayar. Bayar atau tunggu kedaluwarsa dulu.", 429);

        const fee = feeOf(amt);
        const dep = { orderId: newOrderId(), licenseId, discordId: did, amount: amt, fee, net: amt - fee, status: "pending", createdAt: t, expiresAt: t + depositTtlMs, botDeliveredAt: null, botAttempts: 0 };
        if (hostedWL !== undefined) dep.hostedWL = hostedWL;
        if (hostedTenantId) dep.hostedTenantId = hostedTenantId;
        await c.deposits.insertOne(dep);
        try {
            const q = await autoko.createQris({ orderId: dep.orderId, amount: amt, expiresAt: dep.expiresAt });
            await c.deposits.updateOne({ orderId: dep.orderId }, { $set: { providerRef: q.providerRef || null } });
            return { orderId: dep.orderId, amount: amt, expiresAt: dep.expiresAt, qrString: q.qrString || null, qrImageUrl: q.qrImageUrl || null };
        } catch (e) {
            await c.deposits.updateOne({ orderId: dep.orderId }, { $set: { status: "failed", error: String(e.message).slice(0, 200) } });
            throw e instanceof WalletError ? e : new WalletError(e.status === 503 ? e.message : "Gagal membuat QRIS. Coba lagi sebentar lagi.", e.status === 503 ? 503 : 502);
        }
    }

    async function deliver(c, dep) {
        let ok = false;
        try {
            ok = dep.hostedWL === undefined
                ? await forwardToBot(dep.licenseId, { status: "completed", externalId: dep.orderId, amount: dep.amount })
                : await creditHosted(dep);
        } catch { ok = false; }
        if (ok) { await c.deposits.updateOne({ orderId: dep.orderId }, { $set: { botDeliveredAt: now() } }); return true; }
        const upd = await c.deposits.findOneAndUpdate({ orderId: dep.orderId }, { $inc: { botAttempts: 1 } }, { returnDocument: "after" });
        if (upd && upd.botAttempts === maxBotAttempts)
            await tell("⚠️ Deposit sudah dibayar tapi belum masuk ke bot pembeli", [`Order: ${dep.orderId}`, `Nominal: ${rp(dep.amount)}`,
                dep.hostedWL === undefined ? "Admin toko pembeli bisa menekan tombol Success di log donasi Discord sebagai jalan keluar." : "Cek koneksi database toko GevraStore dan transaksi deposit."]);
        return false;
    }

    // Dipanggil dari webhook Autoko ATAU dari pengecekan status berkala. Aman dipanggil berulang untuk order yang sama.
    async function handlePaid({ orderId, amount = null, providerRef = null }, { background = false } = {}) {
        const c = await getCols();
        const dep = await c.deposits.findOne({ orderId });
        if (!dep) return { ok: false, reason: "unknown_order" };
        if (amount != null && Number(amount) !== dep.amount) {
            const updated = await c.deposits.updateOne({ orderId, status: { $ne: "paid" } },
                { $set: { status: "mismatch", mismatchAmount: Number(amount) } });
            if (updated.matchedCount) await tell("⚠️ Nominal pembayaran tidak cocok", [`Order: ${orderId}`, `Seharusnya: ${rp(dep.amount)}`, `Diterima: ${rp(Number(amount))}`, "Tidak dikreditkan. Cek manual di Autoko."]);
            return { ok: false, reason: "amount_mismatch" };
        }
        if (dep.status === "mismatch") return { ok: false, reason: "needs_review" };

        // Gerbang idempotensi: hanya satu pemanggil yang berhasil menulis entri ledger ini.
        const hold = holdMs > 0;
        let first = true;
        try {
            await c.ledger.insertOne({ key: "dep:" + orderId, licenseId: dep.licenseId, type: "credit", orderId, amount: dep.amount, fee: dep.fee, net: dep.net, released: !hold, releaseAt: now() + holdMs, createdAt: now() });
        } catch (e) { if (isDup(e)) first = false; else throw e; }

        await c.deposits.updateOne({ orderId }, { $set: { status: "paid", paidAt: dep.paidAt || now(), ...(providerRef ? { providerRef } : {}) } });
        if (first) {
            await ensure(c, dep.licenseId);
            await c.wallets.updateOne({ _id: dep.licenseId }, { $inc: hold ? { pending: dep.net } : { available: dep.net } });
        }
        if (!dep.botDeliveredAt) {
            const p = deliver(c, { ...dep });
            if (background) p.catch((e) => console.error("[WALLET] kirim ke bot gagal:", e.message)); else await p;
        }
        return { ok: true, duplicate: !first };
    }

    // ---------------------------------------------------------------- Ringkasan & riwayat (untuk buyer)
    async function summary(licenseId, { mode = "manual", frozen = false } = {}) {
        const c = await getCols();
        const w = (await c.wallets.findOne({ _id: licenseId })) || { available: 0, pending: 0, locked: 0, bank: null, bankChangedAt: null, openWithdrawal: null };
        const [totalTx, paidTx] = await Promise.all([c.deposits.countDocuments({ licenseId, status: { $ne: "failed" } }), c.deposits.countDocuments({ licenseId, status: "paid" })]);
        return {
            available: w.available, pending: w.pending, locked: w.locked, total: w.available + w.pending,
            totalTx, paidTx, holdHours: holdMs / 3600e3, minWithdraw, withdrawFee,
            bank: bankView(w.bank), openWithdrawal: !!w.openWithdrawal, mode, frozen, autoReady: autoko.enabled, mock: autoko.mode === "mock",
        };
    }

    async function listDeposits(licenseId, { limit = 50 } = {}) {
        const c = await getCols();
        const rows = await c.deposits.find({ licenseId, status: { $ne: "failed" } }).sort({ createdAt: -1 }).limit(Math.min(200, Math.max(1, limit))).toArray();
        return rows.map((d) => ({ orderId: d.orderId, discordId: d.discordId, amount: d.amount, fee: d.fee, net: d.net, status: d.status, createdAt: d.createdAt, paidAt: d.paidAt || null, expiresAt: d.expiresAt, delivered: !!d.botDeliveredAt }));
    }

    async function hostedDepositStatus(licenseId, hostedTenantId, orderId) {
        const c = await getCols();
        const dep = await c.deposits.findOne({ licenseId, hostedTenantId, orderId });
        if (!dep) throw new WalletError("Pesanan deposit tidak ditemukan.", 404);
        return { status: dep.status, credited: !!dep.botDeliveredAt, amount: dep.amount, wl: dep.hostedWL };
    }

    async function cancelHostedDeposit(licenseId, hostedTenantId, orderId) {
        const c = await getCols();
        const query = { licenseId, hostedTenantId, orderId };
        const dep = await c.deposits.findOne(query);
        if (!dep) throw new WalletError("Pesanan deposit tidak ditemukan.", 404);
        if (dep.status === "paid" || dep.botDeliveredAt) throw new WalletError("Pembayaran sudah diterima.", 409);
        const updated = await c.deposits.updateOne({ ...query, status: { $in: ["pending", "expired"] } },
            { $set: { status: "cancelled", cancelledAt: now() } });
        if (!updated.matchedCount && dep.status !== "cancelled") throw new WalletError("Status pembayaran sudah berubah.", 409);
        return { cancelled: true };
    }

    // ---------------------------------------------------------------- Rekening & penarikan
    const bankView = (b) => b && { bankName: b.bankName, accountName: b.accountName, accountNoMasked: "••••" + String(b.accountNo).slice(-4) };

    async function setBank(licenseId, { bankName, accountNo, accountName }) {
        const bn = clean(bankName, 30), an = String(accountNo ?? "").replace(/\s|-/g, ""), nm = clean(accountName, 60);
        if (bn.length < 2) throw new WalletError("Nama bank / e-wallet minimal 2 huruf (contoh: BCA, DANA).");
        if (!/^\d{5,24}$/.test(an)) throw new WalletError("Nomor rekening hanya angka, 5 sampai 24 digit.");
        if (nm.length < 2) throw new WalletError("Nama pemilik rekening wajib diisi.");
        const c = await getCols(); await ensure(c, licenseId);
        const w = await c.wallets.findOne({ _id: licenseId });
        const changed = !!w.bank && (w.bank.accountNo !== an || w.bank.bankName !== bn);
        await c.wallets.updateOne({ _id: licenseId }, { $set: { bank: { bankName: bn, accountNo: an, accountName: nm }, ...(changed ? { bankChangedAt: now() } : {}) } });
        return bankView({ bankName: bn, accountNo: an, accountName: nm });
    }

    async function requestWithdrawal({ licenseId, buyer = "", amount }) {
        if (isFrozen(licenseId)) throw new WalletError("Penarikan dibekukan penjual. Hubungi penjual.", 403);
        const amt = needInt(amount, "Nominal");
        if (amt < minWithdraw) throw new WalletError(`Penarikan minimal ${rp(minWithdraw)}.`);
        const c = await getCols(); await ensure(c, licenseId);
        const w0 = await c.wallets.findOne({ _id: licenseId });
        if (!w0.bank) throw new WalletError("Isi rekening tujuan dulu di menu Rekening.");
        if (w0.bankChangedAt && now() - w0.bankChangedAt < bankCooldownMs) throw new WalletError(`Rekening baru diganti. Penarikan bisa dilakukan setelah ${Math.ceil(bankCooldownMs / 3600e3)} jam demi keamanan.`, 403);
        if (amt <= withdrawFee) throw new WalletError(`Nominal harus lebih besar dari biaya penarikan ${rp(withdrawFee)}.`);

        const id = crypto.randomBytes(8).toString("hex");
        // Satu langkah atomik: saldo cukup DAN tidak ada penarikan lain yang sedang diproses.
        const locked = await c.wallets.findOneAndUpdate(
            { _id: licenseId, available: { $gte: amt }, openWithdrawal: null },
            { $inc: { available: -amt, locked: amt }, $set: { openWithdrawal: id } }, { returnDocument: "after" });
        if (!locked) {
            const w = await c.wallets.findOne({ _id: licenseId });
            throw new WalletError(w.openWithdrawal ? "Masih ada penarikan yang sedang diproses. Tunggu selesai dulu." : "Saldo tersedia tidak cukup.", 409);
        }
        const wd = { id, licenseId, buyer: clean(buyer, 60), amount: amt, fee: withdrawFee, payout: amt - withdrawFee, bank: { ...w0.bank }, status: "pending", createdAt: now() };
        try {
            await c.withdrawals.insertOne(wd);
            await c.ledger.insertOne({ key: `wd:${id}:req`, licenseId, type: "withdraw_request", amount: amt, createdAt: now() });
        } catch (e) {
            await c.wallets.updateOne({ _id: licenseId }, { $inc: { available: amt, locked: -amt }, $set: { openWithdrawal: null } });
            await c.withdrawals.deleteMany({ id }); await c.ledger.deleteMany({ key: `wd:${id}:req` });
            throw e;
        }
        await tell("💸 Permintaan penarikan saldo", [`Pembeli: ${wd.buyer}`, `Nominal: ${rp(amt)} (dikirim ${rp(wd.payout)})`, `Ke: ${wd.bank.bankName} ${wd.bank.accountNo} a.n. ${wd.bank.accountName}`]);
        return withdrawalView(wd);
    }

    const withdrawalView = (w) => ({ id: w.id, amount: w.amount, fee: w.fee, payout: w.payout, status: w.status, createdAt: w.createdAt, paidAt: w.paidAt || null, reference: w.reference || null, reason: w.reason || null, bank: bankView(w.bank) });
    async function listWithdrawals(licenseId, { limit = 30 } = {}) {
        const c = await getCols();
        return (await c.withdrawals.find({ licenseId }).sort({ createdAt: -1 }).limit(limit).toArray()).map(withdrawalView);
    }

    // ---------------------------------------------------------------- Admin (kamu)
    async function adminWithdrawals({ status = "pending", limit = 100 } = {}) {
        const c = await getCols();
        const q = status === "all" ? {} : { status };
        const rows = await c.withdrawals.find(q).sort({ createdAt: status === "pending" ? 1 : -1 }).limit(limit).toArray();
        return rows.map((w) => ({ ...withdrawalView(w), buyer: w.buyer, licenseId: w.licenseId, bankFull: w.bank }));
    }

    async function adminComplete(id, { reference = "" } = {}) {
        const c = await getCols();
        const w = await c.withdrawals.findOneAndUpdate({ id: String(id), status: "pending" }, { $set: { status: "paid", paidAt: now(), reference: clean(reference, 80) } }, { returnDocument: "after" });
        if (!w) throw new WalletError("Penarikan tidak ditemukan atau sudah diproses.", 409);
        await c.ledger.insertOne({ key: `wd:${w.id}:done`, licenseId: w.licenseId, type: "withdraw_paid", amount: w.amount, createdAt: now() }).catch((e) => { if (!isDup(e)) throw e; });
        await c.wallets.updateOne({ _id: w.licenseId }, { $inc: { locked: -w.amount }, $set: { openWithdrawal: null } });
        return withdrawalView(w);
    }

    async function adminReject(id, { reason = "" } = {}) {
        const c = await getCols();
        const w = await c.withdrawals.findOneAndUpdate({ id: String(id), status: "pending" }, { $set: { status: "rejected", paidAt: now(), reason: clean(reason, 120) } }, { returnDocument: "after" });
        if (!w) throw new WalletError("Penarikan tidak ditemukan atau sudah diproses.", 409);
        let first = true;
        try { await c.ledger.insertOne({ key: `wd:${w.id}:refund`, licenseId: w.licenseId, type: "withdraw_refund", amount: w.amount, createdAt: now() }); } catch (e) { if (isDup(e)) first = false; else throw e; }
        if (first) await c.wallets.updateOne({ _id: w.licenseId }, { $inc: { locked: -w.amount, available: w.amount }, $set: { openWithdrawal: null } });
        return withdrawalView(w);
    }

    async function adminOverview() {
        const c = await getCols();
        const ws = await c.wallets.find({}).toArray();
        const sum = (k) => ws.reduce((a, w) => a + (w[k] || 0), 0);
        return { wallets: ws.length, available: sum("available"), pending: sum("pending"), locked: sum("locked"), owed: sum("available") + sum("pending") + sum("locked"), openWithdrawals: await c.withdrawals.countDocuments({ status: "pending" }), autoko: autoko.mode, autokoReady: autoko.enabled };
    }

    async function balanceOf(licenseId) {
        const c = await getCols();
        const w = await c.wallets.findOne({ _id: licenseId });
        return w ? w.available + w.pending + w.locked : 0;
    }

    // ---------------------------------------------------------------- Pekerjaan berkala
    async function sweep() {
        const c = await getCols(), t = now(), out = { released: 0, expired: 0, retried: 0, checked: 0 };

        // 1. Lepas saldo tertunda yang masa tahannya sudah lewat
        const due = await c.ledger.find({ type: "credit", released: false, releaseAt: { $lte: t } }).limit(200).toArray();
        for (const e of due) {
            const got = await c.ledger.findOneAndUpdate({ key: e.key, released: false }, { $set: { released: true, releasedAt: t } }, { returnDocument: "after" });
            if (!got) continue;
            await c.wallets.updateOne({ _id: e.licenseId }, { $inc: { pending: -e.net, available: e.net } });
            out.released++;
        }
        // 2. Tandai QRIS yang kedaluwarsa
        const exp = await c.deposits.updateMany({ status: "pending", expiresAt: { $lte: t } }, { $set: { status: "expired" } });
        out.expired = exp.modifiedCount || 0;
        // 3. Coba kirim ulang ke bot untuk deposit yang sudah dibayar tapi belum sampai
        const undelivered = await c.deposits.find({ status: "paid", botDeliveredAt: null, botAttempts: { $lt: maxBotAttempts } }).limit(50).toArray();
        for (const d of undelivered) { if (await deliver(c, d)) out.retried++; }
        // 4. Tanya Autoko soal order yang belum jelas (menangkap webhook yang terlewat), termasuk pembayaran telat
        if (autoko.enabled) {
            const maybe = await c.deposits.find({ status: { $in: ["pending", "expired"] }, createdAt: { $gte: t - 2 * 3600e3, $lte: t - 20e3 } }).limit(20).toArray();
            for (const d of maybe) {
                try {
                    out.checked++;
                    const s = await autoko.getStatus(d.orderId);
                    if (s && s.paid) await handlePaid({ orderId: d.orderId });
                } catch (e) { if (e.status === 501) break; console.error("[WALLET] cek status gagal:", e.message); }
            }
        }
        return out;
    }

    // Menghitung ulang saldo dari ledger. fix=true menulis hasilnya; fix=false hanya melaporkan selisih.
    async function reconcile(licenseId = null, { fix = false } = {}) {
        const c = await getCols();
        const ws = licenseId ? [await c.wallets.findOne({ _id: licenseId })].filter(Boolean) : await c.wallets.find({}).toArray();
        const diffs = [];
        for (const w of ws) {
            let available = 0, pending = 0;
            for (const e of await c.ledger.find({ licenseId: w._id }).toArray()) {
                if (e.type === "credit") { if (e.released) available += e.net; else pending += e.net; }
                else if (e.type === "withdraw_request") available -= e.amount;
                else if (e.type === "withdraw_refund") available += e.amount;
            }
            const open = await c.withdrawals.find({ licenseId: w._id, status: "pending" }).toArray();
            const locked = open.reduce((a, x) => a + x.amount, 0);
            if (available !== w.available || pending !== w.pending || locked !== w.locked) {
                diffs.push({ licenseId: w._id, before: { available: w.available, pending: w.pending, locked: w.locked }, after: { available, pending, locked } });
                if (fix) await c.wallets.updateOne({ _id: w._id }, { $set: { available, pending, locked, openWithdrawal: open[0] ? open[0].id : null } });
            }
        }
        return diffs;
    }

    return { createDeposit, handlePaid, summary, listDeposits, hostedDepositStatus, cancelHostedDeposit, setBank, requestWithdrawal, listWithdrawals, adminWithdrawals, adminComplete, adminReject, adminOverview, balanceOf, sweep, reconcile, config: { holdMs, minDeposit, minWithdraw, withdrawFee, feePercent, feeFlat } };
}

module.exports = { createWallet, WalletError, rp };
