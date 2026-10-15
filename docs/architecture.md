# Arsitektur Backoffice Samsara — Tahap 1

Ringkasan untuk review owner. Ini baru **fondasi/struktur**, belum ada fitur
bisnis (item, resep, HPP, dll. sudah ada tabelnya tapi belum ada endpoint
CRUD-nya) — endpoint bisnis itu Tahap 3.

## Kenapa strukturnya begini

Filosofinya seperti Odoo: tiap fungsi bisnis (Inventory, nanti Sales, HR,
Marketing) jadi **modul terpisah** yang bisa dinyalakan/dimatikan tanpa
merusak modul lain, dan tidak boleh saling colek data secara langsung — cuma
lewat API yang memang disediakan modul tersebut.

## Struktur folder

```
samsara-backoffice/
├── core/               → "mesin" platform: sistem manifest modul, koneksi database,
│                          migration runner, server HTTP. Tidak tahu-menahu soal
│                          bisnis Inventory/Sales/dll secara spesifik.
├── modules/
│   └── inventory/       → modul pertama. Isinya: module.json (manifest) + kode
│                          (router API) + migrasi SQL miliknya sendiri.
├── apps/
│   └── api/              → aplikasi yang benar-benar dijalankan: daftar modul mana
│                          saja yang dirakit (apps/api/src/modules.ts), lalu start
│                          server / jalankan migrasi.
├── docs/                 → dokumentasi ini.
└── docker-compose.yml    → Postgres LOCAL DEV saja (lihat § Database).
```

Kenapa dipisah 3 lapis (core / modules / apps)? Supaya `core` tidak pernah
perlu tahu modul apa saja yang ada (jadi menambah modul baru = tidak
menyentuh kode platform sama sekali), dan `apps/api` jadi satu-satunya tempat
yang "merakit" modul mana yang jalan.

## Sistem Module Manifest

Setiap modul WAJIB punya file `module.json` (lihat
[`docs/module-manifest.md`](./module-manifest.md) untuk skema lengkap) yang
mendeklarasikan:

- **name** — nama unik modul (juga dipakai sebagai prefix tabel).
- **version** — versi modul sendiri, independen dari modul lain.
- **dependsOn** — modul lain yang jadi prasyarat (menentukan urutan load & migrasi).
- **tablePrefix** — prefix tabel milik modul ini, harus unik antar modul.
- **tables** — tabel yang dimiliki modul ini (dokumentasi kepemilikan data).
- **api** — endpoint yang diekspos ke modul/klien lain.
- **enabled** — status aktif/nonaktif.

`module.json` sengaja murni data (JSON), bukan kode — supaya bisa dibaca
tooling/dokumentasi/non-engineer tanpa menjalankan TypeScript. Kode modul
(router, migrasi) ada di file terpisah dan disatukan lewat default export
`modules/<nama>/src/index.ts` (`{ manifest, createRouter, migrationsPath }`).

Platform (`core/src/manifest/registry.ts`) membaca semua manifest yang
dirakit `apps/api`, memvalidasi (nama unik, dependency tidak melingkar, tidak
ada dua modul rebutan `tablePrefix`), lalu mengembalikan modul terurut sesuai
dependency untuk load router maupun migrasi.

## Database

**PostgreSQL 16 native** — terinstal langsung di mesin lokal (Homebrew),
**bukan Docker, bukan MAMP/MySQL**. Ini keputusan final, lihat
[`docs/architecture-decisions.md`](./architecture-decisions.md) § 1 untuk
riwayat lengkap kenapa sempat berpindah-pindah (Postgres → MySQL/MAMP →
Docker Postgres → Postgres native) sebelum ditetapkan.

Satu database (`samsara`) dipakai bersama semua modul, dimiliki role
`samsara` (login role khusus, dibuat terpisah dari role OS/superuser
`postgres`). Isolasi antar modul lewat **prefix nama tabel per modul** (mis.
`inventory_items`) — bukan schema Postgres terpisah, supaya konsisten dengan
kontrak module manifest (`tablePrefix`) dan tetap sederhana untuk satu
database kecil.

