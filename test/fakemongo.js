// Koleksi MongoDB tiruan di memori, hanya operator yang dipakai src/wallet.js (untuk tes tanpa database).
"use strict";
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const getv = (d, k) => d[k];
function matchVal(v, cond) {
    if (isObj(cond) && Object.keys(cond).some((k) => k.startsWith("$"))) {
        return Object.entries(cond).every(([op, x]) => {
            if (op === "$gte") return v != null && v >= x;
            if (op === "$gt") return v != null && v > x;
            if (op === "$lte") return v != null && v <= x;
            if (op === "$lt") return v != null && v < x;
            if (op === "$ne") return (v ?? null) !== (x ?? null);
            if (op === "$in") return x.includes(v);
            throw new Error("operator belum didukung di fake: " + op);
        });
    }
    return cond === null ? v == null : v === cond;
}
const matches = (d, f) => Object.entries(f || {}).every(([k, c]) => matchVal(getv(d, k), c));
function applyUpdate(d, u) {
    for (const [k, v] of Object.entries(u.$set || {})) d[k] = v;
    for (const [k, v] of Object.entries(u.$inc || {})) d[k] = (d[k] || 0) + v;
}
function createCollection({ unique = [] } = {}) {
    let rows = [];
    const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);
    const dupErr = () => Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    const checkUnique = (doc, except) => { for (const u of unique) if (rows.some((r) => r !== except && r[u] !== undefined && r[u] === doc[u])) throw dupErr(); };
    const cursor = (list) => { let out = list; const c = { sort(s) { const [[k, dir]] = Object.entries(s); out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir); return c; }, skip(n) { out = out.slice(n); return c; }, limit(n) { out = out.slice(0, n); return c; }, project() { return c; }, toArray: async () => out.map(clone) }; return c; };
    return {
        find: (f) => cursor(rows.filter((r) => matches(r, f))),
        findOne: async (f) => clone(rows.find((r) => matches(r, f)) || null),
        countDocuments: async (f) => rows.filter((r) => matches(r, f)).length,
        insertOne: async (doc) => { const d = clone(doc); checkUnique(d); rows.push(d); return { insertedId: d._id }; },
        updateOne: async (f, u, o = {}) => {
            const r = rows.find((x) => matches(x, f));
            if (r) { applyUpdate(r, u); return { matchedCount: 1, modifiedCount: 1 }; }
            if (o.upsert) { const d = { ...Object.fromEntries(Object.entries(f).filter(([, v]) => !isObj(v))), ...clone(u.$setOnInsert || {}) }; applyUpdate(d, u); rows.push(d); return { upsertedCount: 1 }; }
            return { matchedCount: 0, modifiedCount: 0 };
        },
        updateMany: async (f, u) => { const m = rows.filter((x) => matches(x, f)); m.forEach((r) => applyUpdate(r, u)); return { matchedCount: m.length, modifiedCount: m.length }; },
        findOneAndUpdate: async (f, u, o = {}) => { const r = rows.find((x) => matches(x, f)); if (!r) return null; const before = clone(r); applyUpdate(r, u); return o.returnDocument === "after" ? clone(r) : before; },
        deleteMany: async (f) => { const n = rows.length; rows = rows.filter((r) => !matches(r, f)); return { deletedCount: n - rows.length }; },
    };
}
function createFakeCols() {
    return { wallets: createCollection({ unique: ["_id"] }), deposits: createCollection({ unique: ["orderId"] }), ledger: createCollection({ unique: ["key"] }), withdrawals: createCollection({ unique: ["id"] }) };
}
module.exports = { createFakeCols };
