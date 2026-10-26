# Product Overview — Samsara Backoffice

> **Cara baca dokumen ini:** ini bukan rencana/roadmap. Setiap klaim "sudah
> ada" di bawah **diverifikasi langsung ke kode, skema database, dan hasil
> `npm test`/`npm run typecheck`** pada tanggal pembaruan terakhir (2026-10-26), bukan
> ditulis dari ingatan sesi-sesi sebelumnya. Kalau pembaca menemukan sesuatu
> di sini yang sudah tidak cocok dengan kode saat dibaca nanti, itu tandanya
> dokumen ini perlu diperbarui lagi — jangan dianggap kode yang salah.
>
> Status tiap fitur ditandai: **✅ hidup penuh & teruji**, **🟡 parsial/ada
> keterbatasan diketahui**, **⚪ dibangun tapi tidak terhubung ke apa pun**,
> atau disebutkan eksplisit kalau memang **belum ada sama sekali**.

---

## 1. Ringkasan & Latar Belakang

**Burnas dan Samsara adalah satu bisnis yang sama** — bukan dua brand
berbeda. "Burnas" adalah nama brand yang dipakai saat sistem ini live di
production nanti. "Samsara" adalah codename yang dipakai khusus selama masa
development repo ini, supaya penamaan di lingkungan development tidak
tertukar dengan sistem Burnas yang sudah berjalan secara live sebelumnya.
Klarifikasi lengkap beserta riwayat kebingungannya ada di
[`CLAUDE.md`](../CLAUDE.md) § 1 dan
[`docs/architecture-decisions.md`](./architecture-decisions.md) § 19. (Catatan
berbeda: brand **Bubur Ayam Ajiep** tetap bisnis lain milik owner yang
benar-benar terpisah — tidak ada hubungan dengan Burnas/Samsara.)

**Konsep bisnis**: F&B dengan model mirip Mie Gacoan — menu sempit, volume
transaksi tinggi, harga terjangkau, operasional sangat terstandar antar
outlet. Pilot outlet berlokasi di Malang, jam operasional 06.00–21.00 setiap
hari. Model ekspansi (kota besar, rest area, franchise/kemitraan vs cloud
kitchen) masih terbuka, belum diputuskan — itu keputusan bisnis di luar
scope sistem ini.

**Status saat ini: development lokal LENGKAP, production SUDAH LIVE** di
`https://burnas-app.duckdns.org` (sejak 2026-10-16). Per
[`devops/README.md`](../devops/README.md) (dicek ulang langsung ke VPS
sungguhan, bukan disalin dari versi dokumen sebelumnya):

- Push ke Git, akses SSH ke VPS (alias `samsara-vps`), database `samsara`
  (role & password acak, dibuat di instance Postgres existing lewat
  `docker exec`), reverse proxy + SSL (`burnas-app.duckdns.org`, nginx
  host-level existing + Certbot — BUKAN Nginx Proxy Manager seperti rencana
  awal), swap 2GB, JWT secret production, backup harian otomatis (cron +
  sudah dites manual, file valid), dan **migrasi database production** —
  **semuanya ✅ selesai dan terverifikasi**.
- **Satu bug migrasi nyata ditemukan & diperbaiki** saat deploy ini: migrasi
  `core/0006_move_locations_to_core.sql` crash di database yang BENAR-BENAR
  baru (gap yang tidak pernah kelihatan di dev karena databasenya tidak
  pernah fresh sejak migrasi itu ditulis) — diperbaiki dengan konfirmasi
  eksplisit owner (edit ke migrasi yang sudah *applied*, biasanya dilarang
  di repo ini), diuji ulang end-to-end terhadap database fresh sebelum
  dicoba lagi ke production. Detail: `docs/architecture-decisions.md` § 23.
- RAM VPS sangat tipis (available sempat di bawah 1GB) — owner
  mengonfirmasi eksplisit untuk lanjut dengan resource limit sangat ketat
  (api 256MB, web 64MB). Pemakaian aktual setelah jalan jauh di bawah limit
  (~68MB dan ~2.6MB) — tidak OOM.
- Smoke test lulus semua: HTTPS valid, `/health` OK, container `api`
  di-restart sekali dan naik lagi sendiri otomatis, n8n/Postgres/VNC
  terverifikasi TIDAK terganggu sepanjang proses (uptime tidak pernah
  reset, dicek berkali-kali).
- Akun owner production sudah dibuat owner sendiri lewat `seed:owner` —
  app sudah benar-benar dipakai (bukan cuma live secara teknis).
