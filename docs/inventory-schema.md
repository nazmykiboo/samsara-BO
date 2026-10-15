# Skema Database Modul Inventory

> **Status: terverifikasi Tahap 2** (2026-09-28) terhadap sumber data asli
> `Inventori_FnB_Standar.xlsx` (sheet `Master_Item`, `Master_Menu`,
> `Resep_Prod`, `Resep_Prod_Baris`, `Resep_Menu_Baris`, `Paket_Menu_Baris`).
> Skema Tahap 1 (draft, berdasarkan CLAUDE.md saja) diperbaiki di beberapa
> tempat — lihat § "Koreksi dari Tahap 2" di bawah. Data referensi dari
> spreadsheet itu **sudah di-seed** ke database `samsara`.

File migrasi ada di `modules/inventory/src/db/migrations/`:
- `0001`–`0004`: skema awal Tahap 1.
- `0005`: koreksi skema Tahap 2 (enum `type`, kolom baru, tabel paket menu).
- `0006`: koreksi susulan (drop trigger yang salah asumsi — lihat di bawah).
- `0007`: seed data referensi dari spreadsheet (dibuat otomatis, jangan
  diedit manual — regenerasi lewat script kalau spreadsheet sumber berubah).
- `0008`: tambah baris resep "Kacang" di Bubur Original (dikonfirmasi owner).
- `0009`: Garam dilepas dari `pending_data`, label satuan beli diperbaiki.
- `0010`: kolom `entitas` di lokasi, `antar_entitas` (trigger) &
  `harga_transfer_per_satuan` di transfer.
- `0011`: seed 2 lokasi Samsara (dengan entitas) + 4 channel penjualan.

## Ringkasan tabel

| Tabel | Fungsi |
|---|---|
| `inventory_items` | Master item: bahan baku, packaging, operasional, setengah jadi. |
| `inventory_locations` | Master lokasi Samsara (2 baris: Central Kitchen, Outlet 1 Malang), dengan kolom `entitas` untuk pengelompokan internal. |
| `inventory_sales_channel` | Referensi channel penjualan (Offline, GrabFood, GoFood, ShopeeFood) — belum ada FK dari tabel transaksi. |
| `inventory_resep_produksi` + `_baris` | Resep produksi (bahan baku/packaging → setengah jadi). 1 level. |
| `inventory_menu` | Menu yang dijual — termasuk menu dasar DAN paket/bundle (satu tabel, dibedakan lewat ada/tidaknya baris di `inventory_paket_menu_baris`). |
| `inventory_menu_resep_baris` | Resep per porsi untuk menu dasar (bahan baku/setengah jadi/packaging/operasional — lihat § koreksi). |
| `inventory_paket_menu_baris` | Komposisi menu paket dari beberapa menu dasar. |
| `inventory_stock_ledger` | Satu-satunya sumber kebenaran stok (append-only), view `inventory_current_stock` bisa difilter per `entitas`. |
| `inventory_transaksi_*` (6 jenis) + `_baris` | Pembelian, Produksi, Penjualan, Transfer (+`antar_entitas`, `harga_transfer_per_satuan`), Mutasi_Lain, Opname — belum ada data transaksi (di luar cakupan seed). |
| `schema_migrations` | Dibuat otomatis oleh migration runner, bukan modul-spesifik. |

## Koreksi dari Tahap 2 (verifikasi ke spreadsheet asli)

Tahap 1 ditulis murni dari deskripsi aturan bisnis di CLAUDE.md, tanpa akses
ke spreadsheet. Setelah dibaca langsung, ada beberapa hal yang meleset:

### 1. `inventory_item_type` — nilai enum salah total
Draft Tahap 1: `bahan_baku | packaging | hasil_produksi | non_bahan`.
**Nilai asli di spreadsheet** (sheet `Ref` kolom "Tipe Item", dan memang
persis ini yang dipakai di 92 baris `Master_Item`):
`bahan_baku | packaging | operasional | setengah_jadi`.

