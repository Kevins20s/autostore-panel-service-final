// Cek token & MongoDB pembeli SEBELUM disimpan, supaya salah isi ketahuan langsung.
async function checkDiscord(token, clientId) {
    let r;
    try {
        r = await fetch("https://discord.com/api/v10/users/@me", {
            headers: { Authorization: `Bot ${token}` },
            signal: AbortSignal.timeout(8000),
        });
    } catch {
        throw new Error("Tidak bisa menghubungi Discord. Coba lagi sebentar.");
    }
    if (r.status === 401) throw new Error("Bot token salah atau sudah di-reset.");
    if (!r.ok) throw new Error(`Discord menolak permintaan (${r.status}).`);
    const me = await r.json();
    if (String(me.id) !== String(clientId)) throw new Error("Client ID tidak cocok dengan bot dari token ini.");
}

// Sembunyikan username:password di teks apa pun sebelum ditampilkan / dicatat
const redact = (t) => String(t || "").replace(/(mongodb(?:\+srv)?:\/\/)([^:@/\s]+):([^@\s]+)@/gi, "$1$2:***@");

// Ubah error teknis driver MongoDB jadi penjelasan yang bisa ditindaklanjuti pembeli
function explainMongoError(e) {
    const msg = String(e?.message || e || "");
    if (e?.codeName === "AuthenticationFailed" || e?.code === 18 || /bad auth|authentication failed/i.test(msg))
        return "Username atau password database salah. Cek di Atlas → Database Access. Kalau password mengandung karakter khusus (@ : / ? # %), buat password baru berisi huruf dan angka saja.";
    if (/querySrv|ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg))
        return "Alamat cluster tidak ditemukan. Cek URL-nya tidak salah ketik (bentuknya mongodb+srv://...mongodb.net) dan pastikan internet atau DNS komputer server ini normal.";
    if (/Invalid scheme|Invalid connection string|URI malformed|Invalid URL|must be url encoded|Unescaped/i.test(msg))
        return "Format URL MongoDB tidak valid. Salin ulang dari Atlas (Connect → Drivers). Kalau passwordnya mengandung karakter khusus, ubah passwordnya jadi huruf dan angka saja.";
    if (/timed out|ECONNREFUSED|ETIMEDOUT|ECONNRESET|tlsv1|SSL routines|ssl3_read_bytes|MongoNetworkError|selection/i.test(msg) || e?.name === "MongoServerSelectionError")
        return "Server database tidak bisa dijangkau (waktu habis). Penyebab paling umum: IP komputer server ini belum diizinkan. Di Atlas buka Network Access → Add IP Address → Allow access from anywhere (0.0.0.0/0), tunggu 1-2 menit, lalu coba lagi. Pastikan juga cluster tidak sedang paused.";
    return "Tidak bisa terhubung ke MongoDB. Periksa kembali URL, user, dan izin IP di Atlas.";
}

async function checkMongo(url, timeoutMs = 10000) {
    if (/[<>]/.test(url)) throw new Error("URL masih memuat tanda < >. Ganti seluruh <password> (beserta tanda < >) dengan password database yang sebenarnya.");
    const { MongoClient } = require("mongodb");
    let c;
    try {
        c = new MongoClient(url, { serverSelectionTimeoutMS: timeoutMs });
        await c.connect();
        await c.db().command({ ping: 1 });
    } catch (e) {
        console.error("[MONGO-CHECK]", e?.name, "-", redact(e?.message).slice(0, 300)); // penyebab asli tampil di terminal penjual
        throw new Error(explainMongoError(e));
    } finally {
        await c?.close().catch(() => {});
    }
}

module.exports = { checkDiscord, checkMongo, explainMongoError, redact };
