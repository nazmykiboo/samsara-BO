# Runbook Deploy Production — Samsara Backoffice

Status per 2026-11-18 (dicek ulang langsung lewat SSH sungguhan ke VPS, bukan
disalin dari versi dokumen sebelumnya). **App sudah LIVE, dipakai owner
sungguhan, dan sudah melewati Deploy #8** — lihat § "Deploy #8" di bawah.

## Deploy #8: Tombol Terima Telegram untuk owner (akuiPermintaan, approval opname nyata), keyboard 1 baris 1 tombol (2026-11-18)

1 migrasi baru (`inventory/0035_tambah_pengakuan_permintaan_transfer`),
container `api`/`web` di-rebuild & restart (n8n/Postgres/VNC **tidak
disentuh sama sekali**).

**Pemicu**: owner melaporkan tombol "Terima" di Telegram merespons
(audit log tercatat) tapi tidak mengubah apa pun di app -- permintaan ke
CK tetap "menunggu dipenuhi" terus. Owner klarifikasi: untuk sementara CK
belum ada tim, jadi khusus role **owner**, "Terima" harus benar-benar
berefek (permintaan_baru_ck -> tanda "diakui", opname_menunggu_persetujuan
-> approval sungguhan via `decideOpname('setuju')`); role lain TETAP
acknowledgment generik seperti semula. Sekaligus keyboard Telegram diubah
jadi 1 baris 1 tombol (termasuk tiap alasan preset Tolak).

