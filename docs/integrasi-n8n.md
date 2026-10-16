# Integrasi n8n — Import CSV Otomatis ke Sales-Sync

Dokumen ini untuk orang yang akan **membangun workflow n8n**-nya. Ditulis
dengan asumsi pembaca sudah paham konsep dasar n8n (node, workflow, trigger,
credentials) tapi belum tentu paham detail API Samsara Backoffice — detail
itu yang dijelaskan di sini.

Scope dokumen: mengirim 4 jenis data CSV ke modul `sales-sync` secara
terjadwal. **Bukan** dokumen tentang cara mengekstrak CSV dari Majoo/
ShopeeFood/GrabFood/GoFood — itu di luar scope, lihat Node 4 di bawah.

---

## 1. Ringkasan

Workflow n8n yang dijelaskan di sini punya satu tugas saja: **mengirim data
CSV terbaru secara terjadwal** ke 4 endpoint import milik modul `sales-sync`
di Samsara Backoffice, supaya arsip data penjualan/transaksi/biaya platform
selalu segar tanpa staf harus upload manual tiap hari.

> **TEGAS: workflow ini TIDAK memproses data ke stok.** Import CSV hanya
> menulis ke tabel **arsip** (`salessync_log_penjualan`,
> `salessync_transaksi`, `salessync_raw_majoo`, `salessync_biaya_platform`).
> Mengubah arsip itu jadi transaksi Penjualan sungguhan di modul Inventory
> (yang **mengurangi stok**) adalah langkah terpisah, `POST
> /sales-sync/proses`, dan langkah itu **sengaja tidak bisa dipanggil lewat
> workflow ini** — lihat § 2.

---

## 2. Batasan akses akun integrasi (baca ini dulu sebelum lanjut)

Workflow n8n login memakai akun khusus beridentitas non-manusia: role
`integrasi`, username `n8n-integrasi` (password dikelola manual oleh owner,
**tidak dicatat di dokumen ini**).

Akun ini **sengaja dibuat sempit**: hanya untuk 4 endpoint import CSV.

- **Bisa dipanggil akun ini:**
  - `POST /sales-sync/import/log-penjualan`
  - `POST /sales-sync/import/transaksi`
  - `POST /sales-sync/import/raw-majoo`
  - `POST /sales-sync/import/biaya-platform`
- **TIDAK BISA dipanggil akun ini (akan ditolak `403 Forbidden`):**
  - `POST /sales-sync/proses` — endpoint yang mengubah arsip log jadi
    transaksi Penjualan sungguhan di modul Inventory (dan **mengurangi
    stok**).
  - Semua endpoint lain di luar 4 endpoint import di atas.

**Ini bukan keterbatasan sementara yang "akan diperbaiki nanti" — ini
pengaman yang disengaja.** Alasannya: `/proses` bisa memicu pengurangan
stok untuk banyak order sekaligus berdasarkan arsip log yang baru masuk.
Kalau akun otomatis (workflow terjadwal, tanpa pengawasan manusia saat
jalan) bisa memicu itu, satu kesalahan data sumber (CSV salah format,
salah mapping, dsb.) bisa langsung mengurangi stok sistem tanpa ada manusia
yang mengecek dulu. Karena itu, "proses ke stok" **tetap langkah manual**
yang dilakukan staf lewat UI — halaman **Sinkronisasi Penjualan**, tombol
**"Proses Sinkronisasi"** — sebagai titik review manusia sebelum stok
berubah.

**Jangan coba memperluas akses akun ini ke `/proses` atau endpoint lain
tanpa persetujuan owner.** Kalau suatu saat ada kebutuhan bisnis yang
benar-benar mengharuskan proses-ke-stok berjalan otomatis, itu keputusan
arsitektur besar yang harus dibawa ke owner dulu — bukan sesuatu yang boleh
diputuskan lewat konfigurasi n8n.

