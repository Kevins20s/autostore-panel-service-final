const commandDocs = [
    ["help", "", "Tampilkan daftar perintah yang dapat kamu gunakan.", "List the commands you can use."],
    ["leaderboard", "", "Tampilkan lima pelanggan dengan saldo tertinggi.", "Show the five customers with the highest balances."],
    ["addproduct", "code name role type kategori", "Buat produk dengan kode, nama, role pembeli, tipe, dan kategori.", "Create a product with a code, name, buyer role, type, and category."],
    ["addstock", "code item file tag", "Isi stok dari teks atau file. Tag opsional untuk notifikasi restock.", "Add stock from text or a file. The tag is optional for restock notices."],
    ["changecode", "code newcode", "Ganti kode produk.", "Change a product code."],
    ["changename", "code name", "Ganti nama produk.", "Rename a product."],
    ["changekategori", "code kategori", "Pindahkan produk ke kategori lain.", "Move a product to another category."],
    ["changerole", "code role", "Ubah role Discord yang terkait dengan produk.", "Change the Discord role associated with a product."],
    ["changetype", "code type", "Ubah tipe produk.", "Change a product type."],
    ["checkstock", "code", "Lihat jumlah dan isi stok produk. Gunakan hanya untuk stok yang boleh kamu lihat.", "View stock count and contents for a product."],
    ["removestock", "code amount", "Hapus sejumlah stok dari produk.", "Remove a quantity of stock from a product."],
    ["removeproduct", "code", "Hapus produk berdasarkan kode.", "Delete a product by code."],
    ["setprice", "code price", "Atur harga produk dalam WL.", "Set a product price in WL."],
    ["setdiscount", "code discount", "Atur diskon produk.", "Set a product discount."],
    ["removediscount", "code", "Hapus diskon produk.", "Remove a product discount."],
    ["setbulkdiscount", "code minqty cut", "Atur potongan per item jika pembelian mencapai jumlah minimum.", "Set a per-item discount for a minimum purchase quantity."],
    ["removebulkdiscount", "code minqty", "Hapus diskon grosir pada jumlah minimum tertentu.", "Remove a bulk discount tier."],
    ["send", "code amount user", "Kirim stok produk ke pelanggan Discord.", "Send product stock to a Discord customer."],
    ["checkuser", "user", "Cek GrowID dan saldo pelanggan.", "Check a customer's GrowID and balance."],
    ["addbalance", "user balance", "Tambah saldo WL pelanggan.", "Add WL to a customer's balance."],
    ["removebalance", "user balance", "Kurangi saldo WL pelanggan.", "Subtract WL from a customer's balance."],
    ["setdepo", "world owner botname", "Atur world deposit, nama pemilik, dan nama bot deposit.", "Set the deposit world, owner name, and deposit bot name."],
    ["setchannel", "testimoni donationlog", "Pilih channel testimoni dan log donasi.", "Choose the testimonial and donation log channels."],
    ["setqris", "image", "Pasang gambar QRIS untuk pembayaran manual.", "Set the QRIS image for manual payments."],
    ["setwlprice", "harga", "Simpan kurs manual untuk 1 WL.", "Save the manual rate for 1 WL."],
    ["setapi", "status", "Nyalakan atau matikan kurs live gtid.pro.", "Enable or disable the live gtid.pro rate."],
    ["setrestockchannel", "channel", "Pilih channel notifikasi restock.", "Choose a restock notification channel."],
    ["setrealtime", "channel kategori", "Siapkan channel tampilan stok, opsional per kategori.", "Set up a live stock channel, optionally for a category."],
    ["startrealtime", "delay kategori", "Jalankan pembaruan stok berkala. Delay dihitung dalam detik.", "Start periodic stock updates. Delay is in seconds."],
    ["setmaintenance", "", "Aktifkan atau matikan mode maintenance.", "Toggle maintenance mode."],
    ["resetcount", "", "Reset nomor urut testimoni toko.", "Reset the store's testimonial counter."],
    ["uptime", "", "Lihat informasi waktu aktif bot.", "View bot uptime information."],
];

const guideText = (id, en) => gsLanguage === "en" ? en : id;