- Modul Inventory hanya boleh bikin/ubah tabel berprefix `inventory_`.
- Modul lain yang butuh data Inventory (misal nanti Finance butuh HPP)
  **tidak** query langsung ke tabel `inventory_*` — harus lewat endpoint
  `/api/inventory/...` yang memang disediakan.
- Registry menolak start kalau ada dua modul rebutan `tablePrefix` yang sama.
- Auth lokal: `pg_hba.conf` Homebrew Postgres di mesin ini di-set `trust`
  untuk koneksi dari `localhost`/socket, jadi `.env` tidak perlu
  `DB_PASSWORD` — cukup benar `DB_USER`/`DB_NAME`. Ini hanya berlaku untuk
  dev lokal; production (VPS) tetap pakai kredensial sungguhan.

> ⚠️ Postgres native ini **lokal-only**, terpisah total dari container
> `postgres:16` yang sudah jalan di VPS production (lihat CLAUDE.md §
> "Rencana infra VPS"). Tidak ada koneksi/dependensi ke VPS di tahap ini.

`docker-compose.yml` di repo ini sekarang **tidak berisi service database** —
disiapkan kosong untuk service pendukung lain di masa depan yang memang
lebih praktis dijalankan via container.

## Migrasi database

Tidak pakai ORM/migration tool pihak ketiga — cukup runner custom yang
ringan (`core/src/db/migrate.ts`): tiap modul punya folder
`src/db/migrations/*.sql`, dijalankan berurutan sesuai nama file, dan
tercatat di tabel `schema_migrations` supaya tidak dobel-jalan. Postgres
mendukung DDL transaksional, jadi satu file `.sql` = satu transaksi (gagal
di tengah → seluruh file itu rollback).

```bash
brew services start postgresql@16   # pastikan Postgres native jalan
npm install
npm run migrate                      # jalankan semua migrasi modul yang aktif, sesuai urutan dependency
npm run dev              # jalankan API lokal (auto-reload)
```

## Status saat ini

- Modul **Inventory**: skema **sudah diverifikasi ke spreadsheet asli**
  (Tahap 2) dan **mesin HPP + mesin stok + API REST sudah dibangun**
  (Tahap 3) — lihat [`docs/inventory-schema.md`](./inventory-schema.md) dan
  `docs/architecture-decisions.md` § 10. 9 endpoint (HPP item/menu, stok,
  6 jenis transaksi) didaftarkan di `module.json`. 21 test otomatis lulus.
- Migrasi sudah dijalankan ke database `samsara` di Postgres native mesin
  ini, termasuk seed data referensi dari `Inventori_FnB_Standar.xlsx`
  (92 item, 57 menu, resep produksi & menu, paket) — lihat
  `docs/architecture-decisions.md` § 1, § 7, § 8.
- Beberapa hal masih perlu klarifikasi/tindak lanjut owner (lihat
  `docs/architecture-decisions.md` § "Ringkasan"): kemungkinan campur data
  lokasi lintas-brand di sheet `Ref` sumber, harga jual menu yang belum
  diisi, dan 4 simplifikasi diketahui di mesin stok (§ 10.5) — terutama
  struk/kresek yang dimodelkan per-porsi, bukan per-transaksi.
- Belum disentuh sama sekali: VPS, container n8n/postgres/VNC yang sudah
  jalan di production — sesuai batasan di CLAUDE.md.

## Yang perlu keputusan/konfirmasi owner sebelum lanjut Tahap 2

- Skema tabel Inventory di sini masih **draft** berdasarkan aturan bisnis di
  CLAUDE.md — belum diverifikasi field-by-field ke spreadsheet
  `Inventori_FnB_Standar` (saya belum punya akses ke isi spreadsheet-nya di
  sesi ini). Tahap 2 (Data Modeler) perlu membaca spreadsheet itu langsung
  dan menyesuaikan skema kalau ada perbedaan.
- Rencana VPS di CLAUDE.md masih menyebut Postgres (`postgres:16` sudah
  jalan di VPS) — ini sekarang **konsisten lagi** dengan keputusan lokal
  (sama-sama Postgres), tapi tetap perlu diputuskan owner nanti: pakai
  instance Postgres yang sudah ada di VPS (database baru `samsara`) atau
  container baru, saat mau deploy sungguhan.
