# Workflow n8n Sales-Sync — Panduan Pakai (untuk yang belum kenal n8n)

4 file di folder ini (`log-penjualan.json`, `transaksi.json`,
`raw-majoo.json`, `biaya-platform.json`) adalah workflow n8n **siap
diimpor**. Tugasnya: ambil data penjualan dari spreadsheet
`BURNAS_DASHBOARD_V1` (spreadsheet yang SAMA yang sudah dipakai 3 workflow
n8n lama), lalu kirim ke app Samsara Backoffice secara terjadwal, supaya
Ibnu/owner tidak perlu upload CSV manual tiap hari.

**Keempatnya diimpor dalam keadaan NON-AKTIF** — tidak akan mengirim apa
pun sampai Anda aktifkan sendiri di langkah terakhir. Aman dicoba
pelan-pelan, satu per satu.

Ada file ke-5 di folder ini, `raw-majoo-direct.json` — ini BUKAN
pengganti `raw-majoo.json` di atas, tapi jalur alternatif yang mengambil
data langsung dari API Majoo (tanpa lewat Google Sheets). Lihat § 11
untuk penjelasan lengkap dan rencana penggantian bertahap.

Ada 2 file lagi menyusul, `log-penjualan-direct.json` dan
`transaksi-biaya-direct.json` — jalur "langsung API" untuk Shopee/
GrabFood/GoFood (dan Majoo level-produk), melengkapi `raw-majoo-direct.json`
yang cuma menangani Majoo level-transaksi. Lihat § 12 untuk penjelasan
lengkap — **BACA PERINGATAN di § 12 dulu sebelum impor**, file ini
dibangun sekaligus untuk 7 kombinasi platform×feed TANPA pernah diuji ke
API platform asli.

Dokumen ini ditulis untuk yang **belum pernah pakai n8n sama sekali**.
Kalau Anda sudah paham n8n, bisa langsung lompat ke § 4 (kredensial) dan
§ 7 (aktivasi).

---

## 0. Apa yang TIDAK dilakukan workflow ini (baca dulu)

- **Tidak pernah mengurangi stok.** Workflow ini cuma mengisi arsip data
  mentah di app (tabel log penjualan/transaksi/biaya platform). Mengubah
  arsip itu jadi transaksi sungguhan yang mengurangi stok tetap langkah
  **manual** — Anda yang klik tombol "Proses Sinkronisasi" di halaman
  Sinkronisasi Penjualan, kapan pun Anda siap mengecek dulu. Workflow ini
  **tidak bisa** dan **tidak boleh** dibuat bisa memanggil langkah itu
  sendiri.
- **Tidak mengubah data di Google Sheets.** Workflow ini cuma MEMBACA
  spreadsheet, tidak pernah menulis apa pun ke sana.
- **Tidak menyentuh 3 workflow n8n lama** (`All - Get Product Details`,
  `Get sales & biaya online`, `Majoo - Sales`). Workflow baru ini berjalan
  terpisah, membaca spreadsheet yang sama yang ditulis workflow lama itu.

---

## 1. Urutan kerja singkat

1. Buat 2 credential dulu di n8n (§ 4) — **sekali saja**, dipakai keempat
   workflow.
2. Impor 1 file JSON dulu (coba `log-penjualan.json` duluan, § 2).
3. Pilih credential di node yang bertanda merah (§ 5).
4. Coba dry-run (§ 6) — pastikan hasilnya masuk akal, TIDAK ada yang
   benar-benar terkirim.
5. Kalau dry-run sudah terlihat benar, aktifkan (§ 7).
6. Ulangi langkah 2-5 untuk 3 file JSON lainnya.

---

## 2. Cara impor 1 file workflow

1. Buka n8n di browser, login seperti biasa.
2. Di pojok kiri atas, klik **"+"** atau menu **Workflows** → cari tombol
   **"Import from File"** (atau ikon titik tiga "⋯" di pojok kanan atas
   halaman Workflows → **Import from File**, tergantung versi n8n Anda).
3. Pilih salah satu file di folder ini, misalnya
   `devops/n8n/log-penjualan.json`.
4. Workflow baru akan terbuka di editor, judulnya **"Sales-Sync: Import
   Log Penjualan"** (atau sesuai nama file yang Anda impor). Di kanan
   atas akan ada saklar **aktif/non-aktif** — pastikan **MASIH
   NON-AKTIF** (abu-abu, bukan hijau) sampai Anda selesai § 6.
5. Anda akan melihat beberapa node (kotak) dengan **garis merah** di
   pinggirnya — ini NORMAL, artinya node itu butuh credential yang belum
   dipilih. Lanjut ke § 4 dulu.

---

## 3. Peta alur workflow (supaya tidak bingung melihat kotak-kotaknya)

Semua 4 workflow punya bentuk yang sama:

```
Jadwal Otomatis ─┐
                 ├─→ Atur Mode ─→ Login ke App ─→ Simpan Token & Mode
Jalankan Manual ─┘                                        │
                                                            ▼
                                          Ambil Data dari Google Sheet
                                                            │
                                                            ▼
                                          Susun CSV & Pecah Batch
                                                            │
                                                  ┌─────────┴─────────┐
                                           (dry-run = ya)      (dry-run = tidak)
                                                  │                   │
                                     Pratinjau Dry-Run        Kirim CSV ke App
                                                                      │
                                                                      ▼
                                                            Ada Baris Gagal?
                                                          ┌───────────┴───────────┐
                                                     (ya)│                       │(tidak)
                                                          ▼                       ▼
                                           Error: Ada Baris CSV Gagal        Selesai
```

(`biaya-platform.json` punya tambahan satu kotak "Perbarui Penanda
Sinkron" setelah "Ada Baris Gagal?" di cabang "tidak" — dijelaskan di
§ 8.)

- **Jadwal Otomatis**: nyala sendiri sesuai jadwal (tiap jam untuk log
  penjualan, sekali sehari malam untuk 3 lainnya).
- **Jalankan Manual**: tombol **"Execute Workflow"** di n8n — kalau Anda
  pakai ini, workflow OTOMATIS masuk mode **dry-run** (aman, tidak kirim
  apa-apa). Lihat § 6.
- **Atur Mode**: menentukan jendela waktu data (2 hari untuk jadwal
  otomatis, 1 hari untuk dry-run manual) — biasanya tidak perlu diubah.
- **Login ke App**: masuk ke app Samsara pakai akun khusus `n8n-integrasi`.
- **Ambil Data dari Google Sheet**: baca spreadsheet `BURNAS_DASHBOARD_V1`.
- **Susun CSV & Pecah Batch**: menyusun data jadi format yang dimengerti
  app, sekaligus memeriksa dry-run atau tidak.
