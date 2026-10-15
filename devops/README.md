# Runbook Deploy Production — Samsara Backoffice

Status per [tanggal sesi ini]: **infra lokal (file) sudah disiapkan, eksekusi ke VPS
sungguhan BELUM jalan** — sesi Claude Code ini tidak punya akses jaringan ke GitHub
(push) maupun SSH ke VPS (diblokir permission classifier otomatis, bukan soal
kredensial salah). Dokumen ini adalah checklist persis apa yang sudah/belum, supaya
siapa pun (owner sendiri, atau sesi Claude Code berikutnya yang sudah dikasih akses)
bisa lanjut tanpa mengulang dari nol.

## Status per item

| # | Item | Status | Catatan |
|---|------|--------|---------|
| 1 | Push ke Git | ⚠️ **Commit lokal sudah ada, push BELUM jalan** | Diblokir permission classifier. Remote sudah diset: `https://github.com/nazmykiboo/samsara-BO.git`. Jalankan `git push -u origin master` dari terminal biasa (bukan lewat Claude Code auto mode), atau izinkan Bash network action di settings. |
| 2 | Dockerfile api + web | ✅ Ditulis | `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/nginx.conf`. **BELUM di-`docker build` sungguhan** — Docker tidak terpasang di mesin dev ini. Build & cek ukuran image begitu ada akses ke mesin yang punya Docker (VPS-nya sendiri, atau laptop lain). |
| 3 | docker-compose.prod.yml | ✅ Ditulis, ⚠️ **asumsi network belum dikonfirmasi** | Lihat komentar di file itu — nama network Docker existing (tempat container Postgres jalan) masih placeholder `vps_default`, HARUS dicocokkan setelah SSH ke VPS (lihat Langkah 1 di bawah). |
| 4 | Database `samsara` baru + password proper | ⚠️ **Password sudah di-generate, database BELUM dibuat** | Password ada di `.env.production` (`DB_PASSWORD`). `CREATE DATABASE`/`CREATE ROLE` di instance Postgres VPS belum dieksekusi — butuh SSH (Langkah 2). |
| 5 | Nginx Proxy Manager + domain + SSL | 🛑 **BLOCKED — domain belum resolve** | Owner pilih domain `vps.burnas-ops.id`, tapi domain ini **TIDAK resolve sama sekali** (NXDOMAIN, dicek 2x). `burnas-ops.duckdns.org` (alternatif yang sempat disebut) SUDAH resolve ke `202.155.13.91`. **Jangan minta sertifikat Let's Encrypt untuk domain yang belum resolve** — akan gagal dan bisa kena rate limit Let's Encrypt. Perbaiki DNS `vps.burnas-ops.id` dulu (A record ke `202.155.13.91`), atau putuskan pindah ke domain yang sudah jalan. |
| 6 | Swap VPS 2GB | 🛑 Belum dicek | Butuh SSH. Perintah ada di Langkah 3. |
| 7 | JWT secret production | ✅ Selesai | Di-generate (`openssl rand -hex 32`), tersimpan di `.env.production` (`AUTH_JWT_SECRET`), beda dari `.env` dev. Sudah dikonfirmasi `.env.production` masuk `.gitignore` (`git check-ignore` lulus). |
| 8 | Backup otomatis (pg_dump harian) | ✅ Script ditulis, 🛑 **belum dipasang cron-nya** | `devops/backup-db.sh` (pakai `docker exec` ke container Postgres, retensi 7 hari default). Instalasi cron ada di Langkah 5 — butuh SSH. |
| 9 | Migrasi ke database production | 🛑 Belum jalan | Otomatis jalan tiap kali container `api` start (lihat `CMD` di `apps/api/Dockerfile`) — begitu compose di-`up` dengan database sudah dibuat (item 4), migrasi akan jalan sendiri. Tidak perlu langkah manual terpisah. |
| 10 | Monitoring dasar | ✅ Docker healthcheck terpasang, saran eksternal didokumentasikan | `docker-compose.prod.yml` sudah punya `healthcheck` untuk service `api`. Untuk uptime monitoring dari luar (alert kalau situs down), saya TIDAK mendaftarkan akun pihak ketiga apa pun atas nama owner (di luar kewenangan saya) — rekomendasi: UptimeRobot/Better Uptime (gratis) memantau `https://<domain>/health`, didaftarkan sendiri oleh owner kalau mau. |