"Hasil Produksi" ternyata nilai **Kategori**, bukan Tipe — kolom yang
sama sekali berbeda (lihat poin 2). Item hasil dari resep produksi
bertipe `setengah_jadi`, bukan `hasil_produksi`. Diperbaiki di migrasi
`0005` (rename enum lama → drop, buat ulang dengan 4 nilai yang benar;
aman karena tabel masih kosong saat itu).

### 2. Kolom yang hilang di draft Tahap 1, ditambahkan di migrasi `0005`
Spreadsheet punya kolom yang tidak tercermin di skema awal:

| Kolom baru | Tabel | Sumber |
|---|---|---|
| `kode` | `inventory_items`, `inventory_menu`, `inventory_resep_produksi` | Kode bisnis (mis. `BB-056`, `M-002`, `RP-008`). Untuk traceability — **bukan** kunci pencarian (kunci pencarian tetap `name`, sesuai aturan "nama item unik"). |
| `category` | `inventory_items` | Kolom "Kategori" — pengelompokan laporan, independen dari `type` (mis. kategori "Es & Dessert" isinya banyak `type` berbeda). |
| `min_stok`, `shelf_life_hari` | `inventory_items` | Ada di spreadsheet, belum terisi di data saat ini (semua `NULL`), disiapkan untuk kebutuhan reorder alert nanti. |
| `catatan` | `inventory_items`, `inventory_menu`, `inventory_resep_produksi` | Kolom "Catatan" — anotasi kualitas data dari pengisi spreadsheet (asumsi, pemetaan nama, dll). Sangat berguna, ikut di-seed apa adanya. |
| `harga_jual` | `inventory_menu` | **Tidak ada sama sekali di draft Tahap 1** (celah nyata, bukan cuma kolom tambahan). Lihat § "Harga jual belum ada" di bawah. |
| `kategori_menu` | `inventory_menu` | Kolom "Kategori Menu" (mis. "Buryam", "Paket Hemat"). |

### 3. Konversi satuan: asumsi "satu item = satu satuan beli" TERKONFIRMASI
Draft Tahap 1 menandai ini sebagai "perlu dicek". Sudah dicek: varian
Nutrijel per ukuran sachet (7/10/15 gr) masing-masing punya **baris item
sendiri** di `Master_Item` (`Nutrijel besar anggur 15 gr`, `Nutrijel kecil
anggur 10 gr`, dst) — bukan satu item dengan banyak satuan beli. Model
`purchase_unit` + `purchase_to_recipe_factor` langsung di `inventory_items`
(satu-satu) **sudah benar, tidak perlu tabel terpisah**.

### 4. Menu paket/bundle — konsep baru, tidak ada di Tahap 1 sama sekali
Sheet `Paket_Menu_Baris` mengungkap struktur yang tidak tercakup di aturan
bisnis CLAUDE.md maupun draft Tahap 1: menu **paket** (mis. "PaHe Ber-2
Pagi", "Maksi Mantap") adalah baris biasa di `Master_Menu`/`inventory_menu`
juga, tapi komposisinya dari **menu lain** (mis. 2× Bubur Original + 1× Teh
Tarik), bukan dari bahan mentah. Ditambahkan tabel baru
`inventory_paket_menu_baris` (self-referential ke `inventory_menu`) di
migrasi `0005`. Tidak ada tabel header terpisah untuk "paket" — identitasnya
sama dengan `inventory_menu` (kode & nama sama seperti menu biasa).

### 5. Resep menu BOLEH pakai item `operasional` — koreksi atas koreksi
Header sheet `Resep_Menu_Baris` bilang "Bahan (bahan baku / setengah jadi /
packaging)" — berdasarkan ini saya sempat menambah trigger di migrasi
`0005` yang menolak item `operasional` di `inventory_menu_resep_baris`.
**Ternyata salah**: 47 dari 57 menu memakai "Kertas thermal Coreless 5730"
(struk) dan/atau "Cup Sealer" sebagai baris resep — keduanya bertipe
`operasional` di `Master_Item`, bukan `packaging`, tapi jelas dipakai/habis
per transaksi penjualan. Trigger itu di-drop lagi di migrasi `0006`
(migrasi baru, bukan edit `0005` yang sudah applied). **Kesimpulan final:
tidak ada pembatasan tipe item di `inventory_menu_resep_baris`.**

