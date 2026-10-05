let client = require("../../index.js");
let { refreshJasaPanel } = require("../../utils/jasaPanelBuilder.js");

module.exports = {
    name: "Jasa Auto Refresh",
};

const REFRESH_INTERVAL_MS = 30 * 1000; // 30 detik

client.once("ready", () => {
    // refreshJasaPanel sendiri sudah aman dipanggil kapan saja — kalau panel
    // belum pernah di-set lewat /setjasapanel, fungsinya diam aja (gak error).
    setInterval(() => {
        refreshJasaPanel(client).catch(console.error);
    }, REFRESH_INTERVAL_MS);

    console.log(`[JASA] Auto-refresh panel jasa aktif, tiap ${REFRESH_INTERVAL_MS / 1000} detik.`);
});
