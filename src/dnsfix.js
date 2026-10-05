// Beberapa server (VPS/RDP) punya DNS bawaan yang menolak pencarian SRV (querySrv ECONNREFUSED),
// padahal itu yang dipakai alamat mongodb+srv://. Isi DNS_SERVERS di .env untuk memakai DNS lain.
const dns = require("dns");

function applyDnsServers(list = process.env.DNS_SERVERS) {
    const servers = String(list || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!servers.length) return [];
    try {
        dns.setServers(servers);
        return dns.getServers();
    } catch (e) {
        console.error("[DNS] DNS_SERVERS tidak valid, diabaikan:", e.message);
        return [];
    }
}

module.exports = { applyDnsServers };