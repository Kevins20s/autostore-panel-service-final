# AutoStore Service

Modul AutoStore Service terintegrasi dengan panel utama. Buyer dengan license bertipe `service` mendapatkan bot Service terpisah, sedangkan license `autostore` tetap memakai bot AutoStore lama.

## Fitur Service
- PLANT, HARVEST, HARVEST MOVE, MOVE, PROVIDER, SPLICE
- OPEN/CLOSE dan harga jasa dalam WL
- Harga MOVE per 200 item
- Kode promo/diskon
- Queue order dan nomor order otomatis
- Owner: Take Order, Complete, Cancel & Refund
- Notifikasi DM
- Statistik completed
- Auto-refresh panel 30 detik
- Kurs WL live dari gtid.pro dengan fallback manual
- Set GrowID untuk kebutuhan order

## Command Discord
- `/setjasapanel`
- `/setjasaharga`
- `/setjasapromo`

## Konfigurasi
Jangan isi token/password di `src/config/config.json`. Saat dijalankan oleh panel, konfigurasi diambil dari environment:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `MONGO_URL`
- `OWNER_ID`
- `ADMIN_IDS`
- `GUILD_ID`

Panel menyimpan konfigurasi license dalam bentuk terenkripsi dan Runner meneruskannya ke proses Service hanya saat bot dijalankan.

## Database
Service memakai MongoDB dari license tersebut. Collection `Bal` tetap dapat dipakai bersama AutoStore jika kedua license menggunakan MongoDB yang sama.
