# Architecture Decisions — Tahap 1 (Arsitek Platform)

Ditulis 2026-09-27 di akhir Tahap 1, diperbarui 2026-09-28 (§ 1b — keputusan
database final). Dokumen ini mencatat keputusan & asumsi yang saya ambil,
supaya bisa direview owner dan jadi rujukan sesi berikutnya.

---

## 1. Database engine: kembali ke PostgreSQL (bukan MySQL)

**Konteks penting:** di awal sesi ini saya menemukan bahwa Tahap 1 versi
sebelumnya **sudah pernah dikerjakan** — filenya ter-stage di git index
(`git status` menunjukkan status `A` untuk `core/`, `apps/api/`,
`modules/inventory/`, `docs/architecture.md`, dll.) tapi **hilang dari
disk** (belum pernah di-commit). Saya baca isi versi lama itu dari index:
implementasinya lengkap, tapi pakai **MySQL 8** — sesuai catatan di
`CLAUDE.md` bahwa owner mengubah keputusan dari Postgres ke MySQL pada
2026-09-26 karena environment lokal sudah jalan pakai MAMP Pro.

Task Tahap 1 kali ini secara eksplisit meminta skema **PostgreSQL** — jadi
ada kontradiksi langsung dengan keputusan yang baru dicatat kemarin. Karena
`CLAUDE.md` sendiri mewajibkan konfirmasi owner sebelum mengubah keputusan
stack ("jangan diubah tanpa alasan kuat, kalau mau ubah — tanya owner
dulu"), saya berhenti dan bertanya dua hal ke owner sebelum menulis apa pun:
(1) file lama itu mau direstore atau dibangun ulang, dan (2) DB engine mau
tetap MySQL atau balik ke Postgres.

**Keputusan owner (dikonfirmasi langsung di sesi ini, 2026-09-27):** bangun
ulang dari nol, pakai **PostgreSQL**. Ini secara efektif membalikkan
keputusan 2026-09-26. Saya sudah update `CLAUDE.md` § 3 untuk mencatat
pembalikan ini (lihat diff commit) supaya sesi berikutnya tidak bingung
lagi.

**Konsekuensi teknis:**
- Driver: `pg`, bukan `mysql2`.
- Isolasi antar modul tetap lewat **prefix nama tabel** (`inventory_...`),
  bukan schema Postgres terpisah — supaya konsisten dengan kontrak
  `tablePrefix` di module manifest dan tetap sederhana untuk satu database
  kecil. (Catatan: Postgres sebenarnya mendukung schema asli, beda dengan
  MySQL. Saya tetap pilih prefix, bukan schema, supaya migrasi ke/dari
  MySQL di masa depan tidak memaksa perubahan konsep isolasi data.)
- Migration runner: satu file `.sql` = satu transaksi (Postgres mendukung
  DDL transaksional) — lebih aman dari versi MySQL sebelumnya yang harus
  menulis migrasi idempotent karena MySQL/InnoDB tidak rollback DDL.
- `docker-compose.yml` baru: Postgres 16 lokal, container & volume diberi
  nama eksplisit (`samsara-backoffice-postgres-dev`) supaya jelas beda dari
  container `postgres:16` yang sudah jalan di VPS production.
- File Tahap 1 versi MySQL yang lama (staged, belum pernah commit) **tidak
  dipakai** — atas instruksi owner, dibangun ulang dari nol. File-file baru
  di sesi ini menimpa path yang sama; beberapa path lama (mis.
  `modules/inventory/src/manifest.ts`) sengaja tidak dibuat ulang karena
  digantikan pendekatan `module.json` (lihat § 3).

**Dampak baik yang muncul dari pembalikan ini:** rencana VPS di CLAUDE.md
(`postgres:16` sudah jalan di sana) sekarang **konsisten** dengan keputusan
lokal — sebelumnya (waktu lokal MySQL) ada catatan "belum konsisten" antara
lokal dan VPS. Ketidakkonsistenan itu sekarang hilang dengan sendirinya.
Tetap perlu keputusan owner saat deploy sungguhan: pakai instance Postgres
VPS yang sudah ada (database baru `samsara`) atau container terpisah.

---

## 1b. Update 2026-09-28: Docker Postgres → PostgreSQL native (FINAL)

Owner menetapkan: local dev database **final** adalah PostgreSQL native yang
sudah terinstal langsung di mesin (Homebrew `postgresql@16`), **bukan
Docker, bukan MAMP/MySQL**. Ini keputusan ke-4 soal DB di repo ini dalam
waktu singkat (Postgres rencana awal → MySQL/MAMP 09-26 → Docker Postgres
09-27 → Postgres native 09-28) — supaya tidak bolak-balik lagi, saya tandai
eksplisit di `CLAUDE.md` § 3 sebagai **FINAL**, dan sesi berikutnya
diinstruksikan untuk tidak menanyakan ulang pilihan engine/hosting DB ini
kecuali owner sendiri yang mengangkat topiknya.

**Yang diubah:**
- `docker-compose.yml` — service `postgres` dihapus, file jadi placeholder
  kosong (`services: {}`) untuk service pendukung lain di masa depan yang
  memang lebih cocok dijalankan via container (bukan database).
- `core/src/db/pool.ts` — default `password` diubah dari `"samsara"` jadi
  string kosong, karena auth lokal Postgres native di mesin ini `trust`
  (tidak butuh password sama sekali dari `localhost`).
- `.env` / `.env.example` — `DB_HOST=localhost`, `DB_PORT=5432` (default
  native, sama seperti sebelumnya), `DB_USER=samsara`, `DB_PASSWORD=`
  (kosong).
- `docs/architecture.md`, `README.md` — instruksi quickstart diganti dari
  `docker compose up -d` jadi `brew services start postgresql@16`.

**Setup yang saya lakukan di Postgres native mesin ini** (server Postgres
16 dari Homebrew sudah terinstal tapi belum jalan saat sesi ini mulai, saya
start dengan `brew services start postgresql@16` — reversibel, tidak
menyentuh data apa pun):
- Dibuat role login baru `samsara` (bukan pakai role superuser OS `nazmi`
  langsung) — supaya `.env` tidak bergantung pada username mesin pribadi
  owner, dan lebih jelas untuk siapa pun yang baca konfigurasinya.
- Dibuat database `samsara`, dimiliki role `samsara`.
- Auth: `pg_hba.conf` Homebrew Postgres di mesin ini sudah `trust` untuk
  semua koneksi `localhost`/socket secara default (bawaan installer) — saya
  tidak mengubah pengaturan auth ini, hanya memanfaatkannya. **Catatan
  keamanan:** `trust` berarti siapa pun yang punya akses ke mesin ini bisa
  connect ke database `samsara` tanpa password sama sekali. Ini wajar untuk
  dev lokal single-user, tapi kalau nanti mesin ini dipakai multi-user atau
  di-expose ke jaringan, pengaturan ini perlu direview.

  ⚠️ **Ini HANYA berlaku untuk local dev di mesin ini.** Auth `trust` +
  `DB_PASSWORD` kosong **tidak boleh direplikasi apa adanya** ke VPS
  production. Saat DevOps/Infra (Tahap 4) deploy ke VPS: Postgres wajib
  pakai `pg_hba.conf` dengan `scram-sha-256`/`md5` dan role dengan password
  sungguhan (disimpan sebagai secret, bukan `.env` yang di-commit atau
  ditulis plain di dokumentasi). Konfigurasi `.env`/`pool.ts` di repo ini
  sudah mendukung `DB_PASSWORD` terisi tanpa perlu ubah kode — tinggal beda
  nilai per environment.

**Hasil eksekusi migrasi** (dijalankan `npm run migrate` ke database
`samsara` sungguhan di Postgres native, 2026-09-28):

```
[migrate] inventory/0001_create_items_and_locations.sql
[migrate] inventory/0002_create_recipes_and_menu.sql
[migrate] inventory/0003_create_stock_ledger.sql
[migrate] inventory/0004_create_transactions.sql
[migrate] selesai
```

Diverifikasi setelahnya:
- 18 tabel + 1 view (`inventory_current_stock`) + 3 enum type terbentuk
  sesuai desain di `docs/inventory-schema.md`.
- Tabel `schema_migrations` mencatat ke-4 file sebagai applied.
- Trigger `trg_inventory_resep_produksi_baris_check` (validasi resep
  produksi 1 level) terpasang dan aktif.
- Migrasi dijalankan ulang (`npm run migrate` kedua kali) — tidak ada
  statement yang dieksekusi lagi (idempotent lewat tracking table), tidak
  ada error.

Ini eksekusi pertama skema Inventory ke database sungguhan. Karena skema ini
masih **draft** (lihat § 5 / `docs/inventory-schema.md`), kemungkinan besar
akan ada migrasi tambahan (`0005_...sql` dst, bukan mengedit file yang sudah
applied) begitu Tahap 2 selesai memverifikasi ke spreadsheet asli.

---

## 2. Struktur monorepo: `core` / `modules` / `apps`

Dipertahankan dari eksplorasi struktur di awal (konsisten dengan yang
diminta task): `core` = platform generik (manifest registry, koneksi DB,
migration runner, server builder) yang tidak tahu modul bisnis apa pun;
`modules/*` = satu folder per modul bisnis (dimulai dari `inventory`);
`apps/api` = satu-satunya tempat yang merakit modul mana yang aktif dan
menjalankannya. Alasan: menambah modul baru tidak pernah menyentuh kode
`core`, dan modul tidak saling import langsung — hanya lewat API yang
diekspos.

---

## 3. Format module manifest: `module.json` (data-only) + entrypoint kode terpisah

Task meminta contoh format `module.json` secara eksplisit, jadi saya pakai
JSON murni sebagai kontrak (bukan `export default {...}` di file
TypeScript seperti versi awal). Karena JSON tidak bisa menyimpan fungsi
(router factory), setiap modul juga punya `src/index.ts` yang membaca
`module.json` miliknya sendiri (relatif ke lokasi file itu sendiri, pakai
`import.meta.url` — jadi tidak bergantung pada dari mana modul itu
dipanggil) dan menggabungkannya dengan `createRouter` jadi satu
`LoadedModule`. Detail skema & validasi ada di
[`docs/module-manifest.md`](./module-manifest.md).

**Asumsi:** `apps/api/src/modules.ts` mendaftarkan modul secara eksplisit
(static import), bukan auto-scan folder `modules/*` saat runtime. Ini lebih
predictable (tidak ada modul "kebaca" tidak sengaja) dan match dengan
instruksi CLAUDE.md § "Urutan kerja" yang menyebut peninjauan owner tiap
modul baru ditambahkan.

---

## 4. Migration runner custom, bukan ORM

Tidak pakai Prisma/Drizzle/TypeORM di Tahap 1 — cukup runner ringan
(`core/src/db/migrate.ts`) yang membaca `*.sql` per modul dan mencatat di
`schema_migrations`. Alasan: modul Inventory di tahap ini baru skeleton,
belum butuh query builder/type-safety tingkat lanjut; menambah ORM sekarang
menambah keputusan (schema definition language, codegen) yang belum perlu
diputuskan sebelum skema final Tahap 2 selesai. Ini bukan penolakan
permanen — bisa diadopsi di Tahap 3 kalau kompleksitas query bertambah,
tanpa mengubah struktur migrasi `.sql` yang sudah ada (migration runner
custom bisa jalan berdampingan dengan ORM apa pun).

---

## 5. Skema Inventory: draft berdasarkan aturan bisnis, BELUM diverifikasi ke spreadsheet

*(Historis — status Tahap 1, 2026-09-27. Sudah diverifikasi & dikoreksi di
Tahap 2, lihat § 7 di bawah. Bagian ini dibiarkan apa adanya sebagai
riwayat.)*

Saya **tidak punya akses** ke isi spreadsheet `Inventori_FnB_Standar` di
sesi ini — skema di
`modules/inventory/src/db/migrations/000{1..4}_*.sql` saya turunkan murni
dari aturan bisnis tertulis di `CLAUDE.md` § "Aturan bisnis modul
Inventory" (resep 1 level, stok lewat transaksi saja, HPP dua metode, nama
item unik, konversi satuan, transfer mencatat susut, status
`pending_data`). Semua penjelasan & asumsi field-level ada di
[`docs/inventory-schema.md`](./inventory-schema.md), termasuk daftar
eksplisit hal yang **belum diputuskan** dan perlu dicek ke spreadsheet asli
di Tahap 2 (Data Modeler) — misalnya apakah satu item bisa punya banyak
satuan beli tergantung supplier, dan apakah item `non_bahan` (Sapu,
Pembersih) ikut alur resep sama sekali.

Skema ini **tidak dieksekusi ke database sungguhan** di sesi ini — hanya
file `.sql`, sesuai instruksi.

---

## 6. Docker Compose lokal terpisah total dari VPS

`docker-compose.yml` di root repo ini hanya untuk development lokal (satu
service: `postgres:16`, port 5432, volume bernama eksplisit). Tidak ada
referensi ke VPS, tidak menyentuh container `n8n`/`postgres`/VNC yang sudah
jalan di production — sesuai batasan keras CLAUDE.md.

---

## 7. Tahap 2 (Data Modeler) — verifikasi ke spreadsheet asli (2026-09-28)

Spreadsheet `Inventori_FnB_Standar.xlsx` dibaca langsung (sheet
`Master_Item`, `Master_Menu`, `Resep_Prod`, `Resep_Prod_Baris`,
`Resep_Menu_Baris`, `Paket_Menu_Baris`, plus `Petunjuk` dan `Ref` untuk
konteks). Detail lengkap tiap koreksi skema ada di
[`docs/inventory-schema.md`](./inventory-schema.md) § "Koreksi dari Tahap
2" — di sini ringkasannya saja, plus satu temuan yang **di luar cakupan
skema database** dan perlu perhatian owner.

**Koreksi skema** (migrasi baru `0005` dan `0006`, bukan mengedit
`0001`–`0004` yang sudah applied): enum `inventory_item_type` ternyata salah total
(nilai asli: `bahan_baku/packaging/operasional/setengah_jadi`, bukan
`bahan_baku/packaging/hasil_produksi/non_bahan`); banyak kolom sumber yang
belum tercermin di draft (`kode`, `category`, `min_stok`,
`shelf_life_hari`, `catatan` di beberapa tabel, dan `harga_jual` di
`inventory_menu` yang sebelumnya **hilang sama sekali**); konsep "menu
paket/bundle" yang tidak ada di draft Tahap 1 ternyata butuh tabel baru
(`inventory_paket_menu_baris`); dan satu trigger yang saya tambahkan
sendiri di `0005` (menolak item `operasional` di resep menu, berdasarkan
teks header sheet) ternyata salah terhadap data asli — di-drop lagi di
`0006`. Ini contoh baik kenapa kebijakan "migrasi baru, bukan edit yang
sudah applied" berguna: riwayat salah-lalu-benar tetap terlihat di git log,
bukan hilang ditimpa.

Data referensi (92 item, 57 menu, 12 resep produksi, 43 baris resep
produksi, 395 baris resep menu, 32 baris paket) sudah **di-seed ke database
`samsara` sungguhan** lewat migrasi `0007`. 7 item ditandai `pending_data`
sesuai instruksi CLAUDE.md/owner (Garam, Sapu, Pembersih lantai/meja/piring,
Cup es teler + tutup, Mutiara/RP-008) — logika penentuannya dijelaskan di
`docs/inventory-schema.md` § "Status pending_data".

**Temuan yang PERLU keputusan/klarifikasi owner, bukan sesuatu yang saya
putuskan sendiri:**

1. **Kemungkinan campur data lintas-brand di sheet `Ref`.** Daftar
   "Lokasi" di sheet `Ref` file ini berisi `Central Kitchen`, `Burnas`,
   `Ajiep Sutami`, `Ajiep Dau` — dua nama terakhir terlihat seperti brand
   lain milik owner (Burnas, Bubur Ayam Ajiep), bukan outlet Samsara.
   CLAUDE.md § 1 eksplisit melarang mencampur data antar bisnis di repo
   ini. **Saya tidak menyeed tabel `inventory_locations` sama sekali** di
   Tahap 2 ini (di luar cakupan task, dan enam sheet yang diverifikasi
   tidak punya kolom lokasi) — jadi belum ada data yang benar-benar
   tercampur ke database. Tapi ini perlu diklarifikasi sebelum Tahap 3
   menyentuh sheet `Pembelian`/`Produksi`/`Transfer`/dll. yang memang punya
   kolom lokasi: apakah file spreadsheet ini memang template generik
   lintas-brand (lokasi tinggal disesuaikan ke outlet Malang saja), atau
   ada kebocoran data yang perlu diperbaiki di sumbernya dulu. **Update:
   soal "Burnas" sudah diklarifikasi owner — bukan brand lain, itu nama
   production dari bisnis/sistem yang sama dengan Samsara. "Ajiep" tetap
   brand lain yang terpisah, bagian itu masih belum diklarifikasi.** Lihat
   § 19.
2. **`Harga Jual` kosong di semua 57 menu.** Bukan sebagian, semua. HPP per
   porsi sudah bisa dihitung dari resep, tapi food cost % dan margin tidak
   bisa dihitung sampai harga jual diisi — ini keputusan bisnis Ibnu/owner,
   saya tidak mengisi angka sendiri. **Update: tooling untuk mengisi ini
   sudah dibuat**, lihat § 8.
