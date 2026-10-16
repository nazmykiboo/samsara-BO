# Runbook Deploy Production — Samsara Backoffice

Status per 2026-10-17 (dicek ulang langsung lewat SSH sungguhan ke VPS, bukan
disalin dari versi dokumen sebelumnya). Dokumen ini adalah checklist persis apa
yang sudah/belum, supaya siapa pun (owner sendiri, atau sesi Claude Code
berikutnya) bisa lanjut tanpa mengulang dari nol.

**Domain app: `burnas-app.duckdns.org`.** PENTING — jangan tertukar:
`burnas-ops.duckdns.org` adalah domain **n8n** yang SUDAH LIVE di production
(reverse-proxy ke port 5678 lewat nginx host-level + Certbot, SSL valid sejak
16 September 2026) — **bukan** domain app Samsara, dan **tidak boleh disentuh
sama sekali**. Ini koreksi dari draft sebelumnya yang sempat salah mencatat
`burnas-ops.duckdns.org` sebagai domain app — kesalahan itu ditemukan saat
diagnostik Tahap A langsung ke VPS (lihat bawah), bukan sekadar typo di dokumen.

**Akses VPS: sudah berfungsi** lewat alias `ssh samsara-vps` (dikonfigurasi di
`~/.ssh/config`, kunci `~/.ssh/samsara_vps`). Percobaan sebelumnya pakai
`ssh -i ... root@202.155.13.91` manual sempat gagal "Permission denied" — alias
ini yang terbukti jalan.

## Temuan nyata dari Tahap A (diagnostik baca-saja, sudah dijalankan)

Container yang jalan di VPS sekarang (`docker ps`):

| Container | Image | Port |
|---|---|---|
| `n8n-stack-n8n-1` | `n8nio/n8n:latest` | `0.0.0.0:5678->5678` |
| `n8n-stack-postgres-1` | `postgres:16` | `127.0.0.1:5432->5432` (**sudah tidak publik**, sesuai aturan) |
| `burnas-desktop` | `dorowu/ubuntu-desktop-lxde-vnc` | `0.0.0.0:6080->80` |

- Nama container Postgres **sungguhan**: `n8n-stack-postgres-1` (BUKAN `postgres` seperti asumsi draft awal). Network Docker-nya: `n8n-stack_default`, dengan alias DNS internal `postgres` dan `n8n-stack-postgres-1`.
- **RAM bebas sangat tipis**: ~347MB free / 929MB available dari total 3.8GB. Container app Samsara HARUS dibatasi resource sangat ketat (lebih kecil dari asumsi awal di `docker-compose.prod.yml`).
- **Swap 2GB sudah ada dan aktif** (`/swapfile`) — Langkah "pasang swap" di bawah tidak perlu diulang.
- Disk bebas 52GB — aman.
- **Port 80 dan 443 sudah dipakai `nginx` HOST-LEVEL (systemd, bukan Docker)**, dikelola Certbot, melayani `burnas-ops.duckdns.org` → n8n (port 5678). **Nginx Proxy Manager BELUM terpasang** (port 81 kosong) dan rencananya diganti: numpang di nginx host-level yang sudah ada (tambah server block baru untuk `burnas-app.duckdns.org`), bukan pasang NPM terpisah — supaya tidak rebutan port 80/443 dan tidak berisiko mengganggu konfigurasi n8n yang sudah jalan.

## Status per item