Trigger di `inventory_resep_produksi_baris` (bahan hanya boleh
`bahan_baku`/`packaging`) **tetap berlaku** — ini terverifikasi benar,
tidak ada satu pun dari 43 baris `Resep_Prod_Baris` yang melanggarnya.

### 6. HPP item `setengah_jadi` TIDAK datang dari `harga_master`
Temuan penting untuk Tahap 3: `harga_master` di `inventory_items` **selalu
NULL untuk item bertipe `setengah_jadi`** (item ini tidak dibeli, jadi tidak
punya harga beli). Biaya per satuannya berasal dari resep produksinya:

```
biaya_per_satuan(item setengah_jadi) = Total Biaya Bahan per Batch (dari inventory_resep_produksi_baris × harga bahan)
                                        ÷ yield_qty (dari inventory_resep_produksi)
```

Endpoint HPP di Tahap 3 wajib bercabang berdasarkan `inventory_items.type`:
`bahan_baku` / `packaging` / `operasional` → baca `harga_master` (atau
harga beli terakhir, tergantung metode HPP terpilih); `setengah_jadi` →
hitung rekursif dari resep produksinya. Kalau `yield_qty` resepnya `NULL`
(lihat § pending_data), biaya item tersebut juga tidak bisa dihitung —
otomatis merambat ke `pending_data` di menu manapun yang memakainya.

## Keputusan desain (dari Tahap 1, masih berlaku)

### Item: satu tabel untuk semua jenis, dibedakan `type`
Nama item harus unik lintas jenis (aturan CLAUDE.md) — lebih gampang dijaga
`UNIQUE` di satu tabel daripada di banyak tabel terpisah.

### HPP: dua metode, tidak hardcode satu
- **Harga Master** → baca `inventory_items.harga_master` (bahan_baku/
  packaging/operasional) atau hitung dari resep (setengah_jadi, lihat di
  atas).
- **Harga Beli Terakhir** → dihitung dari `inventory_transaksi_pembelian_baris`,
  ambil baris terbaru. Sengaja tidak disimpan sebagai kolom — dihitung
  lewat query saat dibutuhkan (Tahap 3).
- Pemilihan metode adalah keputusan level aplikasi/laporan, bukan kolom di
  skema ini (lihat juga sheet `Ref!K2`: default "Harga Master").

### Stok: ledger append-only + view, bukan kolom `stok` yang diedit
`inventory_stock_ledger` satu-satunya tempat qty berubah.
`inventory_current_stock` (VIEW) dipakai untuk baca stok saat ini.

### Transfer & Opname
Transfer mencatat `qty_kirim`/`qty_terima` terpisah (susut dihitung saat
dibaca). Opname mencatat `qty_sistem` sebagai snapshot, bukan referensi
live.

## Status `pending_data` — cara penentuannya

> **Update 2026-09-28**: Garam sudah dikonfirmasi owner dan dilepas dari
> `pending_data` lewat migrasi `0009` (lihat
> `docs/architecture-decisions.md` § 8.2) — harga & konversinya sudah benar
> sejak awal, yang salah cuma label satuan beli. Sisa penjelasan di bawah
> tetap relevan sebagai riwayat cara penentuan status saat seed awal.

`inventory_items.status` di-seed dengan aturan berikut (bukan cuma
"kolom kosong = pending", karena satu kasus nyata butuh pengecualian
eksplisit — lihat Garam):

1. **Otomatis**: item bertipe selain `setengah_jadi` dengan
   `purchase_unit`, harga beli, atau `purchase_to_recipe_factor` kosong →
   `pending_data`. Menangkap 5 dari 6 item: `Cup es teler + tutup`, `Sapu`,
   `Pembersih lantai`, `Pembersih meja`, `Pembersih piring`.
2. **Override eksplisit**: `Garam` — field numeriknya justru **terisi**
   (bukan `NULL`), tapi Catatan aslinya bilang "Satuan beli, harga, dan
   konversi belum ada" (nilai yang ada kemungkinan placeholder formula,
   bukan data terverifikasi). Awalnya dipaksa `pending_data` mengikuti
   catatan sumbernya — **owner lalu mengonfirmasi angkanya memang benar**
   (Rp7.100/kemasan 500gr), jadi dilepas lagi dari `pending_data` (migrasi
   `0009`).