3. **Satu baris resep tidak bisa dipetakan**: menu "Bubur Original" punya
   bahan `"Kacang"` yang tidak cocok nama item manapun di `Master_Item`
   (beda dari kasus Mutiara/Pangsit/Kecap yang sudah dipetakan eksplisit di
   catatan Petunjuk — ini genuinely belum diselesaikan, ditandai "Nama
   bahan tidak ditemukan" di sheet sumbernya sendiri). Dikecualikan dari
   seed, dicatat di `inventory_menu.catatan` untuk menu itu. HPP Bubur
   Original saat ini understated sampai dikonfirmasi. **Update: sudah
   dikonfirmasi & diperbaiki**, lihat § 8.

---

## 8. Tahap 2 lanjutan — perbaikan data & konsep entitas (2026-09-28)

Empat perbaikan diminta owner setelah review temuan § 7, sebelum lanjut ke
Tahap 3. Migrasi baru `0008`–`0011` (tidak ada migrasi lama yang diedit).

### 8.1 "Kacang" di Bubur Original — investigasi hasilnya: bukan bug

Dicek ulang teks mentah sel `Resep_Menu_Baris` untuk M-002/"Kacang": tidak
ada spasi tersembunyi, tidak ada masalah case atau encoding (`repr()` dan
byte-level sama persis dengan `'Kacang'`, 6 karakter). Jadi ini **bukan bug
parser seed** — sel itu memang berisi nama singkat di sumber datanya,
berbeda dari nama item lengkap `Kacang dele panda 5 kg` (BB-011) yang
dipakai di 5 menu Bubur lain (M-003, M-004, M-005, M-045, M-046, semuanya
qty 5 gr — pola identik). 5 baris itu **sudah berhasil ter-seed** sejak
migrasi `0007` (skip Tahap 2 sebelumnya hanya berlaku untuk baris M-002,
bukan ke-6 baris sekaligus). Owner mengonfirmasi "Kacang" di M-002 memang
BB-011 — ditambahkan lewat migrasi `0008`, sekaligus update catatan menu.

### 8.2 Garam — bukan lagi pending_data

Angka yang sudah tersimpan sejak seed Tahap 2 (`harga_master` 14.2/gr,
`purchase_to_recipe_factor` 500) **sudah benar** (Rp7.100 ÷ 500 gr = 14.2).
Yang salah cuma label `purchase_unit` ("gr", padahal maksudnya kemasan
berisi 500 gr) dan status yang masih ikut catatan lama di spreadsheet.
Migrasi `0009`: `purchase_unit` → `"kemasan 500gr"`, `status` → `active`.
Item yang **tetap** `pending_data`: Sapu, Pembersih lantai/meja/piring, Cup
es teler + tutup, Mutiara (6 item, turun dari 7).

### 8.3 Konsep "entitas" — pengelompokan internal, bukan pemisahan brand

Penting untuk jelas: "entitas" di sini adalah pengelompokan **internal
Samsara sendiri** (Central Kitchen sebagai satu cost-center, Outlet sebagai
cost-center lain) — sama sekali beda dari isu di § 7.1 (kemungkinan campur
data Burnas/Ajiep, itu antar-**brand**, masih belum diklarifikasi dan masih
sengaja tidak disentuh). **Update: bagian "Burnas" di kalimat di atas sudah
tidak akurat — Burnas bukan brand lain, lihat § 19. "Ajiep" tetap brand
lain yang antar-brand beneran, bagian itu masih berlaku.**

Migrasi `0010`:
- `inventory_locations.entitas` (TEXT, `NOT NULL`, bukan enum — supaya
  entitas/outlet baru tidak perlu migrasi skema). Konvensi: snake_case
  (`samsara_ck`, `samsara_outlet`).
- `inventory_current_stock` (VIEW) ditambah kolom `entitas` (join ke
  `inventory_locations`) — supaya nilai stok bisa difilter per entitas
  langsung dari view ini, tidak perlu join manual di setiap query.
  Catatan teknis: kolom baru ditaruh **di akhir** SELECT (setelah `qty`),
  karena `CREATE OR REPLACE VIEW` di Postgres tidak boleh mengubah
  posisi/nama kolom yang sudah ada, cuma boleh menambah di akhir — sempat
  gagal sekali karena taruh `entitas` di tengah, diperbaiki sebelum
  di-commit ke migrasi.
- `inventory_transaksi_transfer.antar_entitas` (BOOLEAN, `NOT NULL`) —
  **dihitung otomatis oleh trigger** (`trg_inventory_transfer_antar_entitas`)
  dari entitas lokasi asal vs tujuan, bukan diisi manual. Diuji: transfer
  Central Kitchen → Outlet 1 menghasilkan `antar_entitas = true`.
- `inventory_transaksi_transfer_baris.harga_transfer_per_satuan`
  (NUMERIC, nullable). **Kebijakan default ("Skema A")**: sama dengan biaya
  produksi/HPP item di lokasi asal (`harga_master` untuk
  bahan_baku/packaging/operasional, atau biaya per satuan dari resep
  produksinya untuk `setengah_jadi`). **Sengaja tidak dibuat trigger/DEFAULT
  SQL** untuk mengisi angka ini otomatis — resolusi biaya `setengah_jadi`
  butuh logika rekursif yang sama dengan mesin HPP yang direncanakan di
  Tahap 3; kalau diduplikasi di trigger database, akan ada dua sumber
  kebenaran untuk perhitungan yang sama. Jadi ini kebijakan yang
  **Tahap 3 wajib implementasikan di application layer** saat endpoint
  transfer dibuat (baca HPP item di lokasi asal, isi kolom ini saat
  insert) — skema database cuma menyiapkan kolomnya dan mendokumentasikan
  kebijakannya (lihat `COMMENT ON COLUMN` di migrasi `0010`).
- **Laporan HPP per entitas**: tidak perlu kolom/tabel tambahan — semua
  tabel transaksi (`Pembelian`, `Produksi`, `Penjualan`, `Transfer`,
  `Mutasi_Lain`, `Opname`) sudah punya `location_id`, jadi filter per
  entitas tinggal join ke `inventory_locations` di query Tahap 3.

### 8.4 Lokasi & channel — Samsara saja

Migrasi `0011` men-seed **hanya** 2 lokasi Samsara:
`Samsara Central Kitchen` (`samsara_ck`) dan `Samsara Outlet 1 Malang`
(`samsara_outlet`). Lokasi lain di sheet `Ref` sumber (`Burnas`,
`Ajiep Sutami`, `Ajiep Dau`) **sengaja tidak diseed** — sesuai instruksi
eksplisit owner dan batasan keras CLAUDE.md. Ini tidak "menyelesaikan"
temuan § 7.1 (kemungkinan template spreadsheet memang lintas-brand) — itu
masih terbuka, cuma sekarang databasenya sudah pasti bersih dari data
brand lain karena locations di-seed manual, bukan disalin mentah dari
sheet `Ref`.

Tabel baru `inventory_sales_channel` (referensi, belum ada FK dari
`inventory_transaksi_penjualan.sumber`) di-seed 4 channel: Offline,
GrabFood, GoFood, ShopeeFood. Keputusan menghubungkan `sumber` ke tabel ini
lewat FK sengaja ditunda ke Tahap 3, saat modul Penjualan benar-benar
dibangun — mengubah kolom itu sekarang berarti mendesain ulang tabel
transaksi yang di luar cakupan task ini.

### 8.5 Template harga jual + importer

`data/harga_jual_template.csv` (57 baris, kolom `kode_menu, nama_menu,
hpp_per_porsi, harga_jual`) dibuat dari nilai HPP per porsi yang sudah
dihitung Excel di sheet `Master_Menu` (dibulatkan ke rupiah) — bukan
dihitung ulang dari database, karena mesin HPP (termasuk resolusi biaya
`setengah_jadi` dan rollup paket) belum dibangun di Tahap 3. Kolom
`harga_jual` sengaja dikosongkan untuk diisi Ibnu dari data Majoo.

Importer: `apps/api/src/import-harga-jual.ts` (`npm run import:harga-jual --
<path-csv>`). Baca CSV, `UPDATE inventory_menu SET harga_jual = ... WHERE
kode = ...` untuk baris yang `harga_jual`-nya terisi, lewati baris kosong,
laporkan `kode_menu` yang tidak ketemu di database. Sudah diuji dengan CSV
contoh (1 update, 1 skip kosong, 1 kode tidak ditemukan) — hasil uji sudah
dibersihkan lagi dari database (`harga_jual` kembali `NULL` semua),
`data/harga_jual_template.csv` yang di-commit tetap kosong di kolom
`harga_jual`.

---

## 9. Verifikasi HPP lewat query SQL, sebelum Tahap 3 (2026-09-28)

Sebelum membangun mesin HPP di Tahap 3, HPP dihitung manual lewat query SQL
langsung dari data yang sudah ter-seed (resolusi `setengah_jadi` 1 level:
total biaya bahan resep produksi ÷ yield), dibandingkan ke kolom HPP di
`Inventori_FnB_Standar.xlsx` yang dibaca ulang saat itu juga (bukan angka
yang sempat disebut di percakapan sebelumnya). Cakupan: 12 item
`setengah_jadi`, 46 menu dasar, 11 paket. Tidak ada data yang diubah
sebelum penyebab selisihnya ditemukan dan dilaporkan (sesuai instruksi
owner).

**Temuan sebelum perbaikan**: 34/46 menu dasar dan semua 11 paket punya
selisih signifikan, semuanya kelipatan/kombinasi dari akar masalah yang
sama:

1. **Harga `Kertas thermal Coreless 5730` (OP-005) tidak konsisten di
   dalam spreadsheet sumber itu sendiri.** `Master_Item` mencatat
   Rp1.590/pcs (Rp159.000/pack ÷ 100), tapi nilai yang sudah dipakai &
   dihitung konsisten di 47 baris `Resep_Menu_Baris` (dan di kolom HPP
   `Master_Menu`) semuanya Rp50/pcs. Karena migrasi 0007 seed persis
   sesuai `Master_Item` (mengikuti instruksi awal untuk tidak mendesain
   ulang data), perbedaan Rp1.540/pcs ini merambat ke hampir semua menu
   yang memakai item ini (hampir semua menu dasar, sekali per menu).
   Root cause paling mungkin: harga/konversi item ini diedit di
   `Master_Item` setelah HPP resep terakhir dihitung di Excel, dan
   `Resep_Menu_Baris` tidak sempat di-recalculate ulang sebelum file
   diekspor ke `.xlsx`.
2. **Baris resep duplikat**: `Bubur Original Jumbo` (M-003) punya 2 baris
   identik untuk item yang sama di sumber data — dicek langsung, memang
   ada di file asli, bukan bug seed. Karena sheet aslinya juga menjumlahkan
   kedua baris itu, ini **tidak menyumbang selisih tambahan** setelah
   poin 1 diperbaiki (baik sistem maupun sheet menghitung duplikatnya).
3. **Presisi `harga_master NUMERIC(18,2)`**: item dengan harga_beli/konversi
   yang tidak habis dibagi (mis. Rp220÷3, Rp2.000÷75) tersimpan dibulatkan
   2 desimal, menyebabkan selisih Rp0,01–Rp3,33 per resep yang memakainya.
   Dampaknya kecil, tidak diperbaiki (bukan bug, konsekuensi wajar dari
   tipe kolom uang 2 desimal).
4. Penambahan bahan "Kacang" di Bubur Original (§ 8.1) menambah ~Rp112
   yang **tidak ada** di HPP lama sheet (sheet dihitung sebelum baris itu
   dikonfirmasi) — bukan bug, propagasi wajar dari perbaikan data yang
   sudah disetujui.

**Keputusan owner (2026-09-28)**:
- Harga OP-005 **dikoreksi ke Rp50/pcs** (migrasi `0012`) — mengikuti nilai
  yang dipakai konsisten di seluruh resep, bukan nilai `Master_Item` yang
  ternyata stale. `purchase_unit`/`purchase_to_recipe_factor` item ini
  **tidak diubah** (belum jelas bagian mana yang salah di data pembelian
  asli — cuma harga_master efektif yang dikoreksi; kalau owner dapat angka
  pembelian aktual dari supplier, boleh diperbaiki lebih presisi nanti).
- Baris duplikat di M-003 **dibiarkan apa adanya** — tidak dianggap bug
  yang perlu diperbaiki.

**Hasil setelah migrasi `0012`**: 45/46 menu dasar dan 7/11 paket sekarang
cocok dengan sheet dalam Rp1 (murni rounding, poin 3). Sisa 1 menu dasar
(M-002, +Rp112,05) dan 4 paket yang memakai M-002 (M-037 +Rp224,37, M-038
+Rp112,19, M-040 +Rp448,50, M-041 +Rp112,05 — semuanya kelipatan bersih
Rp112 × qty Bubur Original di paket itu) **konsisten dan sudah dijelaskan**
oleh poin 4 — bukan anomali baru.

---

## 10. Tahap 3 (Backend Developer) — mesin HPP, mesin stok, API (2026-09-29)

### 10.1 Struktur kode

- `modules/inventory/src/domain/hpp.ts` — mesin HPP: `resolveItemCost` (rekursif untuk `setengah_jadi`, 1 level, dijaga trigger DB), `getMenuHppReport` (menu dasar & paket), `getItemCostReport`.
- `modules/inventory/src/domain/stok.ts` — mesin stok: satu fungsi per jenis transaksi (`createPembelian`, `createProduksi`, `createPenjualan`, `createTransfer`, `createMutasiLain`, `createOpname`), semuanya memposting ke `inventory_stock_ledger`, tidak pernah mengedit stok langsung.
- `modules/inventory/src/api/router.ts` — endpoint Express yang memanggil domain layer, didaftarkan di `module.json` § `api.endpoints`.

**Keputusan desain**: fungsi domain **menerima** `client: PoolClient` yang transaksinya (BEGIN/COMMIT/ROLLBACK) dikendalikan pemanggil — bukan `pool` yang mengurus transaksi sendiri. Alasan: satu pola yang sama dipakai baik oleh route handler (BEGIN...COMMIT lewat helper `withTransaction`) maupun test (BEGIN...ROLLBACK lewat helper `withRollback`) — test bisa memanggil domain layer yang PERSIS SAMA dengan yang dipakai API, insert/update data sungguhan lewat query nyata, tanpa pernah mengubah database dev karena selalu di-ROLLBACK di akhir.

### 10.2 Metode HPP: query param, bukan tabel konfigurasi

`?metode=harga_master|harga_beli_terakhir` di endpoint HPP, default `harga_master` (sesuai `Ref!K2` di spreadsheet sumber). **Tidak dibuat tabel/kolom konfigurasi tersimpan** untuk metode default sistem — dianggap keputusan kecil (CLAUDE.md §5), bukan arsitektur besar. Kalau owner nanti mau metode default per-lokasi/per-laporan bisa disimpan permanen, itu perubahan kecil menambah tabel `inventory_config` atau semacamnya, tidak mengubah cara `resolveItemCost` bekerja.

### 10.3 Test otomatis: `node --test` + `tsx`, transaksi-rollback terhadap DB dev sungguhan

Tidak menambah dependency baru (Vitest/Jest) — `node --test` (bawaan Node 20+) lewat `tsx` sudah cukup dan konsisten dengan filosofi minim-dependency sejak Tahap 1. **Tidak ada database test terpisah** — semua test jalan lewat helper `withRollback` (`modules/inventory/src/domain/test-helpers.ts`) yang selalu `ROLLBACK` di akhir, jadi test benar-benar memanggil domain layer & Postgres asli (bukan mock) tapi tidak pernah mengubah data seed yang sudah ada. Dikonfirmasi manual: jumlah baris di semua tabel transaksi tetap 0 dan `inventory_locations` tetap 2 baris setelah seluruh test suite jalan.

21 test: 7 di `core` (registry/modul on-off), 14 di `modules/inventory` (8 HPP, 6 stok). Hasil lengkap di § "Laporan hasil test" di bawah.

### 10.4 Penjualan paket: dekomposisi ke komponen + baris resep milik paket sendiri

Sesuai instruksi ("paket dipecah ke menu komponen"): `createPenjualan` mengurangi bahan dari **kedua** sumber saat menjual 1 unit paket:
1. Resep tiap menu komponen (lewat `inventory_paket_menu_baris`), dikali qty komponen dikali qty paket terjual.
2. Baris resep milik paket itu sendiri di `inventory_menu_resep_baris` (mis. kemasan luar paket/kresek tambahan) — paket JUGA punya baris resep sendiri, temuan dari Tahap 2 (lihat `docs/inventory-schema.md` § "Lokasi & entitas").

Ini konsisten dengan bagaimana HPP paket dihitung (rollup komponen SAJA, § 9) TAPI beda untuk stok — HPP sengaja tidak menghitung kemasan luar paket (mengikuti metodologi kolom HPP di sheet sumber), sedangkan pengurangan stok **harus** menghitungnya karena kemasan itu benar-benar dipakai secara fisik. **Konsekuensinya**: menjual satu paket mengurangi kertas thermal/kresek dari SETIAP komponen (masing-masing menu komponen punya baris strukanya sendiri) DITAMBAH dari paket itu sendiri — kemungkinan besar overstate pemakaian kemasan/struk kalau di dunia nyata cuma dicetak 1 struk per transaksi. Ini bagian dari simplifikasi yang sama seperti § 10.5 di bawah, bukan bug terpisah.

### 10.5 Simplifikasi yang diketahui (belum diperbaiki, perlu review owner/Ibnu)

- **Kertas thermal Coreless 5730 (OP-005)** dan **Kresek sedang Tic-Tas (PK-012)** masih dimodelkan sebagai baris resep PER PORSI MENU (dan per paket, lihat § 10.4) — padahal pemakaian aslinya realistis PER TRANSAKSI (1 struk dicetak untuk seluruh order, bukan 1 struk per item yang dijual). Konsekuensi: kalau satu transaksi penjualan berisi beberapa menu/qty, sistem saat ini akan mengurangi struk/kresek berkali-kali (satu kali per baris resep yang kena), bukan sekali per transaksi. Perbaikannya butuh redesain level transaksi Penjualan (satu struk per header, bukan per baris) — sengaja **tidak** dikerjakan sekarang karena itu perubahan arsitektur yang harus dikonfirmasi owner dulu (CLAUDE.md §5).
- **Konversi struk per roll adalah asumsi**: harga OP-005 sudah dikoreksi ke Rp50/pcs (§ 9), tapi `purchase_unit` ("pack") dan `purchase_to_recipe_factor` (100 pcs/pack) **belum diverifikasi ke pembelian aktual** — cuma hasil akhirnya (Rp50/pcs) yang dicocokkan ke pemakaian di resep. Kalau owner dapat nota pembelian struk yang sebenarnya, angka purchase_unit/konversi ini perlu ditinjau ulang.
- **Item operasional lain belum diaudit**: Cup Sealer (OP-002), Gas, Tissue, dan item `operasional` lain selain OP-005 **belum dicek ulang** dengan cara yang sama seperti OP-005 (lihat § 9) — bisa saja ada inkonsistensi harga serupa yang belum ketemu karena kebetulan tidak menghasilkan selisih HPP yang mencolok saat verifikasi Tahap 2/9 (mis. dampaknya kecil atau tidak dipakai di menu yang dicek). Rekomendasi: audit manual harga seluruh item `operasional` terhadap nota pembelian asli sebelum go-live.
- **`hasil_aktual` pada produksi wajib diisi manual saat insert** (model satu-tahap: dicatat setelah produksi selesai) — belum ada alur "mulai produksi → selesai produksi" dua tahap. Cukup untuk kebutuhan sekarang; kalau nanti perlu tracking produksi yang sedang berjalan, itu perubahan skema/alur baru.

---

## Ringkasan yang perlu direview owner

1. Keputusan DB **final** (2026-09-28): PostgreSQL native di localhost,
   database `samsara` sudah dibuat dan migrasi sudah jalan — lihat § 1b.
   Sudah ditandai FINAL di CLAUDE.md § 3.
2. Skema Inventory sudah **diverifikasi ke spreadsheet asli** dan datanya
   sudah di-seed (Tahap 2, § 7) — bukan draft lagi. Penyesuaian berikutnya
   (kalau spreadsheet sumber berubah) tetap lewat migrasi baru, bukan edit
   yang sudah ada.
3. Dari 3 temuan § 7, **2 sudah selesai** (§ 8): "Kacang" di Bubur Original
   sudah dikonfirmasi & ditambahkan, Garam sudah lepas dari `pending_data`.
   **Harga jual** masih menunggu Ibnu isi dari Majoo — tapi tooling-nya
   (`data/harga_jual_template.csv` + `npm run import:harga-jual`) sudah
   siap dipakai.
4. **Masih terbuka, perlu owner**: kemungkinan campur data lokasi
   lintas-brand di sheet `Ref` sumber (§ 7.1) — tidak berdampak ke Tahap 3
   (mesin transaksi cuma pakai 2 lokasi Samsara yang di-seed manual, § 8.4,
   tidak mengimpor data lokasi dari sheet `Ref`), tapi tetap belum
   diklarifikasi kalau nanti ada kebutuhan mengimpor data historis dari
   spreadsheet itu.
5. **Konsep entitas baru** (§ 8.3): 2 lokasi Samsara sekarang punya
   `entitas` (`samsara_ck`, `samsara_outlet`) untuk kebutuhan pembukuan
   internal antar cost-center — beda konsep dari isu brand di poin 4.
   Transfer antar lokasi otomatis ditandai `antar_entitas`; harga transfer
   internal ("Skema A": = HPP item di lokasi asal) disiapkan kolomnya,
   pengisian nilainya jadi tanggung jawab Tahap 3.
6. **HPP sudah diverifikasi lewat query SQL** (§ 9) terhadap sheet asli.
   Ketemu & sudah diperbaiki: harga "Kertas thermal Coreless 5730" yang
   inkonsisten di sumber data (migrasi `0012`, dikonfirmasi owner Rp50/pcs).
   45/46 menu dasar & 7/11 paket sekarang cocok dalam Rp1; sisanya beda
   ~Rp112×qty karena penambahan Kacang di poin 3 (bukan anomali baru).
   Baris resep duplikat di Bubur Original Jumbo (M-003) sengaja dibiarkan.
7. File Tahap 1 versi MySQL yang lama (staged di git, belum commit) sudah
   tidak dipakai — aman untuk di-`git add`/commit ulang dengan isi baru ini
   kapan pun owner siap (saya belum melakukan commit apa pun di sesi ini).
8. Auth `trust` di Postgres native lokal (lihat § 1b) nyaman untuk dev
   single-user tapi tidak untuk environment yang di-share/multi-user — perlu
   direview kalau setup mesin ini berubah.
9. **Tahap 3 (Backend Developer) selesai** (§ 10): mesin HPP (rekursif,
   pilihan metode, status `pending_data`), mesin stok (6 jenis transaksi,
   semua lewat `inventory_stock_ledger`), API REST 9 endpoint didaftarkan
   di module manifest, 21 test otomatis lulus (laporan lengkap di akhir
   dokumen ini).
10. **4 simplifikasi diketahui, belum diperbaiki** (§ 10.5) — perlu review
    owner/Ibnu sebelum go-live: struk/kresek dimodelkan per-porsi bukan
    per-transaksi (bisa overstate pemakaian), konversi struk per-roll belum
    diverifikasi ke nota pembelian asli, item operasional lain (Cup Sealer,
    Gas, Tissue) belum diaudit, dan produksi belum punya alur dua-tahap
    (mulai → selesai).
11. **Auth & permission lintas modul selesai dibangun di `core`** (§ 12):
    tabel user/role/lokasi, login JWT, password bcryptjs (owner pertama
    lewat `npm run seed:owner`, baca `.env`, tidak ada default di kode),
    permission dideklarasikan di `module.json` dan ditegakkan generik oleh
    `core`, filter field harga/HPP/margin di response untuk
    supervisor/staf, kolom audit `dibuat_oleh`. **25/25 test lulus** (4 baru,
    HTTP end-to-end).
12. **Semua 5 kesenjangan § 12.6 SUDAH DITUTUP** (§ 13, 2026-09-29) sesuai
    keputusan owner: penjualan dikonfirmasi, transfer jadi 2 tahap
    (kirim/terima, "dalam perjalanan" via view terpisah), opname jadi 2
    tahap (draft/keputusan), CRUD item & resep produksi + soft-delete +
    audit log (`core_audit_log`), pengaturan owner-only (metode HPP
    global, kelola lokasi & channel). **41/41 test lulus** (15 baru di
    `modules/inventory`, 1 baru di `apps/api`).
13. **Bug ditemukan & diperbaiki** (§ 12.7, § 13.4): `.env` di root ternyata
    tidak pernah termuat untuk script yang dijalankan lewat
    `npm run -w apps/api` (masalah `cwd`) — diperbaiki di `apps/api/src/env.ts`.
    `core_audit_log.user_id` awalnya tidak bisa di-`DELETE` user-nya (FK
    tanpa `ON DELETE`) — diperbaiki jadi `SET NULL` (migrasi `core` 0003).
    Keduanya tidak berdampak ke data.
14. **Gap keamanan token login, dilaporkan belum diperbaiki** (§ 13.6,
    sesuai instruksi "laporkan saja"): TIDAK ADA pembatasan percobaan login
    (rawan brute-force) dan TIDAK ADA mekanisme cabut/logout token (JWT
    stateless, token yang sudah terbit tetap valid 12 jam walau user
    dinonaktifkan). **Wajib diatasi sebelum Tahap 4/deploy**, belum
    dikerjakan sekarang sesuai instruksi.
15. **CRUD resep menu SUDAH DITUTUP** (§ 14, 2026-09-29) — poin 15 lama
    (scope "resep" cuma resep produksi) sudah diangkat owner dan dijawab:
    `PATCH /menu/:kode/resep` (ganti seluruh baris, satu endpoint untuk
    tambah+ubah — beda dari resep produksi yang punya `POST`/`PATCH`
    terpisah karena resep menu tidak punya header sendiri) dan
    `PATCH /menu/:kode/nonaktifkan` (ditolak kalau masih di paket aktif).
    Permission dipakai ulang dari `resep.edit` (bukan aksi baru). Trigger
    1-level resep produksi tidak disentuh; resep menu tetap tanpa
    pembatasan tipe bahan (operasional tetap boleh, sesuai temuan Tahap
    2/3). **45/45 test lulus** (4 baru). Tidak perlu migrasi.

---

## Laporan hasil test (Tahap 3, 2026-09-29)

`npm test` dari root (`core` + `modules/inventory`, `apps/api` tidak punya
test file). Semua lulus, dijalankan terhadap database `samsara` sungguhan
(bukan mock) lewat pola transaksi-rollback (§ 10.3) — dikonfirmasi setelah
test selesai: 0 baris baru di semua tabel transaksi & `stock_ledger`, 2
lokasi tetap seperti seed Tahap 2, tidak ada `harga_jual` yang ke-set.

```
core (7 test — modul on/off & validasi module manifest)
✔ buildRegistry: modul nonaktif tetap ada di daftar lengkap tapi bisa difilter keluar
✔ buildRegistry: menonaktifkan satu modul tidak mengubah urutan/keberadaan modul lain
✔ buildRegistry: menolak nama modul duplikat
✔ buildRegistry: menolak tablePrefix bentrok antar modul
✔ buildRegistry: menolak dependsOn yang tidak terdaftar
✔ buildRegistry: menolak dependency melingkar
✔ buildRegistry: urutan hasil mengikuti dependency (topological order)
tests 7, pass 7, fail 0

modules/inventory (14 test — mesin HPP & mesin stok)
✔ resolveItemCost: bahan_baku biasa baca harga_master langsung
✔ resolveItemCost: item setengah_jadi dihitung rekursif dari resep produksi (cocok verifikasi Tahap 2)
✔ resolveItemCost: item pending_data (yield resep kosong) mengembalikan pending, bukan error
✔ getMenuHppReport: menu dasar cocok dengan hasil verifikasi Tahap 2/9 (Bubur Polos, setelah koreksi OP-005)
✔ getMenuHppReport: paket = rollup komponen, cocok dengan hasil verifikasi (Saraf-an Sehat)
✔ getMenuHppReport: menu yang bergantung ke item pending_data (Mutiara) tampilkan status pending_data, bukan error
✔ getMenuHppReport: food_cost_pct dan margin null kalau harga_jual belum diisi
✔ getMenuHppReport: food_cost_pct dan margin terisi begitu harga_jual ada
✔ createPembelian: konversi satuan beli ke satuan resep otomatis
✔ createPembelian: item pending_data tanpa konversi satuan ditolak, bukan diproses dengan angka salah
✔ createTransfer: susut = qty_kirim - qty_terima, dan stok tiap lokasi bergerak sesuai qty masing-masing
✔ createTransfer: antar entitas terdeteksi otomatis, harga transfer default = HPP item di lokasi asal (Skema A)
✔ createTransfer: transfer dalam entitas yang sama TIDAK ditandai antar_entitas
✔ createOpname: qty_sistem snapshot dari stok saat ini, selisih diposting ke ledger
tests 14, pass 14, fail 0
```

**Total: 21/21 test lulus.** Cakupan sesuai 6 area yang diminta: HPP menu &
paket (cocok verifikasi § 9), stok setelah transfer dengan susut & antar
entitas, opname, item `pending_data` (HPP & pembelian), konversi satuan
pembelian, dan modul on/off.

Selain test otomatis, juga sudah dicoba manual lewat server sungguhan
(`npm run dev` + `curl`): endpoint HPP, stok, dan `POST
/transaksi/pembelian` end-to-end bekerja; data uji manual ini sudah
dibersihkan lagi dari database setelahnya (tidak seperti test otomatis
yang otomatis rollback, panggilan manual lewat HTTP sungguhan commit ke
DB).

---

## 11. Subagent Claude Code per peran (2026-09-29)

6 file agent dibuat di `.claude/agents/` (`module-guardian`, `db-migration`,
`backend-inventory`, `frontend-web`, `qa-verifier`, `docs-writer`) sesuai
tabel tugas/folder/batasan dari owner. Semua system prompt-nya merujuk ke
`CLAUDE.md` dan dokumen ini sebagai sumber aturan, dan menegaskan keputusan
arsitektur baru harus ditanyakan ke owner dulu — bukan diputuskan sendiri
oleh agent.

Ringkasan pembagian (detail lengkap ada di masing-masing file):

| Agent | Tools | Boleh mengubah |
|---|---|---|
| `module-guardian` | Read, Grep, Glob (read-only, tidak ada Edit/Write/Bash) | Tidak ada — hanya melapor |
| `db-migration` | Read, Write, Edit, Bash, Grep, Glob | `modules/*/src/db/migrations` |
| `backend-inventory` | Read, Write, Edit, Bash, Grep, Glob | `modules/inventory/src`, `apps/api` |
| `frontend-web` | Read, Write, Edit, Bash, Grep, Glob | `apps/web` |
| `qa-verifier` | Read, Write, Edit, Bash, Grep, Glob | File test saja |
| `docs-writer` | Read, Write, Edit, Bash, Grep, Glob | `docs/`, `README.md` |

**Catatan penting**: tool-list di frontmatter cuma mengatur tool apa yang
tersedia untuk agent itu, **bukan** pembatas folder — Claude Code tidak
punya mekanisme native untuk membatasi `Edit`/`Write`/`Bash` ke path
tertentu di level konfigurasi agent. Pembatasan folder ("boleh mengubah")
ditegakkan lewat instruksi eksplisit di badan system prompt tiap agent
("Ruang gerak menulis/mengedit HANYA ..."), bukan lewat tool permission.
Artinya kepatuhannya bergantung pada agent mengikuti instruksi itu — kalau
nanti perlu jaminan yang lebih keras (mis. lewat hook atau permission
settings per-path), itu perbaikan terpisah, belum dikerjakan di sini.

`apps/web` **belum ada** di repo ini — `frontend-web` disiapkan untuk
pekerjaan yang belum dimulai, bukan salah rujukan.

Tidak dibuat agent DevOps, sesuai instruksi eksplisit owner — Tahap 4
(deploy VPS) masih menunggu (CLAUDE.md § 3).

---

## 12. Auth & permission lintas modul, dibangun di `core` (2026-09-29)

Diminta owner secara eksplisit: sistem role/permission dibangun di `core`
(bukan di dalam modul Inventory) supaya modul apa pun ke depannya otomatis
ikut sistem yang sama. Ringkasan keputusan & implementasi:

### 12.1 Tabel: `core_users`, `core_roles`, `core_user_lokasi`

Migrasi baru `core/src/db/migrations/0001_create_auth_tables.sql` — migrasi
pertama milik `core` sendiri (sebelumnya cuma modul yang punya folder
migrasi). **Perubahan penting di `core/src/db/migrate.ts`**: migration
runner sekarang menjalankan migrasi `core` LEBIH DULU, baru migrasi modul
(urutan dependency seperti biasa) — supaya tabel fondasi seperti
`core_users` sudah ada sebelum modul mereferensikannya (lihat § 12.4).

`core_roles` diisi 4 baris tetap (`owner`, `manajer_ops`, `supervisor`,
`staf`) langsung lewat migrasi, bukan tabel yang diisi bebas — role dipakai
sebagai kunci di permission matrix `module.json`, jadi daftarnya harus
stabil.

**`core_user_lokasi` SENGAJA TANPA foreign key** ke `inventory_locations`.
Ini konsekuensi langsung dari instruksi "auth di core, lintas modul, bukan
di dalam modul Inventory": kalau `core` di-FK ke tabel milik modul
Inventory, `core` jadi hard-depend ke satu modul bisnis tertentu — kalau
modul Inventory dinonaktifkan/diganti/berubah skema, `core` (platform yang
dipakai SEMUA modul) ikut berisiko rusak. Arah dependency yang benar adalah
modul boleh bergantung ke `core`, bukan sebaliknya. Validasi "location_id
ini beneran ada" tetap dilakukan (lewat query ke `inventory_locations` saat
`createUser`/assign lokasi di `core/src/auth/users.ts`), cuma bukan lewat
constraint database. **Trade-off yang disadari**: tidak ada jaminan
referential integrity di level DB untuk kolom ini — kalau nanti sebuah
lokasi dihapus dari `inventory_locations`, baris `core_user_lokasi` yang
menunjuk ke situ tidak otomatis ikut terhapus/tervalidasi ulang.