- **Kirim CSV ke App**: baru di sini data benar-benar terkirim (SELALU
  dilewati kalau sedang dry-run).

---

## 4. Membuat 2 credential di n8n

Keempat workflow memakai 2 credential yang SAMA (dibuat sekali, dipakai
ulang di semua workflow). Kalau Anda sudah membuat salah satunya waktu
mengimpor workflow pertama, tidak perlu dibuat ulang untuk workflow
berikutnya — cukup dipilih (§ 5).

### 4.1 Credential "Login App Samsara (n8n-integrasi)"

Ini akun KHUSUS untuk robot n8n, BUKAN akun pribadi Anda. Kalau akun ini
belum pernah dibuat di app Samsara, minta orang yang mengurus server
menjalankan (sekali saja, satu kali seumur hidup app ini):

```bash
npm run seed:integrasi -w @samsara/api
```

Perintah itu akan menampilkan **username** (`n8n-integrasi`) dan
**password acak** SEKALI SAJA di layar — catat baik-baik saat itu juga
(misalnya di password manager), karena tidak akan ditampilkan lagi.

Setelah punya username & password itu:

1. Di n8n, buka menu **Credentials** (biasanya di sidebar kiri) → **"+
   Add Credential"**.
2. Cari tipe **"Basic Auth"** (atau "HTTP Basic Auth").
3. Isi:
   - **Name**: `Login App Samsara (n8n-integrasi)` — **harus PERSIS nama
     ini**, supaya n8n otomatis mencocokkan ke node yang butuh credential
     ini saat Anda pilih di § 5 (nama yang sama akan muncul duluan di
     daftar pilihan).
   - **User**: `n8n-integrasi`
   - **Password**: password acak yang dicatat di atas.
4. Klik **Save**.

> **Kredensial ini TIDAK benar-benar dipakai sebagai HTTP Basic Auth
> sungguhan** oleh node "Login ke App" — node itu memang memanggil
> `POST /api/auth/login` dengan username/password di dalam BODY JSON
> (bukan header Basic Auth), tapi tetap perlu "menempelkan" credential
> jenis ini ke node supaya field Usernamed & Password-nya bisa diambil
> lewat rumus `{{ $credentials... }}` di dalam node — ini cara aman n8n
> menyimpan password tanpa ditulis langsung di badan workflow. Anda tidak
> perlu memahami detail ini untuk memakainya, cukup ikuti langkah di
> atas.

### 4.2 Credential "Google Sheets - BURNAS_DASHBOARD_V1"

1. Di menu **Credentials** → **"+ Add Credential"**.
2. Cari tipe **"Google Sheets OAuth2 API"**.
3. **Name**: `Google Sheets - BURNAS_DASHBOARD_V1` (sama alasannya dengan
   di atas — samakan persis).
4. Ikuti alur login Google yang muncul (klik "Connect my account", login
   dengan akun Google yang punya akses ke spreadsheet
   `BURNAS_DASHBOARD_V1`, izinkan akses).

   > Kalau 3 workflow n8n LAMA (`All - Get Product Details` dkk.) sudah
   > punya credential Google Sheets yang berfungsi, **credential itu BISA
   > dipakai ulang** di sini juga (tidak perlu connect akun Google dua
   > kali) — tinggal pilih credential yang sudah ada saat di § 5, tidak
   > perlu buat yang baru kalau sudah ada dan masih berfungsi.
5. Klik **Save**.

---

## 5. Memilih credential di node yang bertanda merah

Setelah impor (§ 2), buka workflow-nya, lalu:

1. Klik node **"Login ke App"** (ada garis merah).
2. Di panel yang terbuka, cari bagian **Credential** / **Basic Auth**,
   klik dropdown-nya, pilih **"Login App Samsara (n8n-integrasi)"** yang
   sudah dibuat di § 4.1.
3. Klik **Save** (tombol di pojok kanan atas panel node, atau tutup
   panelnya — n8n biasanya menyimpan otomatis).
4. Garis merah di node itu akan hilang.
5. Ulangi untuk node **"Ambil Data dari Google Sheet"**, pilih credential
   **"Google Sheets - BURNAS_DASHBOARD_V1"** dari § 4.2.
