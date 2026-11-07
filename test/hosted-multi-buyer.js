"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { encrypt } = require("../src/crypto");
const { hostedTenant, hostedDbName } = require("../src/shared-tenants");
const { hostedWalletToken, registerWalletRoutes } = require("../src/walletapi");
const { hostedQrCancelId, readHostedQrCancelId } = require("../bot/src/utils/hostedQrCancel");

const guildA = "100000000000000001", guildB = "100000000000000002";
const owner = "100000000000000003", appId = "100000000000000004";
const env = {
    MASTER_KEY: "e".repeat(64),
    DISCORD_LOGIN_CLIENT_ID: appId, DISCORD_LOGIN_CLIENT_SECRET: "test",
    DISCORD_HOSTED_BOT_CLIENT_ID: appId,
    DISCORD_CATALOG_PILOT_TOKEN: "test", DISCORD_CATALOG_PILOT_MONGO_URL: "mongodb://unused",
    DISCORD_HOSTED_PILOT_LICENSE_ID: "pilot-a", DISCORD_HOSTED_TEST_LICENSE_IDS: "pilot-b",
    DISCORD_HOSTED_PILOT_GUILD_IDS: guildA + "," + guildB,
    DISCORD_HOSTED_PILOT_DB_NAMESPACE: "existing",
    DISCORD_HOSTED_PILOT_STATUS_FILE: "/status.json", PUBLIC_URL: "https://example.com",
};
Object.assign(process.env, env);
const a = { id: "pilot-a", expiresAt: Date.now() + 60000, discordLoginId: owner, paymentMode: "auto" };
const b = { ...a, id: "pilot-b" };
const licenses = () => [a, b];
const valid = l => !l.revoked && l.expiresAt > Date.now();

function captureRoutes() {
    const routes = new Map();
    const app = {};
    for (const method of ["get", "post", "put"]) {
        app[method] = (url, ...handlers) => routes.set(method + " " + url, handlers.at(-1));
    }
    async function invoke(method, url, req) {
        const response = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; },
            json(value) { this.value = value; }, sendStatus(n) { this.statusCode = n; } };
        await routes.get(method + " " + url)(req, response);
        return response;
    }
    return { app, invoke };
}

async function testRouting() {
    const { app, invoke } = captureRoutes();
    require("../src/discord-login")(app, { buyer() {}, valid, save() {}, licenses });
    const originalFetch = global.fetch;
    global.fetch = async url => ({
        ok: true,
        json: async () => String(url).includes("/users/@me/guilds") ? [
            { id: guildA, name: "Guild A", owner: true }, { id: guildB, name: "Guild B", owner: true },
        ] : {},
    });
    const bind = (lic, guildId) => invoke("put", "/api/discord-install/setup", {
        lic, body: { guildId, enabled: true },
        headers: { cookie: "gs_discord_install=" + encodeURIComponent(encrypt({
            id: owner, accessToken: "synthetic", licenseId: lic.id, exp: Date.now() + 10000,
        })) },
    });
    try {
        const responses = await Promise.all([bind(a, guildA), bind(b, guildA)]);
        assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
        const winner = responses[0].statusCode === 200 ? a : b;
        const loser = winner === a ? b : a;
        assert.equal((await bind(loser, guildB)).statusCode, 200);
        // Reassign the synthetic fixtures for the legacy-data test.
        a.hostedBot.guildId = guildA;
        b.hostedBot.guildId = guildB;
    } finally { global.fetch = originalFetch; }

    const ta = hostedTenant(a, licenses()), tb = hostedTenant(b, licenses());
    assert.equal(ta.dbName, hostedDbName("autostore", "existing-0"));
    assert.notEqual(ta.dbName, tb.dbName);
    const conflict = { ...b, hostedBot: { guildId: guildA, enabled: false } };
    assert.equal(hostedTenant(a, [a, conflict]), null, "paused licenses keep their server reservation");
    assert.equal(hostedTenant({ ...a, id: "public-license" }, licenses()), null);

    const aButton = hostedQrCancelId(guildA, "DP-SAME"), bButton = hostedQrCancelId(guildB, "DP-SAME");
    assert.equal(readHostedQrCancelId(aButton, guildA, true), "DP-SAME");
    assert.equal(readHostedQrCancelId(bButton, guildA, true), null);
    assert.equal(readHostedQrCancelId("qriscancel_DP-OLD", guildA, true), "DP-OLD");
    assert.equal(readHostedQrCancelId("qriscancel_DP-OLD", guildB, false), null);

    const created = [];
    registerWalletRoutes(app, {
        wallet: { async createDeposit(input) { created.push(input); return { orderId: "DP-" + input.licenseId, amount: input.amount }; } },
        autoko: {}, buyer() {}, admin() {}, licenses, findLicense: id => licenses().find(l => l.id === id), valid, qr: {},
    });
    const deposit = (lic, guildId, signedFor) => invoke("post", "/internal/wallet/deposit", {
        headers: { "x-license-id": lic.id, "x-hosted-guild": guildId, authorization: "Bearer " + hostedWalletToken(lic.id, signedFor) },
        body: { amount: 1000, discordId: owner, pricePerWL: 10 },
    });
    assert.equal((await deposit(a, guildB, guildA)).statusCode, 401);
    const accepted = await Promise.all([deposit(a, guildA, guildA), deposit(b, guildB, guildB)]);
    assert.deepEqual(accepted.map(r => r.statusCode), [200, 200]);
    assert.deepEqual(created.map(t => t.hostedTenantId).sort(), [ta.tenantId, tb.tenantId].sort());
    console.log("OK: race for one server rejects a claimant; same user can use two isolated QRIS routes and DM buttons");
}

