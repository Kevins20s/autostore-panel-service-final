const crypto = require("crypto");

function masterKey() {
    const h = process.env.MASTER_KEY || "";
    if (!/^[0-9a-f]{64}$/i.test(h)) {
        throw new Error(
            "MASTER_KEY harus 64 karakter hex. Buat dengan: " +
            "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
        );
    }
    return Buffer.from(h, "hex");
}

// AES-256-GCM: hasilnya "iv.tag.data" (base64)
function encrypt(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
    const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
    return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

function decrypt(str) {
    const [iv, tag, enc] = str.split(".").map((x) => Buffer.from(x, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", masterKey(), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8"));
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const derive = (label) => crypto.createHmac("sha256", masterKey()).update(label).digest();

module.exports = { encrypt, decrypt, sha256, derive };