3. **Item `setengah_jadi`**: `pending_data` kalau resep produksinya
   (`inventory_resep_produksi.yield_qty`) `NULL`. Menangkap `Mutiara`
   (`SJ-008`, resep `RP-008` — "Yield belum diketahui").

**Saat ini 6 item `pending_data`**: Sapu, Pembersih lantai/meja/piring, Cup
es teler + tutup, Mutiara/RP-008 (Garam sudah tidak termasuk, per update di
atas). Status ini **snapshot saat seed/koreksi**, bukan trigger otomatis
yang terus mengecek — begitu owner mengisi data yang kurang untuk item
lain, update `status` jadi `active` adalah endpoint Tahap 3 (atau migrasi
data manual seperti `0009`), bukan bagian migrasi skema.

## Harga jual belum ada (celah data, bukan bug)

**Semua 57 baris di `Master_Menu` punya `Harga Jual (Rp)` kosong** di
spreadsheet sumber — bukan cuma sebagian. `harga_jual` di-seed `NULL` untuk
semua menu. Konsekuensi: `Food Cost %` dan `Margin` tidak bisa dihitung
sama sekali sampai harga jual diisi — ini bukan pending_data per-item, tapi
gap terpisah yang perlu diisi Ibnu/owner (keputusan bisnis harga jual,
bukan sesuatu yang boleh saya asumsikan) sebelum agent Finance/Sales bisa
mulai kerja.

**Update 2026-09-28**: tooling untuk mengisi ini sudah dibuat —
[`data/harga_jual_template.csv`](../data/harga_jual_template.csv) (57 baris,
kolom `kode_menu, nama_menu, hpp_per_porsi, harga_jual` — kolom terakhir
kosong, `hpp_per_porsi` sebagai referensi) dan importer
`apps/api/src/import-harga-jual.ts` (`npm run import:harga-jual --
<path-csv>`, lihat root [`README.md`](../README.md)). Alurnya: Ibnu isi
kolom `harga_jual` dari data Majoo, simpan CSV-nya, lalu jalankan
importernya untuk update `inventory_menu.harga_jual` secara massal. Detail
di `docs/architecture-decisions.md` § 8.5.

## Baris resep yang sempat dikecualikan — sudah diselesaikan

*(Riwayat, sudah diperbaiki — lihat `docs/architecture-decisions.md` §
8.1.)* Satu baris di `Resep_Menu_Baris` sempat tidak bisa di-seed: menu
`Bubur Original` (M-002) punya baris bahan `"Kacang"` (qty 5) yang tidak
cocok dengan nama item manapun di `Master_Item` — beda dengan kasus
Mutiara/Pangsit/Kecap yang sudah dipetakan eksplisit di catatan Petunjuk.
Dicek ulang teks mentahnya (tidak ada spasi tersembunyi/masalah encoding —
bukan bug parser), lalu dikonfirmasi owner bahwa maksudnya
`Kacang dele panda 5 kg` (BB-011), item yang sama dipakai dengan pola qty
identik di 5 menu Bubur lain. Ditambahkan lewat migrasi `0008`.

## Verifikasi HPP lewat SQL & koreksi harga (2026-09-28)

Sebelum Tahap 3, HPP dihitung manual lewat query SQL (item `setengah_jadi`,
46 menu dasar, 11 paket) dan dibandingkan ke kolom HPP di spreadsheet asli.
Ketemu inkonsistensi nyata: **"Kertas thermal Coreless 5730" (OP-005)**
tercatat Rp1.590/pcs di `Master_Item`, tapi seluruh `Resep_Menu_Baris` dan
HPP `Master_Menu` konsisten memakai Rp50/pcs — kemungkinan harga/konversi
item ini diedit di `Master_Item` setelah HPP resep terakhir dihitung Excel,
tanpa sempat di-recalculate ulang. Dikonfirmasi owner: **Rp50/pcs benar**,
dikoreksi lewat migrasi `0012` (`harga_master` OP-005: 1590 → 50).
`purchase_unit`/`purchase_to_recipe_factor` item ini **tidak diubah** —
belum jelas bagian mana yang salah di data pembelian asli.

