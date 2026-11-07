const commandDocs = [
    ["help", "", "Tampilkan daftar perintah yang dapat kamu gunakan.", "List the commands you can use."],
    ["leaderboard", "", "Tampilkan lima pelanggan dengan saldo tertinggi.", "Show the five customers with the highest balances."],
    ["addproduct", "code name role type kategori?", "Buat produk baru dengan kode yang belum dipakai. Kategori kosong memakai ALL.", "Create a product with an unused code. A blank category uses ALL."],
    ["addstock", "code item? file? tag?", "Isi stok produk. Isi item atau unggah file, pilih salah satu.", "Restock a product. Enter items or upload a file, choosing one of the two."],
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
    ["send", "user code amount", "Kirim stok produk ke pelanggan Discord.", "Send product stock to a Discord customer."],
    ["checkuser", "user", "Cek GrowID dan saldo pelanggan.", "Check a customer's GrowID and balance."],
    ["addbalance", "user balance", "Tambah saldo WL pelanggan.", "Add WL to a customer's balance."],
    ["removebalance", "user balance", "Kurangi saldo WL pelanggan.", "Subtract WL from a customer's balance."],
    ["setdepo", "world owner botname", "Atur world deposit, nama pemilik, dan nama bot deposit.", "Set the deposit world, owner name, and deposit bot name."],
    ["setchannel", "testimoni donationlog", "Pilih channel testimoni dan log donasi.", "Choose the testimonial and donation log channels."],
    ["setqris", "image", "Pasang gambar QRIS untuk pembayaran manual.", "Set the QRIS image for manual payments."],
    ["setwlprice", "harga", "Simpan kurs manual untuk 1 WL.", "Save the manual rate for 1 WL."],
    ["setapi", "status", "Nyalakan atau matikan kurs live gtid.pro.", "Enable or disable the live gtid.pro rate."],
    ["setrestockchannel", "channel", "Pilih channel notifikasi restock.", "Choose a restock notification channel."],
    ["setrealtime", "channel kategori?", "Siapkan channel tampilan stok. Kosongkan kategori untuk menampilkan semua produk.", "Set up a live stock channel. Leave the category blank to display all products."],
    ["startrealtime", "delay kategori?", "Jalankan pembaruan stok di channel yang sudah diatur lewat /setrealtime.", "Start stock updates in the channel configured with /setrealtime."],
    ["setmaintenance", "", "Aktifkan atau matikan mode maintenance.", "Toggle maintenance mode."],
    ["resetcount", "", "Reset nomor urut testimoni toko.", "Reset the store's testimonial counter."],
    ["uptime", "", "Lihat informasi waktu aktif bot.", "View bot uptime information."],
];

const guideText = (id, en) => gsLanguage === "en" ? en : id;

const commandCategories = [
    ["Toko & tampilan", "Store & display", "shopping-bag", ["help", "leaderboard", "setchannel", "setrestockchannel", "setrealtime", "startrealtime"]],
    ["Produk & stok", "Products & stock", "package", ["addproduct", "addstock", "changecode", "changename", "changekategori", "changerole", "changetype", "checkstock", "removestock", "removeproduct"]],
    ["Harga & diskon", "Prices & discounts", "credit-card", ["setprice", "setdiscount", "removediscount", "setbulkdiscount", "removebulkdiscount"]],
    ["Pelanggan & saldo", "Customers & balances", "users", ["send", "checkuser", "addbalance", "removebalance"]],
    ["Deposit & pembayaran", "Deposits & payments", "wallet", ["setdepo", "setqris", "setwlprice", "setapi"]],
    ["Administrasi", "Administration", "settings", ["setmaintenance", "resetcount", "uptime"]],
];