### 12.2 Hashing password: bcryptjs (bukan bcrypt native atau argon2)

Instruksi mengizinkan argon2 atau bcrypt. Dipilih **bcryptjs** (implementasi
JS murni dari algoritma bcrypt) karena: (1) tidak butuh kompilasi native
saat `npm install` — proyek ini sudah pernah kena masalah Xcode Command
Line Tools di sesi sebelumnya, jadi menghindari dependency yang butuh
toolchain native mengurangi satu sumber kegagalan install; (2) argon2 di
Node umumnya juga butuh native binding. Kalau nanti performa hashing jadi
masalah nyata (bcryptjs lebih lambat dari versi native), gampang diganti ke
`bcrypt` tanpa mengubah API (`hashPassword`/`authenticate` di
`core/src/auth/users.ts` jadi satu-satunya tempat yang perlu diubah).
`BCRYPT_ROUNDS = 12` (default wajar untuk 2026, bisa dinaikkan tanpa
migrasi karena cuma memengaruhi hash baru).

**Owner pertama**: `apps/api/src/seed-owner.ts` (`npm run seed:owner`),
baca `AUTH_SEED_OWNER_USERNAME`/`AUTH_SEED_OWNER_PASSWORD` dari `.env`.
Idempotent — kalau sudah ada user ber-role owner, script berhenti tanpa
membuat user baru. **Tidak ada password default di kode/repo** — kalau
env var itu kosong, script gagal dengan pesan jelas, tidak fallback ke
apa pun.

### 12.3 Login: JWT, bukan session

`POST /api/auth/login` (di `core/src/auth/router.ts`, endpoint ini SATU-
SATUNYA yang tidak butuh login selain `/health`) mengembalikan JWT berisi
`{id, username, role, allLocations, locationIds}`, ditandatangani pakai
`AUTH_JWT_SECRET` dari `.env` (wajib diisi, tidak ada default di kode —
sama seperti password seed). Masa berlaku token 12 jam.

**Trade-off yang disadari**: `locationIds` di-embed di token saat login,
BUKAN dibaca ulang dari `core_user_lokasi` di setiap request. Konsekuensi:
kalau admin mengubah akses lokasi seorang user, perubahan itu baru berlaku
setelah user itu login ulang (atau token lama kedaluwarsa, maks 12 jam) --
bukan seketika. Ini keputusan kecil demi kesederhanaan (tidak perlu query
tabel lokasi di setiap request); kalau owner mau efeknya instan, itu
perubahan arsitektur terpisah (mis. simpan sesi di database, bukan JWT
stateless) yang perlu dikonfirmasi dulu.

### 12.4 Model permission: `module.json` mendeklarasikan, `core` menegakkan

Setiap endpoint di `module.json` § `api.endpoints` boleh punya field
`permission: { action, roles, locationScope? }`. `core/src/server/build-server.ts`
memanggil `initPermissionRegistry(allModules)` (membangun peta
`action -> definisi`, digabung dengan beberapa permission milik `core`
sendiri seperti `user.manage`) SEBELUM modul mana pun di-mount. Router modul
tinggal `import { requirePermission, hasPermission } from "@samsara/core"`
dan pasang `requirePermission("nama.aksi")` di route yang perlu digate, atau
`hasPermission(user, "nama.aksi")` untuk filter field non-blocking (lihat
§ 12.5). **Modul baru otomatis ikut sistem yang sama** tanpa membangun
middleware sendiri — cuma perlu mendeklarasikan permission-nya di
`module.json` dan memanggil fungsi yang sudah ada.

Ditambah field baru `ModuleManifest.permissions` (array `PermissionDef`
yang TIDAK terikat ke satu endpoint) untuk dua kebutuhan: (1) permission
untuk filter field seperti `hpp.lihat_harga` yang bukan gate akses endpoint
tapi gate per-field, dan (2) mendokumentasikan aksi yang DIRENCANAKAN tapi
endpoint-nya belum ada (`opname.approve`, `master_item.edit`, `resep.edit`
— lihat § 12.6).

`requireAuth` dipasang GLOBAL di `buildServer` (semua request setelah
`/health` dan `/api/auth/login` wajib bawa token valid), jadi modul tidak
perlu mengurus autentikasi sendiri, cuma otorisasi (permission) per aksi.

### 12.5 Filter field di response (bukan role gate)

`GET /items/:kode/hpp` dan `GET /menu/:kode/hpp` bisa **diakses** semua
role yang login (tidak ada `requirePermission` yang menolak) — yang
dibedakan per role adalah **field apa yang muncul** di response,
menggunakan `hasPermission(user, "hpp.lihat_harga")` (roles: owner,
manajer_ops) di dalam handler, bukan disaring di frontend. Supervisor/staf
dapat response tanpa `cost_per_recipe_unit` (item) atau tanpa
`hpp_per_porsi`/`food_cost_pct`/`margin` (menu) — field itu benar-benar
dihapus dari objek JSON (`delete`/destructuring), bukan di-null-kan, supaya
klien bisa membedakan "field tidak ada karena tidak berhak" vs "nilainya
null karena `pending_data`". **`harga_jual` TETAP tampil untuk semua
role** — itu bukan bagian dari "harga beli/HPP/margin" yang dibatasi,
staf perlu tahu harga jual untuk kerja sehari-hari.

### 12.6 Kesenjangan matriks vs implementasi — PERLU KEPUTUSAN/KONFIRMASI OWNER

Beberapa baris di matriks permission owner tidak punya padanan 1:1 dengan
endpoint yang ada, atau menyiratkan alur kerja yang belum dibangun. Semua
di bawah ini **didokumentasikan, tidak dipaksakan diam-diam**:

1. **"Penjualan" tidak ada di matriks yang diberikan.** Kemungkinan karena
   penjualan sungguhan nanti masuk lewat integrasi Majoo POS, bukan input
   manual staf lewat API ini. Saya beri default `penjualan.create`:
   owner/manajer_ops bebas lokasi, supervisor lokasi sendiri, staf tidak
   boleh — mengikuti pola pembelian/produksi. **Ini asumsi saya, bukan
   dari matriks, perlu dikonfirmasi.**
2. **"Transfer: Kirim dan terima" (supervisor) vs "Terima saja" (staf)**
   menyiratkan dua aksi terpisah (kirim vs terima), tapi endpoint
   `POST /transaksi/transfer` yang ada Tahap 3 membuat KEDUA sisi sekaligus
   dalam satu transaksi atomik (bukan alur dua pihak: pengirim mencatat
   kirim, penerima mengonfirmasi terima terpisah). Saya implementasikan
   sebagai pendekatan (bukan redesain): supervisor boleh kalau salah SATU
   sisi (asal/tujuan) lokasinya sendiri; staf boleh HANYA kalau lokasinya
   ada di sisi tujuan (tidak boleh jadi pengirim) — logic custom di
   `modules/inventory/src/api/router.ts`, didokumentasikan di
   `module.json`. **Alur "kirim" dan "terima" sebagai dua langkah terpisah
   (mis. status transfer "menunggu diterima") adalah redesain domain model
   yang lebih besar — belum dikerjakan, perlu keputusan owner kalau memang
   dibutuhkan.**
3. **"Setujui selisih opname dan koreksi"** menyiratkan alur dua tahap:
   input hitungan fisik dulu, lalu APPROVAL terpisah (owner/manajer_ops
   saja) sebelum selisihnya benar-benar memengaruhi stok. **Alur ini belum
   ada** — `POST /transaksi/opname` saat ini langsung memposting selisih ke
   ledger begitu dibuat, jadi siapa pun yang boleh `opname.input` (semua
   role) efektif juga "menyetujui" tanpa gate terpisah. Permission
   `opname.approve` (owner, manajer_ops) sudah didokumentasikan di
   `module.json` § `permissions` untuk referensi, tapi TIDAK ditegakkan
   karena tidak ada endpoint approval. **Membangun alur approval
   sungguhan (kolom status di `inventory_transaksi_opname`, tunda posting
   ledger sampai disetujui, endpoint approve terpisah) adalah perubahan
   domain model yang perlu dikonfirmasi owner dulu** — ini murni gap yang
   dilaporkan, bukan diperbaiki diam-diam (konsisten dengan cara kerja
   sesi-sesi sebelumnya).
4. **"Ubah master item dan resep"** (owner, manajer_ops) — belum ada
   endpoint untuk ubah `inventory_items`/`inventory_resep_produksi*` sama
   sekali (Tahap 3 cuma membangun baca-HPP dan catat-transaksi). Permission
   `master_item.edit`/`resep.edit` didokumentasikan untuk dipakai saat
   endpoint itu dibangun nanti.
5. **"Kelola user dan pengaturan"** — bagian "user" diimplementasikan
   (`POST`/`GET /api/auth/users`, permission `user.manage`, owner saja).
   Bagian "pengaturan" tidak dikerjakan karena tidak ada spesifikasi
   konkret soal pengaturan apa yang dimaksud.

### 12.7 Bug ditemukan & diperbaiki: `.env` tidak pernah termuat lewat `npm run -w`

Saat menyiapkan `AUTH_JWT_SECRET`, ketahuan `dotenv/config` (dipakai apa
adanya sejak Tahap 1 di semua entrypoint `apps/api`) memuat `.env` relatif
ke `process.cwd()` — sementara `npm run <script> -w apps/api` menjalankan
script dengan cwd `apps/api/`, BUKAN root repo. Akibatnya `.env` di root
**tidak pernah benar-benar termuat** sejak awal proyek ini; selama ini
"ketolong" karena nilai default `DB_HOST`/`DB_PORT`/dst. di
`core/src/db/pool.ts` kebetulan sama persis dengan isi `.env`. Begitu
`AUTH_JWT_SECRET` (yang sengaja tidak punya default) ditambahkan, bug ini
langsung kelihatan lewat error yang jelas.

**Diperbaiki**: `apps/api/src/env.ts` baru, resolve path `.env` ke root
repo secara eksplisit lewat `import.meta.url` (bukan bergantung pada cwd),
dipakai di semua entrypoint (`index.ts`, `migrate.ts`,
`import-harga-jual.ts`, `seed-owner.ts`) lewat `import "./env.js"`
menggantikan `import "dotenv/config"`. Tidak ada dampak ke data — ini
murni perbaikan cara environment variable dimuat.

### 12.8 Kolom audit `dibuat_oleh`

Migrasi baru `modules/inventory/src/db/migrations/0015_add_dibuat_oleh_transaksi.sql`
menambah kolom `dibuat_oleh BIGINT REFERENCES core_users(id)` (nullable) ke
KESEMUA 6 tabel header transaksi (`pembelian`, `produksi`, `penjualan`,
`transfer`, `mutasi_lain`, `opname`). Ini arah FK yang normal (modul boleh
mereferensikan tabel `core`, kebalikan dari § 12.1) karena tabel-tabel ini
milik modul Inventory sendiri, bukan `core` yang mereferensikan modul.
Fungsi domain (`createPembelian`, dst. di `modules/inventory/src/domain/stok.ts`)
sekarang menerima `createdByUserId?: number` opsional; router
(`modules/inventory/src/api/router.ts`) mengisinya otomatis dari
`getAuthUser(req).id` — client TIDAK mengirim field ini sendiri. Tabel
transaksi masih 0 baris (belum ada transaksi sungguhan) sebelum & sesudah
migrasi ini; **data seed dari Tahap 2 (92 item, 57 menu, dst.) dikonfirmasi
tidak berubah**.