**Metodologi** (sama persis Deploy #2-7): `pg_dump` production → restore
ke `samsara_prod_rehearsal` lokal → migrasi dijalankan → 63 tabel lama
identik jumlah barisnya (cuma `schema_migrations` +1, TIDAK ada tabel
baru -- migrasi cuma tambah 2 kolom) → migrasi dites idempoten → database
lokal dihapus → commit → `rsync` (exclude `.env`/`.env.production`, TANPA
`--delete`) → `docker compose build` → restart HANYA `api`+`web`.

**Catatan penting**: `.env.production` di VPS TERNYATA sudah diisi owner
sendiri sejak 2026-11-17 17:52 (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET`,
dikonfirmasi lewat ukuran file berubah 840→1007 byte DAN webhook sekarang
membalas `"Secret token tidak valid"` alih-alih 503 "belum dikonfigurasi") --
sesuai instruksi di § "Setup Manual" di bawah, dikerjakan owner sendiri,
Claude Code TIDAK PERNAH membaca/menulis nilainya.

**Smoke test production**: `/health` OK (3 modul aktif), login kredensial
sengaja salah 401, `GET /api/notifikasi/aturan` tanpa token 401, webhook
Telegram tanpa secret header membalas `{"error":"Secret token tidak
valid"}` (bukan lagi 503 -- konfirmasi secret SUDAH terisi), kolom
`diakui_pada`/`diakui_oleh` dikonfirmasi ada lewat `\d
inventory_permintaan_transfer` di production.

Backup pra-deploy diverifikasi (`gzip -t` valid, permission 600, ukuran
2.6MB wajar) sebelum migrasi dijalankan, tersimpan sebagai
`samsara_pre-deploy-terima-owner_2026-11-18_132043.sql.gz` di VPS. RAM
VPS dicek dulu (782MB available + 977MB swap bebas) -- cukup. Tidak ada
kredensial yang terbaca/tertulis ke chat/log/git sepanjang proses.

## Deploy #7: Modul Notifikasi Telegram di core (aturan, log dedup, token aksi, webhook, scheduler) (2026-11-17)

3 migrasi baru di `core` (`0014_add_telegram_dan_source_audit`,
`0015_create_notifikasi_aturan_log_token`, `0016_add_alasan_preset_tolak_token_aksi`),
container `api`/`web` di-rebuild & restart (n8n/Postgres/VNC **tidak
disentuh sama sekali** — uptime tetap "Up 4 weeks"/"Up 6 hari"/"Up 11 hari"
sebelum & sesudah, dicek eksplisit).

**Metodologi** (sama persis Deploy #2-6): `pg_dump` production → restore ke
`samsara_prod_rehearsal` lokal → migrasi dijalankan ke salinan itu → 58
tabel lama dibandingkan jumlah barisnya sebelum/sesudah (**identik**, cuma
3 tabel BARU kosong + `schema_migrations` +3) → migrasi dites idempoten
(jalan ke-2 tidak melakukan apa-apa) → database lokal dihapus → commit lokal
→ BARU dicoba ke production sungguhan via `rsync` (`--exclude '.env'
--exclude '.env.production'`, TANPA `--delete`) → `docker compose build`
→ restart HANYA `api`+`web`.

**Pengecekan pra-deploy khusus fitur ini**: tidak ada migrasi/seed yang
mengisi `core_notifikasi_aturan` dengan baris apa pun — tabel itu kosong
0 baris begitu dibuat, jadi "semua aturan default nonaktif" terpenuhi
secara struktural (tidak ada aturan sama sekali, apalagi yang aktif).
Dicek juga di database dev lokal (0 baris) sebelum deploy.

**Smoke test production**: HTTPS valid, `/health` OK (3 modul aktif), `GET
/api/core/lokasi` publik normal, 2 endpoint BARU (`GET
/api/notifikasi/aturan`, `GET /api/notifikasi/telegram/status`) membalas
401 tanpa token (ter-mount & ter-gate dengan benar), webhook BARU (`POST
/api/telegram/webhook`) membalas **503** tanpa `TELEGRAM_WEBHOOK_SECRET`
terisi (perilaku yang DIHARAPKAN — lihat § "Setup Manual" di bawah, belum
dikonfigurasi owner), `POST /api/auth/login` dengan kredensial SENGAJA
SALAH membalas 401 (endpoint auth jalan normal, TANPA pernah menyentuh
kredensial asli siapa pun). Baris 3 tabel baru dicek langsung di production
lewat `psql` read-only: `core_notifikasi_aturan`/`_log`/`_token_aksi`
ketiganya 0 baris (sesuai ekspektasi, belum ada aturan dibuat owner).

Backup pra-deploy diverifikasi dulu (permission 600, `gzip -t` valid, ukuran
2.5MB wajar dibanding backup harian) SEBELUM migrasi dijalankan — tersimpan
di
`/root/samsara-backups/samsara_pre-deploy-notifikasi-telegram-final_2026-11-17_065945.sql.gz`
di VPS, ikut rotasi retensi 7 hari otomatis seperti backup harian lainnya.
RAM VPS dicek sebelum deploy (832MB available + 1.2GB swap bebas dari 2GB) —
cukup untuk build image (build sukses tanpa OOM, seperti deploy-deploy
sebelumnya). Tidak ada kredensial apa pun (termasuk `TELEGRAM_BOT_TOKEN`/
`TELEGRAM_WEBHOOK_SECRET`, yang memang belum diisi) yang pernah
terbaca/tertulis ke chat/log/git sepanjang proses.

**Catatan penting (BUKAN bagian migrasi/kode)**: `TELEGRAM_BOT_TOKEN` dan
`TELEGRAM_WEBHOOK_SECRET` **belum diisi di production** — ini LANGKAH
MANUAL owner, lihat § "Setup Manual: Notifikasi Telegram" di bawah. Sampai
langkah itu dikerjakan, modul notifikasi tetap berjalan normal (aturan bisa
dibuat, event tetap tercatat di `core_notifikasi_log`), cuma pengiriman ke
Telegram akan gagal dengan status `'gagal'`/`'ditunda'` di log, tidak
mengganggu fitur lain.

## Setup Manual: Notifikasi Telegram (TELEGRAM_BOT_TOKEN & webhook)

**WAJIB dikerjakan OWNER/OPERATOR sendiri lewat SSH ke VPS — Claude Code
TIDAK PERNAH membaca atau menulis nilai `TELEGRAM_BOT_TOKEN` maupun
`TELEGRAM_WEBHOOK_SECRET` (instruksi keras, lihat `CLAUDE.md` dan
`core/src/notifikasi/telegram.ts`).** Tanpa langkah ini, modul notifikasi
(Deploy #7) tetap jalan normal — cuma SETIAP pengiriman ke Telegram akan
gagal dengan pesan jelas di log server, tidak mengganggu fitur lain.

1. **Buat bot Telegram** (sekali saja, kalau belum ada): buka Telegram,
   chat ke `@BotFather`, kirim `/newbot`, ikuti instruksinya (nama +
   username bot, mis. `@BurnasOpsBot`). BotFather membalas dengan TOKEN
   bot (format `123456789:ABC-...`) — simpan sebentar, jangan ditempel ke
   chat Claude/log/git.

2. **SSH ke VPS**, lalu edit `.env.production` (tambahkan DUA baris baru
   di akhir file, ganti kedua nilai di bawah sebelum disimpan):
   ```
   ssh root@<alamat-vps>
   cd /root/samsara-backoffice
   nano .env.production
   ```
   Tambahkan:
   ```
   TELEGRAM_BOT_TOKEN=<token dari BotFather langkah 1>
   TELEGRAM_WEBHOOK_SECRET=<string acak panjang buatan sendiri>
   ```
   Untuk membuat string acak secret webhook, jalankan di VPS (hasilnya
   TIDAK perlu dirahasiakan dari diri sendiri, cukup jangan dibagikan ke
   luar): `openssl rand -hex 32`

3. **Restart HANYA container `api`** supaya `.env.production` yang baru
   terbaca (`docker restart` saja TIDAK cukup — env file cuma dibaca ulang
   oleh `up`, bukan `restart`):
   ```
   cd /root/samsara-backoffice
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-deps api
   ```
   Container `web`, `n8n-stack-n8n-1`, `n8n-stack-postgres-1`, dan
   `burnas-desktop` TIDAK ikut tersentuh oleh perintah ini (`--no-deps`
   + nama service spesifik).

4. **Daftarkan webhook ke Telegram** — jalankan PERSIS seperti ini supaya
   token TIDAK PERNAH tertulis literal di layar/history shell (`source`
   membaca langsung dari file, nilainya cuma dipakai sebagai variabel):
   ```
   cd /root/samsara-backoffice
   set -a; source .env.production; set +a
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=https://burnas-app.duckdns.org/api/telegram/webhook" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
   ```
   Respons sukses: `{"ok":true,"result":true,"description":"Webhook was set"}`.
   Cek ulang statusnya kapan saja dengan:
   ```
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
   ```
   (field `url` harus menunjuk ke `https://burnas-app.duckdns.org/api/telegram/webhook`,
   `last_error_message` harus kosong).

5. **Uji dengan satu pesan percobaan** (end-to-end, bukan cuma cek API):
   - Buka aplikasi Backoffice di browser, login dengan akun apa pun, buka
     menu **Akun Saya**, tekan **Hubungkan Telegram** — muncul kode 6
     digit.
   - Buka Telegram, cari bot yang baru dibuat (langkah 1), kirim PERSIS
     SATU pesan: `/link <kode yang muncul>`.
   - Bot harus membalas konfirmasi ("Akun Telegram ini berhasil
     ditautkan...") dalam hitungan detik — itu berarti webhook sudah
     diterima dan diproses dengan benar ujung ke ujung.
   - Refresh halaman Akun Saya — status harus berubah jadi "Sudah
     terhubung".
   - Kalau TIDAK ada balasan sama sekali: cek `docker logs
     samsara-backoffice-api-1 --tail 50` untuk pesan error (biasanya
     `secret_token` di `setWebhook` tidak sama dengan
     `TELEGRAM_WEBHOOK_SECRET` di `.env.production`, atau container
     belum di-restart setelah env diisi).

Setelah langkah ini selesai, aktifkan aturan notifikasi yang diinginkan
lewat **Pengaturan > Notifikasi** (owner saja) — semua aturan baru dibuat
dalam keadaan AKTIF secara default kecuali dimatikan manual, jadi cukup
tambahkan aturan yang benar-benar diinginkan.

## Deploy #6: Mutasi Lain qty positif, kode otomatis, Kartu Stok & Riwayat Semua Jenis, Permintaan ke CK (timeline + Layar CK), perbaikan raw-majoo, kesegaran data (2026-11-14)

2 migrasi baru (`inventory/0033_tambah_kode_vendor_dan_kategori_item`,
`inventory/0034_permintaan_transfer_timeline_dan_kelompok`), container
`api`/`web` di-rebuild & restart (n8n/Postgres/VNC **tidak disentuh sama
sekali** — uptime tetap "Up 3 weeks"/"Up 3 days"/"Up 8 days" sebelum &
sesudah, dicek eksplisit).

**Metodologi** (sama persis Deploy #2-5): `pg_dump` production (lewat
`devops/backup-db.sh`, `docker exec` ke `n8n-stack-postgres-1`) → restore ke
database lokal terpisah (`samsara_prod_rehearsal`) → migrasi dijalankan ke
salinan itu → 62 tabel dibandingkan jumlah barisnya sebelum/sesudah
(**identik**, cuma `schema_migrations` +2 sesuai jumlah migrasi baru — TIDAK
ada tabel baru, kedua migrasi cuma menambah kolom) → migrasi dites idempoten
(jalan ke-2 tidak melakukan apa-apa) → database lokal dihapus → BARU dicoba
ke production sungguhan.

**rsync** (pola `--exclude '.env' --exclude '.env.production'` dari pelajaran
Deploy #4/#5 tetap dipakai) — dikonfirmasi SETELAH rsync `.env.production` di
VPS checksum-nya tidak berubah sama sekali, migrasi production langsung
berhasil tanpa error di percobaan pertama.

**Smoke test production**: HTTPS valid, `/health` OK (3 modul aktif), `GET
/api/core/lokasi` publik normal, 62 tabel (sama dengan rehearsal, tidak ada
tabel baru), 4 endpoint BARU (`GET /kartu-stok`, `GET /riwayat-transaksi`,
`GET .../permintaan-transfer/layar-ck`, `GET /sales-sync/kesegaran`) semua
membalas 401 tanpa token (ter-mount & ter-gate dengan benar), `POST
/api/auth/login` dengan kredensial SENGAJA SALAH membalas 401 dengan pesan
yang benar (endpoint auth jalan normal, TANPA pernah menyentuh kredensial
asli siapa pun). **Status fitur setelah deploy**: backfill data lama
diverifikasi 100% terisi (15/15 vendor dapat `kode` VN-xxx, 10/10 kategori
item dapat `kode` KT-xxx, 69/69 baris `inventory_permintaan_transfer` lama
dapat `kelompok_id` = id-nya sendiri), `otomatis_aktif` TETAP `true` (nilai
sebelum deploy, tidak disentuh — sesuai instruksi eksplisit owner untuk
deploy ini).

Backup pra-deploy diverifikasi dulu (permission 600, `gzip -t` valid, ukuran
2.4MB wajar dibanding backup harian) SEBELUM migrasi dijalankan — tersimpan
di
`/root/samsara-backups/samsara_pre-deploy-tahap1-permintaanck-kartustok_2026-11-14_091645.sql.gz`
di VPS, ikut rotasi retensi 7 hari otomatis seperti backup harian lainnya.
Tidak ada kredensial apa pun yang pernah terbaca/tertulis ke chat/log/git
sepanjang proses.

**Catatan penting raw-majoo (BUKAN bagian migrasi DB)**: perbaikan workflow
n8n (`devops/n8n/raw-majoo-direct.json`) menghapus total pola static-data
yang terbukti jadi akar masalah pipeline mati 16+ hari — perbaikan ini
HANYA mengedit file JSON definisi workflow di repo, **TIDAK PERNAH**
menyentuh instance n8n yang live di VPS. **Owner/operator perlu
mengimpor ulang file ini secara manual lewat editor n8n** (langkah
lengkap: `devops/n8n/README.md` § 15) — belum otomatis ter-deploy lewat
rsync/docker seperti kode aplikasi, karena workflow n8n dikelola terpisah
dari deployment app ini.

## Deploy #5: Refund Majoo berdiri sendiri + tampilan refund (2026-11-07)

1 migrasi baru (`sales-sync/0004_tabel_refund_majoo`) berhasil dijalankan ke
production, container `api`/`web` di-rebuild & restart (n8n/Postgres/VNC
**tidak disentuh sama sekali** — uptime tetap "Up 2 weeks"/"Up 2 days"
sebelum & sesudah, dicek eksplisit).

**Metodologi** (sama persis Deploy #2-4): `pg_dump` production → restore ke
database lokal terpisah (`samsara_prod_rehearsal`) → migrasi dijalankan ke
salinan itu → 58 tabel lama dibandingkan jumlah barisnya sebelum/sesudah
(**identik**, cuma `schema_migrations` +1 dan tabel baru `salessync_majoo_refund`
muncul kosong — sesuai ekspektasi) → migrasi dites idempoten (jalan ke-2
tidak melakukan apa-apa) → database lokal dihapus → BARU dicoba ke
production sungguhan.

**Pelajaran dari insiden `.env` Deploy #4 diterapkan**: perintah `rsync`
kali ini eksplisit `--exclude '.env' --exclude '.env.production'` —
dikonfirmasi SETELAH rsync kedua file itu tidak ikut terkirim sama sekali
(bukan cuma "isinya sama", tapi memang tidak ada di daftar transfer), dan
migrasi production langsung berhasil tanpa error koneksi apa pun di
percobaan pertama (beda dari Deploy #4 yang sempat ada insiden <1 menit).

**Smoke test production**: HTTPS valid, `/health` OK (3 modul aktif),
`GET /api/core/lokasi` publik normal, 60 tabel di production (59 lama +
`salessync_majoo_refund` baru, 0 baris — belum ada backfill, sesuai
ekspektasi migrasi yang cuma membuat skema), `GET /api/sales-sync/refund`
tanpa token membalas 401 (endpoint baru ter-mount & ter-gate dengan benar).
**Status fitur setelah deploy**: `otomatis_aktif` TETAP `true` (nilai yang
sudah ada SEBELUM deploy ini, owner sendiri yang menyalakannya setelah
Deploy #3 — migrasi `0004` tidak menyentuh `salessync_settings` sama
sekali, dicek dan dikonfirmasi tidak berubah ke arah mana pun oleh deploy
ini).

Backup pra-deploy diverifikasi dulu (permission 600, `gzip -t` valid, ukuran
2.1MB wajar dibanding backup harian) SEBELUM migrasi dijalankan — tersimpan
di `/root/samsara-backups/samsara_pre-deploy-refund-majoo_2026-11-07_232227.sql.gz`
di VPS, ikut rotasi retensi 7 hari otomatis seperti backup harian lainnya.
Tidak ada kredensial apa pun yang pernah terbaca/tertulis ke chat/log/git
sepanjang proses.

**Tindak lanjut owner (di luar scope deploy ini)**: tabel
`salessync_majoo_refund` baru live tapi masih kosong — refund yang sudah
terjadi sebelum fitur ini (termasuk 2 transaksi pemicu diagnosis sesi ini,
`CS/29/261107/0011`/`CS/29/261107/0017`) perlu di-backfill manual lewat
`raw-majoo-direct.json` (prosedur lengkap: § 14 di README ini).

## Deploy #4: Tipe lokasi jadi sumber kebenaran CK, tutup kebocoran biaya, perbaiki silent-failure n8n (2026-11-01)

1 migrasi baru (`core/0013_tipe_lokasi_wajib`) berhasil dijalankan ke
production, container `api`/`web` di-rebuild & restart (n8n/Postgres/VNC
**tidak disentuh sama sekali** — uptime tetap "Up 13 days" sebelum & sesudah,
dicek eksplisit).

**Metodologi** (sama persis Deploy #2/#3): `pg_dump` production → restore ke
database lokal terpisah (`samsara_prod_rehearsal`) → migrasi dijalankan ke
salinan itu → 58 tabel lama dibandingkan jumlah barisnya sebelum/sesudah
(**identik**, cuma `schema_migrations` +1 sesuai ekspektasi) → migrasi dites
idempoten (jalan ke-2 tidak melakukan apa-apa) → database lokal dihapus →
BARU dicoba ke production sungguhan.

**Insiden kecil saat deploy (ditemukan & diperbaiki dalam <2 menit, TIDAK
ada data yang rusak)**: `rsync` tanpa exclude eksplisit untuk `.env` sempat
mengirim file `.env` LOKAL (dev, isi `DB_HOST=localhost` untuk Postgres
native di laptop) ke direktori project di VPS. Docker Compose otomatis
membaca file bernama persis `.env` di direktori project untuk substitusi
variabel (`${DB_HOST:-postgres}`) — **terpisah** dari `env_file:
.env.production` yang dipakai aplikasi — sehingga container `api` yang baru
di-recreate sempat gagal connect ke Postgres (`ECONNREFUSED localhost:5432`)
selama kurang dari semenit. Diperbaiki dengan menghapus file `.env` yang
tidak seharusnya ada itu di VPS (bukan bagian dari deploy yang dimaksud,
tidak pernah ada di project ini sebelumnya) dan recreate ulang container
`api` — kembali ke default `DB_HOST=postgres` yang benar. `.env.production`
(file application-level, isinya kredensial) **tidak pernah terbaca isinya**
sepanjang proses ini, cuma dibandingkan checksum SHA-256 sebelum/sesudah
(identik, tidak berubah). **Pelajaran untuk deploy berikutnya**: tambahkan
`--exclude .env` eksplisit di perintah `rsync` (di luar exclude yang sudah
ada untuk `node_modules`/`dist`/`.git`) supaya ini tidak terulang.

**Smoke test production**: HTTPS valid, `/health` OK (3 modul aktif),
`GET /api/core/lokasi` publik menampilkan ketiga lokasi dengan `entitas`
sudah derived benar dari `tipe` (`Samsara Central Kitchen`/`CK Sutami`
keduanya `entitas: "kitchen"`, `Burnas - Merjosari` `entitas: "outlet"`),
59 tabel di production (58 lama + `schema_migrations`, tidak ada tabel baru
dari migrasi ini — cuma `ALTER COLUMN`/`UPDATE`). **Status fitur setelah
deploy**: `otomatis_aktif = true` di production — **ini BUKAN diaktifkan
oleh deploy ini** (migrasi `0013` tidak menyentuh `salessync_settings` sama
sekali), dicek dan dikonfirmasi SUDAH `true` sebelum deploy dimulai —
owner sendiri yang menyalakannya lewat UI setelah Deploy #3, di luar scope
pekerjaan ini, TIDAK disentuh/diubah oleh deploy ini ke arah mana pun.

Backup pra-deploy diverifikasi dulu (permission 600, `gzip -t` valid, ukuran
1.9MB wajar dibanding backup harian) SEBELUM migrasi dijalankan — tersimpan
di `/root/samsara-backups/samsara_pre-deploy-tahap1_2026-11-01_135436.sql.gz`
di VPS, ikut rotasi retensi 7 hari otomatis seperti backup harian lainnya.
Tidak ada kredensial apa pun yang pernah terbaca/tertulis ke chat/log/git
sepanjang proses (termasuk insiden `.env` di atas — hanya checksum yang
dibandingkan, bukan isi).

## Deploy #3: Pemrosesan otomatis sales-sync, izin staf granular, rename item/menu/kategori, keamanan kredensial (2026-10-30)

4 migrasi baru lintas 3 modul (`core/0011-0012`, `inventory/0032`,
`sales-sync/0003`) berhasil dijalankan ke production, container `api`/`web`
di-rebuild & restart (n8n/Postgres/VNC **tidak disentuh sama sekali** --
uptime tetap "Up 11 hari"/"Up 12 hari" sebelum & sesudah, dicek eksplisit).

**Metodologi** (sama persis Deploy #2): `pg_dump` production → restore ke
database lokal terpisah (`samsara_prod_rehearsal`) → keempat migrasi
dijalankan ke salinan itu → 57 tabel lama dibandingkan jumlah barisnya
sebelum/sesudah (**identik**, cuma `core_roles` +1 dan `salessync_settings`
+1 sesuai yang memang diharapkan migrasi baru) → `npm run seed:sistem-otomatis`
dites 2x di salinan itu (**idempoten**, baris kedua tidak dibuat) → database
lokal dihapus → BARU dicoba ke production sungguhan.

**Smoke test production**: HTTPS valid, `/health` OK (3 modul aktif),
endpoint login merespons benar (dites dengan kredensial sengaja salah,
BUKAN kredensial sungguhan), `GET /api/core/lokasi` publik normal,
60 tabel di production (58 lama + 2 baru `salessync_otomatis_log`/
`salessync_import_log`, sesuai ekspektasi). **Status fitur setelah deploy
-- SESUAI RENCANA, bukan kecelakaan**: `otomatis_aktif = false` (default
migrasi, tidak pernah disentuh selama deploy ini), ketujuh user production
existing punya `wajib_ganti_kredensial = false` (kolom baru, default
`false`, tidak ada yang dipaksa ganti kredensial sebagai efek samping
deploy). `npm run seed:sistem-otomatis` dijalankan sekali di production
(idempoten, dites jalan ke-2 tidak membuat baris baru) -- identitas
`sistem-otomatis-sales-sync` SEKARANG ADA di production tapi tidak pernah
dipakai sampai owner menyalakan `otomatis_aktif` sendiri lewat UI.

Backup pra-deploy diverifikasi dulu (permission 600, `gzip -t` valid,
ukuran 1.9MB wajar dibanding backup harian) SEBELUM migrasi dijalankan --
tersimpan di `/root/samsara-backups/samsara_pre-deploy-DEF_2026-10-30_221356.sql.gz`
di VPS, ikut rotasi retensi 7 hari otomatis seperti backup harian lainnya.
Tidak ada kredensial apa pun yang pernah terbaca/tertulis ke chat/log/git
sepanjang proses.

## Deploy #2: Outlet & Kitchen, Identitas Bisnis, Vendor & Katalog, perbaikan bug lokasi-async (2026-10-26)

5 migrasi baru lintas 3 modul (`core/0010`, `inventory/0029-0031`,
`sales-sync/0002`) berhasil dijalankan ke production, container `api`/`web`
di-rebuild & restart (n8n/Postgres/VNC **tidak disentuh sama sekali** --
uptime tetap "Up 7 days" sebelum & sesudah, dicek eksplisit).

**Metodologi** (owner meminta latihan penuh dulu sebelum production
sungguhan, bukan langsung coba): `pg_dump` production → restore ke database
lokal terpisah (`samsara_prod_rehearsal`) → kelima migrasi diperiksa manual
satu per satu (tidak ada data uji dev yang ikut) → migrasi dijalankan ke
salinan itu → 21 tabel lama (user/transaksi/stok/harga/pemetaan) dibandingkan
jumlah barisnya sebelum/sesudah (**identik**) → HPP 58 menu dihitung ulang
lewat fungsi domain langsung (**0 selisih**) → database lokal dihapus → BARU
dicoba ke production sungguhan. Detail lengkap tiap langkah + rasionalnya:
`docs/architecture-decisions.md` § 31.

**Smoke test production**: HTTPS valid, `/health` OK (`inventory` versi
0.10.0), endpoint login merespons benar (dites dengan kredensial sengaja
salah, BUKAN kredensial sungguhan), **owner sendiri mengonfirmasi login
manajemen berhasil normal** di situs live, jumlah baris tabel lama identik
(`core_login_attempts` +1 dari smoke test login-salah itu sendiri, sesuai
ekspektasi), n8n/Postgres/VNC tidak terganggu. Tidak ada kredensial apa pun
(password database, password owner) yang pernah terbaca/tertulis ke
chat/log/git sepanjang proses -- password database hanya disentuh lewat
`source .env.production` langsung di shell remote SSH.

Backup pra-deploy (dijalankan manual lewat script cron yang sama,
`devops/backup-db.sh`) diverifikasi dulu (permission 600, `gzip -t` valid,
ukuran wajar) SEBELUM migrasi dijalankan -- tersimpan di
`/root/samsara-backups/samsara_2026-10-26_202550.sql.gz` di VPS, ikut
rotasi retensi 7 hari otomatis seperti backup harian lainnya.

## Sinkronisasi data master dev -> production (2026-10-17)

Item, menu, resep, harga per channel, pemetaan item sales-sync, dan
pengaturan sistem sekarang **identik** antara dev dan production — dibuktikan
lewat perhitungan HPP 70 menu/item langsung lewat fungsi domain (bukan lewat
login/API) di kedua sisi, **0 selisih**. Metodologi lengkap + isi 3 skrip
yang dijalankan: `devops/data-migrations/001-003-*.sql` (sudah ditandai
"SUDAH DIJALANKAN" di tiap file, disimpan sebagai arsip) dan
`docs/architecture-decisions.md` § 24.

**Sejak sinkronisasi ini, production adalah sumber kebenaran (source of
truth) untuk data master** — bukan dev lagi. Kalau dev dipakai eksperimen
lagi ke depan, perubahannya TIDAK otomatis masuk ke production — perlu
diulang metodologinya (perbandingan isi penuh + validasi di salinan
production dulu) kalau memang perlu sinkronisasi lagi, bukan diasumsikan
arahnya selalu dev->production.

Bug nyata juga ditemukan & diperbaiki dalam proses yang sama: label `Z` di
import `raw-majoo` (`modules/sales-sync/src/domain/import-csv.ts`) ternyata
SALAH — sebenarnya jam lokal Asia/Jakarta, bukan UTC asli (dikonfirmasi
lintas 5539 order sungguhan, 99.96% konsisten). Diperbaiki di kode (data
lama TIDAK ikut diubah), 278 test lulus, container `api` production
di-rebuild & restart (`web`/n8n/Postgres/VNC tidak disentuh sama sekali).

**Domain app: `burnas-app.duckdns.org`.** PENTING — jangan tertukar:
`burnas-ops.duckdns.org` adalah domain **n8n** yang sudah live sejak lama —
**bukan** domain app Samsara, dan **tidak boleh disentuh sama sekali**.

**Akses VPS**: `ssh samsara-vps` (alias di `~/.ssh/config`, kunci
`~/.ssh/samsara_vps`). Source code app ada di VPS: `/root/samsara-backoffice`
(dikirim lewat `rsync` dari laptop, BUKAN `git clone` di VPS — menghindari
urusan kredensial GitHub di server).

## Status per item — SEMUA SELESAI termasuk Langkah 7

Akun production sudah dibuat owner sendiri (`owner`, `n8n-integrasi`) DAN
owner sudah mulai memakai aplikasi sungguhan — menambah akun tim sendiri
lewat UI (`hisyam`/supervisor, `naura`/staf per 2026-10-17). App bukan cuma
live secara teknis, sudah benar-benar dipakai.

| # | Item | Status |
|---|------|--------|
| 1 | Push ke Git | ✅ Selesai |
| 2 | Dockerfile api + web | ✅ Di-build langsung di VPS, sukses |
| 3 | docker-compose.prod.yml | ✅ Disesuaikan ke temuan nyata (network `n8n-stack_default`, resource limit ketat: api 256M/web 64M) |
| 4 | Database `samsara` + role + password acak | ✅ Dibuat lewat `docker exec` ke `n8n-stack-postgres-1` (role superuser instance ternyata `n8n`, bukan `postgres` — lihat catatan di bawah) |
| 5 | Reverse proxy + domain + SSL | ✅ Server block baru di nginx host-level existing, sertifikat Let's Encrypt terbit (valid s.d. 2027-01-14) |
| 6 | Swap VPS 2GB | ✅ Sudah ada sejak awal, tidak perlu dipasang lagi |
| 7 | JWT secret production | ✅ Selesai, di `.env.production` |
| 8 | Backup otomatis (pg_dump harian) | ✅ Cron terpasang (jam 3 pagi), sudah dites manual sekali — file backup valid (32KB, 5239 baris, permission 600) |
| 9 | Migrasi ke database production | ✅ **Selesai, sekarang 51 file migrasi lintas 4 modul berhasil** (42 saat Deploy #1, +5 saat Deploy #2 2026-10-26, +4 saat Deploy #3 2026-10-30 — lihat § "Deploy #3"/"Deploy #2" di atas; bug migrasi yang ditemukan & diperbaiki saat Deploy #1 di bawah) |
| 10 | Monitoring dasar | ✅ Docker healthcheck aktif, keduanya `healthy` |
| 11 | Smoke test | ✅ HTTPS valid, `/health` OK, restart `api` sekali → naik lagi sendiri otomatis, n8n/Postgres/VNC tidak terganggu (uptime tidak reset) |
| 12 | Akun owner & integrasi production | ✅ **Selesai** — `owner` dan `n8n-integrasi` sudah dibuat owner sendiri (Langkah 7), owner juga sudah menambah akun tim sendiri (`hisyam`/supervisor, `naura`/staf) lewat UI |
| 13 | Sinkronisasi data master dev -> production | ✅ **Selesai** (2026-10-17) — lihat § "Sinkronisasi data master" di atas dan `docs/architecture-decisions.md` § 24 |

## Bug migrasi yang ditemukan & diperbaiki saat deploy ini (penting)

Percobaan pertama build gagal: container `api` crash-loop dengan error
migrasi `core/0006_move_locations_to_core.sql`: `relation "inventory_locations"
does not exist`. **Root cause**: migrasi itu menyalin data dari
`inventory_locations` (tabel modul Inventory) ke `core_locations`, ditulis
dengan asumsi tabel itu SUDAH ADA — benar untuk database dev yang sudah lama
berjalan (tabel sudah ada sejak lama), tapi SALAH untuk database production
yang benar-benar baru: `runMigrations()` (`core/src/db/migrate.ts`) selalu
menjalankan SEMUA migrasi core dulu sebelum migrasi modul manapun, jadi
migrasi ini jalan SEBELUM modul Inventory sempat membuat tabelnya sendiri.
Gap ini tidak pernah kelihatan di dev karena databasenya tidak pernah
benar-benar "fresh" sejak perubahan ini ditulis.

**Perbaikan** (dengan konfirmasi eksplisit owner, karena ini edit ke migrasi
yang sudah applied — biasanya dilarang keras di repo ini): baris penyalinan
data dibungkus `IF EXISTS (tabel inventory_locations)` — perilaku di database
manapun yang sudah menjalankan migrasi ini (termasuk dev) SAMA PERSIS seperti
sebelumnya (dikonfirmasi: `core/0006` sudah tercatat *applied* di dev,
sehingga tidak pernah dijalankan ulang di sana), cuma menambal skenario
database baru (tabelnya belum ada = memang tidak ada data lama yang perlu
disalin). **Diuji end-to-end** terhadap database lokal yang benar-benar baru
(`createdb` + jalankan `migrate.ts` dari nol) sebelum dicoba lagi ke
production — seluruh 42 file migrasi lintas core/inventory/hr/sales-sync
berhasil tanpa error. Detail lengkap: `docs/architecture-decisions.md` § 23.

## Catatan teknis lain dari deploy ini

- **Role superuser Postgres instance adalah `n8n`, bukan `postgres`** — container
  `n8n-stack-postgres-1` tidak punya role bernama `postgres` sama sekali.
  `CREATE ROLE samsara`/`CREATE DATABASE samsara` dijalankan via `-U n8n`.
- **RAM VPS sangat tipis** (available sempat 697MB, di bawah ambang aman 1GB)
  — owner mengonfirmasi eksplisit untuk lanjut deploy dengan resource limit
  sangat ketat. Hasil aktual setelah jalan: `api` pakai ~68MB dari limit
  256MB (26%), `web` ~2.6MB dari limit 64MB (4%) — jauh di bawah limit,
  build & runtime tidak sampai OOM.
- **Backup pengaman** (`pg_dumpall` SEBELUM deploy dimulai) tersimpan di
  `/root/samsara-pre-deploy-backup-20261016-182411.sql` (231MB, 70.504
  baris, permission 600) — jaring pengaman data n8n, belum perlu dipakai.
- Permission backup harian diperketat ke 700 (folder)/600 (file) — sebelumnya
  default 755/644, diperbaiki langsung di `devops/backup-db.sh`.

## Langkah 7 — SUDAH dijalankan: akun owner & integrasi production

**Selesai.** Owner sudah menjalankan sendiri kedua perintah di bawah (akun
`owner` dan `n8n-integrasi` sudah ada di production), dan sudah mulai
menambah akun tim lewat UI (`hisyam`/supervisor, `naura`/staf). Dicatat di
sini sebagai arsip/referensi perintahnya, bukan langkah yang masih perlu
dikerjakan:

```bash
ssh samsara-vps
cd /root/samsara-backoffice
docker compose -f docker-compose.prod.yml exec api sh -c 'read -p "Username owner: " U; read -s -p "Password owner: " P; echo; AUTH_SEED_OWNER_USERNAME="$U" AUTH_SEED_OWNER_PASSWORD="$P" node_modules/.bin/tsx apps/api/src/seed-owner.ts'
docker compose -f docker-compose.prod.yml exec api sh -c 'node_modules/.bin/tsx apps/api/src/seed-integrasi.ts'
```

Password `seed-integrasi` di-generate ACAK otomatis oleh script, tampil
SEKALI di output — catat manual saat itu juga (lihat `docs/integrasi-n8n.md`).

## Yang SENGAJA tidak disentuh (terverifikasi tidak terganggu di sepanjang deploy ini)

- Container `n8n-stack-n8n-1`, `n8n-stack-postgres-1` (instance-nya sendiri,
  bukan database `samsara` di dalamnya), dan `burnas-desktop` (VNC) — tidak
  pernah di-stop/restart (uptime-nya terus naik sepanjang deploy, dicek
  berkali-kali), kecuali operasi baca (`pg_dumpall`/`pg_dump`) yang tidak
  mengganggu operasinya.
- Domain `burnas-ops.duckdns.org` dan konfigurasi nginx/Certbot yang sudah
  melayaninya — tidak diubah, cuma ditambah server block BARU terpisah
  untuk `burnas-app.duckdns.org`.
- Tidak ada instance Postgres baru dibuat — `samsara` adalah database BARU
  di dalam instance yang sudah jalan (`n8n-stack-postgres-1`).
- Port Postgres (`127.0.0.1:5432`) tidak diubah bindingnya — tetap tidak publik.