const commandFields = {
    code: ["Kode produk", "Product code", "Kode yang tercantum di Produk & stok.", "The code listed under Products & stock.", "VOUCHER01"],
    newcode: ["Kode baru", "New code", "Masukkan kode produk baru yang belum dipakai.", "Enter a new product code that is not already in use.", "VOUCHER02"],
    name: ["Nama produk", "Product name", "Nama yang akan dilihat pembeli di katalog.", "The name buyers see in the catalog.", "Voucher Digital"],
    role: ["Role pembeli", "Buyer role", "Pilih role dari daftar Discord. Role ini terkait dengan produk dan diberikan ke pembeli saat pembelian.", "Select a role from Discord's list. The role is associated with the product and assigned on purchase.", "Buyer"],
    type: ["Tipe produk", "Product type", "Isi yes untuk kode atau item teks, atau script untuk produk berupa file script.", "Enter yes for text codes or items, or script for a product delivered as a script file.", "yes"],
    kategori: ["Kategori produk", "Product category", "Masukkan nama kategori produk. Untuk tampilan stok per kategori, pakai nama yang sama di produk, /setrealtime, dan /startrealtime.", "Enter the product category. For a category-specific stock display, use the same name in the product, /setrealtime, and /startrealtime.", "Voucher"],
    item: ["Stok dalam teks", "Stock as text", "Masukkan kode stok dan pisahkan tiap unit dengan spasi.", "Enter stock codes separated by spaces.", "VCR-001 VCR-002"],
    file: ["File stok", "Stock file", "Unggah file .txt, .lua, atau .js. Untuk tipe script, isi file menjadi satu unit stok.", "Upload a .txt, .lua, or .js file. For the script type, the whole file becomes one stock unit.", "stok.txt"],
    tag: ["Penerima notifikasi", "Notification mention", "Pilih role atau pengguna yang ingin ditandai saat restock.", "Select a role or user to mention in the restock notice.", "@Restock"],
    amount: ["Jumlah unit", "Number of units", "Masukkan jumlah item sebagai angka bulat.", "Enter the number of items as a whole number.", "2"],
    price: ["Harga per unit", "Unit price", "Masukkan harga dalam WL. Isi angka saja.", "Enter the price in WL as a number.", "25"],
    discount: ["Diskon persen", "Percentage discount", "Isi angka dari 1 sampai 100. Angka 10 berarti diskon 10%.", "Enter a number from 1 to 100. For example, 10 gives a 10% discount.", "10"],
    minqty: ["Jumlah minimum", "Minimum quantity", "Jumlah unit untuk tier diskon grosir ini. Saat menghapus tier, isi minimum yang sama dengan tier yang dibuat.", "The number of units for this bulk tier. When removing a tier, use the minimum that was set when it was created.", "5"],
    cut: ["Potongan per unit", "Discount per unit", "Masukkan potongan dalam WL. Nilainya harus lebih kecil dari harga per unit.", "Enter the discount in WL. It must be less than the unit price.", "2"],
    user: ["Pengguna Discord", "Discord user", "Pilih akun pelanggan dari daftar pengguna di Discord.", "Select the customer's account from Discord's user list.", "@Pelanggan"],
    balance: ["Nominal saldo", "Balance amount", "Masukkan jumlah WL yang ingin ditambah atau dikurangi.", "Enter the amount of WL to add or subtract.", "100"],
    world: ["World deposit", "Deposit world", "Masukkan nama world Growtopia untuk menerima deposit.", "Enter the Growtopia world that receives deposits.", "TOKODEPO"],
    owner: ["Pemilik world", "World owner", "Masukkan nama atau GrowID pemilik world deposit.", "Enter the name or GrowID of the deposit world owner.", "GrowOwner"],
    botname: ["Nama bot deposit", "Deposit bot name", "Masukkan nama bot Growtopia yang menerima deposit di world.", "Enter the name of the Growtopia bot that accepts deposits in the world.", "BotDepo"],
    testimoni: ["Channel testimoni", "Testimonial channel", "Pilih channel Discord untuk catatan pembelian.", "Choose the Discord channel for purchase testimonials.", "#testimoni"],
    donationlog: ["Channel log donasi", "Donation log channel", "Pilih channel Discord untuk catatan donasi atau deposit world.", "Choose the Discord channel for donation or world deposit logs.", "#donation-log"],
    image: ["Gambar QRIS", "QRIS image", "Unggah gambar QRIS statis untuk deposit manual.", "Upload a static QRIS image for manual deposits.", "qris.png"],
    harga: ["Kurs rupiah per WL", "Rupiah per WL", "Isi nilai rupiah untuk 1 WL. Misalnya 9 berarti Rp9 per WL.", "Enter the rupiah value of 1 WL. For example, 9 means Rp9 per WL.", "9"],
    status: ["Status kurs live", "Live rate status", "Pilih Nyala untuk kurs live atau Mati untuk kurs manual dari /setwlprice.", "Choose On for the live rate or Off for the manual rate from /setwlprice.", "on"],
    channel: ["Channel Discord", "Discord channel", "Pilih channel dari daftar Discord.", "Select a channel from Discord's list.", "#stok-toko"],
    delay: ["Jeda pembaruan", "Update interval", "Masukkan jeda antara pembaruan stok dalam detik.", "Enter the number of seconds between stock updates.", "60"],
};