6. Kalau masih ada node lain bergaris merah yang bukan 2 node di atas,
   kemungkinan nama sheet/dokumen di node "Ambil Data dari Google Sheet"
   perlu dipilih ulang lewat dropdown-nya (n8n kadang minta konfirmasi
   ulang pilihan dokumen/sheet setelah import, walau isinya sudah benar)
   — klik dropdown **Document**/**Sheet**, pilih lagi `BURNAS_DASHBOARD_V1`
   dan tab yang sesuai nama workflow (`LOG_PENJUALAN`/`transaksi`/
   `RAW_TRANSAKSI_MAJOO`/`biaya_platform`).

---

## 6. Menjalankan dry-run (uji coba, AMAN, tidak mengirim apa pun)

1. Pastikan workflow MASIH non-aktif (lebih aman, walau dry-run memang
   tidak mengirim apa pun baik aktif maupun tidak).
2. Klik tombol **"Execute Workflow"** di n8n (biasanya tombol besar di
   bagian bawah editor, atau klik node **"Jalankan Manual (Uji Coba)"**
   lalu klik "Execute step").
3. Tunggu sampai semua node selesai jalan (tanda centang hijau muncul di
   tiap node).
4. Klik node **"Pratinjau Dry-Run (lihat tab Output)"** di akhir alur
   (lihat peta di § 3), lalu lihat tab **"Output"** di panel kanan/bawah.
   Anda akan melihat:
   - `jumlahBaris`: berapa baris yang AKAN terkirim kalau ini bukan
     dry-run.
   - `contohBaris`: 3 baris pertama, supaya Anda bisa cek sekilas apakah
     datanya masuk akal (nama platform benar, tanggal benar, angka tidak
     aneh).
5. **Kalau `jumlahBaris` = 0 padahal Anda yakin ada data penjualan baru**,
   atau **`contohBaris` isinya kosong/aneh/kolom tertukar**, kemungkinan
   nama kolom di spreadsheet tidak sama dengan yang diasumsikan workflow
   — lihat § 9 "Kalau mapping kolom salah".
6. Kalau hasilnya masuk akal, workflow siap diaktifkan (§ 7).

> **Catatan**: menjalankan manual secara default SELALU dry-run (tidak
> peduli berapa kali diulang, tidak akan pernah benar-benar mengirim).
> Kalau suatu saat Anda betul-betul perlu memaksa kirim sungguhan lewat
> tombol manual (bukan menunggu jadwal otomatis) — misalnya untuk
> langsung tes ujung-ke-ujung sekali saat setup — buka node **"Atur
> Mode"**, ubah field `dryRun` dari rumus otomatis menjadi nilai tetap
> `false`, jalankan sekali, **lalu segera kembalikan ke rumus semula**
> (hapus nilai tetap itu) supaya klik manual berikutnya otomatis balik
> jadi dry-run yang aman. Kalau tidak yakin, lebih baik tunggu jadwal
> otomatis saja.

---

## 7. Mengaktifkan workflow

Setelah dry-run terlihat benar (§ 6):

1. Klik saklar **aktif/non-aktif** di pojok kanan atas editor workflow
   (ubah dari abu-abu jadi hijau).
2. Workflow sekarang akan jalan sendiri sesuai jadwalnya (lihat tabel
   cadence di `docs/integrasi-n8n.md` § 4.2 — tiap jam untuk log
   penjualan, sekali sehari malam untuk 3 lainnya).
3. Cek lagi besoknya lewat menu **Executions** di n8n (daftar riwayat
   eksekusi workflow) — pastikan statusnya sukses (centang hijau), bukan
   gagal (silang merah).

Ulangi § 2 - § 7 untuk file workflow lainnya.

---

## 8. Catatan khusus `biaya-platform.json`

Workflow ini sedikit beda dari 3 lainnya: dia **tidak** memakai "data 2
hari terakhir" setiap kali jalan, tapi mengingat sendiri **sampai baris
mana yang sudah pernah dikirim** (disimpan di memori internal workflow
n8n, bukan di database Anda) — supaya baris lama tidak terkirim berulang.

Konsekuensinya:
- **Dry-run AMAN dicoba berkali-kali** — dry-run TIDAK PERNAH membaca atau
  menggeser "ingatan" ini, selalu menunjukkan pratinjau 1 hari terakhir
  apa adanya.
- **Jalan pertama kali (setelah aktivasi)** akan mengirim data **2 hari
  terakhir** (default aman), BUKAN seluruh riwayat biaya platform yang
  ada di spreadsheet. Kalau Anda perlu mengirim riwayat yang lebih jauh
  sekali di awal (backfill), itu perlu bantuan teknis terpisah — jangan
  dipaksa lewat workflow terjadwal ini.
- Kalau Anda **mengekspor ulang workflow ini dan impor lagi dari awal**
  (bukan sekadar edit node), "ingatan" tadi akan hilang dan jalan
  berikutnya akan balik ke default 2 hari — ini aman (tidak akan
  menduplikasi baris yang SUDAH punya `id_platform` terisi, karena baris
  begitu memang di-dedup otomatis oleh server), tapi baris yang dulu
  TIDAK punya `id_platform` terisi berisiko terkirim dobel kalau memang
  masih ada di jendela 2 hari saat itu. Kalau ragu, lebih aman jangan
  impor-ulang workflow ini tanpa alasan kuat — edit node yang sudah ada
  langsung di editor n8n saja kalau cuma mau mengubah sedikit.

---

## 9. Kalau mapping kolom salah

Tiap workflow punya objek `PETA` di baris paling atas kode node **"Susun
CSV & Pecah Batch"** (klik node itu, lihat kolom kode di tengah panel),
bentuknya kira-kira:

```js
const PETA = {
  transaction_date: "transaction_date",
  transaction_time: "transaction_time",
  // ...
};
```

Sisi **kiri** adalah nama kolom yang dipakai app Samsara (JANGAN diubah).
Sisi **kanan** adalah nama kolom di tab Google Sheet — kalau nyatanya
berbeda (misalnya sheet-nya memakai header `Tanggal` bukan
`transaction_date`), ubah sisi kanannya saja supaya cocok dengan header
sungguhan di spreadsheet Anda, simpan node-nya, coba dry-run lagi (§ 6).

Ini satu-satunya bagian workflow yang mungkin perlu disesuaikan manual,
karena nama kolom persis di spreadsheet tidak dicek langsung saat
workflow ini dibuat (dibuat berdasarkan kode 3 workflow n8n lama yang
menulis ke spreadsheet itu, bukan membaca spreadsheet-nya langsung).

---

## 10. Troubleshooting tambahan

Untuk hal-hal di luar daftar ini (gagal login, gagal 403, format CSV
ditolak, dll.), lihat tabel troubleshooting lengkap di
`docs/integrasi-n8n.md` § 6 — penyebab & solusinya sama, workflow di
folder ini hanya implementasi konkret dari desain yang didokumentasikan
di sana.

| Gejala | Kemungkinan sebab |
|---|---|
| Node "Login ke App" gagal | Credential § 4.1 salah isi, atau akun `n8n-integrasi` belum dibuat di server (lihat § 4.1). |
| Node "Ambil Data dari Google Sheet" gagal/kosong | Credential § 4.2 belum tersambung, atau Document/Sheet yang dipilih di node itu perlu dipilih ulang (lihat § 5 poin 6). |
| Node "Kirim CSV ke App" gagal `403` | Seharusnya tidak terjadi — akun `integrasi` memang diizinkan ke 4 endpoint import ini. Kalau terjadi, kemungkinan URL di node itu salah ketik (cek masih `https://burnas-app.duckdns.org/api/sales-sync/import/...`, bukan domain lain). |
| Node "Error: Ada Baris CSV Gagal" membuat eksekusi gagal (silang merah di Executions) | **Ini bukan bug workflow** — artinya sebagian baris CSV gagal disimpan app (format salah, dll). Baca pesan errornya (klik node itu di riwayat Executions), cocokkan dengan isi spreadsheet untuk tahu baris mana. Baris lain yang BENAR tetap tersimpan, tidak ikut gagal. |
| `jumlahBaris`/`jumlahBarisBatch` selalu 0 | Cek § 9 (mapping kolom) dan pastikan ada data baru dalam jendela waktu yang dicek (2 hari untuk jadwal otomatis, 1 hari untuk dry-run). |

---

## 11. Workflow baru: `raw-majoo-direct.json` (langsung dari API Majoo, tanpa Google Sheets)

### Apa bedanya dari `raw-majoo.json`

`raw-majoo.json` (§ 1-10 di atas) membaca data dari tab Google Sheet
`RAW_TRANSAKSI_MAJOO` — yang sampai saat ini masih diisi oleh workflow
n8n LAMA `Majoo - Sales` (lewat API Majoo juga, tapi 2 tahap: API →
Sheet → app). `raw-majoo-direct.json` memotong tahap tengah itu: tarik
langsung dari API Majoo (endpoint `detail_sales` dan `refund_sales`),
format jadi CSV, kirim ke app — **tanpa Google Sheets sama sekali**.

Ini **bukan berarti `raw-majoo.json` dihapus atau salah** — sengaja
dipertahankan sebagai cadangan sampai jalur baru ini terbukti stabil
berjalan beberapa hari (lihat "Cara mengaktifkan" di bawah).

**Apa yang TETAP SAMA dengan § 0** — ini penting: workflow baru ini
**TIDAK PERNAH memanggil endpoint pemotong stok** (`/sales-sync/proses`
atau sejenisnya). Tugasnya SAMA PERSIS seperti `raw-majoo.json`: cuma
mengisi arsip `salessync_raw_majoo` lewat endpoint
`/api/sales-sync/import/raw-majoo`. Mengubah arsip itu jadi transaksi
yang memotong stok tetap manual, lewat tombol di halaman Sinkronisasi
Penjualan — sama seperti sebelumnya, tidak berubah.

### Peta alur

```
Jadwal Otomatis (01:00 WIB, SAMA seperti 'Majoo - Sales' lama) ─┐
Jalankan Manual (Uji Coba) ──────────────────────────────────────┼─→ Atur Mode ─→ Login ke App ─→ Simpan Token & Mode
                                                                                                           │
                                            ┌──────────────────────────────────────────────────────────┴──────────────────────────────────────┐
                                            ▼ (cabang sales, berpaginasi)                                                                        ▼ (cabang refund, satu halaman)
                              Ambil Token Majoo → Parse Token → Tentukan Rentang Tanggal                              Ambil Token Majoo (Refund) → Parse Token (Refund) → Siapkan Request Refund
                                            │                                                                                                    │
                                            ▼                                                                                                    ▼
                              Siapkan Request Sales → Get Detail Sales ─┐                                                              Get Refund Sales → Petakan Baris Refund
                                                              ▲          ▼                                                                                      │
                                                              │   Gabung Konteks Halaman ──→ Petakan Baris Sales (tambah ke akumulator)                        │
                                                              │          ▼                                                                                      │
                                                   Increment Page ← Tunggu 2 Detik ← [ya] Ada Halaman Lagi? ──[tidak]──→ Ambil Baris Sales Terkumpul             │
                                                                                                                                      │                          │
                                                                                                                                      └──────────┬───────────────┘
                                                                                                                                                 ▼
                                                                                                                                      Gabung Semua Baris
                                                                                                                                                 │
                                                                                                                                                 ▼
                                                                                                                              Susun CSV & Pecah Batch ─→ (dry-run/kirim/error, SAMA seperti § 3)
```

- **Ambil Token Majoo** / **Ambil Token Majoo (Refund)**: query SQL yang
  SAMA PERSIS dengan yang dipakai workflow lama `Majoo - Sales` —
  `SELECT token FROM api_tokens t JOIN platforms p ON p.platform_id =
  t.platform_id WHERE p.name = 'majoo' AND t.status = 'valid' LIMIT 1` —
  ke database `n8n` (bukan database `samsara`), credential Postgres yang
  SUDAH ADA (dipakai ulang, bukan baru, lihat "Credential" di bawah).
- **Tentukan Rentang Tanggal** / **Siapkan Request Refund**: hitung
  jendela `[hari ini - windowDays, hari ini]` dalam jam dinding WIB —
  windowDays datang dari "Atur Mode" (2 hari jadwal otomatis, 1 hari
  dry-run manual), sama seperti `raw-majoo.json`.
- **Get Detail Sales** / **Get Refund Sales**: panggil langsung
  `services.majoo.id`, header dan parameter query disalin persis dari
  workflow `Majoo - Sales` (termasuk header "menyamar sebagai dashboard
  Majoo" — `x-brand-key: undefined`, `origin`/`referer`
  `dashboard.majoo.id` — karena token yang dipakai adalah token sesi
  dashboard, bukan API key resmi, dan kemungkinan ditolak Majoo tanpa
  header ini).
- **Petakan Baris Sales** / **Petakan Baris Refund**: ubah respons Majoo
  jadi 20 kolom yang dimengerti app (`id, transaction_no,
  transaction_date, ..., refund_reason`) — LANGSUNG, tanpa perantara
  nama kolom Sheet.
- **Get Detail Sales** berpaginasi (bisa lebih dari 1 halaman per hari
  kalau transaksi ramai) — pola "ambil halaman → cek masih ada halaman
  lagi → tunggu 2 detik → ambil halaman berikutnya" ini SAMA PERSIS
  dengan yang dipakai `Majoo - Sales`, supaya perilaku terhadap API
  Majoo (termasuk jeda antar-request) sudah teruji. **Get Refund Sales
  TIDAK berpaginasi** (satu halaman saja) — ini bukan kekurangan baru,
  `Majoo - Sales` yang jadi rujukan juga begitu (volume refund jauh lebih
  kecil dari sales).
- **Satu penyesuaian sengaja dari pola `raw-majoo.json`**: node "Susun
  CSV & Pecah Batch" di sini **tidak lagi memfilter tanggal berdasarkan
  cutoff relatif ke waktu eksekusi** — di `raw-majoo.json` filter itu
  perlu karena Google Sheet berisi SELURUH histori dan harus dipotong ke
  `windowDays` terakhir di sisi kode n8n. Di sini jendela tanggal SUDAH
  ditentukan di hulu lewat parameter `start_date`/`end_date` yang dikirim
  ke API Majoo — memfilter ulang pakai cutoff waktu eksekusi akan
  berisiko memotong baris di tepi hari secara tidak konsisten dengan
  jendela yang sudah diminta ke API.

### Credential yang dibutuhkan

**Tidak ada credential baru yang perlu dibuat.** Workflow ini memakai 2
credential yang SUDAH ADA di n8n Anda:

1. **"Login App Samsara (n8n-integrasi)"** — sama seperti § 4.1, sudah
   ada kalau Anda sudah mengimpor salah satu dari 4 workflow di § 1-10.
2. **Credential Postgres ke database `n8n`** — credential yang SAMA yang
   SUDAH dipakai workflow lama `Majoo - Sales` untuk mengambil token
   (biasanya bernama **"Postgres account"** di daftar Credentials Anda).
   **Jangan buat credential Postgres baru** — pakai yang sudah ada,
   supaya tidak ada 2 koneksi berbeda ke database yang sama.

Setelah impor, 2 node Postgres baru (**"Ambil Token Majoo"** dan **"Ambil
Token Majoo (Refund)"**) akan bergaris merah — klik masing-masing, pilih
credential **"Postgres account"** (atau nama credential Postgres `n8n`
yang sudah ada) dari dropdown, sama seperti § 5. Node **"Login ke
App"** perlu credential **"Login App Samsara (n8n-integrasi)"**, sama
seperti § 5 poin 1-2.

### Cara mengaktifkan (bertahap, jangan langsung full-schedule)

1. **Impor** `devops/n8n/raw-majoo-direct.json` (cara sama seperti § 2),
   workflow masuk dalam keadaan NON-AKTIF.
2. Pilih credential di 3 node bergaris merah (lihat di atas).
3. **Dry-run dulu** (§ 6) — klik "Jalankan Manual (Uji Coba)", lihat
   `jumlahBaris`/`contohBaris` di node "Pratinjau Dry-Run". Pastikan
   jumlah & isi baris masuk akal dibanding data yang Anda tahu ada di
   Majoo untuk 1 hari terakhir.
4. **Kirim sungguhan pertama kali dengan jendela sempit** — jangan
   langsung aktifkan jadwal penuh. Opsi paling aman: ubah sementara
   `windowDays` di node "Atur Mode" jadi nilai tetap kecil (misal `1`),
   paksa `dryRun` jadi `false` (lihat catatan § 6), jalankan sekali
   manual, lalu **segera kembalikan dua nilai itu ke rumus semula**.
5. **Bandingkan hasilnya**: cek beberapa baris di tabel
   `salessync_raw_majoo` (lewat halaman app atau query langsung) untuk
   tanggal yang baru dikirim, bandingkan dengan data yang sama di Majoo
   (dashboard atau export CSV manual `RAW_TRANSAKSI_MAJOO` untuk periode
   yang sama) — harus identik (`id`, `transaction_no`, nilai `total_sales`
   dkk).
6. Kalau sudah terbukti bersih, **aktifkan jadwal** (§ 7) — jalan sendiri
   tiap hari jam 01:00 WIB.
7. **JANGAN matikan workflow lama `Majoo - Sales` dulu** — biarkan
   keduanya jalan paralel beberapa hari (Sheet `RAW_TRANSAKSI_MAJOO`
   tetap ter-update dari jalur lama sebagai jaring pengaman). Baru
   pertimbangkan menonaktifkan `Majoo - Sales` setelah jalur baru ini
   terbukti stabil tanpa masalah selama beberapa hari berjalan.

### Rencana lanjutan — SUDAH dikerjakan, lihat § 12

Pola yang sama (ambil langsung dari API, bukan dari Sheets) sudah
dibuat juga untuk Shopee/GrabFood/GoFood — sumbernya workflow lama
`All - Get Product Details` (→ `log-penjualan.csv`) dan `Get sales &
biaya online` (→ `transaksi.csv` + `biaya-platform.csv`) — jadi
`log-penjualan-direct.json` dan `transaksi-biaya-direct.json`. Lihat
§ 12 untuk penjelasan lengkap, termasuk peringatan penting: dibangun
sekaligus (7 kombinasi platform×feed) tanpa pernah diuji ke API
platform asli — WAJIB dry-run hati-hati sebelum aktivasi.

---

## 12. Workflow baru: `log-penjualan-direct.json` & `transaksi-biaya-direct.json` (Shopee/GrabFood/GoFood/Majoo langsung API)

### Apa ini

Dua file ini melengkapi `raw-majoo-direct.json` (§ 11, yang cuma
menangani Majoo level-transaksi) dengan jalur "langsung API" untuk
SISA platform & feed:

- **`log-penjualan-direct.json`** — pengganti pola `log-penjualan.json`
  (§ 1-10), tarik langsung dari API **Shopee, GrabFood, GoFood, dan
  Majoo level-produk** (breakdown per item/menu — BEDA dari Majoo di
  `raw-majoo-direct.json` yang level-transaksi/header saja), gabung
  jadi satu, kirim ke `/api/sales-sync/import/log-penjualan`. Jadwal:
  **tiap jam, 06:00–22:00 WIB** (sama seperti `All - Get Product
  Details` lama).
- **`transaksi-biaya-direct.json`** — pengganti pola `transaksi.json`
  DAN `biaya-platform.json` SEKALIGUS (digabung 1 file, lihat alasan di
  bawah), tarik langsung dari API **Shopee, GrabFood, GoFood** untuk
  DUA tujuan: rekonsiliasi income/fee per order (`/import/transaksi`)
  dan biaya/adjustment granular (`/import/biaya-platform`). Jadwal:
  **sekali sehari, 05:50 WIB** (sama seperti `Get sales & biaya online`
  lama — mundur ke pagi supaya settlement platform untuk hari
  sebelumnya sudah final saat ditarik).

**Sama seperti § 0/§ 11**: kedua workflow ini TIDAK PERNAH memanggil
endpoint pemotong stok (`/sales-sync/proses`). Cuma mengisi arsip lewat
3 endpoint `/import/*` di atas — mengubah arsip jadi transaksi yang
memotong stok tetap manual.

### ⚠️ PERINGATAN PENTING sebelum impor

Berbeda dari `raw-majoo-direct.json` (1 platform, dibangun & diuji
bertahap), **kedua file ini dibangun SEKALIGUS untuk 7 kombinasi
platform×feed** (Shopee/GrabFood/GoFood/Majoo-produk ×
log-penjualan, Shopee/GrabFood/GoFood × transaksi+biaya) atas
keputusan sadar Anda — supaya cepat selesai, dengan trade-off: **belum
ada satu pun bagian yang diuji ke API platform ASLI** (cuma dirancang
dari membaca kode workflow lama + verifikasi struktur data `token` di
database). Sebelum mengaktifkan jadwal penuh:

1. **Dry-run dulu** (§ 6) — kalau `jumlahBaris` di "Pratinjau Dry-Run"
   nol/aneh, atau workflow error, isolasi platform yang bermasalah:
   putus sementara koneksi cabang platform LAIN di editor n8n
   (disconnect node, JANGAN dihapus), jalankan ulang dry-run, ulangi
   satu-per-satu sampai ketemu cabang yang salah.
2. Error paling mungkin: **nama/isi header request** (tiap platform
   punya pola "menyamar dashboard/portal" sendiri-sendiri, lihat
   catatan di kode tiap node "Validasi Token ..."), atau **nama field
   respons API** berubah dari yang diasumsikan saat workflow ini
   ditulis (API pihak ketiga bisa berubah tanpa pemberitahuan).
3. Kirim sungguhan pertama kali ke jendela yang SANGAT SEMPIT dulu
   (satu platform, satu hari), bandingkan hasilnya manual sebelum
   percaya ke seluruh platform.
4. **Workflow lama (`All - Get Product Details`, `Get sales & biaya
   online`) TIDAK dimatikan** sampai jalur baru ini terbukti stabil
   beberapa hari — jaring pengaman kalau ada bug yang baru ketahuan
   belakangan.

### Temuan penting (regardless Anda pakai workflow baru ini atau tidak)

Saat meriset workflow lama `Get sales & biaya online` untuk membangun
file ini, ditemukan **kemungkinan bug lama** di node `Parse & Validate
Token` (cabang Shopee workflow itu): kode-nya membaca
`tokenData.x_sap_ri`, `tokenData.spc_b_oft` (garis-bawah), padahal
isi kolom `token` di database untuk Shopee punya nama kunci berbeda
(dash, `'x-sap-ri'`, `'spc-b-oft'`, dikonfirmasi langsung lewat query
read-only ke database) — kemungkinan header itu terkirim `undefined`
ke Shopee selama ini. Workflow baru di sini TIDAK mewarisi pola ini
(baca kolom `token` secara langsung, bukan destrukturisasi nama field).
Ini sekadar informasi — tidak mengubah apa pun di workflow lama,
cuma dicatat supaya Anda tahu kalau suatu saat ada yang terlihat aneh
di data Shopee dari jalur lama.

### Perbedaan desain dari workflow lama (sengaja, bukan kesalahan)

- **Paginasi ditambahkan** di titik yang dulu hardcode 1 halaman
  (Shopee & GrabFood di `log-penjualan-direct.json`, endpoint GoFood di
  situ juga disamakan ke pola paginasi yang SUDAH terbukti jalan di
  `transaksi-biaya-direct.json`) — mencegah data terpotong diam-diam
  kalau transaksi ramai.
- **`unique_key` GrabFood disamakan** ke nama item MENTAH dari
  platform (dulu satu-satunya yang pakai nama standar hasil alias).
- **Tidak ada lagi lookup `MENU_ALIAS` dari Google Sheets** —
  `item_name` dikirim apa adanya dari platform, app sudah punya
  mekanismenya sendiri (`syncItemMappingFromLog`) untuk memetakan item
  baru. **`log-penjualan-direct.json` sekarang 100% tanpa Google
  Sheets.**
  > **Koreksi (2026-10-29, ditemukan dari insiden produksi)**: versi
  > awal node "Petakan Baris ..." mengirim `menu_id` KOSONG untuk
  > semua baris. Ini SALAH — `syncItemMappingFromLog`
  > (`import-csv.ts:421`, lihat `modules/sales-sync/src/domain/item-mapping.ts:74`)
  > HANYA mengantrikan baris ke daftar "item belum dipetakan" kalau
  > `menu_id` TERISI; `menu_id` kosong membuat `/sales-sync/proses`
  > melewati SELURUH order tanpa ada jalan untuk memetakannya lewat UI
  > sama sekali (53 order tersangkut saat pertama kali diuji ke
  > production). Sudah diperbaiki: `menu_id` sekarang diisi SAMA
  > DENGAN `item_name` (nama mentah jadi "kode eksternal" sementara,
  > bisa dipetakan manual lewat halaman Pemetaan Item seperti biasa).
  > **Konsekuensi**: item yang DULU sudah dipetakan lewat jalur Sheets
  > lama (kode eksternalnya beda, hasil lookup `MENU_ALIAS`) perlu
  > DIPETAKAN ULANG sekali di bawah kode eksternal baru ini — tidak
  > otomatis "nyambung" ke pemetaan lama.
- **`transaksi-biaya-direct.json` MASIH membaca 1 Google Sheet kecil**:
  tab `MAPPING_BIAYA_PLATFORM` (lookup kode transaksi → kategori biaya
  yang bisa dibaca manusia) — ini SENGAJA dipertahankan (beda dari
  `MENU_ALIAS` yang dihapus) karena tidak ada penggantinya di app;
  menghapusnya akan membuat SEMUA baris biaya platform baru berlabel
  "PERLU_REVIEW" selamanya. Kalau suatu saat mau dipindah ke tabel
  database, itu pekerjaan terpisah.
- **Biaya Platform GoFood: dedup manual (baca-balik Sheet) dihapus** —
  endpoint app sudah `ON CONFLICT (id_platform) DO UPDATE`, cukup kirim
  CSV apa adanya. `per` di `Fetch Payout List` dinaikkan 10→50 sebagai
  margin aman.
- **Filter Majoo level-produk (skip transaksi yang masih "refundable")
  direplikasi APA ADANYA** dari workflow lama — walau berpotensi bikin
  data selalu telat beberapa hari, ini keputusan sadar untuk putaran
  kerja ini, bukan diperbaiki diam-diam.

### Credential yang dibutuhkan

Semua REUSED (tidak ada yang baru dibuat):
- **"Login App Samsara (n8n-integrasi)"** — sama seperti § 4.1.
- **Credential Postgres ke database `n8n`** ("Postgres account") — sama
  seperti § 11, dipakai di semua node "Ambil Token ...".
- **"Google Sheets account" (service account)** — HANYA dipakai node
  "Baca Mapping Biaya ..." di `transaksi-biaya-direct.json` (3
  instance, satu per platform). `log-penjualan-direct.json` TIDAK
  butuh credential Google Sheets sama sekali.

Setelah impor, pilih ulang credential di tiap node bergaris merah
(pola sama seperti § 5).

## 13. Perbaikan error handling & backfill data (gap sejak 28 Okt 2026)

### Apa yang ditemukan

GoFood (dalam `log-penjualan-direct.json`) dan Majoo level-transaksi
(`raw-majoo-direct.json`) berhenti menghasilkan baris baru sejak ±28
Okt 2026 jam 13:00 WIB, walau eksekusi n8n tetap tercatat "success".
Audit (baca-saja file JSON, TIDAK PERNAH menyentuh data eksekusi n8n
mentah yang bisa memuat token sesi) menemukan akar masalahnya tersebar
di **10 Code node** across `log-penjualan-direct.json` (4 node) dan
`transaksi-biaya-direct.json` (6 node), semuanya memakai
`ignoreHttpStatusErrors: true` (dibutuhkan supaya kode JS bisa baca
body respons error untuk pesan yang informatif) DIKOMBINASIKAN dengan
pola `(response && response.xxx) || []` — begitu respons API tidak
sesuai bentuk yang diharapkan (mis. token revoked/expired di sisi
server, 401/403, atau perubahan bentuk JSON platform), `[]` kosong
diam-diam dianggap "tidak ada data lagi", loop paginasi berhenti
bersih TANPA error apa pun. Token GoFood yang revoked di sisi server
(tidak terdeteksi validasi lokal `api_tokens.status`/`expires_at`,
yang hanya mengecek bookkeeping lokal) adalah kandidat paling kuat
untuk gap GoFood ini.

### Apa yang diperbaiki (per 2026-11-01)

Di SELURUH 10 node tersebut (`Ambil Daftar Transaksi Shopee/GrabFood/
GoFood`, `Ambil Daftar Sales Majoo` di `log-penjualan-direct.json`;
`Ambil Daftar Settlement Shopee`, `Ambil Detail Clearing Shopee`,
`Ambil Daftar Transaksi GrabFood/GoFood`, `Ambil Daftar Payout GoFood`,
`Ambil Detail Payout GoFood` di `transaksi-biaya-direct.json`), plus
`Petakan Baris Sales`/`Loop Control Sales`/`Petakan Baris Refund` di
`raw-majoo-direct.json`:

- **Validasi bentuk respons SEBELUM dipakai** — kalau field yang
  diharapkan array (`data`, `data.list`, `statements`,
  `transaction_shares`, dst) BUKAN array, `throw new Error(...)` dengan
  pesan yang menyebut platform + halaman/offset saat ini. TIDAK PERNAH
  lagi coalesce diam-diam ke `[]`.
- **3 node yang SUDAH punya `throw` tapi dengan lubang "diam-diam
  `break`" di halaman >1/offset>0** (`Ambil Daftar Settlement Shopee`,
  `Ambil Daftar Transaksi GrabFood` di `transaksi-biaya-direct.json`) —
  lubang itu dihapus, throw sekarang berlaku di halaman MANAPUN.
- **Page cap** ditambahkan di SEMUA loop paginasi (tidak ada satu pun
  sebelumnya) — 200 halaman untuk kebanyakan, 500 untuk endpoint
  page-size kecil (GoFood, size=20) — supaya loop yang entah kenapa
  tidak pernah berhenti sendiri (API selalu balas tepat `limit` baris)
  gagal dengan jelas, bukan jalan selamanya.
- **Timeout 15 detik** ditambah di panggilan yang belum punya
  (`Get Detail Sales`/`Get Refund Sales` di `raw-majoo-direct.json`,
  dan semua Code node HTTP yang disebut di atas) — konsisten dengan
  node lain yang sudah lama punya timeout.
- **Logging row-count per halaman** (`console.log`) di tiap iterasi
  loop — kalau masalah serupa terulang, log eksekusi n8n langsung
  menunjukkan di halaman/platform mana jumlah baris berhenti wajar.

### Backfill Majoo (window sementara diperlebar 2 → 7 hari)

`raw-majoo-direct.json`, node "Atur Mode": `windowDays` untuk jadwal
otomatis diubah dari `2` jadi **`7` SEMENTARA** (dry-run manual tetap
`1`, tidak relevan untuk backfill). Begitu workflow ini berjalan normal
lagi (jadwal otomatis berikutnya, atau dipicu manual), rentang tanggal
otomatis mencakup 7 hari ke belakang — cukup untuk menutup gap sejak 28
Okt.

**WAJIB dikembalikan ke `2` setelah backfill selesai** (sekali data gap
sudah masuk, window 7 hari jadi tidak perlu dan memperlambat tiap
eksekusi tanpa guna) — edit node "Atur Mode" di editor n8n, ubah balik
`$execution.mode === "manual" ? 1 : 7` jadi `$execution.mode === "manual" ? 1 : 2`,
simpan workflow.

### Backfill GoFood (prosedur manual, BUKAN config persisten)

`log-penjualan-direct.json` (sumber GoFood untuk level-item) **tidak
punya konsep rentang hari mundur** — jendelanya SELALU "06:00–21:59:59
WIB HARI INI" (node "Tentukan Jendela Waktu"), karena workflow ini
didesain jalan tiap jam, bukan sekali sehari seperti Majoo. Melebarkan
`windowDays` seperti Majoo TIDAK BISA dilakukan di sini — tidak ada
variabel itu.

Untuk menutup gap GoFood sejak 28 Okt, jalankan backfill MANUAL per
hari (bukan ubah konfigurasi permanen):
1. Buka `log-penjualan-direct.json` di editor n8n.
2. Edit SEMENTARA node "Tentukan Jendela Waktu": ganti baris
   `const wibNow = new Date(now.getTime() + 7 * 3600 * 1000);` jadi
   tanggal target secara eksplisit (mis. `const wibNow = new
   Date('2026-10-28T12:00:00+07:00');` untuk backfill tanggal 28 Okt).
3. Jalankan EKSEKUSI MANUAL (bukan jadwal otomatis) — dry-run dulu (§
   6) untuk cek jumlah baris wajar, baru kirim sungguhan.
4. Ulangi langkah 2-3 untuk tiap tanggal yang hilang (satu tanggal per
   eksekusi manual).
5. **WAJIB kembalikan node "Tentukan Jendela Waktu" ke kode asli**
   (`const wibNow = new Date(now.getTime() + 7 * 3600 * 1000);`) segera
   setelah backfill selesai — JANGAN biarkan hardcode tanggal tertinggal,
   jadwal otomatis berikutnya akan memakai tanggal yang salah kalau lupa
   dikembalikan.

Import ulang-tidak-perlu dari sisi app: `POST /import/log-penjualan`
sudah idempoten per `unique_key` (dibuat -> dilewati kalau identik,
diperbarui kalau berubah) — aman dijalankan berkali-kali untuk tanggal
yang sama tanpa membuat baris dobel.

### Keamanan token (2026-11-07)

`raw-majoo-direct.json` (cabang Sales maupun Refund) sebelumnya meneruskan
`access_token` sebagai FIELD DATA biasa dari satu node ke node berikutnya
(`Tentukan Rentang Tanggal` → `Siapkan Request Sales` → ... → `Increment
Page Sales` → kembali ke `Get Detail Sales`, dan pola yang sama di cabang
Refund) — artinya token ikut tampil di tab Output SETIAP node di
sepanjang rantai itu kalau seseorang membuka data eksekusi di editor n8n,
bukan cuma di node yang benar-benar memintanya.

**Diperbaiki**: `access_token` sekarang HANYA ada di output node
`Parse Token Majoo`/`Parse Token Majoo (Refund)` sendiri (node yang
memang tugasnya membaca token dari `api_tokens`). Node lain yang butuh
token (`Get Detail Sales`, `Get Refund Sales`) mengambilnya langsung lewat
expression `{{ $('Parse Token Majoo').item.json.access_token }}` /
`{{ $('Parse Token Majoo (Refund)').item.json.access_token }}` di field
header-nya sendiri — BUKAN membaca `$json.access_token` dari input node
yang mungkin sudah lewat beberapa node perantara. Node `Siapkan Request
Sales`, `Loop Control Sales`, `Increment Page Sales`, `Siapkan Request
Refund` TIDAK LAGI menyimpan/meneruskan `access_token` sama sekali di
output-nya.

## 14. Refund Majoo berdiri sendiri (`salessync_majoo_refund`, 2026-11-07)

### Apa yang diperbaiki

Diagnosis Tahap 0 (baca-saja, tidak pernah menyentuh data eksekusi n8n
mentah) membuktikan **SETIAP baris refund dari endpoint
`GET /v1/refund_sales` SELALU gagal masuk** sejak awal: node "Petakan
Baris Refund" mengosongkan kolom `id` (`id: ''`) untuk baris jenis ini
(refund memang tidak punya `id` Majoo sendiri, cuma `refund_id`) — tapi
importer backend (`modules/sales-sync/src/domain/import-csv.ts`,
`bilanganBulatWajib("id")`) menolak `id` kosong untuk SEMUA baris tanpa
kecuali, karena kolom itu primary key `salessync_raw_majoo`. Baris gagal
ini tercatat di `errors[]` respons import, yang memicu node "Ada Baris
Gagal?" workflow ini menghentikan eksekusi dengan error eksplisit
(`stopAndError`) — BUKAN silent-failure, tapi kemungkinan besar luput
diperhatikan karena alasannya spesifik ke baris refund, bukan ke seluruh
eksekusi.

Dugaan awal ("importer melewati baris lama saat dikirim ulang, bukan
memperbarui") **dibuktikan SALAH** lewat kode + test baru
(`modules/sales-sync/src/domain/import-csv.test.ts`): SQL upsert
(`ON CONFLICT (id) DO UPDATE SET ... WHERE (...) IS DISTINCT FROM (...)`)
sudah benar memperbarui `refund_amount`/`is_paid`/`receivables`/
`total_discount_amount`/`payment_date` saat baris dengan `id` yang sama
dikirim ulang. Akar masalahnya murni `id` kosong, bukan logic update.

### Perubahan

- **Tabel baru `salessync_majoo_refund`** (migrasi
  `modules/sales-sync/src/db/migrations/0004_tabel_refund_majoo.sql`),
  kunci unik `refund_id`. Baris refund (`id` kosong, `refund_id` terisi)
  SEKARANG masuk ke sini lewat `importRawMajoo` yang sudah dibuat
  bercabang: `id` terisi → `salessync_raw_majoo` (seperti sebelumnya),
  `id` kosong + `refund_id` terisi → `salessync_majoo_refund` (BARU),
  keduanya kosong → ditolak dengan pesan jelas. Spesifikasi lengkap:
  `docs/integrasi-n8n.md` § 8.4.
- **`raw-majoo-direct.json` cabang Refund** sekarang MENGIKUTI SEMUA
  halaman (pola loop If/Wait/Set identik cabang Sales — SEBELUMNYA cuma
  `page=1` tetap, data refund di halaman >1 hilang diam-diam kalau ada).
  Node baru: `Gabung Konteks Halaman Refund`, `Loop Control Refund`,
  `Ada Halaman Lagi? (Refund)`, `Tunggu 2 Detik (Refund)`,
  `Increment Page Refund`, `Ambil Baris Refund Terkumpul`.
- Jendela tanggal refund (`start_date`/`end_date` yang dikirim ke
  `/v1/refund_sales`) didokumentasikan eksplisit sebagai **tanggal
  refund** (bukan tanggal transaksi asal) di komentar node "Siapkan
  Request Refund" — nama endpoint & perilakunya mengindikasikan ini,
  TIDAK bisa dipastikan 100% tanpa akses API langsung (di luar scope
  diagnosis).
- **Tidak ada penggabungan/dedup per `transaction_no`** — satu transaksi
  yang direfund dua kali tetap tersimpan sebagai DUA baris
  `salessync_majoo_refund` terpisah (dua `refund_id` berbeda), teruji.
- Respons API yang bentuknya tidak sesuai (bukan array) ATAU error HTTP
  SEKARANG throw eksplisit di "Petakan Baris Refund"/"Loop Control
  Refund" — pola sama Tahap 1C, tidak lagi coalesce diam-diam ke `[]`.
- Jendela impor (`windowDays`) TETAP 7 hari sementara (belum dikembalikan
  ke 2 hari dari Tahap 1C, lihat § 13) — refund dengan jarak waktu dari
  transaksi aslinya yang jauh (lihat 2 baris legacy Agustus di arsip)
  tetap bisa tertangkap selama masih dalam 7 hari dari HARI INI (window
  ini basisnya tanggal refund, bukan tanggal transaksi asal).
- Lihat juga § 13 "Keamanan token" di atas — berlaku untuk cabang Refund
  juga (token tidak lagi ikut di output node manapun selain node login).

### Langkah impor ulang / backfill refund yang terlewat

Refund yang SUDAH terjadi sebelum perbaikan ini (termasuk 2 transaksi
yang jadi pemicu diagnosis ini) **TIDAK otomatis tertangkap** oleh
jadwal rutin berikutnya kalau refund-nya di luar jendela 7 hari window
saat ini. Untuk menangkapnya:

1. Jalankan `raw-majoo-direct.json` secara MANUAL (bukan tunggu jadwal) --
   dry-run dulu (§ 6) untuk cek `jumlahBaris`/pratinjau refund masuk akal.
2. Kalau refund yang dicari lebih lama dari 7 hari ke belakang dari hari
   eksekusi, perbesar SEMENTARA `windowDays` di node "Atur Mode" (field
   `windowDays`, ganti angka `7` ke cakupan yang dibutuhkan untuk
   eksekusi MANUAL itu saja) — **WAJIB dikembalikan ke nilai semula
   setelah backfill selesai**, sama seperti catatan revert di § 13.
3. Kirim sungguhan. `POST /import/raw-majoo` idempoten per `id`
   (transaksi) MAUPUN per `refund_id` (refund, tabel baru) — aman
   dijalankan berkali-kali, tidak membuat baris dobel.
4. Verifikasi lewat Riwayat Transaksi (baris "Refund" muncul terhubung ke
   transaksi asal) atau query langsung `salessync_majoo_refund WHERE
   transaction_no = '...'`.
