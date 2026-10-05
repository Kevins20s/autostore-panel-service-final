const fs = require("fs");
const path = require("path");

module.exports = (client) => {
    const dir = path.join(__dirname, "../events/client");
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".js"))) {
        try {
            const mod = require(path.join(dir, file));
            if (mod.name) {
                client.events.set(mod.name, mod);
                console.log(`[SERVICE EVENT] Loaded: ${mod.name}`);
            }
        } catch (err) {
            console.error(`[SERVICE EVENT] Failed: ${file}`, err);
        }
    }
};
