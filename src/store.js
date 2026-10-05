// Penyimpanan sederhana berbasis file JSON (cukup untuk puluhan pembeli).
// Data penting (token, mongo, dll) di dalamnya sudah terenkripsi.
const fs = require("fs");

function createStore(file) {
    fs.mkdirSync(require("path").dirname(file), { recursive: true });
    let data = { licenses: [], nextPort: Number(process.env.BASE_PORT || 4000) };
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8"));
    const save = () => {
        const tmp = file + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, file); // tulis atomik supaya file tidak rusak kalau mati mendadak
    };
    return { data, save };
}

module.exports = { createStore };
