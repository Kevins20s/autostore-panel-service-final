// Tes logika wallet (deposit, hold, penarikan, rekonsiliasi) tanpa MongoDB sungguhan: node test/wallet.js
// Memakai koleksi tiruan (test/fakemongo.js). Mau diuji ke MongoDB asli? Isi WALLET_TEST_MONGO (database sementara dibuat dan dihapus).
process.env.MASTER_KEY = process.env.MASTER_KEY || "e".repeat(64);
const assert = require("assert");
const { createWallet, WalletError } = require("../src/wallet");
const { createAutoko } = require("../src/autoko");
const { createFakeCols } = require("./fakemongo");

const L = "lic1", L2 = "lic2";
let clock = 1_700_000_000_000; const now = () => clock;
const bad = async (p, re, status) => { try { await p; } catch (e) { assert(e instanceof WalletError, "harus WalletError: " + e.message); assert.match(e.message, re); if (status) assert.strictEqual(e.status, status); return; } assert.fail("seharusnya error " + re); };

async function setup(extra = {}) {
    let cols, close = async () => {};
    if (process.env.WALLET_TEST_MONGO) {
        const { MongoClient } = require("mongodb"); const client = await new MongoClient(process.env.WALLET_TEST_MONGO).connect(); const db = client.db("wallet_test_" + Date.now());
        await db.collection("ledger").createIndex({ key: 1 }, { unique: true }); await db.collection("deposits").createIndex({ orderId: 1 }, { unique: true }); await db.collection("withdrawals").createIndex({ id: 1 }, { unique: true });
        cols = { wallets: db.collection("wallets"), deposits: db.collection("deposits"), ledger: db.collection("ledger"), withdrawals: db.collection("withdrawals") };
        close = async () => { await db.dropDatabase(); await client.close(); };
    } else cols = createFakeCols();
    const sent = [], autoko = createAutoko({ AUTOKO_MODE: "mock" });
    const w = createWallet({ getCols: async () => cols, autoko, now, notify: async (m) => sent.push(m), holdMs: 3600e3, bankCooldownMs: 0, ...extra });
    return { w, cols, sent, autoko, close };
}
const bank = { bankName: "BCA", accountNo: "1234567890", accountName: "Budi Santoso" };

