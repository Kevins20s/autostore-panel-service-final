# AutoStore Panel

Web dashboard untuk menjual bot toko AutoStore dengan sistem key. Satu server menjalankan satu bot per pembeli.

**Kamu (penjual)**: buka `/admin.html`, buat key (nama pembeli + durasi hari), kirim key ke pembeli.
Key habis atau dicabut = bot pembeli otomatis mati. Diperpanjang atau diaktifkan lagi = bot hidup lagi sendiri.

**Pembeli**: buka web, masuk dengan key, lalu:
- **Bot & Server**: isi token bot, Client ID, MongoDB URL, Owner ID, payment gateway. Tekan Start.
- **Products**: tambah produk, atur harga (WL, otomatis tampil DL dan Rp), diskon, bulk discount, kelola stok.
- **Users**: lihat user, tambah atau kurangi saldo.
- **Settings**: mode maintenance, kurs WL, harga live.
- **Dashboard, Tutorial Setup, Subscription**.
- Orders: belum ada (bot belum mencatat riwayat order).

Data toko (produk, stok, saldo) ada di MongoDB milik pembeli sendiri. Panel hanya menyimpan key dan pengaturan (terenkripsi).

## Jalankan (laptop / VPS)
Butuh Node.js 20.6 atau lebih baru.

    npm run setup                 # install panel + bot
    cp .env.example .env          # (Windows: copy .env.example .env) lalu isi MASTER_KEY dan ADMIN_PASSWORD
    npm start                     # pembeli: http://localhost:8080   kamu: http://localhost:8080/admin.html

## Di VPS
1. Pasang Node 22 dan pm2, jalankan panel: `pm2 start npm --name panel -- start`, lalu `pm2 save`.
2. Pasang nginx + HTTPS (certbot) yang meneruskan domain ke port 8080.
3. Di `.env` isi juga `PUBLIC_URL`, `COOKIE_SECURE=1`, `TRUST_PROXY=1`.
4. Firewall: buka hanya 80/443. **Port 4000 ke atas jangan dibuka** (port internal tiap bot).
5. Backup `data.json` dan simpan `MASTER_KEY` di tempat aman. Kalau MASTER_KEY hilang, token pembeli tidak bisa dibuka lagi.
6. Pembeli harus mengizinkan IP VPS kamu di MongoDB Atlas (Network Access).

## Di Railway
1. Upload project ke GitHub (privat), lalu di Railway: New Project, Deploy from GitHub repo. Build dan start sudah diatur di `railway.json`.
2. **Pasang Volume**: klik service, tab Settings atau klik kanan canvas, tambah Volume dengan mount path `/data`. Tanpa Volume, data hilang setiap deploy ulang.
3. Di tab Variables isi:
   - `MASTER_KEY` (buat dengan `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, simpan di catatan pribadi)
   - `ADMIN_PASSWORD` (minimal 8 karakter)
   - `DATA_FILE=/data/data.json`
   - `PANEL_HOST=0.0.0.0`
   - `COOKIE_SECURE=1` dan `TRUST_PROXY=1`
   - `PUBLIC_URL=https://<domain-railway-kamu>` (isi setelah Generate Domain di Settings, Networking)
   - `BACKUP_WEBHOOK_URL` (lihat di bawah)
4. Settings, Networking, Generate Domain. Buka `https://<domain>/admin.html`.

## Backup otomatis ke Discord
- Buat channel privat di Discord, Edit Channel, Integrations, Webhooks, New Webhook, Copy Webhook URL, tempel ke `BACKUP_WEBHOOK_URL`.
- `data.json` dikirim tiap 12 jam (atur lewat `BACKUP_EVERY_HOURS`) dan 15 detik setelah server menyala. Tombol "Kirim ke Discord sekarang" ada di `/admin.html`.
- Setelah menjual key baru, tekan tombol kirim manual supaya langsung aman.
- Pindah server: deploy, pasang variabel yang sama (termasuk `MASTER_KEY`), lalu di `/admin.html` pilih Restore dari file dengan backup terbaru.
- `MASTER_KEY` tidak ikut terkirim. Tanpa key itu backup tidak bisa dibuka.

## Webhook payment
Tiap pembeli melihat URL webhook miliknya di menu Bot & Server (`https://domainmu/hook/<id>`) dan mengisinya di payment gateway masing-masing.

## Tes
    npm test            # alur key, bot, webhook (tanpa database)
    SHOP_TEST_MONGO=mongodb://127.0.0.1:27017/shoptest npm run test:shop   # API toko, butuh Mongo
    npm i --no-save jsdom && SHOP_TEST_MONGO=... npm run test:ui           # tampilan, butuh Mongo + jsdom
Tes yang butuh Mongo otomatis dilewati kalau Mongo tidak tersedia.

## Catatan
- `bot/` adalah AutoStore yang membaca config dari environment variable. Fitur jasa sudah dihapus, fokus jual produk.
- Penyimpanan panel berupa file JSON, cukup untuk puluhan pembeli. Kalau sudah ratusan, pindah ke SQLite/Postgres.
- Perubahan lewat web hanya menulis ke database. Efek di Discord yang dikerjakan bot (notifikasi restock, refresh pesan stok realtime) belum dipicu dari web.