| # | Item | Status | Catatan |
|---|------|--------|---------|
| 1 | Push ke Git | ✅ **Selesai** | Tiga commit terkonfirmasi ada di `origin/master`. Repo: `https://github.com/nazmykiboo/samsara-BO.git`. |
| 2 | Dockerfile api + web | ✅ Ditulis, ⚠️ **belum di-build** | `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/nginx.conf`. Belum pernah `docker build` sungguhan (Docker tidak terpasang di mesin dev ini) — akan di-build langsung di VPS saat Tahap B. |
| 3 | docker-compose.prod.yml | ⚠️ **perlu disesuaikan ke temuan nyata** | Nama network placeholder `vps_default` harus diganti ke `n8n-stack_default` (temuan Tahap A di atas), `DB_HOST` disesuaikan ke `n8n-stack-postgres-1` atau alias `postgres`, dan resource limit diperketat mengikuti RAM VPS yang tipis. |
| 4 | Database `samsara` baru + password proper | ⚠️ **Password sudah di-generate, database BELUM dibuat** | Password ada di `.env.production` (`DB_PASSWORD`). `CREATE DATABASE`/`CREATE ROLE` lewat `docker exec` ke `n8n-stack-postgres-1` (BUKAN lewat jaringan) — Tahap B. |
| 5 | Reverse proxy + domain + SSL | ✅ **Routing & SSL selesai**, 🛑 app belum di-deploy | Server block baru `/etc/nginx/sites-available/burnas-app` dibuat (disalin dari pola `burnas-ops`, proxy ke `127.0.0.1:8080`), diaktifkan via symlink di `sites-enabled`, `nginx -t` lolos, `systemctl reload nginx` (bukan restart). Sertifikat Certbot `burnas-app.duckdns.org` sukses diterbitkan & auto-deployed ke config (valid s.d. 2027-01-14, auto-renew terdaftar). Backup config lama sebelum perubahan: `/etc/nginx/sites-available.backup-20261016-142151`. Verifikasi sebelum & sesudah: `burnas-ops.duckdns.org` tetap HTTP 200 OK (serial sertifikat n8n tidak berubah) — **n8n tidak terganggu**. `burnas-app.duckdns.org` sekarang HTTPS valid tapi **502 Bad Gateway** (wajar, belum ada container app yang listen di port 8080 — itu pekerjaan deploy app, tugas terpisah). |
| 6 | Swap VPS 2GB | ✅ **Sudah ada** | Ditemukan sudah terpasang & aktif saat Tahap A (`/swapfile`, 2GB). Tidak perlu langkah tambahan. |
| 7 | JWT secret production | ✅ Selesai | Di-generate (`openssl rand -hex 32`), tersimpan di `.env.production` (`AUTH_JWT_SECRET`), beda dari `.env` dev. Terkonfirmasi masuk `.gitignore`. |
| 8 | Backup otomatis (pg_dump harian) | ✅ Script ditulis, 🛑 **belum dipasang cron-nya** | `devops/backup-db.sh` — perlu disesuaikan nama container ke `n8n-stack-postgres-1`. Instalasi cron: Langkah 6 di bawah. |
| 9 | Migrasi ke database production | 🛑 Belum jalan | Otomatis jalan tiap kali container `api` start (lihat `CMD` di `apps/api/Dockerfile`) — begitu compose di-`up` dengan database sudah dibuat (item 4), migrasi jalan sendiri (termasuk `0008_add_integrasi_role.sql` dan `0009_add_token_version_to_users.sql`). |
| 10 | Monitoring dasar | ✅ Docker healthcheck terpasang, saran eksternal didokumentasikan | `docker-compose.prod.yml` sudah punya `healthcheck` untuk service `api`. Uptime monitoring eksternal (opsional): `https://burnas-app.duckdns.org/health`, didaftarkan sendiri oleh owner kalau mau (saya tidak mendaftarkan akun pihak ketiga atas nama owner). |

**Ringkasan jujur**: akses VPS sekarang sudah berfungsi dan diagnostik Tahap A sudah dijalankan — tapi diagnostik itu sendiri menemukan 3 kondisi (RAM tipis, port 80/443 terpakai, domain app sebelumnya salah) yang mengubah rencana Langkah 1, 3, dan 5 di bawah dari asumsi draft awal. Langkah-langkah di bawah sudah diperbarui mengikuti temuan nyata ini.

## Langkah-langkah Tahap B (dikerjakan bertahap, bukan sekaligus tanpa jeda)

Jalankan lewat `ssh samsara-vps "<perintah>"`.

### Langkah 0 — DNS dulu
```bash
dig +short burnas-app.duckdns.org A
# harus keluar 202.155.13.91 -- kalau bukan, STOP, benahi DNS dulu di dashboard duckdns.org
# (field "current ip" untuk subdomain burnas-app harus diisi manual ke IP VPS,
# BUKAN dibiarkan auto-terisi IP perangkat yang mendaftarkan).
```

### Langkah 1 — Network & nama container Postgres (SUDAH diketahui dari Tahap A)
Container: `n8n-stack-postgres-1`, network: `n8n-stack_default`. Set di
`docker-compose.prod.yml` (`EXISTING_NETWORK_NAME=n8n-stack_default`) dan
`.env.production` (`DB_HOST=n8n-stack-postgres-1` atau alias `postgres`,
tergantung mana yang resolve dari network yang sama).

### Langkah 2 — Buat database `samsara` baru di instance Postgres existing
```bash
ssh samsara-vps "docker exec -it n8n-stack-postgres-1 psql -U postgres -c \"CREATE ROLE samsara LOGIN PASSWORD '<isi dari DB_PASSWORD di .env.production>';\""
ssh samsara-vps "docker exec -it n8n-stack-postgres-1 psql -U postgres -c \"CREATE DATABASE samsara OWNER samsara;\""
```
**PENTING**: pakai password ASLI dari `.env.production`, jangan buat password baru di langkah ini.

### Langkah 3 — Swap: SUDAH ADA, lewati langkah ini
Tahap A mengonfirmasi swap 2GB sudah terpasang dan aktif. Tidak perlu `fallocate`/`mkswap` lagi.

