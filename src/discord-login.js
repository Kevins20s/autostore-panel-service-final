"use strict";

const crypto = require("node:crypto");
const auth = require("./auth");

const FLOW = "gs_discord_flow";
const PENDING = "gs_discord_link";
const MAX_AGE = 10 * 60 * 1000;
const API = "https://discord.com/api/v10";

module.exports = function registerDiscordLogin(app, { licenses }) {
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
    const options = { httpOnly: true, sameSite: "lax", secure: !!redirectUri?.startsWith("https:"), path: "/api" };
    const read = (req, name) => auth.verify(auth.readCookie(req, name));
    const set = (res, name, payload) => res.cookie(name, auth.sign({ ...payload, exp: Date.now() + MAX_AGE }), { ...options, maxAge: MAX_AGE });
    const pendingId = (req) => {
        const data = enabled && read(req, PENDING);
        return data?.t === PENDING ? data.id : null;
    };
    const clear = (res) => res.clearCookie(PENDING, options);
    const noStore = (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); };

    app.get("/api/auth/discord/status", noStore, (req, res) => {
        res.json({ enabled, needsLicense: !!pendingId(req) });
    });
    app.get("/api/auth/discord", noStore, (_req, res) => {
        if (!enabled) return res.sendStatus(404);
        const state = crypto.randomBytes(24).toString("base64url");
        const verifier = crypto.randomBytes(32).toString("base64url");
        const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
        clear(res);
        set(res, FLOW, { t: FLOW, state, verifier });
        const params = new URLSearchParams({
            client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "identify",
            state, code_challenge: challenge, code_challenge_method: "S256",
        });
        res.redirect("https://discord.com/oauth2/authorize?" + params);
    });
    app.get("/api/auth/discord/callback", noStore, async (req, res) => {
        if (!enabled) return res.sendStatus(404);
        const flow = read(req, FLOW);
        res.clearCookie(FLOW, options);
        if (flow?.t !== FLOW || req.query.state !== flow.state || typeof req.query.code !== "string") {
            return res.redirect("/?discord=error#masuk");
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
            if (typeof id !== "string" || !/^\d{17,20}$/.test(id)) throw new Error("Invalid Discord ID");
            const linked = licenses().find(license => license.discordLoginId === id);
            if (linked) {
                clear(res);
                auth.setSession(res, { t: "buyer", id: linked.id });
                return res.redirect("/");
            }
            set(res, PENDING, { t: PENDING, id });
            return res.redirect("/#masuk");
        } catch {
            return res.redirect("/?discord=error#masuk");
        }
    });

    return { pendingId, clear };
};