function testWorkerLifecycle() {
    const queue = [], workers = new Map(), cleared = [];
    let time = Date.now();
    let status, data = { licenses: structuredClone(licenses()) };
    const fakeFs = {
        readFileSync: () => JSON.stringify(data),
        writeFileSync: (_name, json) => { status = JSON.parse(json); },
        renameSync() {},
    };
    const fakeFork = (_file, { env }) => {
        const child = new EventEmitter();
        child.kill = () => { child.killed = true; child.emit("close"); };
        workers.set(env.GUILD_ID, { child, env });
        return child;
    };
    const imports = {
        "node:fs": fakeFs, "node:path": path, "node:child_process": { fork: fakeFork },
        "./loadenv": { loadEnv() {} }, "./shared-tenants": require("../src/shared-tenants"),
        "./walletapi": { hostedWalletToken },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/run-hosted-pilot.js"), "utf8"), {
        require: id => imports[id], __dirname: path.join(__dirname, "../src"),
        process: { env, on() {}, once() {} }, console, setTimeout: fn => queue.push(fn), AbortSignal,
        Date: class extends Date { static now() { return time; } },
        fetch: async url => { cleared.push(url); return { ok: true }; },
    });
    assert.equal(workers.size, 1);
    time += 6000;
    queue.shift()();
    assert.equal(workers.size, 2);
    assert.notEqual(workers.get(guildA).env.PANEL_INTERNAL_TOKEN, workers.get(guildB).env.PANEL_INTERNAL_TOKEN);
    assert.notEqual(JSON.parse(workers.get(guildA).env.HOSTED_PILOT_BINDING).dbName, JSON.parse(workers.get(guildB).env.HOSTED_PILOT_BINDING).dbName);
    for (const { child } of workers.values()) child.emit("message", { online: true });
    queue.shift()();
    assert.deepEqual(status.bindings, { [guildA]: a.id, [guildB]: b.id });
    data.licenses[0].hostedBot.enabled = false;
    queue.shift()();
    assert.equal(workers.get(guildA).child.killed, true);
    assert.equal(workers.get(guildB).child.killed, undefined);
    assert.deepEqual(status.bindings, { [guildB]: b.id });
    assert.equal(cleared.length, 1);
    assert.ok(cleared[0].includes("/guilds/" + guildA + "/commands"));
    console.log("OK: two workers online together; stopping A leaves B online and preserves its command registration");
}

testRouting().then(testWorkerLifecycle).catch(error => { console.error(error); process.exitCode = 1; });
