const crypto = require("crypto");
const { derive } = require("./crypto");

const COOKIE = "sid";
const sig = (body) => crypto.createHmac("sha256", derive("session")).update(body).digest("base64url");

function sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return body + "." + sig(body);
}

function verify(token) {
    try {
        const [body, s] = String(token || "").split(".");
        if (!body || !s) return null;
        const a = Buffer.from(s), b = Buffer.from(sig(body));
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
        const p = JSON.parse(Buffer.from(body, "base64url").toString());
        return p.exp > Date.now() ? p : null;
    } catch {
        return null;
    }
}

function readCookie(req, name = COOKIE) {
    const m = (req.headers.cookie || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(name + "="));
    try { return m ? decodeURIComponent(m.slice(name.length + 1)) : null; }
    catch { return null; }
}

function setSession(res, payload, hours = 12) {
    const token = sign({ ...payload, exp: Date.now() + hours * 3600e3 });
    const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
    res.append("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${hours * 3600}${secure}`);
}

const clearSession = (res) => res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
const session = (req) => verify(readCookie(req));

// Batasi percobaan login salah: 10x per 10 menit per IP
const fails = new Map();
function tooMany(ip) {
    const f = fails.get(ip);
    return !!f && f.reset > Date.now() && f.count >= 10;
}
function recordFail(ip) {
    const f = fails.get(ip);
    if (!f || f.reset < Date.now()) fails.set(ip, { count: 1, reset: Date.now() + 600e3 });
    else f.count++;
}
const clearFails = (ip) => fails.delete(ip);

module.exports = { sign, verify, readCookie, setSession, clearSession, session, tooMany, recordFail, clearFails };