function commandGuide() {
    const results = h("div", { class: "guide-grid" });
    const count = h("span", { class: "mut", "aria-live": "polite" });
    const searchLabel = guideText("Cari command atau fungsi", "Search commands or descriptions");
    const search = h("input", { type: "search", placeholder: searchLabel, "aria-label": searchLabel });
    function renderCommands() {
        const query = search.value.trim().toLowerCase().replace(/^\//, "");
        const matches = commandDocs.filter(row => row.join(" ").toLowerCase().includes(query));
        count.textContent = guideText(`${matches.length} command`, `${matches.length} commands`);
        results.replaceChildren(...matches.map(([name, options, id, en]) => card(
            h("div", { class: "row sp" }, h("code", { class: "guide-command" }, "/" + name),
                h("span", { class: "pill" }, ["help", "leaderboard"].includes(name) ? guideText("Semua pengguna", "Everyone") : "Admin")),
            h("p", {}, guideText(id, en)),
            options ? h("p", { class: "mut mono" }, options.split(" ").join(" · ")) : null,
            h("button", { type: "button", class: "sm", onclick: () => copyText("/" + name) }, guideText("Salin command", "Copy command"))
        )));
        if (!matches.length) results.append(card(h("p", { class: "mut" }, guideText("Command tidak ditemukan.", "No commands found."))));
    }
    search.addEventListener("input", renderCommands);
    renderCommands();
    return h("div", { class: "guide-page" },
        head("Slash Command List", guideText("Referensi command asli bot AutoStore. Salin nama command lalu isi opsinya di Discord.", "Reference for the original AutoStore bot commands. Copy a command name and fill in its options in Discord.")),
        h("div", { class: "row sp guide-toolbar" }, search, count), results);
}

function luaDepositScript(template, values) {
    return template.replace(/^(local\s+(\w+)\s*=\s*)""/gm, (line, prefix, key) => {
        if (!Object.hasOwn(values, key)) return line;
        return prefix + '"' + values[key].replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    });
}

async function depositScript() {
    const response = await fetch("/api/deposit-template", { cache: "no-store" });
    if (!response.ok) throw new Error(guideText("Script deposit tersedia untuk lisensi AutoStore aktif.", "The deposit script requires an active AutoStore license."));
    const template = await response.text();
    const fields = [
        ["WorldDonation", "World deposit", "DEPOSITWORLD", "text", "[A-Za-z0-9]{1,24}"],
        ["WebhookDonation", "Webhook donasi", "https://discord.com/api/webhooks/…", "password"],
        ["WebhookStatus", "Webhook status", "https://discord.com/api/webhooks/…", "password"],
        ["WebhookStarted", "Webhook startup", "https://discord.com/api/webhooks/…", "password"],
        ["UsernameWebhook", "Nama webhook", "AutoStore Deposit", "text"],
        ["BannerWebhook", "URL banner", "https://…", "url"],
        ["AvatarWebhook", "URL avatar", "https://…", "url"],
    ];
    const preview = h("textarea", { readonly: true, class: "deposit-code", rows: 18, spellcheck: false, "aria-label": guideText("Pratinjau Lua", "Lua preview") });
    preview.value = template;
    const message = h("p", { class: "mut", "aria-live": "polite" });
    const copy = h("button", { type: "button", class: "pri", disabled: true, onclick: () => copyText(preview.value) }, guideText("Salin script Lua", "Copy Lua script"));
    const form = h("form", { class: "deposit-form", autocomplete: "off" });
    const labels = ["Deposit world", "Donation webhook", "Status webhook", "Startup webhook", "Webhook name", "Banner URL", "Avatar URL"];
    for (const [index, [key, label, placeholder, type, pattern]] of fields.entries()) {
        const input = h("input", { name: key, type, placeholder, required: true, autocomplete: "off", maxlength: key === "UsernameWebhook" ? 80 : 2048 });
        if (pattern) input.pattern = pattern;
        input.addEventListener("input", () => { preview.value = template; copy.disabled = true; message.textContent = ""; });
        form.append(field(guideText(label, labels[index]), input));
    }
    form.append(h("div", { class: "row gap mt" }, h("button", { type: "submit" }, guideText("Buat script", "Generate script")), copy), message);
    form.addEventListener("submit", event => {
        event.preventDefault();
        const values = Object.fromEntries(Array.from(new FormData(form), ([key, value]) => [key, value.trim()]));
        const hook = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;
        const imageUrl = /^https:\/\/[^"\\\s]+$/i;
        if (!/^[A-Za-z0-9]{1,24}$/.test(values.WorldDonation) ||
            !["WebhookDonation", "WebhookStatus", "WebhookStarted"].every(key => hook.test(values[key])) ||
            !values.UsernameWebhook || /["\\\x00-\x1f]/.test(values.UsernameWebhook) ||
            !["BannerWebhook", "AvatarWebhook"].every(key => imageUrl.test(values[key]))) {
            message.textContent = guideText("Periksa nama world, URL webhook Discord, nama webhook, dan URL gambar HTTPS.", "Check the world name, Discord webhook URLs, webhook name, and HTTPS image URLs.");
            return;
        }
        values.WorldDonation = values.WorldDonation.toUpperCase();
        preview.value = luaDepositScript(template, values);
        copy.disabled = false;
        message.textContent = guideText("Script siap disalin.", "Your script is ready to copy.");
    });
    return h("div", { class: "guide-page" },
        head(guideText("Script Deposit", "Deposit Script"), guideText("Isi konfigurasi, buat script Lua, lalu salin ke runtime bot depositmu.", "Fill in the configuration, generate the Lua script, then copy it to your deposit bot runtime.")),
        h("div", { class: "deposit-layout" },
            card(h("h2", {}, guideText("Konfigurasi", "Configuration")),
                h("p", { class: "mut" }, guideText("Webhook diproses di browser dan tidak disimpan panel. Jaga kerahasiaan script hasil salinan.", "Webhook values are processed in your browser. Keep the generated script private.")),
                h("p", { class: "mut" }, guideText("Atur channel donasi lewat /setchannel. Di Bot GevraStore, simpan ID angka webhook donasi di Pengaturan toko pada panel.", "Set the donation channel via /setchannel. For hosted GevraStore, save the donation webhook's numeric ID in the panel Store settings.")), form),
            card(h("h2", {}, guideText("Pratinjau Lua", "Lua preview")), preview)));
}