> ### Status implementasi: SUDAH SELESAI (2026-10-16)
>
> Dua kesenjangan yang tercatat di versi dokumen ini tanggal 2026-10-15
> (`seed:integrasi` belum ada, dan 4 endpoint import belum mengizinkan role
> `integrasi` karena masih satu action `sales_sync.manage` bersama
> `/proses`) **sudah dikerjakan**. Kode yang berjalan sekarang:
>
> 1. **`npm run seed:integrasi -w @samsara/api` sudah ada**
>    (`apps/api/src/seed-integrasi.ts`). Idempoten, dan passwordnya
>    **di-generate acak saat dijalankan** lalu ditampilkan sekali di
>    terminal — tidak dibaca dari `.env` (beda dari `seed:owner`) dan tidak
>    ditulis ke file mana pun.
> 2. **4 endpoint import pakai action terpisah `sales_sync.import`**
>    dengan `roles: ["owner", "manajer_ops", "integrasi"]`. Empat endpoint
>    sales-sync lainnya (`/proses`, `GET /item-mapping`,
>    `PATCH /item-mapping/:id`, `/belum-diproses`) **tetap**
>    `sales_sync.manage` dengan `roles: ["owner", "manajer_ops"]` — role
>    `integrasi` tidak ada di sana, jadi `/proses` memang selalu `403`
>    untuk akun ini, sesuai desain di § 2 di atas.
> 3. **Celah tambahan ikut ditutup.** Saat verifikasi ditemukan 6 endpoint
>    modul Inventory (`GET /items`, `GET /items/:kode/hpp`, `GET /menu`,
>    `GET /menu/:kode/hpp`, `GET /menu/:kode/rekomendasi-harga`,
>    `GET /resep-produksi`) yang dulu **tidak punya gate permission sama
>    sekali** — cuma butuh login, jadi akun `integrasi` pun bisa
>    mengaksesnya. Keenamnya sekarang digerbang action READ baru
>    (`master_item.lihat`, `master_menu.lihat`, `resep_produksi.lihat`)
>    dengan populasi keempat role manusia (owner/manajer_ops/supervisor/
>    staf) — akses staf & supervisor tidak berubah, yang berubah hanya
>    akun `integrasi` sekarang ditolak `403` di situ juga.
>
> Bukti otomatisnya ada di `apps/api/src/auth.test.ts` (4 test: login +
> keempat import `200`; 14 endpoint lain `403`; regresi owner/manajer_ops
> di endpoint import; regresi supervisor/staf di 6 endpoint Inventory itu).

---

## 3. Prasyarat

Sebelum mulai membangun workflow di n8n, pastikan dulu:

1. **Akun integrasi sudah dibuat.** Di server Samsara Backoffice, jalankan
   (oleh orang yang punya akses server, bukan dari n8n):
   ```
   npm run seed:integrasi -w @samsara/api
   ```
   Script ini membuat satu user dengan role `integrasi`, username
   `n8n-integrasi`. Password-nya **di-generate acak oleh script** dan
   ditampilkan **sekali** di terminal; catat **manual oleh owner** di
   tempat yang aman (mis. password manager / n8n Credentials) — **tidak
   pernah ditulis di repo atau dokumen ini**.
   > Script ini **idempoten**: kalau akun role `integrasi` sudah ada, dia
   > berhenti tanpa mengubah apa pun (jadi menjalankannya ulang TIDAK
   > memberi password baru). Kalau passwordnya hilang, jalurnya reset
   > kredensial oleh owner: `POST /api/auth/users/:id/reset`.
2. **Domain production sudah aktif** dan bisa diakses dari internet (tempat
   n8n jalan) — bukan `localhost` devbox. Base URL semua endpoint di
   dokumen ini:
   ```
   https://<domain-production>/api
   ```
   Ganti `<domain-production>` dengan domain production Samsara Backoffice
   yang sesungguhnya. **Jangan hardcode domain devbox/lokal manapun** di
   workflow — kalau n8n dan backend ada di environment berbeda (mis. VPS
   berbeda), pastikan domain production memang bisa diakses dari mesin n8n.
3. **Kredensial akun integrasi sudah disiapkan sebagai n8n Credential**
   (bukan ditulis langsung di node) — lihat § 5.

---

## 4. Struktur workflow n8n

### 4.1 Opsi struktur: workflow terpisah per cadence vs satu workflow bercabang

