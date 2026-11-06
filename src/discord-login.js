"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const auth = require("./auth");
const { encrypt, decrypt } = require("./crypto");

const FLOW = "gs_discord_flow";
const MAX_AGE = 10 * 60 * 1000;
const API = "https://discord.com/api/v10";
const INSTALL = "gs_discord_install";
const DISCORD_ID = /^\d{17,20}$/;
const CAN_INSTALL = (1n << 3n) | (1n << 5n); // Administrator atau Manage Server

module.exports = function registerDiscordLogin(app, { buyer, valid, save }) {
    const clientId = process.env.DISCORD_LOGIN_CLIENT_ID;
    const clientSecret = process.env.DISCORD_LOGIN_CLIENT_SECRET;
    let redirectUri;
    try {
        const base = new URL(process.env.PUBLIC_URL);
        if (base.protocol === "https:" || (base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname))) {
            redirectUri = new URL("/api/auth/discord/callback", base).href;
        }
    } catch { /* OAuth belum dikonfigurasi */ }
    const enabled = !!(clientId && clientSecret && redirectUri);
    const botId = process.env.DISCORD_HOSTED_BOT_CLIENT_ID || "";
    const botPermissions = process.env.DISCORD_HOSTED_BOT_PERMISSIONS || "0";
    const installEnabled = enabled && DISCORD_ID.test(botId) && /^\d+$/.test(botPermissions);
    const pilotLicense = process.env.DISCORD_HOSTED_PILOT_LICENSE_ID;
    const pilotGuilds = new Set((process.env.DISCORD_HOSTED_PILOT_GUILD_IDS || "").split(",").filter(Boolean));
    const eligible = license => installEnabled && license.type !== "service" && valid(license) &&
        (!pilotLicense || (license.id === pilotLicense && pilotGuilds.size > 0));
    const options = { httpOnly: true, sameSite: "lax", secure: !!redirectUri?.startsWith("https:"), path: "/api" };
    const read = (req, name) => auth.verify(auth.readCookie(req, name));
    const set = (res, name, payload) => res.cookie(name, auth.sign({ ...payload, exp: Date.now() + MAX_AGE }), { ...options, maxAge: MAX_AGE });
    const noStore = (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); };
    const installOptions = { ...options, path: "/api/discord-install" };
    const clearInstall = (res) => res.clearCookie(INSTALL, installOptions);
    const botToken = process.env.DISCORD_CATALOG_PILOT_TOKEN;
    async function manageableServers(req) {
        let session;
        try { session = decrypt(auth.readCookie(req, INSTALL)); } catch { /* Belum login atau cookie rusak. */ }
        if (!session || session.exp <= Date.now() || session.licenseId !== req.lic.id || session.id !== req.lic.discordLoginId) {
            return null;
        }
        const response = await fetch(API + "/users/@me/guilds?limit=200", {
            headers: { Authorization: "Bearer " + session.accessToken },
            signal: AbortSignal.timeout(8000),
        });
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok) throw new Error("Discord guild lookup failed");
        return (await response.json()).filter(guild =>
                DISCORD_ID.test(guild.id) &&
                (!pilotLicense || pilotGuilds.has(guild.id)) &&
                (guild.owner === true || (/^\d+$/.test(guild.permissions) && (BigInt(guild.permissions) & CAN_INSTALL) !== 0n))
        );
    }
    const canActivate = !!(pilotLicense && botToken);
    const statusFile = process.env.DISCORD_HOSTED_PILOT_STATUS_FILE;
    function statusFor(license) {
        const setup = license.hostedBot;
        if (!setup) return null;
        const status = { ...setup, state: "stopped" };
        if (!setup.enabled || !eligible(license)) return status;
        try {
            const heartbeat = JSON.parse(fs.readFileSync(statusFile, "utf8"));
            const age = Date.now() - heartbeat.at;
            if (age >= 0 && age < 20000 && heartbeat.guilds.includes(setup.guildId)) status.state = "running";
        } catch { /* Missing or stale pilot status is offline. */ }
        return status;
    }
    async function installed(id) {
        const response = await fetch(API + "/guilds/" + id, {
            headers: { Authorization: "Bot " + botToken },
            signal: AbortSignal.timeout(5000),
        });
        if (response.status === 403 || response.status === 404) return false;
        if (!response.ok) throw new Error("Bot membership lookup failed");
        return true;
    }
    app.get("/api/discord-install/servers", noStore, buyer, async (req, res) => {
        if (!eligible(req.lic)) return res.sendStatus(403);
        try {
            const guilds = await manageableServers(req);
            if (!guilds) { clearInstall(res); return res.json({ reconnect: true }); }
            const servers = await Promise.all(guilds.map(async ({ id, name }) => {
                const params = new URLSearchParams({
                    client_id: botId, scope: "bot applications.commands", permissions: botPermissions,
                    integration_type: "0", guild_id: id, disable_guild_select: "true",
                });
                return { id, name, invite: "https://discord.com/oauth2/authorize?" + params, installed: canActivate && await installed(id) };
            }));
            res.json({ servers, canActivate, setup: statusFor(req.lic) });
        } catch {
            res.status(502).json({ error: "Daftar server Discord belum bisa dimuat. Coba lagi." });
        }
    });

    app.put("/api/discord-install/setup", noStore, buyer, async (req, res) => {
        if (!canActivate || !eligible(req.lic)) return res.sendStatus(403);
        const { guildId, enabled: running } = req.body || {};
        if (!DISCORD_ID.test(guildId) || typeof running !== "boolean") return res.sendStatus(400);
        const license = req.lic;
        try {
            if (running) {
                const guilds = await manageableServers(req);
                if (!guilds) return res.status(401).json({ error: "Hubungkan kembali akun Discord." });
                if (!guilds.some(guild => guild.id === guildId)) return res.sendStatus(403);
                if (!await installed(guildId)) return res.status(409).json({ error: "Undang bot ke server ini terlebih dahulu." });
            } else if (license.hostedBot?.guildId !== guildId) {
                return res.sendStatus(409);
            }
            if (!eligible(license)) return res.sendStatus(403);
            const previous = license.hostedBot;
            license.hostedBot = { guildId, enabled: running };
            try { save(); }
            catch (error) { license.hostedBot = previous; throw error; }
            res.json({ setup: statusFor(license) });
        } catch {
            res.status(502).json({ error: "Pengaturan bot belum bisa disimpan. Coba lagi." });
        }
    });

    app.get("/api/auth/discord/status", noStore, (_req, res) => {
        res.json({ enabled: installEnabled });
    });
    app.get("/api/auth/discord", noStore, buyer, (req, res) => {
        if (!eligible(req.lic)) return res.redirect("/?discord=unavailable#/bot");
        const state = crypto.randomBytes(24).toString("base64url");
        const verifier = crypto.randomBytes(32).toString("base64url");
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        clearInstall(res);
        set(res, FLOW, { t: FLOW, state, verifier, licenseId: req.lic.id });
        const params = new URLSearchParams({
            client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "identify guilds",
            state, code_challenge: challenge, code_challenge_method: "S256",
        });
        res.redirect("https://discord.com/oauth2/authorize?" + params);
    });
    app.get("/api/auth/discord/callback", noStore, buyer, async (req, res) => {
        const flow = read(req, FLOW);
        res.clearCookie(FLOW, options);
        const license = req.lic;
        if (!eligible(license) || flow?.t !== FLOW || flow.licenseId !== license.id || req.query.state !== flow.state || typeof req.query.code !== "string") {
            return res.redirect("/?discord=error#/bot");
        }
        try {
            const token = await fetch(API + "/oauth2/token", {
                method: "POST",
                body: new URLSearchParams({
                    client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code",
                    code: req.query.code, redirect_uri: redirectUri, code_verifier: flow.verifier,
                }),
                signal: AbortSignal.timeout(8000),
            });
            if (!token.ok) throw new Error("Token exchange failed");
            const { access_token: accessToken } = await token.json();
            if (!accessToken) throw new Error("Missing access token");
            const profile = await fetch(API + "/users/@me", {
                headers: { Authorization: "Bearer " + accessToken },
                signal: AbortSignal.timeout(8000),
            });
            if (!profile.ok) throw new Error("Discord identity lookup failed");
            const { id } = await profile.json();
            if (typeof id !== "string" || !DISCORD_ID.test(id)) throw new Error("Invalid Discord ID");
            if (!eligible(license)) return res.redirect("/?discord=unavailable#/bot");
            if (license.discordLoginId && license.discordLoginId !== id) return res.redirect("/?discord=conflict#/bot");
            if (!license.discordLoginId) {
                license.discordLoginId = id;
                try { save(); }
                catch (error) { delete license.discordLoginId; throw error; }
            }
            res.cookie(INSTALL, encrypt({ id, accessToken, licenseId: license.id, exp: Date.now() + MAX_AGE }), { ...installOptions, maxAge: MAX_AGE });
            return res.redirect("/?discord=connected#/bot");
        } catch {
            return res.redirect("/?discord=error#/bot");
        }
    });

    return { clearInstall, eligible, statusFor };
};
