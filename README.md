# Samsara Backoffice

Sistem backoffice modular untuk Samsara (F&B). Modul pertama: **Inventory**.

Baca [`CLAUDE.md`](./CLAUDE.md) untuk konteks bisnis & keputusan yang tetap.
Baca [`docs/architecture.md`](./docs/architecture.md) untuk struktur teknis,
dan [`docs/architecture-decisions.md`](./docs/architecture-decisions.md)
untuk kenapa keputusan-keputusan di bawah ini diambil.

## Quickstart (local dev)

Database: **PostgreSQL native** (bukan Docker/MAMP), terinstal langsung di
mesin (mis. `brew install postgresql@16` lalu `brew services start
postgresql@16`). `docker-compose.yml` di repo ini sengaja tidak berisi
service database — disiapkan untuk service pendukung lain nanti.

```bash
# Sekali saja, kalau role & database "samsara" belum ada:
createuser samsara               # role login, tanpa perlu password di local trust auth
createdb -O samsara samsara      # database "samsara" dimiliki role tsb.

cp .env.example .env     # kalau belum ada .env
# Isi AUTH_JWT_SECRET (mis. `openssl rand -hex 32`) dan
# AUTH_SEED_OWNER_USERNAME/AUTH_SEED_OWNER_PASSWORD di .env sebelum lanjut.

npm install
npm run migrate          # jalankan migrasi semua modul aktif
npm run seed:owner        # buat user owner pertama (sekali saja, baca password dari .env)
npm run dev               # jalankan API di http://localhost:4000
```

Cek modul termuat (tidak perlu login): `GET http://localhost:4000/health`

Semua endpoint LAIN wajib login. Login dulu untuk dapat token:

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"owner","password":"<isi sesuai .env>"}'
# -> { "token": "...", "user": {...} }

curl http://localhost:4000/api/inventory/status \
  -H "Authorization: Bearer <token>"
```

Jalankan test otomatis (lewat database dev sungguhan, transaksi selalu
di-rollback — tidak mengubah data):

```bash
npm test
```

### API modul Inventory

Semua butuh header `Authorization: Bearer <token>` (lihat login di atas).
Daftar lengkap + permission tiap endpoint ada di
`modules/inventory/module.json` § `api.endpoints`. Ringkas:

- `GET /api/inventory/items/:kode/hpp?metode=...` / `GET /api/inventory/menu/:kode/hpp?metode=...` — `?metode=` cuma override untuk owner/manajer_ops (role lain pakai `pengaturan/hpp-metode` global); field harga/HPP/margin di-strip untuk supervisor/staf.
- `PATCH /api/inventory/menu/:kode/harga-jual` — owner saja.
- `GET /api/inventory/stok?item=<kode>&location=<id>` — supervisor/staf cuma bisa lokasi sendiri.
- `POST /api/inventory/transaksi/{pembelian,produksi,penjualan,mutasi-lain}`
- **Transfer, 2 tahap**: `POST /transaksi/transfer` (kirim — stok asal langsung berkurang) → `POST /transaksi/transfer/:id/terima` (stok tujuan bertambah, susut final). `GET /transaksi/transfer/dalam-perjalanan` — barang yang sudah dikirim, belum diterima.
- **Opname, 2 tahap**: `POST /transaksi/opname` (input hitungan, draft, stok belum berubah) → `POST /transaksi/opname/:id/keputusan` (`{decision: "setuju"|"tolak"}`, owner/manajer_ops saja).
- **Master data** (owner/manajer_ops): `POST`/`PATCH /items`, `POST`/`PATCH /resep-produksi`, `PATCH /menu/:kode/resep` (ganti baris resep menu), `PATCH .../nonaktifkan` (soft-delete item/resep/menu — ditolak kalau item masih dipakai resep aktif, atau menu masih dipakai paket aktif). Perubahan harga/konversi/resep/harga-jual tercatat di `core_audit_log`.
- **Pengaturan** (owner saja): `GET`/`PATCH /pengaturan/hpp-metode`, `POST`/`PATCH /lokasi`, `POST`/`PATCH /channel`.

### Kelola user

```bash
curl -X POST http://localhost:4000/api/auth/users \
  -H "Authorization: Bearer <token owner>" -H "Content-Type: application/json" \
  -d '{"username":"budi","password":"...","role":"staf","locationIds":[1]}'

curl http://localhost:4000/api/auth/users -H "Authorization: Bearer <token owner>"
```

Role: `owner`, `manajer_ops`, `supervisor`, `staf`. Detail matriks
permission ada di `docs/architecture-decisions.md` § 12–13. **Belum ada
pembatasan percobaan login maupun cara mencabut token sebelum
kedaluwarsa (12 jam)** — dilaporkan di § 13.6, wajib dibenahi sebelum
deploy.

### Mengisi harga jual menu

HPP per porsi sudah ada di database, tapi harga jual belum (lihat
`docs/inventory-schema.md` § "Harga jual belum ada"). Alurnya:

```bash
# 1. Buka data/harga_jual_template.csv, isi kolom "harga_jual" dari Majoo.
# 2. Jalankan importer-nya:
npm run import:harga-jual -- data/harga_jual_template.csv
```

## Struktur

```
core/               → platform: manifest system, koneksi DB, migration runner, server HTTP
modules/inventory/   → modul pertama: module.json + router API + migrasi SQL
apps/api/             → app yang benar-benar dijalankan, merakit modul mana yang aktif
data/                 → template/CSV untuk proses input manual (mis. harga jual)
docs/                 → dokumentasi arsitektur & keputusan
```

## Status

Tahap 1 (Arsitek Platform), Tahap 2 (Data Modeler), dan Tahap 3 (Backend
Developer) selesai untuk modul Inventory: skema terverifikasi + data
referensi ter-seed, mesin HPP (rekursif, 2 metode — pilihan global +
override owner/manajer_ops), mesin stok (transfer & opname 2 tahap lewat
`inventory_stock_ledger`), API REST (~25 endpoint termasuk CRUD master
item/resep & pengaturan), dan **auth/permission lintas modul di `core`**
(login JWT, 4 role, filter field harga di response, `core_audit_log`
untuk perubahan harga/konversi/resep/harga-jual). **45 test otomatis
lulus** (`npm test`). Beberapa hal masih menunggu input/keputusan
owner/Ibnu (harga jual, klarifikasi data lokasi, simplifikasi mesin stok,
keamanan token login) — lihat `docs/architecture-decisions.md` §
"Ringkasan yang perlu direview owner". Tahap 4 (DevOps/Infra, deploy VPS)
belum dikerjakan.