Ada 2 endpoint dengan cadence **tiap ~1 jam** (`log-penjualan`) dan yang
lain **harian** (`transaksi`, `biaya-platform`, serta `raw-majoo` —
lihat catatan cadence `raw-majoo` di bawah). Ada dua cara menyusun ini di
n8n:

- **Opsi A — workflow terpisah per cadence (REKOMENDASI).** Buat workflow
  sendiri-sendiri, satu per endpoint import (atau minimal satu per
  cadence), masing-masing punya Schedule Trigger sendiri. Total bisa 4
  workflow kecil (satu per endpoint), atau 2 workflow (satu untuk cadence
  per-jam, satu untuk cadence harian yang mengirim ke 3 endpoint sekaligus
  secara berurutan).
- **Opsi B — satu workflow besar dengan percabangan kondisional**
  (mis. node `Switch`/`IF` yang mengecek "jam berapa sekarang" untuk
  menentukan endpoint mana yang dipanggil). Secara teknis bisa, tapi logika
  percabangannya menambah kompleksitas yang tidak perlu.

**Rekomendasi untuk yang baru mulai dengan n8n: pakai Opsi A.** Alasannya:
- Tiap workflow gagal/sukses **sendiri-sendiri** — kalau `import/transaksi`
  gagal, itu tidak memengaruhi eksekusi `import/log-penjualan` yang
  trigger-nya beda jam.