## Langkah-langkah SETELAH akses VPS tersedia (urutan disarankan)

Jalankan sebagai `root` (atau user dengan akses Docker) di VPS, SETELAH `git push`
berhasil dan repo bisa di-`git clone`/`git pull` di VPS.

### Langkah 0 — DNS dulu (lihat item 5)
Jangan lanjut ke Langkah 4 (Nginx Proxy Manager) kalau domain belum resolve. Cek:
```bash
dig +short vps.burnas-ops.id A
# harus keluar 202.155.13.91 (atau IP VPS yang benar) -- kalau kosong, STOP, benahi DNS dulu.
```

### Langkah 1 — Cocokkan network & nama container Postgres existing
```bash
docker ps --format '{{.Names}}'                     # cari nama container Postgres & n8n
docker inspect <nama-container-postgres> --format '{{json .NetworkSettings.Networks}}'
```
Edit `docker-compose.prod.yml`: ganti `EXISTING_NETWORK_NAME` (lewat env var saat
`docker compose up`, atau langsung di file) dan `DB_HOST` di `.env.production` kalau
nama container Postgres bukan `postgres`.

### Langkah 2 — Buat database `samsara` baru di instance Postgres existing
```bash
docker exec -it <nama-container-postgres> psql -U postgres -c \
  "CREATE ROLE samsara LOGIN PASSWORD '<isi dari DB_PASSWORD di .env.production>';"
docker exec -it <nama-container-postgres> psql -U postgres -c \
  "CREATE DATABASE samsara OWNER samsara;"
```
**PENTING**: pakai password ASLI dari `.env.production`, jangan buat password baru
di langkah ini (harus sama persis dengan yang dipakai app untuk connect).

### Langkah 3 — Swap 2GB (kalau belum ada)
```bash
free -h   # cek kolom Swap, kalau 0 lanjut di bawah
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab   # permanen setelah reboot
```

### Langkah 4 — Build & jalankan aplikasi
```bash
cd /path/ke/samsara-backoffice   # hasil git clone/pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml ps   # pastikan api & web "healthy"/"running"
curl -s http://127.0.0.1:8080/health            # cek dari host VPS sendiri
```

### Langkah 5 — Nginx Proxy Manager
- Tambah Proxy Host baru: domain → `http://127.0.0.1:8080` (port yang di-expose `web` di compose).
- Aktifkan "Force SSL" + request sertifikat Let's Encrypt (HANYA setelah Langkah 0 lulus).

### Langkah 6 — Pasang cron backup harian
```bash
crontab -e
# tambahkan baris (jam 3 pagi WIB -- sesuaikan timezone server):
0 3 * * * DB_PASSWORD='<isi dari .env.production>' /path/ke/samsara-backoffice/devops/backup-db.sh >> /var/log/samsara-backup.log 2>&1
```

### Langkah 7 — Buat akun owner production
**JANGAN migrasikan user dari dev.** Sesuai instruksi owner, akun Ibnu/Fitri/Naura/Duhan
dibuat ULANG lewat UI production nanti (bukan dari sini), supaya kredensial mereka
baru dan belum pernah terekspos di percakapan mana pun.
```bash
docker compose -f docker-compose.prod.yml exec api sh -c \
  "AUTH_SEED_OWNER_USERNAME=<username> AUTH_SEED_OWNER_PASSWORD=<password-baru-kuat> node_modules/.bin/tsx apps/api/src/seed-owner.ts"
```
Pilih username/password baru saat itu juga (jangan pakai nilai dev manapun).

## Yang SENGAJA tidak disentuh

- Container `n8n`, `postgres:16` (instance-nya sendiri, bukan database `samsara` di
  dalamnya), dan `dorowu/ubuntu-desktop-lxde-vnc` — tidak direstart/diubah sama
  sekali oleh file-file di folder ini.
- Tidak ada instance Postgres baru dibuat — `samsara` adalah database BARU di dalam
  instance yang sudah jalan (CLAUDE.md § Rencana infra VPS).
