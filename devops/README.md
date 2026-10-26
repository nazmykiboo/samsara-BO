# Runbook Deploy Production — Samsara Backoffice

Status per 2026-10-26 (dicek ulang langsung lewat SSH sungguhan ke VPS, bukan
disalin dari versi dokumen sebelumnya). **App sudah LIVE, dipakai owner
sungguhan, dan sudah melewati Deploy #2** — lihat § "Deploy #2" di bawah.

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
| 9 | Migrasi ke database production | ✅ **Selesai, sekarang 47 file migrasi lintas 4 modul berhasil** (42 saat Deploy #1, +5 saat Deploy #2 2026-10-26 — lihat § "Deploy #2" di atas; bug migrasi yang ditemukan & diperbaiki saat Deploy #1 di bawah) |
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