Ditemukan juga: `Bubur Original Jumbo` (M-003) punya 2 baris resep identik
untuk item yang sama (kemungkinan artefak copy-paste) — dicek ada di file
sumber asli, bukan bug seed. **Dibiarkan apa adanya** (owner: mungkin
memang sengaja) — dan karena sheet aslinya juga menjumlahkan kedua baris
itu, ini tidak menyebabkan selisih HPP.

Hasil setelah migrasi `0012`: 45/46 menu dasar & 7/11 paket cocok dengan
sheet dalam Rp1 (sisa selisih kecil = pembulatan `NUMERIC(18,2)`, lihat di
atas). Sisa 1 menu dasar (M-002) + 4 paket yang memakainya beda konsisten
~Rp112×qty — itu penambahan Kacang di atas, bukan masalah baru. Detail
lengkap & angka verifikasi di `docs/architecture-decisions.md` § 9.

## Lokasi & entitas (ditambahkan setelah Tahap 2 awal)

`inventory_locations` sekarang punya kolom `entitas` (TEXT, snake_case) —
pengelompokan **internal** Samsara sendiri (mis. Central Kitchen vs Outlet
sebagai cost-center terpisah untuk kebutuhan pembukuan transfer), **bukan**
pemisahan antar brand. Di-seed 2 lokasi: `Samsara Central Kitchen`
(`samsara_ck`) dan `Samsara Outlet 1 Malang` (`samsara_outlet`) — sengaja
**hanya Samsara**, tidak menyalin daftar lokasi lain dari sheet `Ref`
sumber yang tercampur nama brand lain (lihat § "Yang masih di luar cakupan"
di bawah).

`inventory_transaksi_transfer.antar_entitas` dihitung otomatis oleh trigger
dari entitas lokasi asal vs tujuan. `inventory_transaksi_transfer_baris.harga_transfer_per_satuan`
disiapkan untuk pembukuan transfer lintas entitas, kebijakan default
("Skema A" = HPP item di lokasi asal) didokumentasikan di kolom tapi
**pengisian nilainya adalah tugas Tahap 3** (butuh mesin resolusi HPP yang
sama dengan resep, lihat § 6 di atas). `inventory_current_stock` (VIEW)
sekarang bisa difilter per `entitas` langsung. Detail lengkap & alasan di
`docs/architecture-decisions.md` § 8.3.

Tabel referensi baru `inventory_sales_channel` (Offline, GrabFood, GoFood,
ShopeeFood) juga sudah di-seed — belum ada FK dari
`inventory_transaksi_penjualan.sumber`, itu keputusan Tahap 3.

## Yang masih di luar cakupan

- **Lokasi brand lain**: sheet `Ref` sumber mencantumkan daftar lokasi
  ("Central Kitchen", "Burnas", "Ajiep Sutami", "Ajiep Dau") yang tercampur
  dengan nama brand lain. `inventory_locations` **tidak menyalin daftar itu
  sama sekali** — cuma diisi manual 2 lokasi Samsara (lihat § "Lokasi &
  entitas" di atas). Tapi kecurigaan soal isi sheet `Ref` itu sendiri
  (apakah memang template generik lintas-brand, atau ada kebocoran data)
  **masih belum diklarifikasi** — relevan lagi kalau Tahap 3 nanti mengimpor
  sheet transaksi (`Pembelian`/`Produksi`/dll.) yang punya kolom lokasi.
  Lihat `docs/architecture-decisions.md` § 7.1.
- Data transaksional (`Pembelian`, `Produksi`, `Penjualan`, `Transfer`,
  `Mutasi_Lain`, `Opname`, `Stok`) ada di spreadsheet tapi **tidak diminta**
  untuk diseed — itu data operasional harian, bukan data referensi/master.
- FK dari `inventory_transaksi_penjualan.sumber` ke `inventory_sales_channel`
  — ditunda ke Tahap 3.
- Pengisian `harga_transfer_per_satuan` saat transfer dibuat — ditunda ke
  Tahap 3 (butuh mesin resolusi HPP).