### 12.9 Auth `trust` di Postgres lokal — CUMA untuk dev

Ditegaskan ulang (sudah pernah dicatat di § 1b, diulang di sini sesuai
instruksi eksplisit owner supaya tidak kelewat): koneksi ke Postgres lokal
di mesin dev ini pakai `pg_hba.conf` mode `trust` (tanpa password) —
**ini HANYA boleh untuk local development**. Ini beda total dari auth
aplikasi (JWT/user login) yang dibangun di sini — `trust` mengatur siapa
yang boleh connect ke database Postgres-nya sendiri, bukan siapa yang
boleh memanggil API. Saat deploy ke VPS nanti, Postgres WAJIB pakai
`scram-sha-256`/`md5` + password sungguhan sebagai secret (lihat § 1b),
dan `AUTH_JWT_SECRET`/password owner production juga harus beda dari nilai
dev di `.env` lokal ini.

### 12.10 Hasil test

`npm test` dari root: **25/25 lulus** (7 `core`, 14 `modules/inventory`
tidak berubah, **4 baru di `apps/api`** — HTTP end-to-end lewat server
sungguhan + `fetch`, bukan cuma panggil fungsi domain langsung):

```
apps/api (4 test baru — auth end-to-end)
✔ staf tidak bisa membuka stok lokasi lain (cuma lokasi sendiri)
✔ staf tidak menerima field harga/HPP/margin di response
✔ manajer_ops tidak bisa ubah harga jual (owner saja)
✔ modul nonaktif tetap tidak mengganggu server & auth (404, bukan 401/500)
```

Test ini beda pola dari test domain sebelumnya (§ 10.3): server HTTP
sungguhan (`app.listen(0)`, port acak) + `fetch` asli, karena tiap request
HTTP membuka koneksi/transaksinya sendiri (tidak bisa dibungkus satu
transaksi test yang di-rollback). User test dibuat langsung lewat SQL dan
**dihapus eksplisit di `after()`** — dikonfirmasi manual setelah test
selesai: 0 user `test_*` tersisa, `harga_jual` M-048 kembali `NULL`, cuma 1
user (`owner` sungguhan) di `core_users`.

Juga dicoba manual lewat `npm run dev` + `curl`: login → dapat token →
endpoint tanpa token ditolak 401 → endpoint dengan token berhasil 200,
semua sesuai desain.

---

## 13. Menutup 5 kesenjangan auth dengan keputusan owner (2026-09-29)

Lanjutan § 12.6. Semua keputusan di bawah ini berasal dari arahan eksplisit
owner, bukan asumsi saya. Migrasi baru saja (`core` 0002–0003,
`inventory` 0016–0018) — tidak ada migrasi lama yang diedit. Data seed
Tahap 2 dikonfirmasi tidak berubah (lihat § 13.7).

### 13.1 Penjualan: dikonfirmasi

`penjualan.create` di `module.json` sudah persis seperti yang diminta
owner (owner/manajer_ops bebas lokasi, supervisor lokasi sendiri, staf
tidak boleh) — **tidak ada perubahan kode**, cuma catatan "perlu
konfirmasi" di deskripsi endpoint dihapus dan diganti "dikonfirmasi owner".

### 13.2 Transfer 2 tahap: `dikirim` → `diterima`

Migrasi `inventory/0016_transfer_dua_tahap.sql`: `inventory_transaksi_transfer`
dapat kolom `status` (enum `dikirim`/`diterima`), `diterima_oleh`,
`diterima_at`; `inventory_transaksi_transfer_baris.qty_terima` dilonggarkan
jadi nullable (diisi cuma saat tahap terima). View baru
`inventory_transfer_dalam_perjalanan` (baris dengan header `status =
'dikirim'`) — ini jawaban atas "nilainya ditampilkan terpisah": bukan kolom
stok, murni query atas transfer yang belum diterima.

**Domain** (`modules/inventory/src/domain/stok.ts`): `createTransfer`
lama **diganti total** (bukan disimpan berdampingan) oleh
`createTransferKirim` (posting `-qty_kirim` ke ledger asal saja, hitung
`harga_transfer_per_satuan` di sini kalau `antar_entitas` — sesuai instruksi
"harga transfer tetap, dihitung saat kirim") dan `createTransferTerima`
(isi `qty_terima`, posting `+qty_terima` ke ledger tujuan, `susut =
qty_kirim - qty_terima` final di sini, tolak kalau transfer sudah
`diterima`).

**Permission**: `transfer.kirim` (owner/manajer_ops bebas lokasi, supervisor
lokasi sendiri — staf TIDAK ada di daftar, jadi otomatis 403) dan
`transfer.terima` (owner/manajer_ops/supervisor/staf boleh; lingkup lokasi
untuk terima dicek terhadap `location_tujuan_id` transfer yang **sudah ada
di database** (di-query dulu di `router.ts`), bukan dari body request — jadi
tidak lewat `locationScope` generik `requirePermission`, manual di route
handler).

**Pembatalan**: sesuai instruksi, **tidak ada endpoint hapus transfer sama
sekali** (tidak pernah dibangun, bukan "dihapus lagi") — kalau transfer yang
sudah dikirim perlu dibatalkan, jalurnya lewat `mutasi_lain` (transaksi
lawan yang mengembalikan stok), yang sudah ada dari Tahap 3.