### Langkah 4 — Build & jalankan aplikasi (resource limit ketat, RAM VPS tipis)
```bash
# di VPS, setelah git clone/pull repo
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml ps
curl -s http://127.0.0.1:8080/health
```
Resource limit di `docker-compose.prod.yml` WAJIB dicek ulang/diperketat mengingat RAM bebas VPS cuma ~350MB — pertimbangkan turunkan limit `api`/`web` lebih kecil dari draft awal.

### Langkah 5 — Reverse proxy: tambah server block di nginx host-level existing (BUKAN Nginx Proxy Manager)
**✅ SUDAH DIKERJAKAN pada 2026-10-16.** Backup dibuat (`/etc/nginx/sites-available.backup-20261016-142151`),
server block baru `/etc/nginx/sites-available/burnas-app` ditambahkan (proxy ke
`127.0.0.1:8080`), `nginx -t` lolos, `systemctl reload nginx` (bukan restart),
Certbot menerbitkan sertifikat `burnas-app.duckdns.org` (valid s.d. 2027-01-14).
`burnas-ops.duckdns.org` dikonfirmasi tetap HTTP 200 OK sebelum & sesudah —
tidak terganggu. `burnas-app.duckdns.org` sekarang HTTPS valid tapi 502 Bad
Gateway (normal, port 8080 belum ada yang listen — menunggu deploy app di
tugas terpisah).

### Langkah 6 — Pasang cron backup harian
```bash
crontab -e
# tambahkan baris (jam 3 pagi WIB -- sesuaikan timezone server):
0 3 * * * DB_PASSWORD='<isi dari .env.production>' PG_CONTAINER='n8n-stack-postgres-1' /path/ke/samsara-backoffice/devops/backup-db.sh >> /var/log/samsara-backup.log 2>&1
```
Jalankan SEKALI secara manual dulu untuk memastikan file backup benar-benar terbentuk, baru percaya ke cron-nya.

### Langkah 7 — Buat akun owner & integrasi production
**JANGAN migrasikan user dari dev.** Akun Ibnu/Fitri/Naura/Duhan dibuat ULANG
lewat UI production nanti (bukan dari sini), supaya kredensial mereka baru dan
belum pernah terekspos di percakapan mana pun.
```bash
docker compose -f docker-compose.prod.yml exec api sh -c \
  "AUTH_SEED_OWNER_USERNAME=<username> AUTH_SEED_OWNER_PASSWORD=<password-baru-kuat> node_modules/.bin/tsx apps/api/src/seed-owner.ts"
docker compose -f docker-compose.prod.yml exec api sh -c \
  "node_modules/.bin/tsx apps/api/src/seed-integrasi.ts"
```
Password `seed-owner` dipilih sendiri saat itu juga (jangan pakai nilai dev manapun). Password `seed-integrasi` di-generate acak otomatis oleh script, ditampilkan SEKALI di output — catat manual, lihat `docs/integrasi-n8n.md`.

### Smoke test setelah semua langkah di atas
1. HTTPS `https://burnas-app.duckdns.org` — sertifikat valid (bukan warning browser).
2. `https://burnas-app.duckdns.org/health` — response OK.
3. Login sebagai owner production (hasil Langkah 7) — berhasil.
4. Restart container `api` SEKALI (`docker compose restart api`) — pastikan naik lagi sendiri (healthcheck jadi `healthy` lagi).
5. **`n8n`, Postgres (`n8n-stack-postgres-1`), dan VNC (`burnas-desktop`) masih `Up`/`healthy` seperti sebelum deploy** — `docker ps` dibandingkan dengan kondisi awal Tahap A. `burnas-ops.duckdns.org` (n8n) masih bisa diakses normal dari browser.

## Yang SENGAJA tidak disentuh

- Container `n8n-stack-n8n-1`, `n8n-stack-postgres-1` (instance-nya sendiri, bukan database `samsara` di dalamnya), dan `burnas-desktop` (VNC) — tidak di-stop/restart/diubah konfigurasinya sama sekali oleh langkah-langkah di dokumen ini, kecuali backup read-only (`pg_dumpall`/`pg_dump`) yang tidak mengganggu operasinya.
- Domain `burnas-ops.duckdns.org` dan konfigurasi nginx/Certbot yang sudah melayaninya — tidak diubah, cuma ditambah server block BARU yang terpisah untuk `burnas-app.duckdns.org`.
- Tidak ada instance Postgres baru dibuat — `samsara` adalah database BARU di dalam instance yang sudah jalan (`n8n-stack-postgres-1`).
- Port Postgres (`127.0.0.1:5432`) tidak diubah bindingnya — tetap tidak publik.