(async () => {
    // 1. deposit: dibuat, dibayar, ditahan, dirilis
    { const { w, cols, close } = await setup();
      const d = await w.createDeposit({ licenseId: L, amount: 50000 });
      assert.ok(d.orderId && /^DP-/.test(d.orderId), "orderId DP-");
      let s = await w.summary(L); assert.strictEqual(s.available, 0);
      const r1 = await w.handlePaid({ orderId: d.orderId, amount: 50000 });
      s = await w.summary(L); assert.strictEqual(s.pending, 50000, "uang masuk ditahan dulu"); assert.strictEqual(s.available, 0);
      await w.handlePaid({ orderId: d.orderId, amount: 50000 }); // webhook ganda
      s = await w.summary(L); assert.strictEqual(s.pending, 50000, "webhook ganda tidak boleh mengkredit dua kali");
      assert.strictEqual((await cols.ledger.find({ type: "credit" }).toArray()).length, 1);
      await w.sweep(); s = await w.summary(L); assert.strictEqual(s.available, 0, "belum lewat masa tahan");
      clock += 3601e3; await w.sweep(); s = await w.summary(L); assert.strictEqual(s.available, 50000); assert.strictEqual(s.pending, 0);
      assert.deepStrictEqual(await w.reconcile(null, { fix: false }), [], "saldo cocok dengan ledger");
      console.log("ok  deposit > bayar > ditahan > dirilis, webhook ganda aman"); await close(); }

    // 2. webhook paralel + nominal tak cocok + deposit tak dikenal
    { const { w, cols, close } = await setup();
      const d = await w.createDeposit({ licenseId: L, amount: 20000 });
      await Promise.all(Array.from({ length: 6 }, () => w.handlePaid({ orderId: d.orderId, amount: 20000 })));
      assert.strictEqual((await w.summary(L)).pending, 20000, "6 webhook bersamaan tetap hanya satu kredit");
      const d2 = await w.createDeposit({ licenseId: L, amount: 30000 });
      await w.handlePaid({ orderId: d2.orderId, amount: 29999 });
      assert.strictEqual((await cols.deposits.findOne({ orderId: d2.orderId })).status, "mismatch");
      assert.strictEqual((await w.summary(L)).pending, 20000, "nominal tidak cocok tidak mengkredit");
      await w.handlePaid({ orderId: "DP-TIDAKADA", amount: 1 }).catch(() => {});
      console.log("ok  webhook paralel, nominal tidak cocok, order tak dikenal"); await close(); }

    // Deposit bot GevraStore: pengguna dan nominal rupiah sama di dua lisensi.
    { const { createHostedCredit } = require("../src/shared-deposit");
      const { hostedDbName } = require("../src/shared-tenants");
      const discordId = "123456789012345678";
      const databases = new Map();
      const creditHosted = createHostedCredit({ mongoUrl: "mongodb://unused", openDb: async (_id, _url, name) => {
          if (!databases.has(name)) databases.set(name, { credits: new Map(), balance: 0 });
          const data = databases.get(name);
          return {
              client: { withSession: fn => fn({ withTransaction: fn => fn() }) },
              collection: key => key === "hostedcredits" ? {
                  findOne: async query => data.credits.get(query._id),
                  insertOne: async doc => data.credits.set(doc._id, doc),
              } : {
                  updateOne: async (query, update) => {
                      assert.strictEqual(query.DiscordID, discordId);
                      data.balance += update.$inc.Balance;
                      return { matchedCount: 1 };
                  },
              },
          };
      } });
      let legacyCalls = 0;
      const { w, close } = await setup({ creditHosted, forwardToBot: async () => { legacyCalls++; return true; } });
      const a = await w.createDeposit({ licenseId: L, amount: 20000, discordId, hostedWL: 100 });
      const b = await w.createDeposit({ licenseId: L2, amount: 20000, discordId, hostedWL: 150, hostedTenantId: "guild-b" });
      await w.handlePaid({ orderId: a.orderId, amount: 20000 });
      await w.handlePaid({ orderId: a.orderId, amount: 20000 });
      assert.strictEqual(databases.has(hostedDbName("autostore", "guild-b")), false);
      await w.handlePaid({ orderId: b.orderId, amount: 20000 });
      const status = await w.hostedDepositStatus(L2, "guild-b", b.orderId);
      assert.strictEqual(status.credited, true);
      assert.strictEqual(status.wl, 150);
      await bad(w.hostedDepositStatus(L, "guild-b", b.orderId), /tidak ditemukan/, 404);
      await bad(w.hostedDepositStatus(L2, L2, b.orderId), /tidak ditemukan/, 404);
      assert.strictEqual(databases.get(hostedDbName("autostore", L)).balance, 100);
      assert.strictEqual(databases.get(hostedDbName("autostore", "guild-b")).balance, 150);
      assert.strictEqual(databases.has(hostedDbName("autostore", L2)), false);
      assert.strictEqual(legacyCalls, 0);
      console.log("ok  deposit GevraStore dikreditkan ke database lisensi yang benar"); await close(); }

    { let credits = 0;
      const { w, close } = await setup({ creditHosted: async () => { credits++; return true; } });
      const d = await w.createDeposit({ licenseId: L, amount: 10000, discordId: "123456789012345678", hostedWL: 50, hostedTenantId: "store-a" });
      await bad(w.cancelHostedDeposit(L2, "store-a", d.orderId), /tidak ditemukan/, 404);
      await w.cancelHostedDeposit(L, "store-a", d.orderId);
      await w.cancelHostedDeposit(L, "store-a", d.orderId);
      assert.strictEqual((await w.hostedDepositStatus(L, "store-a", d.orderId)).status, "cancelled");
      assert.strictEqual(credits, 0);
      await w.handlePaid({ orderId: d.orderId, amount: 10000 });
      await w.handlePaid({ orderId: d.orderId, amount: 10000 });
      assert.strictEqual(credits, 1);
      await bad(w.cancelHostedDeposit(L, "store-a", d.orderId), /sudah diterima/, 409);
      console.log("ok  pembatalan QRIS dan pembayaran terlambat tidak menggandakan saldo");
      await close(); }

    // 3. biaya + validasi nominal
    { const { w, close } = await setup({ feePercent: 10, feeFlat: 500 });
      const d = await w.createDeposit({ licenseId: L, amount: 10000 }); await w.handlePaid({ orderId: d.orderId, amount: 10000 });
      assert.strictEqual((await w.summary(L)).pending, 10000 - 1000 - 500, "net = nominal - 10% - Rp500");
      await bad(w.createDeposit({ licenseId: L, amount: 10 }), /minimal/i); await bad(w.createDeposit({ licenseId: L, amount: 99_000_000 }), /maksimal/i);
      console.log("ok  biaya persen + tetap, batas nominal"); await close(); }

    // 4. penarikan
    { const { w, cols, close } = await setup({ holdMs: 0 });
      const d = await w.createDeposit({ licenseId: L, amount: 100000 }); await w.handlePaid({ orderId: d.orderId, amount: 100000 }); await w.sweep();
      assert.strictEqual((await w.summary(L)).available, 100000);
      await bad(w.requestWithdrawal({ licenseId: L, amount: 50000 }), /rekening/i);
      await w.setBank(L, bank);
      await bad(w.requestWithdrawal({ licenseId: L, amount: 5000 }), /minimal/i);
      await bad(w.requestWithdrawal({ licenseId: L, amount: 200000 }), /tidak cukup/i, 409);
      const wd = await w.requestWithdrawal({ licenseId: L, amount: 60000 });
      let s = await w.summary(L); assert.strictEqual(s.available, 40000); assert.strictEqual(s.locked, 60000);
      await bad(w.requestWithdrawal({ licenseId: L, amount: 10000 }), /sedang diproses/i, 409);
      await w.adminComplete(wd.id, { reference: "TRX1" });
      s = await w.summary(L); assert.strictEqual(s.locked, 0); assert.strictEqual(s.available, 40000);
      const wd2 = await w.requestWithdrawal({ licenseId: L, amount: 30000 }); await w.adminReject(wd2.id, { reason: "rekening salah" });
      s = await w.summary(L); assert.strictEqual(s.available, 40000, "ditolak = saldo kembali"); assert.strictEqual(s.locked, 0);
      await w.adminReject(wd2.id, {}).catch(() => {}); assert.strictEqual((await w.summary(L)).available, 40000, "tolak dua kali tidak menggandakan refund");
      assert.deepStrictEqual(await w.reconcile(null, { fix: false }), []);
      const frozen = await setup({ holdMs: 0, isFrozen: (id) => id === L2 }); await bad(frozen.w.requestWithdrawal({ licenseId: L2, amount: 20000 }), /dibekukan/i, 403);
      console.log("ok  penarikan: kunci saldo, satu penarikan terbuka, selesai, tolak, bekukan"); await close(); await frozen.close(); }

    // 5. rekening baru ada masa tunggu
    { const { w, close } = await setup({ holdMs: 0, bankCooldownMs: 24 * 3600e3 });
      const d = await w.createDeposit({ licenseId: L, amount: 50000 }); await w.handlePaid({ orderId: d.orderId, amount: 50000 }); await w.sweep();
      await w.setBank(L, bank); await w.requestWithdrawal({ licenseId: L, amount: 10000 }).then((x) => w.adminReject(x.id, {})); // rekening pertama: langsung boleh tarik
      await w.setBank(L, { ...bank, accountNo: "9999999999" }); await bad(w.requestWithdrawal({ licenseId: L, amount: 20000 }), /jam/i, 403); // ganti rekening: tunggu
      clock += 25 * 3600e3; await w.requestWithdrawal({ licenseId: L, amount: 20000 });
      console.log("ok  ganti rekening: tunggu 24 jam, rekening pertama langsung boleh"); await close(); }

    // 6. rekonsiliasi memperbaiki saldo yang rusak
    { const { w, cols, close } = await setup({ holdMs: 0 });
      const d = await w.createDeposit({ licenseId: L, amount: 40000 }); await w.handlePaid({ orderId: d.orderId, amount: 40000 }); await w.sweep();
      await cols.wallets.updateOne({ _id: L }, { $set: { available: 999999 } });
      const diffs = await w.reconcile(null, { fix: false }); assert.strictEqual(diffs.length, 1);
      await w.reconcile(null, { fix: true }); assert.strictEqual((await w.summary(L)).available, 40000);
      assert.deepStrictEqual(await w.reconcile(null, { fix: false }), []);
      console.log("ok  rekonsiliasi mendeteksi dan memperbaiki selisih"); await close(); }

    console.log("\nSemua tes wallet lulus." + (process.env.WALLET_TEST_MONGO ? " (MongoDB asli)" : " (koleksi tiruan)"));
})().catch((e) => { console.error("GAGAL:", e); process.exit(1); });
