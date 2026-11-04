// Membaca file .env (di folder project) ke process.env tanpa paket tambahan.
// Variabel yang sudah ada di lingkungan (mis. dari Railway) TIDAK ditimpa.
// Dipanggil paling awal oleh server.js, jadi "node server.js" dan "npm start" sama-sama membaca .env.
"use strict";
const fs = require("fs");
const path = require("path");

function parse(text) {
    const out = {};
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
        let val = line.slice(eq + 1).trim();
        const q = val[0];
        if ((q === '"' || q === "'") && val.endsWith(q) && val.length >= 2) val = val.slice(1, -1);
        else val = val.replace(/\s+#.*$/, "");
        out[key] = val;
    }
    return out;
}

function loadEnv(file = process.env.ENV_FILE || path.join(__dirname, "..", ".env")) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { return { loaded: 0, file }; }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM dari Notepad
    let loaded = 0;
    for (const [k, v] of Object.entries(parse(text))) {
        if (process.env[k] === undefined) { process.env[k] = v; loaded++; }
    }
    return { loaded, file };
}

module.exports = { loadEnv, parse };
