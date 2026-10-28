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

### Rencana lanjutan (BELUM dikerjakan)

Pola yang sama (ambil langsung dari API, bukan dari Sheets) rencananya
akan dibuat juga untuk Shopee/GrabFood/GoFood — sumbernya workflow lama
`All - Get Product Details` (→ `log-penjualan.csv`) dan `Get sales &
biaya online` (→ `transaksi.csv` + `biaya-platform.csv`). Ini BELUM
diriset/dibuat — workflow itu jauh lebih besar (~28-32 node, 3 platform
tergabung dalam 1 workflow) dan butuh riset node-per-node yang sama
dalamnya seperti Majoo sebelum ditulis jadi workflow baru. Dikerjakan
setelah `raw-majoo-direct.json` terbukti jalan bersih di production.