**Test lama diganti isinya (bukan dihapus filenya)**: 4 test transfer lama
di `stok.test.ts` diganti jadi 6 test baru yang menguji alur 2 tahap
(termasuk "dalam perjalanan tidak masuk stok lokasi manapun" dan "susut
tercatat saat terima" — dua syarat eksplisit dari owner).

### 13.3 Opname 2 tahap: `draft` → `disetujui`/`ditolak`

Migrasi `inventory/0017_opname_dua_tahap.sql`: `inventory_transaksi_opname`
dapat kolom `status` (enum `draft`/`disetujui`/`ditolak`),
`diputuskan_oleh`, `diputuskan_at`.

**Domain**: `createOpname` sekarang **cuma menyimpan draft** — snapshot
`qty_sistem` tetap diambil saat itu juga (sesuai instruksi "snapshot stok
sistem saat menghitung"), tapi TIDAK ada lagi posting ke ledger di sini
(beda dari perilaku Tahap 3 sebelumnya). Fungsi baru `decideOpname`:
`"setuju"` → posting selisih (`qty_fisik - qty_sistem`) ke ledger per
baris (cuma yang selisihnya ≠ 0) dan set `diputuskan_oleh`/`diputuskan_at`;
`"tolak"` → tidak ada perubahan stok sama sekali, tetap dicatat
diputuskan_oleh/at. Draft yang sudah punya keputusan tidak bisa diputuskan
ulang (baik setuju maupun tolak).

**Permission**: `opname.input` tetap semua role (tidak berubah dari Tahap
3). `opname.approve` (sudah didokumentasikan sejak Tahap 3 tapi belum ada
endpoint) sekarang **punya endpoint sungguhan**
(`POST /transaksi/opname/:id/keputusan`), owner/manajer_ops saja.

### 13.4 Master item & resep produksi: CRUD + soft-delete + audit log

Tidak butuh migrasi skema untuk item/resep (kolom `is_active` sudah ada
dari Tahap 1/2) — cuma tabel audit log baru di `core`
(`core/src/db/migrations/0002_create_audit_log.sql`, tabel
`core_audit_log`: `user_id, table_name, record_id, field_name, old_value,
new_value, created_at` — satu baris per FIELD yang berubah, bukan per aksi,
supaya gampang di-query "field X pernah diubah kapan saja").

**File baru** `modules/inventory/src/domain/master.ts`: `createItem`,
`updateItem` (audit log otomatis untuk `harga_master` dan
`purchase_to_recipe_factor` — dua field yang diminta owner: "harga beli"
dan "konversi"), `deactivateItem` (cek pemakaian di `inventory_resep_produksi_baris`
DAN `inventory_menu_resep_baris`, tapi cuma yang resep/menu-nya `is_active
= true` — ditolak dengan pesan yang menyebutkan kode resep/menu-nya kalau
masih dipakai), `createResepProduksi`, `updateResepProduksi` (yield_qty
diaudit; `baris` kalau diisi MENGGANTI SELURUH baris lama, bukan
patch/tambah sebagian — disederhanakan sesuai kompleksitas yang wajar
untuk kebutuhan ini, diaudit sebagai satu entri `field_name = 'baris'`
berisi snapshot lama vs baru), `deactivateResepProduksi` (soft-delete
tanpa cek pemakaian — beda dari item, karena instruksi "tolak menonaktifkan
ITEM yang masih dipakai" cuma menyebut item, bukan resep).

**Trigger 1-level TETAP dijaga** — tidak disentuh sama sekali, dan
memverifikasi lewat test (`createResepProduksi` dengan bahan `setengah_jadi`
tetap ditolak, sekarang lewat jalur create yang baru).

`setMenuHargaJual` (sudah ada dari Tahap 3) sekarang juga menulis audit log
(field `harga_jual`, memenuhi "audit log untuk ... harga jual").

**Bug presisi ditemukan & diperbaiki saat menulis ini**: perbandingan
"apakah field berubah" di `core/src/auth/audit.ts` awalnya naif
(`stringify(old) === stringify(new)`) — gagal untuk kolom NUMERIC, karena
Postgres selalu mengembalikannya sebagai string (`"14.20"`) sementara body
request berisi angka JS (`14.2`), jadi dianggap "berubah" padahal sama.
Diperbaiki dengan `valuesEqual` yang membandingkan sebagai angka kalau
keduanya valid angka.

**Scoping yang saya putuskan sendiri (kecil, didokumentasikan)**: "resep"
di instruksi owner saya artikan sebagai **resep produksi** saja (bukan juga
resep menu / `inventory_menu_resep_baris`, dan bukan juga CRUD untuk
`inventory_menu` itu sendiri) — karena trigger 1-level yang disebut
eksplisit di instruksi memang cuma ada di resep produksi. Kalau owner
maksudnya resep menu juga perlu endpoint CRUD serupa, itu perlu diminta
eksplisit (bukan saya asumsikan sekarang, supaya tidak salah bikin scope
yang tidak diminta).

Ditemukan juga (lewat kegagalan test, bukan dugaan): FK
`core_audit_log.user_id` awalnya tanpa `ON DELETE` (default Postgres: `NO
ACTION`) — artinya user yang PERNAH menulis audit log tidak bisa dihapus
sama sekali. Diperbaiki lewat migrasi baru `core/src/db/migrations/0003_audit_log_user_fk_set_null.sql`
(`ON DELETE SET NULL` — riwayat audit tetap ada, cuma "siapa"-nya jadi
kosong kalau user itu dihapus).

### 13.5 Pengaturan: metode HPP global, lokasi, channel — owner saja

Tidak ada tabel baru untuk lokasi/channel (sudah ada dari Tahap 2, cuma
kurang endpoint kelola). Tabel baru `inventory_settings` (key-value,
migrasi `inventory/0018_create_settings.sql`), seed 1 baris
`hpp_default_method = 'harga_master'` (migrasi ini menambah baris BARU ke
tabel BARU — tidak menyentuh data seed Tahap 2 sama sekali).

`modules/inventory/src/domain/pengaturan.ts`: `getHppDefaultMethod`/`setHppDefaultMethod`,
`resolveHppMethod(client, user, queryMetode)` — logika persis sesuai
instruksi: kalau role owner/manajer_ops DAN `?metode=` valid dikirim,
dipakai (override); kalau tidak (termasuk kalau supervisor/staf mengirim
`?metode=` — **diabaikan, tidak ditolak**, supaya tidak memblokir akses
baca mereka), pakai default global. Dipanggil dari kedua endpoint HPP
(`GET /items/:kode/hpp`, `GET /menu/:kode/hpp`) menggantikan `parseMethod`
lama yang cuma baca query param tanpa peduli role/default global.

Lokasi (`createLokasi`, `updateLokasi` — name/entitas/is_active) dan
channel (`createChannel`, `updateChannel` — name/is_active) dikelola lewat
1 permission `pengaturan.manage`, **owner saja** (bukan owner+manajer_ops)
— mengikuti heading instruksi "Pengaturan khusus owner" secara literal
untuk SELURUH poin 5 (metode HPP, lokasi, channel), beda dari poin 4
(item/resep) yang owner+manajer_ops.

### 13.6 Laporan token login (diminta laporan saja, TIDAK diubah)

- **Jenis token**: JWT (`jsonwebtoken`), payload = `AuthUser` (`id,
  username, role, allLocations, locationIds`) — tidak dienkripsi, cuma
  ditandatangani (siapa pun bisa membaca isinya kalau tokennya bocor, tapi
  tidak bisa memalsukan tanda tangannya tanpa secret).
- **Masa berlaku**: 12 jam (`expiresIn: "12h"`, `core/src/auth/jwt.ts`),
  tetap, tidak ada refresh token.
- **Sumber secret**: `AUTH_JWT_SECRET` dari `.env`, wajib diisi, TIDAK ADA
  default di kode (`getJwtSecret()` melempar error kalau kosong). Secret
  dev di `.env` lokal ini digenerate sekali lewat `openssl rand -hex 32`
  (lihat § 12.9 soal secret production harus beda dari dev).
- **Pembatasan percobaan login**: **TIDAK ADA** — `POST /api/auth/login`
  bisa dicoba berkali-kali tanpa jeda/lockout/rate-limit apa pun. Ini gap
  keamanan nyata untuk brute-force kalau endpoint ini nanti ter-expose ke
  internet (belum relevan sekarang, masih local dev, tapi WAJIB diatasi
  sebelum Tahap 4/deploy).
- **Logout/pencabutan token**: **TIDAK ADA MEKANISME** — JWT di desain ini
  stateless (tidak ada tabel sesi/blacklist di database), jadi tidak ada
  cara "mencabut" satu token yang sudah diterbitkan sebelum masa
  berlakunya (12 jam) habis sendiri. Konsekuensi: kalau token bocor, atau
  admin mau langsung memutus akses satu user (mis. karyawan resign),
  **tidak bisa langsung** — user itu tetap bisa pakai token lama sampai
  kedaluwarsa. Mitigasi yang ADA sekarang: set `core_users.is_active =
  false` mencegah LOGIN BARU (`authenticate` mengecek `is_active`), tapi
  token yang SUDAH diterbitkan sebelum dinonaktifkan tetap valid sampai
  masa berlakunya habis. **Ini juga perlu keputusan/perbaikan sebelum
  Tahap 4** kalau butuh pencabutan token instan (opsi umum: simpan sesi di
  database dan cek tiap request, atau daftar token yang dicabut/blacklist)
  — belum dikerjakan, sesuai instruksi "laporkan saja, jangan ubah".

### 13.7 Konfirmasi data seed tidak berubah

Dicek ulang setelah semua migrasi & smoke test manual dibersihkan:

```
items: 92, menu: 57, resep_produksi: 12 (sama seperti akhir Tahap 2)
inventory_locations: 2, inventory_sales_channel: 4 (sama seperti Tahap 2/3)
inventory_settings.hpp_default_method: 'harga_master' (baris baru, tabel baru)
core_users: 1 (cuma owner asli), core_audit_log: 0
```

### 13.8 Hasil test

`npm test` dari root: **41/41 lulus** — 7 `core` (tidak berubah), **29
`modules/inventory`** (14 lama + 15 baru: 6 transfer 2-tahap, 4 opname
2-tahap, 6 master/audit-log, 3 pengaturan/HPP-global — lihat rincian di
bawah), **5 `apps/api`** (4 lama + 1 baru: staf tidak bisa
menyetujui/menolak opname).

```
modules/inventory (15 test baru)
✔ createTransferKirim: stok lokasi asal langsung berkurang, TAPI belum masuk stok lokasi manapun (dalam perjalanan)
✔ createTransferTerima: susut = qty_kirim - qty_terima tercatat saat terima, stok tujuan bertambah qty_terima
✔ createTransferTerima: transfer yang sudah diterima tidak bisa diterima ulang
✔ createTransferKirim: antar entitas terdeteksi otomatis, harga transfer default = HPP item di lokasi asal (Skema A), dihitung saat kirim
✔ createTransferKirim: transfer dalam entitas yang sama TIDAK ditandai antar_entitas
✔ createOpname: status draft, qty_sistem snapshot, TAPI stok BELUM berubah sampai disetujui
✔ decideOpname: 'setuju' memposting selisih ke ledger, tercatat siapa & kapan
✔ decideOpname: 'tolak' tidak mengubah stok sama sekali
✔ decideOpname: draft yang sudah diputuskan tidak bisa diputuskan ulang
✔ createItem: item baru tersimpan dengan status sesuai kelengkapan data
✔ updateItem: perubahan harga_master ditulis ke core_audit_log
✔ updateItem: tidak menulis audit log kalau nilai numerik sebenarnya sama
✔ deactivateItem: ditolak kalau item masih dipakai resep/menu AKTIF, daftar resepnya ditampilkan
✔ deactivateItem: berhasil untuk item yang tidak dipakai resep/menu apa pun
✔ createResepProduksi: trigger 1-level tetap berlaku (bahan setengah_jadi ditolak)
✔ createResepProduksi + updateResepProduksi: ganti baris bahan, yield_qty berubah tercatat di audit log
✔ resolveHppMethod: role owner/manajer_ops boleh override lewat query param
✔ resolveHppMethod: role supervisor/staf SELALU pakai default global, query param diabaikan
✔ setHppDefaultMethod: mengubah default global berlaku untuk semua role

apps/api (1 test baru)
✔ staf tidak bisa menyetujui/menolak opname (owner/manajer_ops saja)
```

Semua test HTTP (`apps/api`) commit sungguhan lalu dibersihkan eksplisit di
`after()`/`finally` (bukan rollback) — dikonfirmasi manual: 0 user `test_*`,
0 baris di `core_audit_log`, transfer/opname test terhapus, `inventory_settings`
kembali ke default. Endpoint baru yang belum tersentuh test otomatis (CRUD
item/resep, lokasi, channel, pengaturan HPP, transfer kirim/terima, opname
keputusan) sudah dicoba manual lewat `npm run dev` + `curl` satu per satu
dan datanya dibersihkan lagi setelahnya.

---

## 14. CRUD resep menu — menutup scope kecil dari § 13.4 (2026-09-29)

Owner mengonfirmasi "resep" di § 13.4 memang juga mencakup resep menu, bukan
cuma resep produksi. Tidak perlu migrasi — `inventory_menu.is_active` dan
`inventory_menu_resep_baris` sudah lengkap kolomnya sejak Tahap 1/2.

### 14.1 Bentuk API: satu endpoint ganti-seluruh-baris, bukan pasangan create/update

Resep produksi punya "header" terpisah (`inventory_resep_produksi`) dari
baris bahannya, jadi ada `POST` (bikin header+baris baru) dan `PATCH`
(ubah, baris opsional diganti seluruhnya) yang jelas beda. Resep menu
**tidak punya header terpisah** — "header"-nya ya `inventory_menu` itu
sendiri, dan menu-nya sudah pasti ada (57 menu dari seed Tahap 2, semuanya
sudah punya baris resep). Karena itu "tambah" dan "ubah" baris resep menu
digabung jadi **satu** endpoint: `PATCH /menu/:kode/resep`, body
`{baris: [...]}`, MENGGANTI SELURUH baris lama (delete lalu insert ulang) —
pola persis sama dengan `PATCH /resep-produksi/:kode` kalau field `baris`
diisi. Ini keputusan scope kecil yang saya ambil sendiri (bukan bikin
`POST` terpisah yang toh tidak akan pernah dipakai berbeda dari `PATCH`,
karena tidak ada kondisi nyata "menu belum punya resep sama sekali" di data
saat ini) — beri tahu kalau ternyata perlu endpoint `POST` terpisah juga.

`PATCH /menu/:kode/nonaktifkan` — soft-delete menu (`is_active = false`).

### 14.2 Trigger 1-level resep produksi: tidak disentuh

`inventory_check_resep_produksi_baris` (dan trigger-nya) sama sekali tidak
diubah oleh perubahan ini — CRUD resep menu ada di jalur kode yang
sepenuhnya terpisah (`updateMenuResep` di `modules/inventory/src/domain/master.ts`,
langsung `INSERT` ke `inventory_menu_resep_baris`, bukan
`inventory_resep_produksi_baris`). **Sengaja tidak ada pembatasan tipe
bahan** untuk resep menu (tidak ada trigger baru ditambahkan) — ini
konsisten dengan temuan Tahap 2/3 (migrasi `0006`) bahwa resep menu
memang butuh boleh pakai item `operasional` (mis. kertas struk, kresek).
Menambahkan pembatasan di sini akan mengulang bug yang sudah pernah
diperbaiki.

### 14.3 Permission: `resep.edit` dipakai ulang, bukan aksi baru

Endpoint baru (`PATCH /menu/:kode/resep`, `PATCH /menu/:kode/nonaktifkan`)
memakai permission `resep.edit` yang sama dengan resep produksi
(owner/manajer_ops) — bukan aksi baru seperti `resep_menu.edit`, karena
konsepnya sama ("siapa boleh mengubah resep") dan instruksi owner memang
menyebut izin yang sama ("izin owner dan manajer_ops", tanpa membedakan
dari resep produksi).

### 14.4 Nonaktifkan menu: cek pemakaian di paket AKTIF (bukan di resep produksi)

`deactivateMenu` menolak kalau menu masih jadi komponen di
`inventory_paket_menu_baris` milik paket yang `is_active = true`, pesan
error menyebutkan kode paketnya — pola yang sama persis dengan
`deactivateItem` (§ 13.4), cuma target pemakaiannya beda (paket, bukan
resep). Menu yang merupakan paket itu sendiri (bukan komponen) tidak kena
pembatasan ini karena tidak ada nesting paket-di-dalam-paket di desain
sekarang.

Audit log: `updateMenuResep` menulis field `baris` (snapshot lama vs baru,
sama pola dengan resep produksi), `deactivateMenu` menulis field
`is_active`. Keduanya di `table_name = 'inventory_menu'`.

### 14.5 Hasil test

`npm test`: **45/45 lulus** (4 baru di `modules/inventory`, tidak ada
perubahan di `core`/`apps/api`):

```
✔ updateMenuResep: mengubah qty bahan langsung mengubah HPP menu itu (tanpa langkah tambahan)
✔ updateMenuResep: perubahan baris dicatat ke core_audit_log
✔ deactivateMenu: ditolak kalau menu masih ada di paket AKTIF, daftar paketnya ditampilkan
✔ deactivateMenu: berhasil untuk menu yang bukan komponen paket manapun
```

Dicoba juga manual lewat `npm run dev` + `curl`: ubah qty bahan M-047 (Air
mineral) dari 1 jadi 2 botol → HPP naik dari Rp1.633,33 jadi Rp3.216,66 →
dikembalikan ke 1 botol → HPP balik ke Rp1.633,33 persis (membuktikan HPP
memang dihitung live dari baris resep, tidak ada cache tersembunyi).
Percobaan nonaktifkan M-002 (dipakai 4 paket aktif) ditolak dengan daftar
`M-037, M-038, M-040, M-041`. Semua data uji (termasuk resep M-047 yang
sempat diubah) dikembalikan/dibersihkan — dikonfirmasi jumlah menu tetap
57, `core_audit_log` kembali 0 baris, resep M-047 identik dengan sebelum
diuji.

---

## 15. Frontend `apps/web` — scaffold, isolasi filesystem, dan insiden pemindahan folder (2026-09-29)

### 15.1 Stack dan keputusan default (teknis kecil, tidak perlu approval owner)

- **React 19 + React Router 7 + Vite 6 + TypeScript**, Tailwind CSS v4
  (`@tailwindcss/vite`, tanpa file config terpisah — cukup
  `@import "tailwindcss";` di `src/index.css`).
- **Proxy dev** (`vite.config.ts`): `/api` dan `/health` diarahkan ke
  `http://localhost:4000` supaya browser memanggil path relatif dan tidak
  kena masalah CORS (backend memang belum punya middleware CORS sama
  sekali). Ini murni pengaturan dev server, tidak mengubah backend. Untuk
  production nanti perlu diputuskan: reverse proxy satu origin, atau
  tambah CORS di backend — **belum diputuskan, tunggu Tahap 4/deploy**.
  Baca § 3 kalau lupa: production/VPS memang belum boleh disentuh tanpa
  owner minta.
- **Helper permission UI-only** (`src/auth/permissions.ts`): fungsi seperti
  `bisaLihatHarga`, `bisaUbahHargaJual`, dll. meniru aturan role yang
  sama seperti backend, dipakai HANYA untuk menyembunyikan/menampilkan
  elemen UI (misal tombol "Ubah harga jual" tidak dirender untuk staf).
  Ini eksplisit BUKAN batas keamanan — backend tetap validasi ulang lewat
  `requirePermission`. Kalau sinkronisasi aturan role ini nanti berubah
  di backend, helper ini harus diperbarui manual (belum ada mekanisme
  share otomatis antara backend dan frontend untuk aturan role).
- **Data mock/placeholder untuk halaman 2–5** (Menu & HPP, Stok, Transaksi,
  Master): backend saat ini belum punya endpoint GET list/browse untuk
  menu, item, resep produksi, lokasi, channel, antrian opname, atau audit
  log (baru ada endpoint per-kode/detail). Owner memutuskan: **bangun UI
  dulu dengan data contoh**, endpoint list yang hilang menyusul belakangan
  — bukan diblokir menunggu backend selesai duluan.
- Belum ditambahkan **React Query** atau library data-fetching lain —
  sengaja ditunda sampai dikonfirmasi ke owner, supaya tidak menambah
  dependency besar tanpa alasan jelas di tahap awal ini.

### 15.2 Insiden pemindahan folder proyek (2026-09-29) — laporan transparansi

Selama scaffolding `apps/web`, ditemukan bug fatal: Vite (dan kemungkinan
bundler lain) tidak bisa jalan kalau path proyek mengandung karakter `#`.
Folder kerja saat itu bernama `/Users/nazmi/samsara-backoffice #1`. Build
produksi gagal total (`vite:build-html Failed to resolve /src/main.tsx`),
dan dev server pun sebenarnya rusak juga — halaman blank, `/@vite/client`
404, error sintaks JS di console. Dicoba workaround symlink ke path tanpa
`#`, tapi Vite tetap resolve ke path asli (real path) lewat `realpath`,
jadi tidak membantu. Satu-satunya solusi adalah **mengganti nama folder
proyek** supaya tidak mengandung `#` — sudah dikonfirmasi ke owner
sebelum dieksekusi.

Saat eksekusi, sempat terjadi kesalahan: `mv` folder lama langsung ke nama
tujuan `/Users/nazmi/samsara-backoffice` tanpa cek dulu apakah folder itu
sudah ada — ternyata sudah ada folder lama tak terpakai di situ (berisi
`index.php` yang tidak berkaitan sama sekali dengan proyek ini, plus satu
snapshot proyek versi sangat awal peninggalan sebelum keputusan final
Postgres native, dengan git repo terpisah yang juga belum pernah commit).
Akibatnya proyek yang sedang aktif dikerjakan malah ter-nesting di dalam
folder lama itu, bukan menggantikannya.

Tidak ada data yang hilang di titik manapun — kesalahan ini langsung
diinvestigasi dulu (bukan langsung diperbaiki/ditimpa) sebelum bertindak,
sesuai aturan "jangan hapus/timpa state yang tidak dikenal tanpa
diperiksa dulu". Setelah dikonfirmasi ke owner, perbaikan dilakukan lewat
tiga langkah `mv` direktori (bukan copy atau delete) yang murni
mengganti nama, tidak ada penghapusan:

1. Proyek aktif (yang ter-nesting) dipindah sementara ke nama sementara.
2. Folder lama (berisi `index.php` + snapshot lama) di-rename jadi folder
   cadangan bertanggal: **`/Users/nazmi/samsara-backoffice-lama-20260929`**
   — disimpan utuh, tidak dihapus.
3. Proyek aktif dari nama sementara di-rename naik jadi
   `/Users/nazmi/samsara-backoffice` (path final, tanpa `#`).

Hasil akhir path proyek yang benar dan aktif dipakai mulai sekarang:
**`/Users/nazmi/samsara-backoffice`** (tanpa `#1`, tanpa nesting). Folder
`samsara-backoffice-lama-20260929` sengaja dibiarkan ada sebagai arsip —
isinya tidak relevan dengan pekerjaan yang sedang berjalan (file PHP tak
berkaitan + snapshot proyek usang), tapi tidak dihapus supaya tetap bisa
diperiksa/direstore kalau owner butuh. Boleh dihapus permanen kapan pun
owner sudah yakin tidak diperlukan lagi — belum dihapus di sini karena
penghapusan permanen tidak dilakukan tanpa instruksi eksplisit.

Setelah pemindahan, seluruh monorepo diverifikasi ulang dari path baru:
`npm run typecheck` bersih di ke-4 workspace (`core`, `modules/inventory`,
`apps/api`, `apps/web`), `npm test` tetap **45/45 lulus**, dan dev server
`apps/web` dicoba langsung di browser — halaman Login tampil normal, form
login berhasil (owner) sampai masuk ke halaman dashboard dengan navigasi
sesuai role. Bug path `#` dikonfirmasi hilang total.

### 15.3 Halaman 2-5 (Menu & HPP, Stok, Transaksi, Master) -- dibangun dan diverifikasi end-to-end (2026-09-29)

Pola yang dipakai konsisten di semua 4 halaman: **daftar/list dari snapshot
data referensi ASLI** (bukan karangan -- diambil langsung dari database
lokal lewat query manual sekali di awal sesi, ditulis ke
`apps/web/src/mock/referenceData.ts`), sementara **setiap aksi (lihat
detail HPP, submit transaksi, simpan resep, dst) selalu memanggil API
asli** yang sudah ada. Banner kuning "Data contoh" ditampilkan di
setiap halaman yang daftarnya masih snapshot, supaya tidak ada yang
salah kira itu data live. Pendekatan ini dipilih karena backend belum
punya endpoint GET list untuk menu/item/resep-produksi/lokasi/channel/
antrian-opname (sudah diidentifikasi sejak laporan struktur), dan owner
sudah memutuskan: bangun UI dulu dengan data contoh, endpoint list
menyusul belakangan.

Komponen baru yang dipakai lintas halaman: `ItemPicker`/`MenuPicker`
(searchable combobox dari snapshot), `LokasiPicker` (dibatasi
`user.locationIds` kalau bukan `allLocations`), `BarisEditor` (daftar
{item, qty, satuan} generik untuk resep produksi & resep menu),
`ConfirmDialog` (dipakai sebelum nonaktifkan item/resep/menu),
`MockDataNotice` dan `ResultBox`/`ErrorBox`.

**Bug ditemukan & diperbaiki selama verifikasi manual di browser**:
`DalamPerjalananRow` (`apps/web/src/api/types.ts`) awalnya mengetik
`transferId`/`locationAsalId`/`locationTujuanId` sebagai `number`,
padahal kolom aslinya BIGINT sehingga `pg` mengembalikannya sebagai
string (pola yang sama seperti `headerId` di tempat lain) -- ketahuan
karena pencocokan lokasi asal di halaman Terima Transfer gagal diam-diam
(`MOCK_LOKASI.find` selalu `undefined`). Diperbaiki: field-field itu
diketik ulang jadi `string`, `createTransferTerima` menerima
`number | string`, dan perbandingan ID di `TransferTerimaPanel`
di-`Number()`-kan. Juga ditemukan bug kedua: form ubah harga jual di
halaman Menu & HPP hanya nge-patch `harga_jual` di state lokal setelah
simpan, jadi `food_cost_pct`/`margin` yang tampil tidak ikut kehitung
ulang -- diperbaiki dengan refetch penuh laporan HPP setelah simpan.

**Verifikasi dilakukan dengan transaksi SUNGGUHAN lewat API asli** (bukan
cuma render check): pembelian, produksi, penjualan, transfer kirim+
terima (termasuk susut), mutasi lain, dan opname draft+persetujuan semua
dicoba end-to-end di browser dan berhasil. Semua data uji coba (termasuk
1 item, 1 resep-baris-edit, 1 menu-resep-edit, dan harga_jual M-001)
dibersihkan lagi setelah verifikasi -- dikonfirmasi lewat query langsung
bahwa `inventory_stock_ledger`, `core_audit_log`, dan semua tabel
transaksi kembali ke 0 baris, jumlah item (92) dan menu (57) tidak
berubah dari sebelum sesi ini.

**Keterbatasan yang sengaja dibiarkan (bukan bug, perlu endpoint baru)**:
tab "Persetujuan" opname tidak bisa menampilkan daftar draft yang
menunggu -- backend belum punya endpoint list/detail untuk opname draft,
jadi owner/manajer ops harus memasukkan nomor draft (headerId) secara
manual, dikirim dari staf yang input. Ini ditampilkan jelas sebagai
banner keterbatasan di halaman itu sendiri, bukan disembunyikan.

`npm run typecheck` (4 workspace) dan `npm test` (45/45) tetap lulus
setelah semua halaman ini selesai.

### 15.4 GET /transaksi/opname (daftar draft/riwayat) + tab Persetujuan pakai daftar sungguhan (2026-09-29)

Menutup salah satu gap yang tercatat di § 15.3: tab Persetujuan Opname
sekarang menampilkan **daftar draft sungguhan** dari endpoint baru
`GET /inventory/transaksi/opname?status=draft&location=<id>` (`status`
opsional, terima `draft`/`disetujui`/`ditolak` untuk riwayat juga; kosong =
semua status), bukan lagi input nomor manual. Endpoint baru:
`listOpname` di `modules/inventory/src/domain/stok.ts` -- satu query
gabungan header+baris+item (bukan N+1). Izin disamakan dengan
`opname.approve` (owner/manajer_ops) sesuai instruksi owner, dipisah dari
`stok.lihat` supaya supervisor/staf yang cuma boleh lihat stok tidak ikut
bisa melihat antrian persetujuan.

Bug kecil ketemu & diperbaiki saat verifikasi: kolom `tanggal` (DATE)
dari Postgres ke JSON lewat `pg`+`res.json` jadi timestamp UTC penuh
(mis. `2026-09-28T17:00:00.000Z` untuk tanggal `2026-09-29` di zona
WIB) -- diperbaiki dengan `to_char(tanggal, 'YYYY-MM-DD')` di query,
bukan format ulang di frontend.

Halaman `apps/web/src/pages/transaksi/OpnameApprovalPanel.tsx` ditulis
ulang: fetch daftar draft saat tab dibuka, klik satu baris untuk lihat
detail (baris item + selisih) dan Setujui/Tolak, refetch otomatis
setelah diputuskan. Diverifikasi end-to-end lewat browser dengan
transaksi sungguhan (input draft -> muncul di daftar -> disetujui ->
hilang dari daftar draft), data uji dibersihkan lagi setelahnya.

`npm test`: **54 lulus** (7 core + 42 inventory + 5 api), naik dari 45
sebelumnya (1 test baru `listOpname` + beberapa dari § 15.5 di bawah).

### 15.5 Master kategori & satuan (dropdown mengurangi human error di form item) (2026-09-29)

**Migrasi baru** `modules/inventory/src/db/migrations/0019_create_kategori_dan_satuan.sql`:
tabel `inventory_kategori_item` dan `inventory_satuan`, diseed dari nilai
DISTINCT yang SUDAH dipakai 92 item existing (10 kategori, 26 satuan)
supaya tidak ada item lama yang jadi "tidak valid" begitu validasi baru
aktif. `inventory_satuan` sengaja SATU tabel dipakai untuk satuan resep
MAUPUN satuan beli (bukan dua tabel terpisah) -- banyak nilai yang sama
dipakai untuk keduanya di data nyata (gr, pcs, botol, dst).

**Keputusan desain (teknis kecil, diambil default masuk akal)**: kolom
`inventory_items.category`/`recipe_unit`/`purchase_unit` TETAP TEXT bebas,
TIDAK diubah jadi foreign key ke tabel master ini. Alasannya: FK berarti
migrasi skema besar yang menyentuh 92 item existing plus semua titik kode
yang baca kolom itu sebagai teks (HPP, laporan, dst) -- risiko tinggi
untuk manfaat yang sama. Sebagai gantinya dipakai pola **validasi di
application layer** yang sudah ada preseden di codebase ini
(`core_user_lokasi` -- lihat `core/0001`): `createItem`/`updateItem`
(`modules/inventory/src/domain/master.ts`) sekarang mengecek
`kategoriExists`/`satuanExists` (`modules/inventory/src/domain/referensi.ts`)
sebelum insert/update, ditolak dengan pesan jelas kalau nilainya belum
ada di master.

**Bug pre-existing ketemu & diperbaiki sambil di sini**: `updateItem`
sebelumnya TIDAK mendukung ubah `recipe_unit` sama sekali (field itu
tidak ada di `UpdateItemInput` maupun query UPDATE-nya) -- form edit di
frontend sudah lama mengirim field ini tapi diam-diam diabaikan backend.
Ditambahkan sekarang karena field ini pas jadi salah satu dari 3 field
yang diminta jadi dropdown (kategori, satuan resep, satuan beli) --
tanpa perbaikan ini dropdown "Satuan resep" di form edit cuma kosmetik.
Perbaikan field `name` yang punya gejala serupa (dikirim frontend, tidak
disimpan backend) SENGAJA TIDAK disentuh di sini -- di luar permintaan
kategori/satuan, dilaporkan terpisah ke owner sebagai gap yang belum
diperbaiki.

**Endpoint baru** (izin `master_item.edit`, sama seperti create/update
item -- owner & manajer_ops, supaya tidak jadi bottleneck kalau
manajer_ops butuh kategori/satuan baru): `GET/POST /kategori`,
`PATCH /kategori/:id`, `GET/POST /satuan`, `PATCH /satuan/:id`.

**Frontend**: field "Kategori", "Satuan resep", "Satuan beli" di form
tambah & ubah item (`apps/web/src/pages/master/ItemTab.tsx`) sekarang
dropdown (`RefSelect`, komponen baru di `components/RefSelect.tsx`)
diisi dari endpoint sungguhan (BUKAN data contoh/mock -- ini beda dari
pola snapshot di § 15.3, karena endpoint list-nya memang sudah dibuat).
`RefSelect` punya opsi "+ Tambah baru..." bawaan yang buka mini-form
inline dan langsung panggil API `createKategori`/`createSatuan` --
tanpa ini, validasi server-side yang baru justru bikin owner/manajer_ops
buntu kalau butuh nilai yang belum ada di master.

**Pertanyaan owner (dijawab, bukan perubahan kode)**: harga_master TIDAK
otomatis berubah kalau ada pembelian baru -- kolom itu murni manual
(diubah lewat PATCH /items/:kode). Yang otomatis mengikuti harga beli
terakhir adalah metode HPP `harga_beli_terakhir` (lihat § 3 CLAUDE.md dan
`modules/inventory/src/domain/hpp.ts`) -- itu DIHITUNG LIVE dari baris
pembelian terakhir tiap kali HPP diminta, bukan menulis balik ke
harga_master. Jadi ada 2 cara pakai: (a) harga_master manual + stabil
(default), atau (b) pilih metode `harga_beli_terakhir` (global di
Pengaturan atau override per-query owner/manajer_ops) supaya HPP selalu
ikut pembelian terbaru tanpa perlu ada yang mengubah harga_master.

**Verifikasi**: `npm test` **54 lulus** (5 test baru: 3 validasi
kategori/satuan di `master.test.ts`, 5 CRUD dasar di `referensi.test.ts`
baru). Dicoba manual di browser: tambah item baru dengan kategori/satuan
lewat dropdown, tambah kategori baru inline dari dalam form, edit item
existing (Bubur) dan konfirmasi ketiga dropdown ter-prefill benar dari
nilai existing-nya. Semua data uji coba dibersihkan lagi -- kategori
kembali ke 10, satuan ke 26, audit_log ke 0.

## 16. Login PIN untuk staf + kelola user + rate-limiting login (2026-10-03)

Mengikuti matriks role yang disetujui owner 3 Okt 2026
(`Matriks_Role_Samsara.xlsx`, disimpan ke tim): owner/manajer_ops/
supervisor tetap login username+password; **staf login lewat PIN**
(pilih lokasi -> pilih nama -> PIN), bukan ketik username. Dikerjakan
langsung lintas `core` (migrasi via `db-migration`, logika aplikasi
langsung oleh sesi utama -- di luar scope `backend-inventory` yang
khusus `modules/inventory`), frontend via `frontend-web`.

### 16.1 Skema baru (2 migrasi baru di `core/src/db/migrations/`)

`0004_add_pin_login_and_login_attempts.sql`: `core_users.pin_hash`
(nullable), `core_users.password_hash` direlaksasi jadi nullable (staf
tidak punya password sama sekali), tabel baru `core_login_attempts`
(user_id nullable `ON DELETE SET NULL`, username, method
`'password'|'pin'`, success, attempted_at + index `(user_id,
attempted_at)`). **Sengaja tidak ada CHECK constraint** "exactly one of
password_hash/pin_hash" -- dijelaskan di komentar migrasi: PIN yang sama
persis menghasilkan hash bcrypt yang BEDA (salt acak per hash), jadi
keunikan PIN pun mustahil dicek di level SQL, harus di application layer
lewat `bcrypt.compare` satu-satu terhadap kandidat.

`0005_add_display_name_to_users.sql`: kolom `name` (NOT NULL, backfill
dari `username` untuk baris lama) -- dibutuhkan belakangan setelah
ketahuan form "Kelola User" butuh field nama tampilan terpisah dari
`username` (staf tidak pernah mengetik username sama sekali).

### 16.2 Desain: staf tetap punya `username` (wajib unik), walau tidak pernah mengetiknya

Supaya `AuthUser.username: string` (dipakai luas, termasuk payload JWT
dan tampilan UI) tidak perlu diubah jadi nullable -- yang akan merembet
ke banyak tempat -- staf dapat `username` hasil slug otomatis dari nama
(`fitri`, `fitri2` kalau tabrakan), murni identifier internal.

### 16.3 PIN: 6 digit, di-generate otomatis, TIDAK bisa diset manual lewat form

PIN digenerate `node:crypto`'s `randomInt` (bukan `Math.random`), 6
digit. Form "Kelola User" **sengaja tidak punya input PIN sama sekali**
untuk role staf -- PIN selalu di-generate server, dikembalikan SEKALI di
response `POST /api/auth/users` (`generatedPin`), ditampilkan sekali di
UI ("catat sekarang, tidak akan ditampilkan lagi"), tidak pernah
disimpan plaintext di mana pun. Alasan: mencegah owner memilih PIN yang
gampang ditebak ("111111").

### 16.4 Rate-limiting: sliding window murni dari query, tanpa mekanisme "buka kunci" terpisah

`core/src/auth/rate-limit.ts`: terkunci (`429`) kalau 5 percobaan
TERAKHIR user ini (gabungan method password+PIN, sesuai permintaan
owner) dalam 15 menit semuanya gagal. Begitu ada satu sukses di antara 5
terakhir, atau lewat 15 menit, otomatis tidak terkunci lagi -- tidak
butuh state/flag terpisah yang perlu direset manual.

### 16.5 Endpoint baru/diperluas (semua di `core/src/auth/router.ts`, bukan modul)

- `POST /api/auth/login-pin` (publik, `{userId, pin}`) dan
  `GET /api/auth/staf?lokasi=` (publik, daftar nama staf aktif di satu
  lokasi, tanpa field sensitif) -- keduanya didaftarkan di router yang
  sama dengan `/login`, di-mount SEBELUM `requireAuth` global di
  `build-server.ts`, jadi otomatis tidak butuh token (sama seperti
  `/login` yang sudah ada).
- `POST /api/auth/users` diperluas: `name` wajib semua role; role
  password (owner/manajer_ops/supervisor) tetap wajib username+password;
  role staf wajib `locationIds` (>=1), `pin` opsional (lihat §16.3).
- `PATCH /api/auth/users/:id` (baru) -- ubah nama/status aktif/lokasi
  (full-replace, bukan merge).

### 16.6 Gap keamanan ditemukan & diperbaiki saat verifikasi manual (bukan diminta eksplisit, ditemukan lewat testing)

Saat mencoba halaman "Kelola User" sungguhan di browser, ketahuan akun
**owner sendiri** tampil dengan tombol "Nonaktifkan" aktif -- karena
cuma ada SATU akun owner dan halaman ini owner-only, menonaktifkan diri
sendiri secara tidak sengaja berarti terkunci total dari fitur kelola
user (tidak ada akun owner lain untuk membatalkannya lewat UI). Diperbaiki
dua lapis: backend (`PATCH /api/auth/users/:id` menolak 400 kalau
`isActive:false` ditujukan ke akun yang sedang login sendiri) dan
frontend (tombol "Nonaktifkan" diganti label "Akun kamu" untuk baris
akun sendiri). Field lain (nama) di akun sendiri tetap bisa diubah --
yang ditolak spesifik cuma menonaktifkan diri sendiri. Dites otomatis
(`PATCH /api/auth/users/:id: owner tidak bisa menonaktifkan akun
sendiri`).

### 16.7 Bug tipe BIGINT-jadi-string ditemukan & diperbaiki langsung (pola yang sama berulang kali di codebase ini)

Semua `id` baru (`CreateUserResult.id`, `listUsers()[].id`,
`listActiveStafByLocation()[].id`) awalnya diketik `number` tapi
`core_users.id` adalah BIGINT -- runtime-nya string (dikonfirmasi lewat
curl langsung sebelum diteruskan ke `frontend-web`). Diperbaiki di
`core/src/auth/users.ts` sebelum delegasi ke frontend, supaya kontrak
yang diberikan ke `frontend-web` sudah benar sejak awal (tidak mengulang
pola gagal yang sama seperti §15.3/15.4/15.5 sebelumnya).

**Catatan: `AuthUser.id` (tipe JWT payload, `core/src/auth/types.ts`)
PUNYA bug yang sama tapi SENGAJA TIDAK diperbaiki** -- ini konvensi
lama dari Tahap auth awal, dipakai luas di seluruh app (frontend
`AuthUser` type, setiap pengecekan `user.id`). Memperbaikinya dengan
benar berarti mengubah jadi `string` dan merembet ke banyak tempat --
di luar scope sesi yang menemukannya. Didokumentasikan dengan komentar
tebal di `core/src/auth/types.ts` supaya tidak dikira luput diperiksa;
kalau perlu membandingkan `AuthUser.id`, selalu bungkus `String(...)`
di kedua sisi (lihat contoh guard self-deactivation di §16.6).

### 16.8 Frontend: halaman Login 2 tab, "Kelola User" di bawah Pengaturan

`LoginPage.tsx` sekarang py tab "Login Tim" (default) dan "Login
Manajemen". Login Tim: pilih lokasi (dari `MOCK_LOKASI`, bukan
`useLokasiOptions` yang butuh auth context) -> pilih nama (live dari
`GET /auth/staf`) -> keypad PIN besar (`PinKeypad.tsx`, auto-submit di 6
digit). `PengaturanPage.tsx` yang sebelumnya placeholder polos sekarang
bertab: "Kelola User" (lengkap) + "Lainnya" (placeholder lama untuk
HPP-metode/lokasi/channel, belum dikerjakan -- bukan scope tugas ini).

### 16.9 Hasil test & verifikasi

`npm test`: **66 lulus** (7 core + 47 inventory + 12 api, naik dari 54
sebelumnya -- 7 test baru di `apps/api/src/auth.test.ts`: PIN duplikat
lokasi sama ditolak/lokasi beda diterima, PIN auto-generate bisa dipakai
login sungguhan, lockout 5x gagal, staf-tidak-bisa-password &
sebaliknya, daftar staf publik tanpa data sensitif, nonaktifkan user,
owner-tidak-bisa-nonaktifkan-diri-sendiri). 3 test lama yang bikin staf
lewat password juga disesuaikan jadi lewat PIN (staf memang tidak bisa
lagi lewat password, itu perubahan yang disengaja, bukan regresi).

Diverifikasi end-to-end sungguhan di browser: buat staf baru lewat
Kelola User -> PIN ditampilkan sekali -> logout -> Login Tim: pilih
lokasi -> pilih nama staf itu -> ketik PIN yang baru dibuat -> berhasil
masuk dengan role staf yang benar (nav menu otomatis terbatas sesuai
role). PIN salah -> pesan error, bisa dicoba lagi. Semua data uji coba
(user + login_attempts) dibersihkan lagi setelahnya.

### 16.10 User sungguhan dibuat (bukan data uji coba)

Dibuat lewat endpoint `POST /api/auth/users` yang baru (bukan SQL
manual): **Ibnu** (manajer_ops, akses semua lokasi otomatis) dan
**Fitri, Naura, Duhan** (staf, Samsara Outlet 1 Malang). Password Ibnu
dan PIN awal ketiga staf ditampilkan SEKALI di terminal session ini
untuk disampaikan manual oleh owner -- tidak disimpan di file/log
manapun di repo ini.

## 17. Kelola User: aktifkan ulang, reset kredensial, proteksi nol-owner (2026-10-04)

Melengkapi halaman "Kelola User" (§16) yang sebelumnya cuma bisa
menonaktifkan user satu arah, dan belum ada mekanisme pemulihan kalau
PIN/password lupa. Dikerjakan langsung (bukan via subagent) karena
scope-nya murni `core` + `apps/web`, sama seperti §16.

### 17.1 `PATCH /api/auth/users/:id` sekarang dua arah

`isActive` bisa dikirim `true` ATAU `false` -- sebelumnya backend
(`updateUser`) sebenarnya SUDAH mendukung keduanya (tidak ada
pembatasan arah di domain layer), yang cuma satu arah adalah UI-nya
(tombol "Aktifkan" belum ada). User yang nonaktif tetap muncul di
`GET /api/auth/users` (tidak pernah difilter keluar) dengan badge
"Nonaktif" di frontend -- ini juga sudah benar sejak §16, cuma belum
ada cara mengembalikannya.

### 17.2 Guard dikonsolidasi ke satu tempat (`updateUser` di `core/src/auth/users.ts`)

Dua pengecekan sebelum `isActive:false` diproses, keduanya di domain
layer (bukan lagi di router seperti §16.6) supaya satu sumber kebenaran
dipakai baik oleh endpoint PATCH ini maupun kode lain yang mungkin
memanggil `updateUser` langsung nanti:

1. **Tidak bisa menonaktifkan akun sendiri** (dari §16.6, dipindah ke sini).
2. **Tidak boleh menyisakan nol owner AKTIF di sistem** (baru, diminta
   owner sebagai proteksi jaga-jaga kalau nanti ada owner kedua). Secara
   matematis, guard ini SELALU lebih umum daripada guard 1 dalam sistem
   1-owner saat ini (siapa pun yang berhasil memanggil endpoint ini pasti
   owner yang masih aktif, jadi dia sendiri tetap terhitung aktif
   setelah aksi non-self) -- KECUALI dalam satu skenario nyata: token
   JWT lama milik owner yang SUDAH dinonaktifkan tapi tokennya belum
   kedaluwarsa (sistem ini belum punya revoke token, §13.6/14) dipakai
   untuk menonaktifkan owner aktif terakhir. Guard 2 menutup celah itu.
   Dites eksplisit dengan skenario token basi ini, bukan cuma self-case.

### 17.3 Reset kredensial: `POST /api/auth/users/:id/reset`

Endpoint baru, owner-only. Mengganti `password_hash`/`pin_hash` TOTAL
(bukan menambah) sesuai role target -- kredensial lama otomatis tidak
berlaku lagi begitu baris di-UPDATE, tidak perlu langkah invalidasi
terpisah. Alasan dibutuhkan: sistem ini tidak punya mekanisme
"lupa PIN/password" sama sekali (tidak ada reset-via-email, dst) --
ini satu-satunya jalan pemulihan kalau staf lupa PIN atau manajer_ops/
supervisor lupa password. Password baru digenerate CSPRNG
(`node:crypto` `randomBytes`, ~12 karakter base64url), PIN baru 6 digit
sama seperti saat create (§16.3, termasuk cek keunikan PIN per-lokasi
yang sama). Response (`generatedPin` atau `generatedPassword`,
tergantung role) cuma muncul SEKALI, sama persis pola "tampil sekali"
seperti saat create user.

### 17.4 Frontend: tombol dinamis sesuai status, dialog konfirmasi digeneralisasi

Tombol per baris di `KelolaUserTab.tsx` sekarang: "Nonaktifkan" (kalau
aktif, pakai `ConfirmDialog` seperti sebelumnya) ATAU "Aktifkan" (kalau
nonaktif, aksi langsung tanpa konfirmasi -- tidak destruktif, reversibel
lewat "Nonaktifkan" lagi kapan saja), plus tombol "Reset PIN"/"Reset
password" (label menyesuaikan `authMethod` user itu, lewat
`ConfirmDialog` juga karena langsung meng-invalidate kredensial lama).
`PinConfirmationDialog` lama digeneralisasi jadi
`CredentialConfirmationDialog` (menerima `label` + `value` apa pun,
bukan cuma PIN) supaya dipakai ulang oleh alur create-staf (§16.3) dan
reset (keduanya "tampil sekali, lalu hilang").

### 17.5 Hasil test & verifikasi

`npm test`: **70 lulus** (7 core + 47 inventory + 16 api, naik dari 66
sebelumnya -- 4 test baru: aktifkan-ulang status konsisten di list+login,
proteksi nol-owner-aktif dengan skenario token basi, reset PIN dengan
PIN lama dibuktikan mati, reset password dengan password lama dibuktikan
mati).

Diverifikasi end-to-end sungguhan di browser (bukan cuma test otomatis,
sesuai instruksi owner): buat user staf+manajer_ops uji coba lewat UI ->
nonaktifkan (badge "Nonaktif" muncul, tombol berubah jadi "Aktifkan") ->
aktifkan lagi (badge hilang, tombol balik "Nonaktifkan") -> reset PIN
(PIN baru tampil sekali) -> dikonfirmasi lewat API langsung: PIN lama
ditolak (`PIN salah`), PIN baru berhasil login -> reset password (sama,
dikonfirmasi password lama ditolak, password baru berhasil login). Semua
user & login_attempts uji coba dibersihkan setelahnya -- 5 user
sungguhan (owner + Ibnu/Fitri/Naura/Duhan dari §16.10) dan audit_log
entry asli (min_stok Ayam suwir dari §15) dikonfirmasi tidak tersentuh.

---

## 18. Lokasi pindah dari Inventory ke `core` + modul baru `hr` (2026-10-06)

### 18.1 Pemicu: modul bisnis baru (`hr`) butuh FK ke lokasi, yang saat itu milik modul bisnis lain (Inventory)

Modul bisnis baru `hr` (jadwal shift + pengajuan libur staf) butuh foreign
key sungguhan dari `hr_jadwal_shift.lokasi_id` ke data lokasi (outlet/
gudang). Sampai sesi ini, lokasi dimiliki modul Inventory
(`inventory_locations`). `module-guardian` (subagent review, read-only)
diminta konfirmasi pola isolasi modul sebelum kode ditulis, dan
menemukan: preseden yang sudah ada di repo ini
(`core_user_lokasi.location_id` TANPA FK ke `inventory_locations`,
sengaja dibuat begitu di `core/0001_create_auth_tables.sql`, lihat §12.1)
**cuma berlaku untuk kasus PLATFORM (`core`) membaca tabel MODUL BISNIS**
-- bukan preseden yang sah untuk kasus MODUL BISNIS membaca tabel MODUL
BISNIS LAIN (`hr` -> Inventory), karena CLAUDE.md §3 mewajibkan akses
lintas modul bisnis lewat API yang diekspos, bukan query/FK tabel
langsung. `module-guardian` merekomendasikan ini ditanyakan ke owner,
bukan diputuskan sendiri -- sesuai batasan kerja subagent itu (read-only,
tidak boleh memutuskan arsitektur).

### 18.2 Tiga opsi yang diberikan ke owner

1. **Soft reference langsung `hr` -> `inventory_locations` tanpa FK.**
   Paling cepat, tapi jadi preseden baru "modul bisnis boleh baca tabel
   modul bisnis lain secara langsung" -- melenceng dari CLAUDE.md §3.
2. **`hr` panggil lewat HTTP API Inventory** (`GET /lokasi` atau serupa).
   Sesuai arsitektur modular murni (lintas modul bisnis lewat API), tapi
   endpoint list lokasi belum ada sama sekali saat itu -- nambah kerjaan
   sebelum `hr` bisa jalan.
3. **Pindahkan lokasi ke `core`.** Perubahan paling besar (migrasi data +
   repoint FK + cek kode lama), tapi paling bersih jangka panjang --
   lokasi memang konsep lintas modul (dipakai Inventory DAN `hr`,
   kemungkinan modul lain juga di masa depan).

### 18.3 Keputusan owner: opsi 3 (pindahkan lokasi ke `core`)

Alasan owner: lokasi bukan konsep yang eksklusif milik satu modul bisnis
-- itu data operasional dasar (outlet/gudang fisik) yang relevan untuk
modul apa pun yang berurusan dengan "di mana" (stok, jadwal staf, dan
kemungkinan modul lain di masa depan). Menaruhnya di `core` (lapisan yang
semua modul boleh depends-on, tapi tidak sebaliknya) adalah penempatan
yang benar secara arsitektur, bukan sekadar workaround untuk melewati
masalah FK `hr`.

### 18.4 Eksekusi: migrasi `core` dulu, lalu migrasi Inventory merepoint & drop

**`core/src/db/migrations/0006_move_locations_to_core.sql`**:
`CREATE TABLE core_locations` dengan struktur sama persis
`inventory_locations` (`id`, `name UNIQUE`, `is_active`, `created_at`,
`entitas`), copy data preserve ID (`OVERRIDING SYSTEM VALUE`, supaya 11
FK yang masih memegang nilai id lama tetap valid), lalu tambah FK
sungguhan `core_user_lokasi_location_id_fkey`. **Akibatnya**:
`core_user_lokasi` sekarang punya FK asli ke lokasi -- preseden lama
"sengaja tanpa FK" (§12.1) jadi tidak relevan lagi untuk kolom ini,
karena alasannya (lokasi milik modul bisnis lain) sudah tidak berlaku
sejak lokasi pindah ke `core` sendiri.

**`modules/inventory/src/db/migrations/0023_move_locations_to_core.sql`**
(selalu jalan SETELAH migrasi `core` di atas, karena `core/src/db/migrate.ts`
selalu menjalankan migrasi `core` lebih dulu): merepoint 11 foreign key
constraint yang tadinya menunjuk `inventory_locations` --
`inventory_min_stok_lokasi`, `inventory_permintaan_transfer` (2 kolom:
asal & tujuan), `inventory_stock_ledger`, dan 6 tabel
`inventory_transaksi_*` (mutasi_lain, opname, pembelian, penjualan,
produksi, transfer x2 kolom) -- supaya menunjuk `core_locations`, lalu
`DROP TABLE inventory_locations` (datanya sudah dipindah).

`db-migration` subagent juga menemukan sendiri (bukan diminta cari) 1
**VIEW** (`inventory_current_stock`) dan 1 **trigger function**
(`inventory_set_transfer_antar_entitas`) yang diam-diam masih query
`inventory_locations` di body SQL-nya -- Postgres tidak melacak
dependency itu otomatis seperti dependency FK biasa, jadi `DROP TABLE`
tidak akan langsung gagal, tapi fungsi/view itu akan diam-diam rusak
kalau tidak diperbarui. Keduanya di-`CREATE OR REPLACE` supaya ikut
menunjuk `core_locations` (daftar & posisi kolom output tidak berubah).

### 18.5 Modul baru `hr`: jadwal shift + pengajuan libur, pola self-scoping baru

Scaffold `modules/hr` (package baru, dibuat di sesi yang sama dengan
keputusan ini): jadwal shift dan pengajuan libur staf, 2 tabel awal
(`hr_jadwal_shift`, `hr_pengajuan_libur`), didaftarkan lewat
`modules/hr/module.json` seperti modul lain. 7 endpoint: health check,
CRUD jadwal shift (owner/manajer_ops saja yang bisa buat/ubah/hapus,
semua role boleh lihat), ajukan libur (semua role, selalu untuk diri
sendiri -- `user_id` dari token login, tidak pernah dari body), dan
keputusan approve/tolak pengajuan libur (owner/manajer_ops saja, tidak
bisa memutuskan pengajuan milik sendiri -- pola sama seperti owner tidak
bisa menonaktifkan akun sendiri, §17.2).

**Pola permission baru, beda dari Inventory**: endpoint `GET
/jadwal-shift` dan `GET /pengajuan-libur` menerima query `userId`/
`lokasiId`, tapi untuk role supervisor/staf, nilai yang dikirim client
**DIABAIKAN (bukan ditolak/403)** -- dipaksa ke `user_id` milik akun yang
login sendiri. Ini beda dari pola `locationScope` yang sudah ada di
Inventory (yang menolak akses ke lokasi di luar scope dengan 403) --
lebih dekat ke pola `resolveHppMethod` (§13.5) yang juga "mengabaikan,
bukan menolak" parameter dari role terbatas. Dipilih supaya staf tetap
bisa memanggil endpoint yang sama tanpa perlu tahu/mengirim ID dirinya
sendiri secara presisi, dan tidak mungkin "mengintip" filter ke user/
lokasi lain lewat query param.

### 18.6 Pembersihan kode lama & dokumentasi manifest

Setelah migrasi, 7 file TypeScript ketahuan masih hardcode nama tabel
lama (`inventory_locations`): `core/src/auth/users.ts`,
`modules/inventory/src/domain/permintaan-transfer.ts`,
`modules/inventory/src/domain/pengaturan.ts`,
`modules/inventory/src/domain/laporan.ts`,
`modules/inventory/src/domain/test-helpers.ts`,
`modules/inventory/src/domain/stok.test.ts`,
`apps/api/src/auth.test.ts` -- semua diperbaiki (ganti ke
`core_locations`).

`modules/inventory/module.json` dibersihkan: `inventory_locations`
dihapus dari daftar `tables` (tabelnya sudah tidak ada lagi di modul
ini), dan deskripsi endpoint `POST /lokasi` / `PATCH /lokasi/:id`
ditambah catatan bahwa tabelnya sekarang di `core` (`core_locations`)
meski endpoint CRUD-nya **sengaja TETAP** di router Inventory (bukan
dipindah ke `core`) -- supaya tidak perlu migrasi frontend/URL yang
sudah terintegrasi. Modul lain (termasuk `hr`) boleh FK langsung ke
`core_locations` tanpa lewat endpoint ini sama sekali -- cuma butuh
bacaan ID yang valid, bukan CRUD-nya.

### 18.7 Dua bug tidak terduga, ditemukan saat verifikasi langsung di browser

Ditemukan dalam rangkaian kerja yang sama, bukan bagian dari keputusan
pindah lokasi itu sendiri -- dicatat di sini sebagai pelajaran:

1. **Kolom `DATE` Postgres bergeser mundur 1 hari di frontend (timezone
   Asia/Jakarta).** Driver `pg` secara default mem-parsing kolom `DATE`
   jadi objek JS `Date` di tengah malam **waktu lokal proses Node**, lalu
   `res.json()` men-serialize-nya via `toISOString()` (UTC). Di
   Asia/Jakarta (UTC+7), ini menggeser tanggal mundur satu hari begitu
   sampai di frontend (mis. `2026-10-06` di database jadi tampil sebagai
   `2026-10-05` di layar). **Diperbaiki GLOBAL** di `core/src/db/pool.ts`
   (`types.setTypeParser(1082, (v) => v)` -- OID 1082 = `DATE`, dikembalikan
   sebagai string `"YYYY-MM-DD"` apa adanya, bukan diparse jadi objek
   `Date`). Kolom `TIMESTAMPTZ` (mis. `created_at`) **tidak disentuh** --
   itu memang harus tetap jadi instant absolut dengan timezone, beda
   kasus dari `DATE` murni (tanggal kalender tanpa jam). Karena perbaikan
   ini di level `pool.ts` (bukan di satu modul), semua modul (Inventory,
   `hr`, dan modul masa depan) otomatis ikut benar.
2. **Router `hr` sempat lupa pasang error-handler per-router.** Setiap
   router modul **wajib** pasang error-handler Express sendiri (pola yang
   sudah ada di baris akhir `modules/inventory/src/api/router.ts`) --
   karena **tidak ada** error-handler global di `core/src/server/build-server.ts`.
   Tanpa error-handler ini, error bisnis dari domain layer (mis. "tidak
   bisa menyetujui pengajuan libur milik sendiri") bubble ke default
   error handler Express sebagai **500 polos** tanpa pesan yang jelas,
   bukan respons 400/404 dengan pesan yang bisa dibaca. Sudah ditambahkan
   di `modules/hr/src/api/router.ts`.

### 18.8 Verifikasi yang sudah dilakukan

- Migrasi (`core` 0006, Inventory 0023) jalan bersih di database `samsara`
  sungguhan.
- FK constraint baru diuji aktif: insert `core_user_lokasi` dengan
  `location_id` valid berhasil, dengan `location_id` palsu ditolak oleh
  Postgres (bukan cuma validasi aplikasi).
- **103 test otomatis lulus**: 7 `core` + 12 `hr` (baru) + 68
  `modules/inventory` + 16 `apps/api`.
- Modul `hr` dites bisa dinonaktifkan (`enabled: false` di
  `modules/hr/module.json`) tanpa mengganggu modul Inventory -- konsisten
  dengan kontrak module manifest (§2/§3).
- Self-scoping staf/supervisor (§18.5) dites langsung lewat HTTP: staf
  yang mengirim `userId`/`lokasiId` milik orang/lokasi lain tetap cuma
  menerima data miliknya sendiri, tidak 403 dan tidak "mengintip" data
  lain.

---

# Aturan Tetap (checklist permanen — bukan entri keputusan satu kali)

Bagian di bawah ini **beda jenis** dari entri bernomor (§1–§18) di atas.
Entri bernomor mencatat satu keputusan di satu titik waktu ("apa yang
diputuskan, kapan, kenapa"). Bagian ini sebaliknya: **checklist yang wajib
diulang setiap kali** suatu jenis perubahan terjadi, berlaku terus ke
depan — tidak pernah "selesai" dan tidak boleh dibaca sebagai "sudah
pernah dites sekali, jadi beres".

## A. Verifikasi manual lintas-role setelah perubahan navigasi/halaman/permission

**Berlaku untuk**: subagent `qa-verifier`, dan siapa pun (termasuk Claude
sendiri) yang melakukan verifikasi manual terhadap `apps/web` atau API.

**Pemicu** — checklist ini WAJIB dijalankan setelah perubahan apa pun yang
menyentuh salah satu dari:
1. Navigasi/menu (menambah, menghapus, atau mengubah visibilitas item
   menu).
2. Halaman/route baru (termasuk mengubah route yang sudah ada).
3. Permission atau role-gating (siapa boleh akses apa, baik di backend
   `module.json` § `permission` maupun di gating sisi frontend).

**Langkah wajib**, dalam urutan ini:
1. Login sebagai **masing-masing** dari 4 role yang ada di sistem — owner,
   manajer_ops, supervisor, staf — satu per satu (bukan cuma role yang
   "paling relevan" dengan perubahan).
2. Untuk setiap role, klik **SEMUA** menu/tab yang terlihat untuk role itu
   — bukan hanya fitur yang baru dikerjakan di task yang sedang berjalan.
3. Untuk tiap menu yang diklik, pastikan dua hal: (a) menu yang **seharusnya
   terlihat** untuk role itu memang terlihat dan berfungsi, dan (b) menu
   yang **seharusnya tidak terlihat/tidak bisa diakses** untuk role itu
   memang benar-benar hilang atau ditolak — bukan cuma tersembunyi di UI
   tapi endpoint-nya masih bisa dipanggil langsung.

**Alasan aturan ini ada**: perubahan di satu titik (satu menu, satu
permission, satu route) bisa punya efek tidak langsung ke halaman/menu
lain yang tidak disentuh sama sekali oleh perubahan itu sendiri — regresi
jenis ini tidak akan ketahuan kalau verifikasi hanya mengecek fitur yang
baru dikerjakan. Contoh nyata dari sesi sebelumnya: saat permission gate
`/pengaturan` diubah agar `manajer_ops` juga boleh akses, verifikasi yang
benar bukan cuma mengecek tab baru yang kini terlihat untuk `manajer_ops`
— tapi juga mengecek ulang tab **"Kelola User"** di halaman yang sama
benar-benar tetap **tidak** terlihat untuk role itu (karena `user.manage`
tetap owner-only, lihat §17). Kalau verifikasi cuma fokus ke tab yang baru
dibuka, regresi "Kelola User" ikut kebuka untuk `manajer_ops` bisa lolos
tanpa terdeteksi.

**Status checklist ini**: permanen, berulang setiap kali pemicu di atas
terjadi — bukan catatan historis "sudah pernah dites sekali di tanggal
tertentu". Kalau ada log hasil verifikasi untuk tanggal/perubahan
tertentu, catat itu sebagai entri bernomor terpisah (seperti §16–§18 di
atas yang sudah menyertakan hasil verifikasi manual masing-masing), bukan
dengan mengedit section ini.

---

## 19. Klarifikasi penamaan: Burnas = nama production, Samsara = codename development (2026-10-07)

Owner mengklarifikasi satu hal yang sejak Tahap 2 (§ 7.1) tercatat sebagai
"belum jelas": **"Burnas" dan "Samsara" bukan dua brand/bisnis yang
berbeda.** Keduanya menunjuk ke bisnis/sistem yang **sama persis** — bedanya
cuma konteks pemakaian nama:

- **Burnas** adalah nama brand yang dipakai saat sistem ini sudah live di
  production.
- **Samsara** adalah alias/codename yang dipakai **khusus selama masa
  development** repo ini — supaya penamaan di lingkungan development tidak
  tertukar dengan sistem Burnas yang sudah berjalan secara live.

Jadi di mana pun dokumen ini (atau `CLAUDE.md`) sebelumnya menyiratkan
"Burnas kemungkinan brand lain milik owner, terpisah dari Samsara" — itu
**tidak akurat**. Tidak ada percampuran data antar-bisnis di titik-titik
itu; "Burnas" yang muncul di data sumber memang data bisnis yang sama ini
sendiri, hanya dari era sebelum penamaan development "Samsara" dipakai.

**Yang TIDAK berubah oleh klarifikasi ini**: "Ajiep Sutami"/"Ajiep Dau"
(Bubur Ayam Ajiep) **tetap brand lain milik owner yang terpisah** — larangan
keras `CLAUDE.md` § 1 soal tidak mencampur data antar bisnis/brand tetap
berlaku penuh untuk Ajiep. Klarifikasi ini **hanya** menyangkut hubungan
Burnas↔Samsara, bukan pelonggaran aturan isolasi data secara umum. Status
"belum diklarifikasi" untuk kemungkinan template spreadsheet lintas-brand
di § 7.1 **tetap terbuka** sejauh menyangkut Ajiep.

### 19.1 Tabel `salessync_log_penjualan` (modul `sales-sync`) — data Burnas asli, SENGAJA disimpan untuk uji coba

Tabel `salessync_log_penjualan` (modul `sales-sync`, dibuat 2026-10-07) saat
ini berisi **19.519 baris** (diverifikasi langsung lewat query `SELECT
count(*)` ke database `samsara` sungguhan saat menulis entri ini) data
penjualan **asli** dari era Burnas, dengan penamaan platform dan menu versi
lama — dicek beberapa contoh nyata di tabel: nama menu seperti `Bubur Ayam
Original`, `Bubur Ayam Oriental`, `Roti Cane`, `Burjo Panas`, dan platform
`GoFood`/`GrabFood`/`Shopee`/`Majoo`. Nama-nama ini dari sebelum migrasi ke
branding "Samsara" untuk keperluan development (lihat § 19).

**Ini bukan data sisa QA/test session, bukan kecelakaan upload** — data ini
**sengaja disimpan** untuk keperluan uji coba modul `sales-sync` (butuh
volume data penjualan realistis untuk mengetes logika sinkronisasi/dedup/
pemetaan menu, bukan sekadar beberapa baris dummy).

> **WAJIB dipatuhi oleh sesi Claude Code mana pun (termasuk subagent
> `qa-verifier`/`docs-writer` di masa depan):** 19.519 baris di
> `salessync_log_penjualan` ini **TIDAK BOLEH dihapus** oleh rutinitas
> pembersihan data QA/test setelah selesai testing — kebiasaan "hapus semua
> data uji coba setelah testing" yang berlaku untuk tabel-tabel lain di repo
> ini **TIDAK berlaku** untuk tabel ini. Penghapusan baris di tabel ini
> hanya boleh dilakukan kalau owner **secara eksplisit** memintanya untuk
> tabel ini.

Tidak ada migrasi skema yang menyertai entri ini — ini murni catatan
klarifikasi kebijakan data, bukan perubahan struktur database.

---

## 20. Gap ditemukan: permission role `integrasi` belum benar-benar diberi akses ke endpoint import `sales-sync` (2026-10-15)

> **SUDAH DITUTUP 2026-10-16 — lihat § 21.** Isi § 20 di bawah dibiarkan apa
> adanya sebagai catatan temuan historis; kondisi kode yang dideskripsikan di
> § 20.2/20.3 **sudah tidak berlaku lagi**.

Ditemukan oleh `docs-writer` saat menulis `docs/integrasi-n8n.md` (panduan
teknis membangun workflow n8n untuk import CSV otomatis ke modul
`sales-sync`). Ini **bukan keputusan arsitektur baru** yang saya ambil —
ini laporan temuan kesenjangan antara niat desain yang sudah tercatat di
kode (lewat komentar) dan implementasi yang sebenarnya berjalan, supaya
tidak hilang dan ada yang menindaklanjuti.

### 20.1 Yang seharusnya terjadi (niat desain, sudah ada jejaknya di kode)

- `core/src/auth/types.ts` mendefinisikan role `integrasi` dengan komentar
  eksplisit: akun otomatis (workflow n8n) yang "cuma boleh akses 4 endpoint
  import CSV modul sales-sync (action `sales_sync.import`)".
- Migrasi `core/src/db/migrations/0008_add_integrasi_role.sql` menambahkan
  role `integrasi` ke tabel `core_roles`, dengan komentar yang juga
  mengasumsikan akan ada permission action `sales_sync.import` terpisah
  dari `sales_sync.manage`, dan role `integrasi` akan masuk ke `roles[]`
  action itu — sambil mereferensikan dokumen `docs/integrasi-n8n.md` yang
  (saat migrasi itu ditulis) belum ada.

### 20.2 Yang sebenarnya ada di kode saat ini

- `modules/sales-sync/module.json` — **kedelapan** endpoint modul ini
  (termasuk keempat endpoint import `log-penjualan`, `transaksi`,
  `raw-majoo`, `biaya-platform`, DAN `proses`) semuanya memakai **satu**
  permission action yang sama: `sales_sync.manage`, dengan
  `roles: ["owner", "manajer_ops"]`. Role `integrasi` **tidak terdaftar**
  di `roles[]` manapun di file ini.
- `modules/sales-sync/src/api/router.ts` konsisten dengan itu — semua
  route dipasang `requirePermission("sales_sync.manage")`, tidak ada
  action `sales_sync.import` di kode mana pun selain di komentar
  `types.ts`.
- `apps/web/src/auth/usePermission.ts` juga hanya mengenal
  `"sales_sync.manage": ["owner", "manajer_ops"]` — konsisten dengan
  backend, tidak ada jejak `sales_sync.import` di frontend juga.
- Tidak ada script `npm run seed:integrasi` di `package.json` manapun
  (root maupun `apps/api`) — hanya ada `seed:owner`
  (`apps/api/src/seed-owner.ts`). Belum ada cara terstandar untuk benar-
  benar membuat user `n8n-integrasi` dengan role `integrasi`.

### 20.3 Konsekuensi praktis

Dengan kondisi kode saat ini: **akun role `integrasi` tidak bisa memanggil
endpoint apa pun di modul `sales-sync`**, termasuk 4 endpoint import yang
seharusnya menjadi satu-satunya hal yang boleh diaksesnya — bukan cuma
`/proses` yang memang sengaja ditolak. Permintaan `POST
/sales-sync/import/*` dengan token role `integrasi` akan mendapat
`403 Forbidden "Role integrasi tidak punya izin untuk aksi
sales_sync.manage"`, sama seperti kalau mencoba `/proses`.

Jadi workflow n8n yang dijelaskan di `docs/integrasi-n8n.md` **belum bisa
benar-benar dites end-to-end** sampai gap ini ditutup oleh Backend
Developer:
1. Tambahkan permission action baru `sales_sync.import` di
   `modules/sales-sync/module.json` untuk 4 endpoint import (roles minimal
   `owner`, `manajer_ops`, `integrasi` — supaya staf manusia tetap bisa
   import manual dari UI kalau perlu, dan akun integrasi bisa import lewat
   n8n), sambil endpoint `/proses` TETAP di `sales_sync.manage` tanpa
   `integrasi` (pemisahan ini yang justru jadi inti pengamanan "integrasi
   tidak bisa memproses ke stok").
2. Update `router.ts` modul `sales-sync` supaya 4 route import memakai
   `requirePermission("sales_sync.import")`, bukan `sales_sync.manage`.
3. Buat script `seed:integrasi` (pola sama seperti `seed-owner.ts`) supaya
   akun `n8n-integrasi` bisa dibuat secara terstandar, idempotent, dan
   passwordnya tidak pernah masuk ke kode/repo.

### 20.4 Apa yang TIDAK saya putuskan sendiri

Saya **tidak** mengubah `module.json`/`router.ts`/membuat script seed
apa pun untuk menutup gap ini — di luar ruang gerak `docs-writer` (hanya
boleh menulis ke `docs/` dan `README.md`), dan lebih penting lagi: ini
pekerjaan Backend Developer/Arsitek yang perlu direview seperti perubahan
permission lainnya, bukan sesuatu yang boleh "diam-diam diperbaiki" lewat
sesi dokumentasi. `docs/integrasi-n8n.md` sudah saya tulis sesuai **niat
desain yang dituju** (karena itu yang diminta, dan jejaknya sudah ada di
kode/migrasi), dengan catatan status implementasi yang jelas di bagian
awal dokumen tersebut supaya siapa pun yang mau memakainya tidak
mengira ini sudah langsung bisa jalan hari ini.

**Terbuka untuk owner/Backend Developer:** konfirmasi apakah rencana di
§ 20.3 (action baru `sales_sync.import`, roles `owner`+`manajer_ops`+
`integrasi`) ini yang dimaksud, atau ada pendekatan lain yang lebih
disukai — saya hanya merekonstruksi niat dari komentar yang sudah ada di
kode, bukan memastikan langsung dengan owner.

---

## 21. Gap § 20 ditutup + 6 endpoint Inventory tanpa gate permission ikut ditutup (2026-10-16)

Menindaklanjuti temuan § 20. Semua yang diminta di § 20.3 sudah dikerjakan,
plus satu celah tambahan yang ditemukan saat verifikasi.

### 21.1 Permission 4 endpoint import dipisah dari `/proses`

Action baru **`sales_sync.import`**, `roles: ["owner", "manajer_ops",
"integrasi"]`, dipakai oleh 4 endpoint import CSV
(`/import/log-penjualan`, `/import/transaksi`, `/import/raw-majoo`,
`/import/biaya-platform`). Empat endpoint sales-sync lainnya (`/proses`,
`GET /item-mapping`, `PATCH /item-mapping/:id`, `/belum-diproses`) **tetap**
`sales_sync.manage` dengan `roles: ["owner", "manajer_ops"]`.

Pemisahan ini **justru inti pengamanannya**, bukan kerapian: kalau
`integrasi` ditambahkan ke `sales_sync.manage` yang lama (satu action untuk
8 endpoint), akun bot otomatis ikut dapat akses `POST /proses` — endpoint
yang MENGURANGI STOK sungguhan. Owner/manajer_ops ada di **dua-duanya**,
jadi tidak ada akses yang dicabut dari role manusia.

Di `router.ts`, helper `endpointImport()` (yang dipakai keempat route
import) sekarang memasang `requirePermission("sales_sync.import")`; empat
route lain tidak disentuh.

### 21.2 Celah TAMBAHAN yang ditemukan: 6 endpoint Inventory tanpa gate sama sekali

Saat memverifikasi kriteria "akun `integrasi` harus 403 di daftar menu",
ternyata ada **6 endpoint modul Inventory yang tidak punya blok
`"permission"` sama sekali** di `module.json` — hanya `requireAuth` global,
artinya **SIAPA PUN yang login** bisa mengaksesnya, termasuk akun bot:

`GET /items`, `GET /items/:kode/hpp`, `GET /menu`, `GET /menu/:kode/hpp`,
`GET /menu/:kode/rekomendasi-harga`, `GET /resep-produksi`.

Ini bukan niat desain yang disengaja: komentar di `router.ts` menjelaskannya
sebagai "semua role login boleh akses", yang benar **selama** satu-satunya
yang bisa login adalah 4 role manusia. Begitu ada role ke-5 yang bukan
manusia, "semua role yang login" berhenti jadi batasan yang bermakna.

**Keputusan:** tiga action READ baru, mengikuti konvensi `.lihat` yang sudah
dipakai di modul ini (`stok.lihat`, `min_stok.lihat`,
`permintaan_transfer.lihat`), semuanya `roles: ["owner", "manajer_ops",
"supervisor", "staf"]`:

| Action baru | Endpoint |
|---|---|
| `master_item.lihat` | `GET /items`, `GET /items/:kode/hpp` |
| `master_menu.lihat` | `GET /menu`, `GET /menu/:kode/hpp`, `GET /menu/:kode/rekomendasi-harga` |
| `resep_produksi.lihat` | `GET /resep-produksi` |

**Sengaja TIDAK numpang action yang sudah ada**, dua-duanya pernah
dipertimbangkan dan ditolak:
- Bukan `master_item.edit`/`master_menu.edit`/`resep.edit` — itu action
  WRITE dengan populasi lebih sempit (`owner`+`manajer_ops`). Memakainya
  sebagai gate READ akan **mencabut** akses supervisor & staf yang hari ini
  memang butuh endpoint itu (ItemPicker di form pembelian/produksi/opname,
  halaman Menu & HPP, dropdown di ProduksiForm).
- Bukan `hpp.lihat_harga` — itu **konsep berbeda**: dicek lewat
  `hasPermission` untuk memfilter FIELD harga/HPP/margin dari response, bukan
  lewat `requirePermission` sebagai gate akses. Dua mekanisme itu tidak
  boleh dicampur; `hpp.lihat_harga` tetap bekerja seperti sebelumnya di
  endpoint yang sama.

Populasi keempat role manusia dipilih supaya **tidak ada perubahan perilaku
sama sekali untuk role yang sudah ada** — satu-satunya yang berubah: role
di luar keempatnya (hari ini hanya `integrasi`) sekarang ditolak 403. Ada
test regresi eksplisit untuk ini.

### 21.3 Script `seed:integrasi` — password acak, BUKAN dari `.env`

`apps/api/src/seed-integrasi.ts` + script `seed:integrasi` di
`apps/api/package.json`. Polanya mirip `seed-owner.ts` (idempoten: berhenti
kalau sudah ada user role `integrasi`), dengan **satu perbedaan penting atas
instruksi eksplisit owner**: passwordnya **di-generate acak** dengan CSPRNG
(`crypto.randomBytes(24).toString("base64url")`) saat script dijalankan, lalu
ditampilkan **sekali** ke terminal — **tidak dibaca dari `.env`** seperti
`seed-owner` (yang baca `AUTH_SEED_OWNER_PASSWORD`), dan tidak ditulis ke
file apa pun. Konsekuensi yang disengaja: kalau output terminalnya hilang,
password tidak bisa dibaca ulang — jalurnya reset kredensial oleh owner
(`POST /api/auth/users/:id/reset`), bukan menjalankan ulang script.

`integrasi` ditambahkan ke `PASSWORD_ROLES` (login username+password lewat
`POST /auth/login`, bukan PIN — n8n tidak punya layar pilih-nama) dan ke
`isAllLocationsRole` (akun bot system-wide, tidak terikat satu lokasi fisik,
jadi `createUser()` tidak mewajibkan `locationIds`) di
`core/src/auth/users.ts`.

### 21.4 Catatan sisi frontend

`apps/web` punya tipe `Role` **sendiri** (`apps/web/src/api/types.ts`,
duplikat yang disinkronkan manual, bukan import dari `core`). `"integrasi"`
ditambahkan ke sana **hanya** supaya halaman Kelola User bisa menampilkan
label & lokasi akun bot dengan benar (`ROLE_LABEL` di `KelolaUserTab.tsx`
bertipe `Record<Role, string>`, jadi exhaustive) — akun ini ikut muncul di
DAFTAR user walaupun tidak bisa dibuat dari form itu (`ROLE_OPTIONS` sengaja
tidak menawarkannya; akun bot dibuat lewat CLI supaya passwordnya cuma
muncul sekali di terminal owner).

`"integrasi"` **sengaja TIDAK** dimasukkan ke `SEMUA_ROLE` di
`apps/web/src/auth/usePermission.ts`: kalau dimasukkan, kontrol UI yang
backend-nya pasti menolak 403 malah ikut tampil. Tabel `PERMISSION_ROLES` di
file itu (yang menurut komentarnya memang mirror 1:1 dari `module.json`)
diperbarui dengan 4 action baru.

### 21.5 Verifikasi

`npm run typecheck` bersih di 6 workspace. `npm test` **269 test, 0 gagal**
di semua workspace (core 7, hr 46, inventory 151, sales-sync 41, api 24).
Empat test baru di `apps/api/src/auth.test.ts`:

1. `role integrasi: bisa login password dan BOLEH keempat endpoint import CSV sales-sync`
2. `role integrasi: DITOLAK 403 di endpoint lain apa pun (sales-sync non-import, Inventory, HR)` — 14 endpoint
3. `regresi: owner & manajer_ops TETAP boleh keempat endpoint import setelah dipisah ke sales_sync.import`
4. `regresi: supervisor & staf TETAP boleh 6 endpoint Inventory yang baru di-gate`

Test membuat user fixture-nya **sendiri** lewat SQL langsung (pola
`createTestUser` yang sudah ada), **tidak** bergantung pada akun hasil
`seed:integrasi`. Endpoint import COMMIT sungguhan, jadi baris fixture
arsip (prefix `TEST-PERM-`, termasuk antrian `salessync_item_mapping` yang
disegarkan otomatis oleh import log) dibersihkan eksplisit di `finally`.

---

## 22. Revoke token berbasis `token_version` (2026-10-16)

### 22.1 Masalah

Sistem auth sejak awal (§ 13.6, poin 14) murni **stateless**: `requireAuth`
cuma verify signature JWT, tanpa query database sama sekali. Konsekuensinya,
token yang sudah terbit tetap sah secara kriptografis sampai TTL alami
habis (12 jam) — **walaupun** user-nya sudah dinonaktifkan, password/PIN-nya
di-reset, atau akses lokasinya dicabut di tengah jalan. Gap ini sudah
dilaporkan eksplisit ke owner di § 13.6/14 sebagai sesuatu yang "wajib
diatasi sebelum Tahap 4/deploy".

### 22.2 Keputusan: counter per-user, bukan tabel sesi/blacklist terpisah

Dua opsi standar yang disebut di § 13.6: (a) simpan sesi di database dan
cek tiap request, atau (b) daftar token yang dicabut (blacklist). Dipilih
varian lebih murah dari opsi (a): satu kolom `core_users.token_version`
(INTEGER NOT NULL DEFAULT 0, migrasi `core/src/db/migrations/0009_add_token_version_to_users.sql`),
BUKAN tabel sesi terpisah. Alasan: jumlah user di sistem ini kecil (pilot
outlet tunggal), satu angka per user sudah cukup untuk kebutuhan "basikan
SEMUA token user ini sekarang juga" — tidak perlu melacak sesi individual
per device/browser.

Mekanismenya: `signAuthToken` (tidak diubah strukturnya) menyisipkan
`tokenVersion` user APA ADANYA ke payload JWT, karena fungsi itu memang
men-sign seluruh objek `AuthUser` yang dioper (lihat `core/src/auth/jwt.ts`).
`authenticate()`/`authenticateByPin()` (`core/src/auth/users.ts`) membaca
`token_version` dari DB saat login dan menyisipkannya ke objek `AuthUser`
yang dikembalikan. `requireAuth` (`core/src/auth/permissions.ts`), SETELAH
verify signature berhasil, query SATU baris (`SELECT token_version FROM
core_users WHERE id = $1`) dan bandingkan ke versi di token — mismatch atau
baris sudah tidak ada → 401 `"Sesi berakhir, silakan login ulang"` (pesan
INI SENGAJA beda dari `"Token tidak valid atau kedaluwarsa"` yang dipakai
untuk kegagalan verify signature/TTL alami, supaya dua skenario bisa
dibedakan saat menelusuri keluhan user).

### 22.3 Trade-off performa yang disadari & diterima

`requireAuth` dipasang GLOBAL (`core/src/server/build-server.ts`), jadi
perubahan ini mengubah middleware itu dari **nol query per request** jadi
**satu query per request** ke SEMUA endpoint terautentikasi di modul
manapun. Diukur langsung di DB dev (8 baris `core_users`): `EXPLAIN
(ANALYZE, BUFFERS)` untuk query ini **0.076 ms**, full cache hit, planner
pilih Seq Scan (wajar untuk tabel sekecil ini, index primary key tetap ada
dan otomatis dipakai begitu tabel tumbuh). Dibandingkan biaya query domain
lain di sistem ini (join resep berjenjang, agregasi stok ledger) atau
`bcrypt.compare` saat login (ratusan ms, disengaja ~12 rounds) — overhead
ini **tidak terukur** oleh pemakai untuk skala satu outlet pilot. Kalau
nanti skalanya naik jauh (puluhan request/detik terus-menerus), opsi mitigasi
standar sudah diketahui: cache `token_version` per user di memori dengan TTL
pendek (mis. 5-10 detik) yang menukar "revoke instan" dengan "revoke dalam
hitungan detik" — TIDAK dikerjakan sekarang karena belum perlu, dan
menambah cache sebelum ada bukti nyata perlu cuma mengorbankan ketepatan
revoke tanpa keuntungan terukur.

### 22.4 Tiga titik yang menaikkan `token_version` (`core/src/auth/users.ts`)

1. `updateUser()` — saat `isActive` diubah jadi `false` (menonaktifkan user).
   Menyalakan kembali (`isActive: true`) TIDAK menaikkan apa pun — tidak ada
   token yang perlu dibasikan ke arah itu.
2. `updateUser()` — saat `locationIds` diubah (UPDATE terpisah dari blok
   `name`/`isActive`, karena `locationIds` bisa dikirim sendirian).
   `locationIds` ikut disisipkan ke JWT (`AuthUser.locationIds`), jadi token
   lama yang masih mengklaim lokasi LAMA harus langsung basi begitu lokasi
   di DB berubah — baik nambah maupun ngurangin akses.
3. `resetCredential()` — reset password ATAU PIN, di statement UPDATE yang
   sama dengan penggantian `password_hash`/`pin_hash`.

Semua pakai `token_version = token_version + 1` (increment relatif di SQL),
bukan baca-angka-dulu-dari-aplikasi, supaya aman dari race condition kalau
ada dua request bersamaan.

**Role SENGAJA tidak ada di daftar ini** — dikonfirmasi ulang saat
implementasi: **tidak ada satu pun jalur ubah-role** di aplikasi ini
sekarang (`UpdateUserInput` cuma terima `name`/`isActive`/`locationIds`,
tidak ada `role`). Ditulis sebagai catatan eksplisit di JSDoc `updateUser`:
kalau fitur ubah-role ditambahkan nanti, `token_version` WAJIB ikut
dinaikkan di situ juga — tanpa itu, token lama akan terus dipercaya membawa
role LAMA sampai TTL 12 jam habis, termasuk skenario penurunan hak akses
(mis. owner diturunkan ke staf tapi tokennya masih mengaku owner).

### 22.5 Frontend

Tombol Keluar (`apps/web/src/auth/AuthContext.tsx`) **tidak diubah** —
tetap murni hapus token+user dari `localStorage`, tanpa panggilan API, sesuai
instruksi eksplisit owner (tidak perlu endpoint logout baru).

401 yang muncul DI TENGAH sesi (bukan saat login) sekarang ditangani GLOBAL
di `apps/web/src/api/client.ts` (`handleUnauthorized()`, dipanggil dari
`request()`/`postCsv()`): hapus token+user dari `localStorage`, simpan pesan
error ke `sessionStorage` (dibaca sekali oleh `LoginPage.tsx` lalu dihapus,
supaya tidak nyangkut di kunjungan berikutnya), lalu `window.location.href
= "/login"` — full reload, karena router app ini `<BrowserRouter>` biasa
tanpa instance router yang bisa diakses dari file non-komponen. Dua guard
anti-loop: path yang mengandung `/auth/login` di-skip total (gagal
login/salah password BUKAN "sesi berakhir", jangan ikut redirect), dan
tidak reload kalau sudah di `/login`.

### 22.6 Verifikasi

`npm run typecheck` bersih 6 workspace. `npm test` **276 test, 0 gagal**
(269 lama + 7 baru, semua workspace termasuk `api` yang sekarang memuat
request HTTP sungguhan lewat `requireAuth` yang sudah async+query DB).
7 test baru di `apps/api/src/auth.test.ts`:

1. Token user yang baru dinonaktifkan langsung ditolak 401 (pesan persis
   "Sesi berakhir, silakan login ulang")
2. Token lama ditolak setelah reset password; login dengan password baru
   berhasil dan tokennya normal
3. Token lama staf ditolak setelah reset PIN; PIN baru dipakai login ulang
4. Counter per-user dibuktikan: deactivate/reset SATU user tidak mengganggu
   token user LAIN
5. Token lama ditolak setelah `locationIds` diubah; login ulang membawa
   lokasi baru
6. Akun role `integrasi` tetap bisa login ulang normal & pakai keempat
   endpoint import (regresi dari § 21)
7. Kontrol positif: token baru keempat role manusia + `integrasi` langsung
   bisa dipakai normal di jalur yang sesuai permission masing-masing

Diverifikasi ulang secara independen (bukan cuma dari laporan implementasi)
lewat `curl` manual terhadap dev server sungguhan (reset PIN staf, deactivate
manajer di tengah sesi, cek user lain tidak terganggu) DAN lewat browser:
user staf yang sedang aktif browsing (`/menu` ter-load, PIN sudah login)
dinonaktifkan dari sisi lain, klik menu berikutnya langsung redirect ke
`/login` dengan banner amber "Sesi berakhir, silakan login ulang" — banner
itu terbukti hilang lagi di kunjungan berikutnya (read-once). Semua akun QA
yang dipakai untuk verifikasi ini (4 akun, lintas role) dihapus bersih
setelahnya, termasuk baris `core_user_lokasi`/`core_login_attempts` terkait.

---

## 23. Deploy production #1 — app live, dan bug migrasi `core/0006` (2026-10-16)

### 23.1 Ringkasan

App Samsara Backoffice berhasil di-deploy ke production, live di
`https://burnas-app.duckdns.org`, berdampingan dengan n8n/Postgres/VNC yang
sudah berjalan di VPS yang sama tanpa mengganggu satu pun (diverifikasi
berkali-kali sepanjang proses: uptime container tidak pernah reset,
sertifikat SSL n8n tidak berubah, `burnas-ops.duckdns.org` tetap 200 OK).
Dikerjakan bertahap dengan banyak titik berhenti eksplisit (bukan satu
proses otomatis dari ujung ke ujung) — pola yang konsisten dipakai sejak
sesi deploy pertama (lihat § 22 dan seterusnya untuk kronologi sebelumnya).

### 23.2 Koreksi domain production

Domain production app SEMPAT salah tercatat `burnas-ops.duckdns.org` di
beberapa dokumen (CLAUDE.md, devops/README.md, product-overview.md) —
diagnostik langsung ke VPS menemukan domain itu sebenarnya milik **n8n**,
sudah live sejak lama (reverse-proxy ke port 5678, SSL sejak September
2026). Domain app yang benar: **`burnas-app.duckdns.org`**, didaftarkan
owner terpisah di DuckDNS. Sempat ada kesalahan tambahan: saat pertama
didaftarkan, IP yang terisi di DuckDNS adalah IP perangkat owner sendiri
(auto-terisi), bukan IP VPS — baru benar setelah owner perbaiki manual di
dashboard DuckDNS. Semua dokumen sudah dikoreksi.

### 23.3 Reverse proxy: numpang di nginx host-level existing, bukan Nginx Proxy Manager

Rencana awal (Nginx Proxy Manager terpisah, lihat § 20/21 dan CLAUDE.md
§ Rencana Infra VPS) diubah setelah diagnostik menemukan VPS SUDAH punya
`nginx` host-level (systemd, bukan Docker) + Certbot yang melayani
`burnas-ops.duckdns.org` (n8n) — port 80/443 sudah terpakai, NPM belum
terpasang sama sekali. Keputusan owner (lewat AskUserQuestion): tambah
server block BARU di nginx yang sama untuk `burnas-app.duckdns.org`, bukan
pasang NPM terpisah yang akan rebutan port. Backup config dibuat sebelum
perubahan (`/etc/nginx/sites-available.backup-20261016-142151`), diverifikasi
n8n tidak terganggu sebelum & sesudah (serial sertifikat tidak berubah).

### 23.4 RAM VPS tipis — keputusan sadar menerima risiko

RAM available VPS sempat terukur 697MB-717MB, di bawah ambang aman 1GB
yang ditetapkan owner sendiri sebagai syarat berhenti. Penyebabnya n8n
sendiri (~410MB RSS) plus proses pendukungnya — kondisi harian, bukan
lonjakan sesaat (dicek ulang beberapa menit kemudian, angkanya stabil/turun
sedikit, bukan membaik). Owner dikonfirmasi eksplisit (AskUserQuestion)
untuk tetap lanjut dengan resource limit SANGAT ketat (`docker-compose.prod.yml`:
api 256M limit/64M reservation, web 64M limit/16M reservation, diperketat
dari draft awal 512M/128M). Hasil aktual setelah container jalan: api
~68MB (26% dari limit), web ~2.6MB (4% dari limit) — jauh di bawah limit,
build maupun runtime tidak sampai OOM. Keputusan ini TIDAK diambil sepihak
oleh Claude Code — eksplisit dikonfirmasi owner dengan risiko dijelaskan
dulu.

### 23.5 Bug migrasi `core/0006_move_locations_to_core.sql` — ditemukan & diperbaiki

**Gejala**: build & start container `api` sukses, tapi container langsung
crash-loop. Log: migrasi gagal di `core/0006_move_locations_to_core.sql`
dengan error `relation "inventory_locations" does not exist`.

**Root cause** (ditelusuri langsung, bukan tebakan): migrasi itu menyalin
data lokasi dari `inventory_locations` (tabel modul Inventory) ke
`core_locations` (lihat § 18 untuk konteks kenapa lokasi dipindah ke core).
Penulisnya mengasumsikan `inventory_locations` SUDAH ADA saat migrasi ini
jalan — BENAR untuk database dev (tabel itu sudah ada sejak modul Inventory
migrasi 0001, jauh sebelum migrasi pemindahan-ke-core ini ditulis belakangan).
Tapi `runMigrations()` (`core/src/db/migrate.ts:64-77`) SELALU menjalankan
**seluruh migrasi `core/` dulu**, baru migrasi tiap modul bisnis secara
berurutan — jadi di database production yang BENAR-BENAR baru (belum pernah
dimigrasi sama sekali), `core/0006` jalan SEBELUM modul Inventory sempat
membuat `inventory_locations` sama sekali. Gap ini **tidak pernah kelihatan
di dev** selama ini, murni karena database dev tidak pernah benar-benar
"fresh" sejak migrasi ini ada dalam sejarahnya — tidak ada CI/test harness
yang pernah menjalankan seluruh rantai migrasi dari nol sebelum sesi deploy
ini.

**Kenapa bukan bug di tempat lain**: ditelusuri seluruh rantai terkait —
`modules/inventory/0023_move_locations_to_core.sql` (migrasi lanjutan yang
merepoint 11 FK ke `core_locations` lalu `DROP TABLE inventory_locations`)
SUDAH `IF EXISTS`/idempotent dari awal, tidak butuh perbaikan. Hanya SATU
baris `INSERT ... FROM inventory_locations` di `core/0006` yang unconditional.

**Perbaikan**: baris penyalinan data dibungkus `DO $$ ... IF EXISTS (SELECT
1 FROM information_schema.tables WHERE table_name = 'inventory_locations')
... $$` — kalau tabelnya ada (dev, atau instalasi lama manapun), perilaku
SAMA PERSIS seperti sebelumnya; kalau tabelnya belum ada (database baru),
blok itu di-skip (memang tidak ada data lama untuk disalin — modul Inventory
akan membuat `inventory_locations` kosong sendiri nanti lewat migrasi 0001,
lalu menghapusnya lagi lewat migrasi 0023 yang sudah aman). `setval()` untuk
reset sequence TIDAK perlu diduplikasi ke dalam blok kondisional — statement
`SELECT setval(..., COALESCE(MAX(id), 1))` yang sudah ada di akhir file
sudah otomatis aman untuk kedua kasus (tabel kosong → `COALESCE` jatuh ke 1).

**Ini edit ke migrasi yang SUDAH applied** — bertentangan dengan aturan keras
repo ini ("migrasi baru, bukan edit yang sudah applied", ditegakkan berkali-kali
sepanjang proyek, bahkan oleh subagent `db-migration` yang menolak permintaan
serupa di luar scope-nya). **Dikerjakan HANYA setelah konfirmasi eksplisit
owner** (AskUserQuestion, dengan penjelasan lengkap root cause dan argumen
keamanan fix-nya sebelum owner menjawab) — dibenarkan karena: (a) ini bug
crash yang nyata dan dapat dibuktikan, bukan perbedaan pendapat soal desain;
(b) fix-nya PROVABLY tidak mengubah perilaku di database manapun yang sudah
menjalankan migrasi ini (dikonfirmasi: `core/0006` sudah tercatat *applied*
di `schema_migrations` dev, sehingga tidak pernah dijalankan ulang di sana
sama sekali); (c) migrasi lanjutan (`0023`) sudah terbukti aman menghadapi
kasus ini tanpa perlu ikut diubah.

**Verifikasi sebelum dicoba lagi ke production**: dibuat database test lokal
benar-benar baru (`createdb samsara_fresh_test`), dijalankan `migrate.ts`
dari nol — **seluruh 42 file migrasi lintas core/inventory/hr/sales-sync
berhasil tanpa error**, `core_locations` berakhir kosong (0 baris, benar
untuk fresh install), `inventory_locations` berakhir tidak ada (ter-DROP
bersih oleh `0023`). `npm test` penuh (276 test) tetap lulus 100% setelah
perubahan ini (tidak ada regresi, karena file ini memang tidak pernah
dijalankan ulang di dev). Baru setelah lolos verifikasi ini, file migrasi
yang sudah diperbaiki disalin ulang ke VPS dan `docker compose up -d --build`
diulang — berhasil, seluruh 42 file migrasi jalan bersih ke database
production, container `api` langsung `healthy`.

### 23.6 Yang masih tersisa (sengaja, bukan terlupa)

Akun owner & integrasi production BELUM dibuat — sengaja ditahan sampai
owner sendiri yang menjalankan `seed:owner` (interaktif, password diketik
langsung oleh owner lewat `read -s`, tidak pernah lewat argumen
command/environment yang bisa terlihat di `ps`/log) dan `seed:integrasi`.
Password/kredensial apa pun tidak pernah ditulis ke chat, log, atau git
sepanjang seluruh proses deploy ini — password database disalin lewat
`scp` (file `.env.production`, permission 600 di kedua sisi), bukan lewat
git atau pesan chat.
