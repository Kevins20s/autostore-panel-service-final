// Bot palsu untuk tes: cetak env, lalu buka server yang membalas isi webhook
const http = require("http");
console.log("fakebot up token=" + process.env.DISCORD_TOKEN + " owner=" + process.env.OWNER_ID + " leak=" + (process.env.MASTER_KEY || "none"));
http.createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d));
    req.on("end", () => { res.writeHead(200); res.end(JSON.stringify({ url: req.url, sig: req.headers["x-webhook-signature"], body: b })); });
}).listen(process.env.PORT);
setInterval(() => {}, 1e6);