function commandGuide() {
    const results = h("div", { class: "guide-sections" });
    const count = h("span", { class: "mut", "aria-live": "polite" });
    const searchLabel = guideText("Cari command atau fungsi", "Search commands or descriptions");
    const search = h("input", { type: "search", placeholder: searchLabel, "aria-label": searchLabel });
    const fieldFor = (command, key) => commandFields[command === "addproduct" && key === "code" ? "newcode" : key];
    const optionList = options => options ? options.split(" ").map(option => ({
        key: option.replace(/\?$/, ""), optional: option.endsWith("?"),
    })) : [];
    function commandCard([name, options, id, en]) {
        const fields = optionList(options);
        const details = fields.length ? h("details", { class: "guide-details" },
            h("summary", {}, guideText("Arti kolom & contoh", "Field help & examples")),
            h("dl", { class: "guide-options" }, ...fields.map(({ key, optional }) => {
                const [label, labelEn, description, descriptionEn, example] = fieldFor(name, key);
                return h("div", {},
                    h("dt", {}, h("strong", {}, guideText(label, labelEn)), h("code", {}, key),
                        h("span", { class: "guide-option-status" }, optional ? guideText("Opsional", "Optional") : guideText("Wajib", "Required"))),
                    h("dd", {}, guideText(description, descriptionEn),
                        h("small", { class: "mut" }, guideText("Contoh", "Example"), " ", h("code", {}, example))));
            }))) : h("span", { class: "mut guide-no-options" }, guideText("Bisa langsung dijalankan.", "Run without filling in any fields."));
        const copyLabel = guideText("Salin command", "Copy command");
        return h("article", { class: "guide-card" },
            h("div", { class: "guide-card-heading" },
                h("div", { class: "guide-signature" }, h("h3", {}, h("code", { class: "guide-command" }, "/" + name)),
                    ...fields.map(({ key, optional }) => h("code", { class: "guide-chip", title: optional ? guideText("Opsional", "Optional") : guideText("Wajib", "Required") },
                        optional ? "[" + key + "]" : "<" + key + ">"))),
                h("span", { class: "pill" }, ["help", "leaderboard"].includes(name) ? guideText("Semua pengguna", "Everyone") : "Admin")),
            h("p", { class: "guide-description" }, guideText(id, en)),
            h("div", { class: "guide-card-actions" }, details,
                h("button", { type: "button", class: "sm", "aria-label": copyLabel + " /" + name, onclick: () => copyText("/" + name) }, copyLabel)));
    }
    function renderCommands() {
        const query = search.value.trim().toLowerCase().replace(/^\//, "");
        const matches = new Map(commandDocs.filter(([name, options, id, en]) => {
            const fieldText = optionList(options).flatMap(({ key }) => fieldFor(name, key));
            return [name, options, id, en, ...fieldText].join(" ").toLowerCase().includes(query);
        }).map(command => [command[0], command]));
        count.textContent = guideText(`${matches.size} command`, `${matches.size} ${matches.size === 1 ? "command" : "commands"}`);
        const sections = commandCategories.flatMap(([id, en, icon, names]) => {
            const commands = names.filter(name => matches.has(name));
            if (!commands.length) return [];
            return h("section", { class: "card guide-section" },
                h("h2", {}, navIcon(icon), guideText(id, en)),
                h("div", { class: "guide-grid" }, ...commands.map(name => commandCard(matches.get(name)))));
        });
        results.replaceChildren(...sections);
        if (!sections.length) results.append(card(h("p", { class: "mut" }, guideText("Command tidak ditemukan.", "No commands found."))));
    }
    search.addEventListener("input", renderCommands);
    renderCommands();
    return h("div", { class: "guide-page" },
        card(h("div", { class: "guide-intro" },
            head("Slash Command List", guideText("Cari command berdasarkan fungsi, lalu buka contoh untuk melihat cara mengisi kolomnya di Discord.", "Find a command by function, then open its examples to see how to fill in the fields in Discord.")),
            h("div", { class: "row sp gap guide-toolbar" }, search, count),
            h("p", { class: "guide-access mut" },
                h("code", {}, guideText("<wajib>", "<required>")), " ", h("code", {}, guideText("[opsional]", "[optional]")), " · ",
                guideText("Command Admin tersedia untuk Owner dan Admin bot.", "Admin commands are available to the bot owner and bot admins.")))),
        results);
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