- Log eksekusi n8n ("Executions") jadi lebih mudah dibaca — satu workflow =
  satu tanggung jawab jelas, bukan satu workflow raksasa yang nge-skip
  cabang tertentu tiap kali jalan (bikin bingung saat debug: "ini kok tidak
  kirim apa-apa, error atau memang lagi di cabang yang di-skip?").
- Mengubah jadwal satu endpoint (mis. `log-penjualan` mau dicoba tiap 30
  menit) tidak berisiko mengubah jadwal endpoint lain secara tidak
  sengaja.

Node-by-node di bawah ini menjelaskan **struktur SATU workflow** (ulangi
pola yang sama untuk tiap endpoint/cadence kalau pakai Opsi A).

### 4.2 Cadence per endpoint

| Endpoint | Cadence | Keterangan |
|---|---|---|
| `POST /import/log-penjualan` | **~tiap 1 jam** | Data penjualan real-time per platform (item per baris). |
| `POST /import/transaksi` | **harian** | Rekonsiliasi transaksi per platform (income/fee). |
| `POST /import/raw-majoo` | **harian (asumsi)** | `module.json` modul `sales-sync` tidak menyebutkan cadence eksplisit untuk endpoint ini. Defaultkan ke harian, selaras dengan `import/transaksi` dan `import/biaya-platform`, kecuali ditemukan kebutuhan bisnis spesifik yang mengharuskan lebih sering (mis. kalau API Majoo baru punya endpoint data near-real-time) — **konfirmasi ke owner/Ibnu kalau ternyata perlu lebih sering dari harian.** |
| `POST /import/biaya-platform` | **harian** | Biaya/potongan platform (iklan, komisi, adjustment). |

### 4.3 Node 1 — Trigger terjadwal (Schedule Trigger)

Node pertama tiap workflow: **Schedule Trigger** (bawaan n8n), diatur
sesuai cadence di tabel § 4.2:

- Untuk `log-penjualan`: interval "Every Hour" (atau custom cron
  `0 * * * *` kalau mau tepat di menit ke-0 tiap jam).
- Untuk `transaksi`, `biaya-platform`, `raw-majoo`: interval "Every Day"
  pada jam tertentu — pilih jam yang masuk akal setelah data sumber harian
  sudah tersedia (mis. kalau laporan harian platform baru terbit jam
  23:00–00:00, jangan jadwalkan jam 06:00 karena datanya belum lengkap).
  Jam pasti ini **tergantung kapan sumber data masing-masing platform
  terbit** — di luar scope dokumen ini untuk menentukan jam eksaknya,
  sesuaikan dengan kenyataan di lapangan.

### 4.4 Node 2 — HTTP Request: Login

Node **HTTP Request**, method `POST`, URL:
```
https://<domain-production>/api/auth/login
```

Pengaturan penting:
- **Authentication:** `None` — kredensial dikirim lewat **body**, bukan
  lewat mekanisme auth bawaan node ini.
- **Body Content Type:** JSON
- **Body:**
  ```json
  {
    "username": "{{ $credentials.username }}",
    "password": "{{ $credentials.password }}"
  }
  ```
  (Ambil dari n8n Credential, bukan ditulis literal — lihat § 5.)

Response sukses (`200`) berbentuk:
```json
{
  "token": "<JWT>",
  "user": { "id": "...", "username": "n8n-integrasi", "role": "integrasi", "...": "..." }
}
```
Field yang dipakai di node selanjutnya adalah `token`.

Kalau username/password salah, responnya `401` dengan body
`{ "error": "Username atau password salah" }` — node berikutnya tidak akan
bisa melanjutkan karena tidak ada `token` untuk diambil (lihat § 6 soal
penanganan error ini).

### 4.5 Node 3 — Set/Edit Fields: simpan token

Node **Set** (atau **Edit Fields**, nama di n8n versi baru), ambil field
`token` dari output Node 2 dan simpan sebagai field baru, misalnya
`authToken`:

```
authToken = {{ $json.token }}
```

Node ini murni supaya referensi ke token di node berikutnya lebih singkat
dan jelas (`{{ $('Set').item.json.authToken }}` atau sejenisnya, tergantung
nama node), dibanding harus merujuk balik ke output Node 2 tiap kali.

### 4.6 Node 4 — Sumber data CSV (DI LUAR SCOPE backend Samsara)

Node ini **tidak dijelaskan detail teknisnya di sini** karena sepenuhnya
tergantung dari mana CSV sumbernya didapat secara riil — bisa macam-macam
tergantung platform dan proses operasional Ibnu/tim:

- Google Sheets node (kalau CSV diekspor/disalin ke spreadsheet dulu),
- Read Binary File / FTP / SFTP (kalau file CSV diletakkan di folder
  tertentu),
- Email Trigger + ekstrak attachment (kalau laporan dikirim via email,
  umum untuk laporan harian platform delivery),
- atau kombinasi beberapa node di atas (download, lalu transformasi
  format).

**Tanggung jawab workflow n8n di titik ini: memastikan hasil akhirnya
adalah TEKS CSV MENTAH** (bukan JSON, bukan file biner, bukan hasil
`.toString()` dari objek) **dengan kolom header PERSIS sesuai yang
diharapkan endpoint tujuan.** Setiap endpoint punya ekspektasi kolom yang
berbeda — baca deskripsi lengkapnya di
`modules/sales-sync/module.json` (field `api.endpoints[].description`)
kalau perlu detail persis nama kolom, format tanggal, dan aturan parsing
tiap endpoint:

- `import/log-penjualan`: kolom wajib `transaction_date` (`M/D/YYYY`),
  `transaction_time` (`H:MM`), `platform`, `order_id`, `item_name`,
  `menu_id`, `quantity`, `item_type`, `parent_item`, `unique_key`,
  `inv_status`.
- `import/transaksi`: 13 kolom bernama — `platform`,
  `platform_order_number`, `platform_transaction_id`, `order_time`,
  `settled_time`, `status`, `gross_amount`, `total_fees`, `net_revenue`,
  `currency`, `source`, `source_id`, `raw_payload`. Angka boleh pakai
  pemisah ribuan koma (dibuang otomatis oleh backend).
  **Catatan kompatibilitas sumber:** 2 kolom tanpa nama di akhir header
  file sumber (artefak export spreadsheet) akan diabaikan otomatis — tidak
  perlu dibersihkan dulu di n8n, tapi juga tidak masalah kalau mau
  dibersihkan.
- `import/raw-majoo`: kolom `id` (bilangan bulat, wajib, dipakai sebagai
  primary key apa adanya), kolom waktu berakhiran `Z` (UTC eksplisit),
  angka tanpa pemisah ribuan, `is_paid` berupa `'1'`/`'0'`, kolom
  `hasMore`/`nextPage`/`_empty` dari sumber.
- `import/biaya-platform`: kolom `tanggal_closing` (boleh format
  `YYYY-MM-DD` polos atau dengan offset), `create_time`/`synced_at`
  (nullable), `amount` (boleh desimal/negatif untuk potongan),
  `transaction_type_raw`, dan `id_platform` (boleh kosong untuk baris
  historis tanpa id — baris begini selalu dihitung "dibuat", tidak
  di-dedup).

Kalau kolom yang dikirim tidak sesuai, lihat § 7 soal gejala error `400`.

### 4.7 Node 5 — HTTP Request: Import CSV

Node **HTTP Request**, method `POST`, URL sesuai endpoint tujuan, misalnya:
```
https://<domain-production>/api/sales-sync/import/log-penjualan
```

Pengaturan penting (BEDA dari Node 2):
- **Authentication:** `None` (token dikirim manual lewat header, bukan
  lewat kredensial HTTP bawaan node).
- **Headers:**
  - `Content-Type: text/csv` — **wajib**, tanpa ini backend tidak akan
    memproses body sebagai CSV sama sekali (akan dianggap body kosong,
    gagal validasi dengan pesan "Body wajib berisi teks CSV mentah...").
  - `Authorization: Bearer {{ $('Set').item.json.authToken }}` (sesuaikan
    nama node Set sesuai Node 3).
- **Body:** mode "Raw"/"Text" (bukan JSON, bukan form), isinya teks CSV
  mentah hasil Node 4 — biasanya referensi seperti
  `{{ $('Node 4').item.json.data }}` tergantung bentuk output Node 4.

Response sukses (`200`) berbentuk:
```json
{
  "dibuat": 12,
  "diperbarui": 3,
  "dilewati": 1,
  "errors": [
    { "baris": 7, "pesan": "quantity bukan angka" }
  ]
}
```
Perlu dicatat: response `200` **tidak berarti semua baris sukses** — satu
baris CSV yang gagal diparse (mis. `quantity` bukan angka) tidak
menghentikan baris lain, tapi dicatat di `errors[]` dengan nomor baris dan
pesannya. Ini kenapa Node 6 di bawah disarankan.

### 4.8 Node 6 (opsional, disarankan) — Cek `errors[]` dan beri notifikasi

Tambahkan node **IF** setelah Node 5, mengecek:
```
{{ $json.errors.length > 0 }}
```
Kalau `true`, lanjutkan ke node notifikasi (Email, Slack, Telegram, atau
apa pun yang dipakai tim) berisi ringkasan `errors[]` — supaya ada yang
tahu dan bisa mengecek CSV sumbernya, tanpa harus login ke server dan
mengecek log manual.

Ini **saran, bukan wajib**. Tanpa node ini, baris yang gagal tetap aman
(tidak merusak data lain), hanya saja tidak ada yang diberi tahu secara
aktif kalau ada baris yang terlewat.

---

## 5. Keamanan kredensial

- **Simpan username & password akun `n8n-integrasi` di n8n Credentials
  store** (menu Credentials di n8n, bukan ditulis langsung sebagai teks di
  node HTTP Request manapun). Referensikan lewat `{{ $credentials... }}`
  seperti contoh di § 4.4. Ini supaya kredensial tidak ikut ter-export
  kalau workflow JSON-nya disalin/dibagikan, dan supaya satu tempat saja
  yang perlu diupdate kalau password diganti.
- **Token JWT JANGAN disimpan permanen** (jangan ditulis ke Credential,
  jangan disimpan ke variabel global n8n yang bertahan antar-eksekusi).
  **Selalu login ulang (Node 2) di setiap eksekusi workflow** — jangan
  mengandalkan token dari eksekusi sebelumnya.
  - Alasan teknis: token JWT yang diterbitkan `POST /auth/login` punya
    masa berlaku **12 jam** (`TOKEN_TTL` di `core/src/auth/jwt.ts`). Untuk
    workflow cadence per-jam ini jarang jadi masalah praktis kalaupun
    token disimpan, tapi tetap **tidak disarankan**: kalau token
    kedaluwarsa di tengah eksekusi harian/per-jam, request akan gagal
    `401` padahal masalahnya cuma "lupa login ulang" — login ulang tiap
    eksekusi menghilangkan kelas masalah ini sepenuhnya, dan biayanya
    murah (satu request tambahan per eksekusi).

---

## 6. Troubleshooting dasar

| Gejala | Kemungkinan sebab | Yang harus dicek |
|---|---|---|
| Node 2 (login) gagal `401` | Username/password di n8n Credential salah, atau akun `n8n-integrasi` belum dibuat/sudah di-nonaktifkan. | Cek isi Credential di n8n. Cek dengan owner apakah akun masih aktif, dan pastikan `npm run seed:integrasi -w @samsara/api` sudah pernah dijalankan **di server yang dituju** (bukan cuma di devbox). |
| Node 2 gagal `429` | Terlalu banyak percobaan login gagal berturut-turut, akun kena rate-limit sementara. | Tunggu beberapa menit, cek apakah ada eksekusi lain yang retry login terlalu agresif. |
| Node 5 (import) gagal `403 Forbidden` | **Seharusnya TIDAK terjadi** kalau workflow ini dipakai sesuai desain: sejak 2026-10-16 keempat endpoint import memang mengizinkan role `integrasi` (action `sales_sync.import`), dan ada test otomatis yang menjaganya (`apps/api/src/auth.test.ts`). Penyebab paling mungkin sekarang: URL yang dipanggil ternyata BUKAN salah satu dari 4 endpoint import itu, atau token yang dikirim bukan token dari Node 2 di eksekusi yang sama. | Pastikan URL yang dipanggil benar salah satu dari 4 endpoint import (BUKAN `/sales-sync/proses` — itu memang didesain selalu `403` untuk akun ini, lihat § 2). Pastikan token yang dikirim di header `Authorization` memang token baru dari Node 2 eksekusi yang sama (bukan token basi/salah variabel). Baca pesan error-nya: body `403` selalu menyebut role dan action yang ditolak, mis. `Role "integrasi" tidak punya izin untuk aksi "sales_sync.manage"` — kalau action-nya `sales_sync.manage`, berarti URL-nya memang endpoint non-import. |
| Node 5 gagal `400` | Format CSV tidak sesuai yang diharapkan endpoint — nama kolom salah/hilang, format tanggal salah, `Content-Type` bukan `text/csv`, atau body kosong/bukan string. | Baca ulang deskripsi kolom endpoint tujuan di `modules/sales-sync/module.json`. Cek header `Content-Type: text/csv` benar terpasang di Node 5. Cek output Node 4 benar-benar berupa teks CSV mentah (bukan objek/array hasil parsing sebelum waktunya). |
| Node 5 sukses (`200`) tapi `errors[]` tidak kosong | Sebagian baris CSV gagal diparse, tapi baris lain tetap masuk (ini bukan kegagalan workflow secara keseluruhan). | Lihat Node 6 (§ 4.8) kalau mau notifikasi otomatis. Cocokkan nomor `baris` di `errors[]` dengan isi CSV sumber untuk tahu baris mana yang bermasalah. |
| Data terkirim tapi tidak kelihatan pengaruh ke stok sama sekali | **Ini perilaku yang benar, bukan bug** — lihat § 1 dan § 2. Import CSV cuma mengisi arsip; staf harus membuka halaman Sinkronisasi Penjualan dan menekan "Proses Sinkronisasi" secara manual. | Konfirmasi ke staf ops (Ibnu) apakah langkah manual itu sudah dilakukan. |

---

## 7. Ringkasan cepat (checklist sebelum dianggap "selesai setup")

- [ ] Akun `n8n-integrasi` sudah dibuat (role `integrasi`) lewat
  `npm run seed:integrasi -w @samsara/api` **di server yang dituju**
  (akun di DB dev tidak otomatis ada di production).
- [x] Permission `sales_sync.import`/role `integrasi` sudah ada di
  `modules/sales-sync/module.json` + `router.ts` — selesai 2026-10-16,
  lihat § 2. Tidak perlu dikonfirmasi lagi ke backend developer.
- [ ] Kredensial akun integrasi tersimpan di n8n Credentials, bukan
  hardcode di node.
- [ ] Workflow (atau beberapa workflow) sudah dibuat sesuai cadence § 4.2.
- [ ] Sudah dicoba manual run sekali untuk tiap endpoint, dicek
  `errors[]` di response kosong/sesuai ekspektasi.
- [ ] (Opsional) Notifikasi error sudah disiapkan sesuai § 4.8.