- **Data master dev -> production sudah disinkronkan penuh** (2026-10-17):
  item, menu, resep, harga per channel, pemetaan item sales-sync, dan
  pengaturan sistem sekarang **identik** antara dev dan production —
  dibuktikan lewat perhitungan HPP 70 menu/item langsung lewat fungsi
  domain di kedua sisi, 0 selisih. Detail lengkap metodologi & 3 skrip
  yang dijalankan: `docs/architecture-decisions.md` § 24. **Sejak
  sinkronisasi ini, production adalah sumber kebenaran (source of truth)
  untuk data master** — bukan dev lagi (lihat § 7 "Keputusan desain
  penting" dan CLAUDE.md).
- Bug zona waktu nyata ditemukan & diperbaiki dalam proses yang sama:
  label `Z` di import `raw-majoo` ternyata salah (sebenarnya jam lokal
  Asia/Jakarta, bukan UTC) — dikonfirmasi lintas 5539 order sungguhan
  (99.96% konsisten). Diperbaiki di kode (bukan di data lama), container
  `api` production di-rebuild & restart, `web`/n8n/Postgres/VNC tidak
  disentuh.

Ringkasnya: app Samsara Backoffice sudah bisa diakses publik dengan HTTPS
valid di `burnas-app.duckdns.org`, berjalan berdampingan dengan n8n/VNC yang
sudah ada tanpa mengganggu satu pun, database production sudah termigrasi
bersih dari nol DAN data masternya sudah disinkronkan penuh dengan dev —
app sudah benar-benar dipakai owner, bukan cuma live secara teknis.
Production sekarang jadi acuan utama data master ke depan, bukan dev.

---

## 2. Pengguna & Role

Lima role terdaftar di tabel `core_roles` (diverifikasi ke
`core/src/db/migrations/0001_create_auth_tables.sql` +
`0008_add_integrasi_role.sql`, dan ke `core/src/auth/types.ts`):

| Role | Jenis | Gambaran akses |
|---|---|---|
| `owner` | Manusia | Akses paling luas. Satu-satunya yang boleh: ubah harga jual & visibilitas menu per channel, atur metode HPP & target food cost global, kelola lokasi/channel, kelola identitas bisnis (nama+logo), kelola user (buat/edit nama-lokasi-WhatsApp/**ubah role**/nonaktifkan/reset kredensial). Juga ikut di semua permission `manajer_ops`. |
| `manajer_ops` | Manusia | Operasional harian lintas lokasi: approve opname & pengajuan libur, kelola jadwal shift, lihat laporan harian & analitik (penjualan + operasional), kelola sinkronisasi penjualan (`sales-sync`), transaksi apa pun di lokasi mana pun. **Tidak** bisa ubah harga jual, visibilitas channel, pengaturan global, atau kelola user. |
| `supervisor` | Manusia | Operasional harian **di lokasi yang ditugaskan saja** (`locationScope: own`): catat pembelian/produksi/penjualan, kirim transfer, lihat laporan harian lokasinya. **Tidak** bisa approve opname/cuti, tidak bisa lihat analitik. |
| `staf` | Manusia | Paling terbatas, dibatasi lokasi sendiri: input opname (draft saja), mutasi lain, terima transfer, ajukan permintaan transfer, ajukan cuti sendiri. **Tidak** bisa lihat laporan harian/analitik, tidak bisa approve apa pun. Login pakai **PIN** (pilih nama dari daftar staf aktif di satu lokasi, lalu input PIN), bukan username+password seperti 3 role manusia lainnya. |
| `integrasi` | **Bot, bukan manusia** | Akun otomatis untuk workflow n8n. Akses **sangat sempit — cuma 4 endpoint**: `POST /sales-sync/import/{log-penjualan,transaksi,raw-majoo,biaya-platform}` (action `sales_sync.import`). **Ditolak 403 di endpoint lain apa pun**, termasuk `POST /sales-sync/proses` yang mengurangi stok sungguhan — ini pengaman sengaja, bukan keterbatasan sementara. Lihat [`docs/integrasi-n8n.md`](./integrasi-n8n.md). |

Sistem permission ini **murni whitelist di kode** (bukan tabel database
yang bisa diedit lewat UI): setiap endpoint di `module.json` tiap modul
mendeklarasikan `action` + daftar `roles` yang boleh, dan ada request yang
tidak match otomatis ditolak 403. Beberapa permission juga punya
`locationScope: "own"` yang memaksa supervisor/staf hanya menyentuh lokasi
yang ditugaskan ke mereka. Untuk presisi lengkap per-endpoint (permission
mana untuk endpoint mana), rujuk `module.json` tiap modul — sengaja tidak
disalin satu-satu di sini supaya dokumen ini tetap terbaca.

Kondisi user nyata di database dev saat ini (bukan target produksi, sekadar
konteks): 1 `owner`, 1 `manajer_ops`, 0 `supervisor`, 5 `staf`, 1
`integrasi`. Per `devops/README.md`, akun production **tidak** akan
dimigrasikan dari dev — dibuat ulang dari nol saat deploy sungguhan.

---

## 3. Arsitektur

Backend **Node.js + TypeScript**, frontend **React + TypeScript** (build
tool Vite), database **PostgreSQL 16 native** (terinstal langsung di mesin,
**bukan** Docker — ini keputusan final, lihat `CLAUDE.md` § 3 dan
`docs/architecture-decisions.md` § 1/§1b untuk alasan & riwayatnya). Repo ini
**monorepo npm workspaces**: `core/` (platform — auth, audit log, migration
runner, server HTTP), `modules/*/` (unit bisnis terpisah — Inventory, HR,
Sales-Sync), `apps/*/` (aplikasi yang benar-benar dijalankan — `api` dan
`web`).

Tiap modul bisnis mendeklarasikan kontraknya lewat file `module.json`:
nama, versi, dependency ke modul lain, daftar tabel yang dimilikinya, dan
daftar endpoint API yang diekspos (lengkap dengan permission-nya). Isolasi
antar modul dilakukan lewat **prefix nama tabel per modul** (mis.
`inventory_items`, `hr_jadwal_shift`, `salessync_log_penjualan`) di dalam
**satu** database `samsara` — bukan schema Postgres terpisah per modul.
Modul baru tidak boleh mengubah skema tabel milik modul lain secara
langsung, hanya lewat API yang diekspos modul itu (lihat bagaimana modul
`sales-sync` memanggil `POST /api/inventory/transaksi/penjualan` lewat HTTP,
bukan import fungsi domain, untuk contoh nyata aturan ini ditegakkan).

Detail lengkap stack & struktur folder: `CLAUDE.md` § 3 dan
`docs/architecture.md` (dokumen itu menggambarkan kondisi Tahap 1, sudah agak
basi dibanding kode saat ini — jangan jadikan satu-satunya rujukan untuk
status fitur).

---

## 4. Modul yang sudah ada

### Core — pondasi, BUKAN modul bisnis ke-4

`core` menyediakan layanan yang dipakai bersama semua modul bisnis: auth
(login, JWT, permission registry), `core_users`/`core_roles`, audit log
(`core_audit_log`), dan lokasi fisik (`core_locations` — dipindah dari
modul Inventory ke `core` pada 2026-10-06 supaya modul lain seperti `hr`
bisa FK langsung tanpa bergantung ke modul bisnis tertentu, lihat
`docs/architecture-decisions.md` § 18). Ini **bukan modul bisnis setara**
dengan Inventory/HR/Sales-Sync — tidak punya `module.json` sendiri yang
menyatakan dirinya modul "aktif/nonaktif".

Sejak Tahap 1 "Outlet & Kitchen + Identitas Bisnis" (2026-10-25/26):
- `core_locations` punya **detail operasional lengkap** (kode, tipe
  outlet/kitchen, alamat, kota, telepon, jam buka/tutup, penanggung jawab,
  tanggal buka, kitchen pemasok default) — sebelumnya cuma name/entitas.
  CRUD detailnya tetap di modul Inventory (`/api/inventory/lokasi`, owner
  saja) sesuai preseden § "Keputusan desain penting" di bawah, tapi daftar
  **ringkas publik** (tanpa login, dipakai flow login PIN staf & picker
  lokasi di seluruh app) ada di `GET /api/core/lokasi`.
- `core_business_identity` (BARU, satu baris): nama tampilan + logo
  (PNG/JPG/WebP maks 500KB, disimpan sebagai bytea). `GET
  /api/core/identitas-bisnis`(`/logo`) publik; `PUT` owner saja (action
  `identitas_bisnis.manage`). Dipakai sidebar, halaman login, judul tab —
  menggantikan "Samsara Backoffice" yang sebelumnya hardcode.

### Inventory (v0.10.0) — modul paling matang

- Master data (item, kategori item, satuan, resep produksi 1 level, menu,
  kategori menu, paket menu) — ✅
- HPP dengan **2 metode kalkulasi** (Harga Master vs Harga Beli Terakhir,
  bisa dipilih global oleh owner, dengan override per-request untuk
  owner/manajer_ops) — ✅ teruji
- Stok & ledger (semua perubahan **wajib** lewat salah satu jenis
  transaksi, tidak ada edit stok langsung) — ✅
- Transaksi: Pembelian (konversi satuan beli→resep otomatis) ✅, Produksi
  (hasil aktual, bukan yield teoretis) ✅, Penjualan (dengan jam opsional
  untuk heatmap) ✅, Transfer 2 tahap kirim→terima dengan susut tercatat ✅,
  Mutasi Lain dengan 6 jenis terstruktur (waste_rusak, hilang_tidak_diketahui,
  staff_meal, sampel, retur_supplier, koreksi_tambah) ✅, Opname 2 tahap
  draft→keputusan ✅ — **semuanya teruji** (166 test domain + test regresi
  permission di `apps/api`).
- Channel penjualan & harga per channel (termasuk komisi channel, saran
  harga otomatis berdasar target food cost, export/import CSV harga massal)
  — ✅
- Visibilitas menu per lokasi & per channel (dua tabel pengecualian
  berbeda, semantik "tidak ada baris = tayang") — ✅, tapi **permission-nya
  tidak sama**: visibilitas per **lokasi** diatur lewat `lokasiIds` saat
  buat/duplikat menu (`master_menu.edit`, owner+manajer_ops boleh),
  sedangkan visibilitas per **channel** (`PATCH
  .../channel/:channel/visibilitas`) permission-nya lebih sempit,
  **owner saja** — manajer_ops ditolak 403 di endpoint ini secara sengaja.
- **Snapshot HPP historis** per baris transaksi penjualan (migrasi 0028,
  kolom `hpp_saat_transaksi`/`hpp_sumber`) — **✅ hidup penuh & teruji**:
  ditulis otomatis tiap transaksi Penjualan baru (`snapshot_asli`), tampil
  di halaman Riwayat Transaksi, dan dipakai analitik operasional untuk tren
  COGS (`cogsTren`). Jalur backfill untuk data lama (`snapshot_estimasi`)
  sudah ada skemanya tapi scriptnya di luar migrasi ini.
- Analitik — **bukan modul terpisah**, cuma 2 endpoint di dalam modul
  Inventory (`GET /analitik/penjualan`, `GET /analitik/operasional`):
  - Penjualan: minggu ini vs minggu lalu per menu, top/bottom produk,
    **heatmap jam ramai** (24 jam, offline vs online), insight otomatis
    berbasis ambang yang dibaca dari tabel `inventory_insight_rules` — ✅
  - Operasional: tren waste 8 minggu, tren selisih opname, tren susut
    transfer, **tren COGS** (`cogsTren`), insight otomatis (streak waste
    naik, streak opname negatif) — ✅ teruji. **Catatan verifikasi**: teks
    deskripsi endpoint ini di `module.json` sendiri sudah agak basi — tidak
    menyebut field `cogsTren`/`adaDataEstimasi`/`tanggalMulaiDataAsli` yang
    nyatanya ada di response sungguhan dan sudah diuji test. `module.json`
    adalah kontrak yang benar-benar di-deploy, tapi **teks deskripsinya**
    bisa ikut basi seperti dokumentasi lain kalau tidak diperbarui saat
    endpoint berkembang.
- Laporan harian per lokasi — ✅ (owner/manajer_ops/supervisor; staf tidak
  boleh)
- Permintaan transfer (outlet minta stok ke Central Kitchen) — ✅
- Min stok per lokasi (ambang notifikasi menipis) — ✅
- **Modifier menu** (`inventory_modifier_grup`, `inventory_modifier_opsi`,
  `inventory_menu_modifier_grup`, dibuat migrasi 0024) — **⚪ dibangun tapi
  TIDAK terhubung ke apa pun**. Dikonfirmasi langsung ke kode: migrasinya
  sendiri berkomentar eksplisit "STRUKTUR SAJA, belum dipakai kode", tidak
  ada endpoint API di `module.json`/`router.ts`, dan tidak ada satu pun
  referensi di frontend (`apps/web`). Tabelnya ada di database, kosong
  fungsinya.
- **Vendor & Katalog** (Tahap 3, dalam modul Inventory — **bukan modul PO/
  hutang/retur/QC terpisah, sengaja tidak dibangun**) — ✅ teruji (15 test
  domain + verifikasi langsung lewat browser/API, 4 role):
  - CRUD vendor (nama, kontak, telepon, alamat, **termin pembayaran**,
    aktif/nonaktif) + pencarian nama ILIKE — tab **Master > Vendor**,
    `vendor.edit` (owner/manajer_ops). Vendor juga bisa dibuat **langsung
    dari dalam form Pembelian** lewat opsi "+ Vendor baru..." di dropdown
    vendor (form singkat: nama, telepon, termin — cuma tampil untuk role
    yang punya `vendor.edit`).
  - Katalog vendor-item: harga per vendor+item, **riwayat harga selalu
    bertambah** (tidak pernah overwrite, jadi tren harga vendor tetap
    terlacak). "Pencarian barang ke vendor" (`GET
    /vendor/untuk-item/:itemKode`) — lintas vendor, urut harga termurah
    dulu, untuk bandingkan sebelum beli.
  - **Vendor WAJIB dipilih di form Pembelian** (bukan opsional lagi sejak
    perbaikan lanjutan setelah Tahap 3) — backend menolak 400 kalau
    `vendorId` kosong, dengan pesan yang mengarahkan ke vendor seed
    **"Pembelian Umum (pasar/warung)"** (dibuat migrasi 0031) untuk
    pembelian dadakan tanpa vendor tetap. Kolom `supplier` TEKS BEBAS lama
    **sudah dihapus dari form** dan DEPRECATED di backend (selalu NULL
    untuk pembelian baru) — baris lama yang masih punya teks supplier
    tetap kebaca, ditampilkan sebagai "Supplier (lama)" di Laporan Harian.
    Item dari katalog mengisi **harga terakhir otomatis**, dan peringatan
    **real-time** (sebelum submit) + di **response setelah submit** kalau
    kenaikan harga di atas ambang (`inventory_insight_rules`, default 10%,
    owner bisa ubah). Alasan & detail insiden: `docs/architecture-decisions.md`
    § 29.
  - **Harga difilter berdasar permission `hpp.lihat_harga`** (role
    supervisor/staf): katalog per vendor, "pencarian barang ke vendor", dan
    riwayat harga semuanya **menyembunyikan/403 harga** untuk role tanpa
    izin itu — KECUALI satu endpoint sempit "harga terakhir untuk satu
    vendor+item" (`GET /vendor/:id/item/:itemKode/harga-terakhir`) yang
    **sengaja tetap tampil ke supervisor**, karena itu yang dipakai form
    Pembelian untuk isi-otomatis & supervisor memang boleh bikin pembelian
    — tanpa itu dia tidak bisa menilai wajar-tidaknya harga yang
    ditawarkan vendor. Alasan lengkap: `docs/architecture-decisions.md`
    § 28.
  - **Supplier teks lama tidak digabung otomatis** ke vendor baru — endpoint
    "laporan supplier lama" (`GET /vendor/laporan-supplier-lama`, owner/
    manajer_ops) cuma mengelompokkan & melaporkan daftar teks supplier yang
    `vendor_id`-nya masih NULL, supaya owner yang putuskan manual mana yang
    mau dijadikan vendor resmi.

### HR (v0.1.0)

- Jadwal shift: grid per hari × shift per lokasi, salin jadwal antar minggu
  (idempoten), assign/hapus banyak baris sekaligus, shift template — ✅
  teruji, termasuk penanda `konflikCuti` (jadwal yang bertabrakan dengan
  cuti disetujui, peringatan saja, tidak memblokir).
- Pengajuan libur: kuota bulanan per staf, kuota harian per lokasi (maks 1
  staf cuti disetujui per lokasi per tanggal kecuali ada pengganti), aturan
  H-2, jalur override darurat untuk manajer — ✅ teruji lengkap (46 test
  domain HR, semua lulus).
- Tidak ada payroll/rekrutmen di modul ini — itu di luar scope repo,
  termasuk peta bisnis jangka panjang `CLAUDE.md` § 4 (lihat § 5 di bawah).

### Sales-Sync (v0.1.0)

- Import CSV 4 jenis (log penjualan, transaksi rekonsiliasi platform, raw
  data Majoo, biaya platform) ke tabel arsip — ✅, bisa diakses akun
  `integrasi` (n8n) maupun manual oleh owner/manajer_ops. Parser CSV
  menerima **dua gaya sumber** (ekspor Postgres: tanggal ISO, angka tanpa
  pemisah ribuan; Google Sheet: tanggal `M/D/YYYY`, angka boleh berkutip
  dengan koma ribuan) — diuji eksplisit untuk 8 kombinasi (4 endpoint x 2
  gaya), termasuk perbaikan bug nyata `angkaWajib` yang dulu diam-diam
  salah parse angka berkoma (`parseFloat("-1,000")` -> `-1`, bukan error).
  Spesifikasi kolom lengkap: `docs/integrasi-n8n.md` § 8.
- **4 workflow n8n siap-impor** (`devops/n8n/*.json`, non-aktif saat
  diimpor, belum pernah dicoba jalan sungguhan di instance n8n owner) —
  mengambil data dari spreadsheet `BURNAS_DASHBOARD_V1` yang sudah dipakai
  3 workflow n8n LAMA (bukan query Postgres — Postgres cuma punya mirror
  parsial 1 platform untuk 1 dari 4 jenis data, lihat
  `docs/architecture-decisions.md` § 25), lalu POST ke 4 endpoint import
  di atas lewat akun `integrasi`. Fitur: jendela rolling 2 hari
  (`log_penjualan`/`transaksi`/`raw_majoo`) atau penanda `synced_at` di
  static data workflow (`biaya_platform`, menghindari dobel baris tanpa
  `id_platform`), mode dry-run otomatis saat dijalankan manual (tidak
  pernah mengirim apa pun), notifikasi gagal lewat node error n8n bawaan
  (belum ada notifikasi Telegram/WhatsApp — sengaja, belum diminta).
  **Belum aktif** — owner masih perlu mengimpor, membuat 2 credential di
  UI n8n, dan mengaktifkan manual. Langkah lengkap: `devops/n8n/README.md`.
- Item mapping: pemetaan kode eksternal platform → kode menu internal
  Samsara, antrian disegarkan otomatis dari arsip log — ✅
- Proses sinkronisasi (`POST /proses`): ubah arsip log jadi transaksi
  Penjualan sungguhan di modul Inventory (memanggil HTTP ke Inventory, ikut
  mengurangi stok) — **🟡 parsial**: sengaja selalu manual (perlu klik
  tombol "Proses Sinkronisasi" oleh owner/manajer_ops, tidak bisa dipicu
  akun bot) sebagai titik review manusia, dan ada keterbatasan diketahui
  yang didokumentasikan eksplisit di `module.json`: baris `item_type =
  'refund'` yang kebetulan lolos validasi akan **tetap mengurangi stok**
  seperti penjualan biasa, karena modul Inventory belum punya konsep
  refund/retur.
- `GET /belum-diproses` (visibilitas arsip yang belum pernah diproses) — ✅

---

## 5. Yang belum dibangun

Daftar murni fakta ketiadaan di kode saat ini, bukan roadmap:

- **Modul Purchasing penuh (PO, hutang/jatuh tempo pembayaran, retur ke
  vendor, QC penerimaan)** — tidak ada, **sengaja tidak dibangun** di
  Tahap 3. Master vendor + katalog harga + riwayat harga per vendor
  **sudah ada** (lihat § 4 Inventory, "Vendor & Katalog"), termasuk kolom
  `termin` di vendor (teks bebas, mis. "Net 30") — tapi **murni
  informasional**, tidak ada logika hutang/jatuh tempo apa pun yang
  membacanya. Kolom `supplier TEXT` bebas lama di header Pembelian
  **DEPRECATED** sejak `vendor_id` diwajibkan (bukan lagi berdampingan
  aktif) — kolomnya masih ada di database untuk baca data lama, tapi
  tidak ditulis lagi untuk pembelian baru.
- **Isolasi multi-tenant/multi-brand sungguhan di level kode** — tidak ada.
  Satu database `samsara` untuk satu brand (Burnas/Samsara). "Satu Jarvis,
  banyak bisnis" di `CLAUDE.md` § 1 adalah konteks operasional Claude Code
  di luar repo ini (data Bubur Ayam Ajiep memang disimpan di tempat lain
  sama sekali) — bukan fitur arsitektur multi-tenant di dalam aplikasi ini.
- **Layer agent/AI otomatis di dalam aplikasi** — tidak ada. Satu-satunya
  "otomasi" yang menyentuh sistem ini dari luar adalah workflow n8n untuk
  import CSV terjadwal (file JSON siap-impor ada di `devops/n8n/`, lihat
  `devops/n8n/README.md` dan `docs/integrasi-n8n.md`), yang scope-nya
  sempit (4 endpoint import saja, murni kirim data, tidak memproses
  keputusan apa pun) — **dan per penulisan ini belum diaktifkan** oleh
  owner di instance n8n sungguhan. Tidak ada agent/AI yang berjalan
  sebagai bagian dari aplikasi itu sendiri — beda dari Claude Code yang
  membangun sistem ini.
- **PWA / mobile app native** — tidak ada. Frontend adalah SPA React biasa
  via browser.
- **Modul Marketing/Finance/Ekspansi** — tidak ada di repo ini sama sekali.
  Itu peta agent bisnis jangka panjang di `CLAUDE.md` § 4, konteks bisnis
  di luar scope engineering backoffice ini, bukan modul yang dibangun atau
  direncanakan di dalam kode.
- **CORS** — backend **tidak punya header CORS apa pun**, diverifikasi
  langsung ke `core/src/server/build-server.ts` (tidak ada middleware
  `cors`, tidak ada `Access-Control-*` di mana pun di `core`/`apps/api`).
  Desainnya mengandalkan reverse proxy satu origin nanti saat deploy
  (frontend & backend disajikan dari domain yang sama lewat Nginx Proxy
  Manager), bukan API yang didesain untuk diakses cross-origin.
- **Test otomatis untuk frontend (`apps/web`)** — tidak ada. `npm test`
  menjalankan 276 test yang semuanya lulus (core 7, hr 46, inventory 151,
  sales-sync 41, integrasi lintas-modul di `apps/api` 31) — **tapi nol test
  otomatis untuk kode React di `apps/web`**. `npm run typecheck` lulus
  bersih untuk semua workspace termasuk `web`, tapi typecheck ≠ test
  perilaku.
- **Payroll/rekrutmen** di modul HR — tidak ada, HR hanya menangani jadwal
  shift & pengajuan libur.
- **Refund/retur** — tidak ada konsep ini di modul Inventory (lihat
  keterbatasan `sales-sync` § 4 di atas).

---

## 6. Kebutuhan non-fungsional aktual

- **Auth**: JWT, TTL **12 jam** (`core/src/auth/jwt.ts`, konstanta
  `TOKEN_TTL = "12h"`), ditandatangani dengan `AUTH_JWT_SECRET` dari env
  (wajib diisi, tidak ada default di kode). Dua metode login paralel:
  `owner`/`manajer_ops`/`supervisor`/`integrasi` pakai **username +
  password**; `staf` pakai **PIN** (pilih nama dari daftar staf aktif satu
  lokasi, lalu input PIN tanpa ketik username) — satu user cuma punya salah
  satu dari `password_hash`/`pin_hash`, tidak pernah dua-duanya.
- **Rate-limit login**: 5 kali gagal (gabungan password+PIN) dalam 15 menit
  mengunci akun sementara, berbasis tabel `core_login_attempts` — diverifikasi
  ada test regresi khusus untuk ini (`auth.test.ts`) dan lulus.
- **Revoke token** (migrasi 0009, `core_users.token_version`) — ✅ hidup
  penuh & teruji, ditambahkan 2026-10-16. Setiap login menyisipkan versi
  token user saat itu ke payload JWT; middleware `requireAuth` membandingkan
  versi itu ke `core_users.token_version` di database pada **setiap
  request** (query tambahan, bukan lagi fully-stateless seperti sebelumnya
  — overhead-nya diukur <0.1 ms untuk skala pilot outlet saat ini, lihat
  `docs/architecture-decisions.md` § 22). Versi dinaikkan otomatis saat user
  dinonaktifkan, password/PIN di-reset, `locationIds`-nya diubah, **atau
  role-nya diubah** (fitur ubah role ditambahkan Tahap 2 "Kelola User",
  2026-10-26 — PATCH `/api/auth/users/:id` body `role`, owner saja, lihat
  § 7) — token lama langsung ditolak 401 ("Sesi berakhir, silakan login
  ulang") walau belum lewat TTL 12 jam. Tombol Keluar di frontend tetap
  murni hapus token lokal (tanpa endpoint
  logout baru); 401 di tengah sesi sekarang ditangani global oleh
  `apps/web/src/api/client.ts` — redirect otomatis ke halaman login dengan
  notice singkat, bukan error mentah.
- **Audit log** (`core_audit_log`): satu baris = satu field yang berubah
  (bukan satu baris per aksi). Dipakai untuk **himpunan field sensitif yang
  terus bertambah** seiring modul berkembang — harga beli/konversi item,
  resep, harga jual & visibilitas channel menu, min-stok, kategori
  item/menu, satuan, kelola user (reset kredensial, nonaktifkan, **ubah
  role** sejak Tahap 2), perubahan jadwal shift/shift template, pengajuan libur via jalur
  override, dan tag `created_via=sales-sync` untuk transaksi Penjualan
  hasil sinkronisasi otomatis. **Bukan audit universal otomatis** untuk
  semua tabel/semua write — tiap domain function yang mau dicatat harus
  memanggilnya secara eksplisit.
- **Backup**: script `devops/backup-db.sh` (pg_dump harian, retensi 7 hari)
  **sudah ditulis**, tapi per `devops/README.md` **belum terpasang** sebagai
  cron job di mana pun (menunggu akses SSH ke VPS saat deploy).
- **Status deploy dev vs production** (per `devops/README.md`, status
  terkini — lihat dokumen itu untuk detail per-langkah): dev lokal berjalan
  penuh dan diuji (lihat § 1 & § 5). **Production SUDAH LIVE** di
  `https://burnas-app.duckdns.org` (nginx host-level + Certbot existing yang
  juga melayani n8n di domain terpisah `burnas-ops.duckdns.org` — tidak
  terganggu, diverifikasi berkali-kali). Database `samsara` (role + password
  acak) dibuat lewat `docker exec` ke instance Postgres existing (role
  superuser instance ternyata `n8n`, bukan `postgres` — detail
  `devops/README.md`), **migrasi production berhasil penuh** (42 file lintas
  4 modul) setelah satu bug migrasi nyata ditemukan & diperbaiki (lihat
  `docs/architecture-decisions.md` § 23 — migrasi `core/0006` crash di
  database fresh, gap yang tidak pernah kelihatan di dev). Cron backup
  harian terpasang dan sudah dites manual (file valid, permission 600).
  Container `api`/`web` jalan dengan resource limit ketat (RAM VPS tipis,
  sempat available < 1GB, owner mengonfirmasi eksplisit untuk lanjut) —
  pemakaian aktual jauh di bawah limit, tidak OOM. **Satu-satunya yang
  tersisa**: akun owner & integrasi production sengaja belum dibuat,
  menunggu owner menjalankan sendiri `seed:owner`/`seed:integrasi` secara
  interaktif supaya password tidak lewat tangan siapa pun selain owner
  (lihat `docs/integrasi-n8n.md` untuk akun integrasi, `devops/README.md`
  Langkah 7 untuk perintah persisnya).

---

## 7. Keputusan desain penting

Ringkasan eksekutif — detail lengkap selalu di `docs/architecture-decisions.md`:

- **PostgreSQL native, bukan Docker/MySQL** — setelah berpindah 4 kali
  (Postgres → MySQL/MAMP → Docker Postgres → Postgres native) dalam waktu
  singkat, owner menetapkan Postgres native sebagai final supaya tidak ada
  lagi bolak-balik keputusan engine database. Detail: § 1, § 1b.
- **Isolasi antar modul lewat prefix nama tabel, bukan schema Postgres
  terpisah** — dipilih supaya tetap sederhana untuk satu database kecil
  dan konsisten dengan kontrak `tablePrefix` di `module.json`; modul lain
  wajib lewat API, tidak boleh query langsung ke tabel modul lain. Detail:
  `docs/architecture.md` § Database, § 2.
- **Permission murni whitelist di kode (`PermissionDef.roles` per action),
  bukan tabel database yang bisa diedit dari UI** — setiap action harus
  didaftarkan dulu di `module.json` sebelum dipakai; role yang tidak
  disebut otomatis tertolak. Ini yang membuat role `integrasi` (bot) bisa
  dijaga sempit hanya dengan **tidak pernah** mencantumkannya di
  `roles[]` action lain. Detail: § 12, § 13, § 20, § 21.
- **Snapshot HPP historis (migrasi 0028) ditambahkan terpisah dari live
  HPP** — sebelumnya HPP laporan historis dihitung ulang dari harga item
  *saat ini*, sehingga laporan bulan lalu ikut berubah kalau harga bahan
  berubah. Kolom `hpp_saat_transaksi`/`hpp_sumber` mengunci angka HPP pada
  saat transaksi Penjualan dibuat, terpisah dari mesin kalkulasi HPP live
  yang tetap dipakai untuk keputusan harga hari ini. Detail: migrasi 0028,
  § Inventory di atas.
- **Lokasi fisik (`core_locations`) dipindah dari modul Inventory ke
  `core`** — supaya modul non-Inventory (mis. `hr`) bisa referensi lokasi
  tanpa bergantung ke modul bisnis tertentu; endpoint CRUD lokasi sengaja
  dibiarkan tetap di bawah `/api/inventory/lokasi` (bukan dipindah ke
  `/api/core/...`) supaya tidak mengubah integrasi frontend yang sudah ada.
  Detail: § 18.
- **Pemisahan permission `sales_sync.import` dari `sales_sync.manage`** —
  supaya akun bot `integrasi` bisa mengimpor CSV tanpa ikut mendapat akses
  ke `POST /proses` yang mengurangi stok sungguhan. Awalnya ini gap nyata
  di kode (role `integrasi` tidak bisa akses apa pun sama sekali), ditutup
  2026-10-16 bersamaan dengan menambahkan gate permission ke 6 endpoint
  Inventory yang sebelumnya terbuka untuk siapa pun yang login. Detail:
  § 20, § 21.
- **Endpoint publik (tanpa login) wajib hidup di router core SEBELUM
  `requireAuth` global, tidak bisa di modul bisnis** — ditemukan saat
  membangun `GET /api/core/lokasi` dan `/identitas-bisnis` (Tahap 1):
  modul bisnis (inventory/hr/sales-sync) selalu di-mount SETELAH
  `requireAuth` global di `build-server.ts`, jadi endpoint publik apa pun
  (dipakai flow login PIN staf, sidebar, halaman login) harus masuk router
  core-level baru (`core/src/public/router.ts`), bukan router modul mana
  pun. Detail: § 27.
- **Ubah role LINTAS keluarga auth (staf/PIN <-> owner/manajer_ops/
  supervisor/password) otomatis membuat KREDENSIAL BARU** — Tahap 2
  "Kelola User" (2026-10-26): kredensial lama (PIN/password) tidak cocok
  lagi dengan metode login role baru, jadi `updateUser` men-generate yang
  baru otomatis (pola sama seperti `resetCredential`) dan
  mengembalikannya sekali ke response (ditampilkan sekali di UI, sama
  seperti create/reset). Alternatif yang dipertimbangkan (menolak ubah
  role lintas keluarga, minta admin reset manual sesudahnya) ditolak
  karena akan membuat akun langsung tidak bisa login tanpa langkah
  lanjutan yang jelas. Detail: § 27.
