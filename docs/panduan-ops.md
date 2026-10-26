# Panduan Pakai Backoffice Samsara

Panduan ini untuk tim operasional Samsara (Ibnu dan staf outlet/Central
Kitchen) yang pakai sistem Backoffice sehari-hari. Ditulis dengan bahasa
sederhana — tidak perlu latar belakang IT untuk mengikutinya.

Kalau ada langkah di layar yang tidak persis sama dengan yang ditulis di
sini (tombolnya pindah, ada tampilan baru, dll), kemungkinan sistemnya sudah
diperbarui — laporkan ke yang mengelola sistem supaya panduan ini
disesuaikan lagi.

> Catatan tentang data contoh: di beberapa halaman ada kotak kuning
> bertuliskan "Data contoh". Itu artinya **daftar nama** yang ditampilkan
> (misalnya daftar nama item/menu) diambil dari data referensi yang sudah
> disiapkan, bukan diambil ulang setiap detik dari database. Tapi begitu
> kamu **membuka detail** satu item/menu, atau **menekan tombol
> simpan/kirim** apa pun, itu semua sungguhan langsung ke database — bukan
> pura-pura.

---

## Daftar Isi

1. [Masuk & Keluar (Login/Logout)](#1-masuk--keluar-loginlogout)
2. [Mengenal Peran (Role) Kamu](#2-mengenal-peran-role-kamu)
3. [Halaman Menu & HPP](#3-halaman-menu--hpp)
4. [Halaman Stok](#4-halaman-stok)
5. [Halaman Transaksi](#5-halaman-transaksi)
   - [5.1 Cara input pembelian](#51-cara-input-pembelian)
   - [5.2 Cara input produksi](#52-cara-input-produksi)
   - [5.3 Cara transfer barang dua tahap (kirim & terima)](#53-cara-transfer-barang-dua-tahap-kirim--terima)
   - [5.4 Cara catat waste / mutasi lain](#54-cara-catat-waste--mutasi-lain)
   - [5.5 Cara opname dua tahap (hitung fisik & persetujuan)](#55-cara-opname-dua-tahap-hitung-fisik--persetujuan)
   - [5.6 Cara minta barang ke Central Kitchen (Permintaan)](#56-cara-minta-barang-ke-central-kitchen-permintaan)
6. [Halaman Master](#6-halaman-master)
7. [Halaman Laporan Harian](#7-halaman-laporan-harian)
8. [Halaman Jadwal & Izin](#8-halaman-jadwal--izin)

---

## 1. Masuk & Keluar (Login/Logout)

Buka halaman Backoffice di browser, kamu akan melihat form "Samsara
Backoffice" dengan dua kolom: **Username** dan **Password**. Isi keduanya,
lalu tekan tombol **Masuk**.

Setelah berhasil masuk, kamu akan melihat menu di sisi kiri layar (kalau
pakai komputer/laptop) atau di bagian bawah layar (kalau pakai HP). Menu
yang muncul **beda-beda tergantung peranmu** — dijelaskan di bagian
berikutnya.

Untuk keluar, di komputer/laptop klik nama kamu di pojok kiri bawah lalu
tekan **Keluar**.

Catatan teknis yang perlu kamu tahu (bukan salahmu kalau ini terjadi):
sesi login otomatis berakhir setelah 12 jam, jadi kalau besok masuk lagi
kamu perlu login ulang. Juga, kalau owner menonaktifkan akun seseorang,
orang itu tidak bisa login baru — tapi sesi yang sedang dia pakai saat itu
juga (kalau kebetulan sedang login) tidak langsung terputus otomatis,
paling lama 12 jam baru habis sendiri.

## 2. Mengenal Peran (Role) Kamu

Setiap akun punya satu dari empat peran ini. Peranmu menentukan menu apa
yang muncul dan tombol apa yang bisa kamu tekan:

- **Owner** — akses penuh ke semua halaman dan semua aksi, termasuk yang
  paling sensitif (ubah harga jual, kelola lokasi, setujui hasil hitung
  stok, dll).
- **Manajer Ops** — hampir sama dengan Owner, kecuali tidak bisa mengubah
  harga jual menu dan tidak bisa mengelola pengaturan (lokasi, channel
  penjualan, metode HPP default).
- **Supervisor** — bisa mencatat transaksi sehari-hari (pembelian, produksi,
  penjualan, kirim transfer) tapi **hanya untuk lokasi yang ditugaskan ke
  dia**. Tidak bisa mengubah data master (item/resep/harga jual) dan tidak
  bisa menyetujui hasil opname.
- **Staf** — peran paling terbatas. Bisa lihat stok (lokasi sendiri),
  menerima transfer, mencatat waste/mutasi lain, dan input hitungan fisik
  opname — tapi **tidak bisa** mencatat pembelian/produksi/penjualan, tidak
  bisa mengirim transfer (cuma bisa terima), dan tidak bisa lihat HPP/harga
  beli/margin.

Peran ini ditentukan owner saat akun kamu dibuat. Kalau merasa peranmu
salah atau kamu butuh akses ke lokasi lain, minta owner yang mengubahnya —
tim operasional tidak bisa mengubah peran sendiri.

Ringkasan menu yang muncul per peran, di sisi kiri/bawah layar:

| Menu | Owner | Manajer Ops | Supervisor | Staf |
|---|---|---|---|---|
| Menu & HPP | Ya | Ya | Ya | Ya |
| Stok | Ya | Ya | Ya | Ya |
| Transaksi | Ya | Ya | Ya | Ya |
| Jadwal & Izin | Ya | Ya | Ya | Ya |
| Laporan Harian | Ya | Ya | Ya | Tidak muncul |
| Master | Ya | Ya | Tidak muncul | Tidak muncul |
| Pengaturan | Ya | Tidak muncul | Tidak muncul | Tidak muncul |

(Halaman **Pengaturan** dipakai owner untuk mengatur lokasi, channel
penjualan, dan metode HPP default — di luar cakupan panduan ini karena
jarang dipakai tim operasional sehari-hari.)

---

## 3. Halaman Menu & HPP

### Apa gunanya

Halaman ini untuk melihat daftar menu Samsara (Bubur Polos, Burjo Panas,
paket hemat, dll) beserta **HPP** (harga pokok penjualan — biaya bahan per
porsi) dan **harga jual**-nya. Dari sini juga bisa dihitung **food cost %**
(berapa persen harga jual habis untuk biaya bahan) dan **margin** (selisih
harga jual dikurangi HPP).

### Siapa boleh apa

- **Owner**: bisa lihat semua angka (HPP, food cost %, margin, harga jual),
  bisa mengubah metode perhitungan HPP khusus saat melihat satu menu (lihat
  di bawah), dan **satu-satunya** peran yang boleh mengubah harga jual
  menu.
- **Manajer Ops**: bisa lihat semua angka yang sama seperti Owner, dan juga
  bisa mengubah metode perhitungan HPP saat melihat — tapi **tidak bisa**
  mengubah harga jual.
- **Supervisor & Staf**: bisa buka daftar menu dan lihat **harga jual**-nya
  saja. Kolom HPP per porsi, food cost %, dan margin **tidak akan
  muncul** di layar mereka (bukan disembunyikan di tampilan saja — datanya
  memang tidak dikirim ke akun mereka). Tidak ada tombol ubah harga jual.

### Cara pakai

1. Buka menu **Menu & HPP** di sisi kiri/bawah layar.
2. Ketik nama menu, kategori, atau kode di kotak pencarian (misalnya ketik
   "Bubur" untuk mencari semua menu Bubur) — daftar di bawahnya otomatis
   menyaring.
3. Tekan salah satu menu di daftar, misalnya **Bubur Polos**, untuk membuka
   detailnya. Sebuah panel akan muncul menampilkan HPP per porsi (kalau
   kamu Owner/Manajer Ops), harga jual, food cost %, dan margin.
4. **Khusus Owner/Manajer Ops**: di bagian atas panel ada pilihan "Metode
   HPP (khusus tampilan ini)" — defaultnya "Default sistem". Kamu bisa
   ganti sementara ke "Harga Master" (harga standar yang stabil) atau
   "Harga Beli Terakhir" (mengikuti harga pembelian paling baru) hanya
   untuk melihat perbandingan; ini tidak mengubah pengaturan permanen
   sistem.
5. **Khusus Owner**: di bagian bawah panel ada kotak "Ubah harga jual" —
   isi angka baru lalu tekan **Simpan harga jual**. Food cost % dan margin
   akan langsung dihitung ulang begitu tersimpan.
6. Tutup panel dengan menekan tanda **✕** di pojok kanan atas, atau
   klik di luar panel.

---

## 4. Halaman Stok

### Apa gunanya

Halaman ini menampilkan **stok saat ini** untuk setiap item (bahan baku,
kemasan, hasil produksi, dll) di setiap lokasi — supaya kamu bisa cek stok
mana yang habis atau menipis tanpa harus buka form transaksi dulu. Ada juga
bagian khusus untuk melihat **transfer yang masih dalam perjalanan**
(barang sudah dikirim tapi belum dikonfirmasi diterima).

### Siapa boleh apa

- **Owner & Manajer Ops**: bisa melihat stok **semua lokasi** (Samsara
  Central Kitchen dan Samsara Outlet 1 Malang, atau lokasi lain kalau
  nanti ditambah).
- **Supervisor & Staf**: hanya bisa melihat stok **lokasi yang ditugaskan
  ke akun mereka**. Kalau akunnya cuma ditugaskan ke Samsara Outlet 1
  Malang, filter lokasi di halaman ini otomatis hanya menampilkan pilihan
  itu — tidak bisa mengintip stok lokasi lain.

### Cara pakai

1. Buka menu **Stok**. Begitu halaman terbuka, tabel stok langsung tampil
   berisi semua item di lokasi yang bisa kamu lihat — tidak perlu mencari
   dulu.
2. Gunakan kotak **"Cari nama, kode, atau kategori item..."** untuk
   mempersempit tabel (misalnya ketik "Gula pasir").
3. Ada tiga filter tambahan di atas tabel:
   - **Lokasi** — pilih satu lokasi tertentu atau "Semua lokasi".
   - **Entitas** — pengelompokan internal (Central Kitchen vs Outlet),
     bisa dibiarkan "Semua entitas".
   - **Status** — pilih "Habis saja", "Menipis saja", atau "Aman saja"
     kalau mau fokus ke item yang bermasalah dulu.
4. Setiap baris menampilkan nama item, kode, kategori, lokasi, dan angka
   stok saat ini di satuan resepnya (gram, pcs, dll). Baris dengan status
   **Habis** ditandai merah dan **Menipis** ditandai kuning, kalau item itu
   sudah punya angka "stok minimum" yang diisi di Master.
   
   Catatan jujur: sampai dokumen ini ditulis, kolom "stok minimum" belum
   pernah diisi untuk item mana pun, jadi status "Menipis" belum akan
   muncul sampai ada yang mengisinya lewat halaman Master.
5. Di bagian bawah ada kartu **"Transfer dalam perjalanan"**. Pilih lokasi
   di kotak "Lokasi tujuan (lokasi saya)", lalu lihat dua daftar: barang
   yang **keluar** dari lokasi itu (sudah dikirim, menunggu diterima di
   tempat lain) dan barang yang **masuk** ke lokasi itu (dikirim dari
   tempat lain, menunggu kamu terima). Ini murni untuk memantau — proses
   menerimanya dilakukan di halaman Transaksi (lihat bagian 5.3).

---

## 5. Halaman Transaksi

### Apa gunanya

Semua perubahan stok **wajib** lewat halaman ini — stok tidak pernah
diedit langsung di halaman Stok atau Master. Ada 6 jenis transaksi,
ditampilkan sebagai tab: **Pembelian**, **Produksi**, **Penjualan**,
**Transfer**, **Mutasi Lain**, **Opname**.

### Siapa boleh apa

- **Tab Pembelian, Produksi, Penjualan** — hanya muncul untuk **Owner,
  Manajer Ops, dan Supervisor**. Staf tidak akan melihat tab-tab ini sama
  sekali. Supervisor hanya bisa mencatat untuk lokasi yang ditugaskan ke
  dia; Owner/Manajer Ops bisa untuk lokasi mana pun.
- **Tab Transfer**:
  - Sub-tab **Kirim** hanya muncul untuk Owner, Manajer Ops, Supervisor
    (Supervisor hanya boleh mengirim dari lokasi sendiri). **Staf tidak
    bisa mengirim transfer sama sekali** — sub-tab Kirim tidak akan
    muncul untuknya.
  - Sub-tab **Terima** muncul untuk **semua peran termasuk Staf** — tapi
    tetap dibatasi ke lokasi yang ditugaskan ke akun itu.
- **Tab Mutasi Lain** — semua peran (Owner, Manajer Ops, Supervisor, Staf)
  boleh mencatat, dibatasi ke lokasi sendiri untuk Supervisor/Staf.
- **Tab Opname**:
  - Sub-tab **Input Hitungan** — semua peran boleh, dibatasi lokasi
    sendiri untuk Supervisor/Staf.
  - Sub-tab **Persetujuan** hanya muncul untuk **Owner dan Manajer Ops**.
    Supervisor dan Staf tidak bisa menyetujui/menolak hasil opname sama
    sekali — sub-tab ini tidak akan tampil untuk mereka.
- **Tab Permintaan ke CK** — semua peran (Owner, Manajer Ops, Supervisor,
  Staf) boleh mengajukan permintaan, dibatasi ke lokasi sendiri untuk
  Supervisor/Staf. Sub-bagian "Permintaan Masuk (CK)" hanya muncul kalau
  akunmu ditugaskan ke lokasi Central Kitchen — dan tombol **Penuhi
  permintaan** di dalamnya cuma muncul untuk Owner, Manajer Ops, dan
  Supervisor (Staf tetap bisa melihat daftar permintaan masuk kalau
  ditugaskan ke CK, tapi tidak ada tombol untuk memenuhinya — konsisten
  dengan aturan "Staf tidak bisa mengirim transfer" di atas).

### 5.1 Cara input pembelian

**Skenario**: Samsara Central Kitchen baru saja menerima kiriman **Gula
pasir** 20 kg dari vendor "CV Sumber Pangan", harga Rp17.500/kg. Perlu
dicatat supaya stok Gula pasir di Central Kitchen bertambah.

1. Buka menu **Transaksi**, lalu pilih tab **Pembelian**.
2. Di kotak **Lokasi**, pilih **Samsara Central Kitchen**.
3. Di kotak **Vendor**, pilih vendor yang mengirim barangnya (mis. "CV
   Sumber Pangan"). **Vendor wajib dipilih** — pembelian tidak bisa
   disimpan tanpa vendor. Kalau belinya dadakan di warung/pasar (bukan
   vendor langganan), pilih **"Pembelian Umum (pasar/warung)"**, bukan
   dikosongkan.
   - Belum ada di daftar vendor? Pilih **"+ Vendor baru..."** di paling
     bawah dropdown (cuma muncul untuk Owner/Manajer Ops) — isi nama,
     telepon, dan termin pembayaran (semuanya opsional kecuali nama),
     lalu tekan **Simpan vendor**. Vendor baru langsung terpilih,
     lanjutkan ke langkah berikutnya.
4. (Opsional) Isi **No. referensi** kalau ada nomor nota dari vendor.
5. Isi **Tanggal** pembelian (defaultnya sudah terisi tanggal hari ini).
6. Di kotak **"Tambah item"**, ketik "Gula" lalu klik **Gula pasir** dari
   daftar yang muncul. Baris baru akan muncul di bawah untuk item ini.
   Kalau vendor ini pernah tercatat menjual Gula pasir sebelumnya, kolom
   **Harga/satuan** otomatis terisi harga terakhirnya — tinggal dicek,
   boleh diubah kalau harga sekarang beda.
7. Isi tiga kolom di baris Gula pasir:
   - **Qty beli**: `20`
   - **Satuan beli**: sudah otomatis terisi `kg` (satuan beli item ini),
     bisa diubah kalau perlu.
   - **Harga/satuan**: `17500`
   - Kalau harga yang diisi naik lebih dari ambang tertentu (default 10%)
     dibanding harga terakhir vendor ini, muncul peringatan kuning di
     bawah baris itu — **bukan larangan**, cuma pengingat supaya dicek
     ulang sebelum disimpan (mungkin salah ketik, atau memang harga
     vendor sedang naik).
8. Tekan tombol **Simpan pembelian** di paling bawah.
9. Kalau berhasil, akan muncul kotak hijau "Pembelian #... tersimpan --
   1 baris item, stok bertambah sesuai konversi ke satuan resep." Stok
   Gula pasir di Samsara Central Kitchen otomatis bertambah — sistem yang
   menghitung sendiri konversi dari kg (satuan beli) ke gram (satuan
   resep Gula pasir), kamu tidak perlu menghitung manual. Kalau ada baris
   yang harganya naik di atas ambang, ringkasannya muncul lagi di sini
   (kotak kuning) setelah tersimpan.

Kamu bisa menambahkan lebih dari satu item dalam satu pembelian yang sama
(misalnya sekalian catat Kecap dan Minyak dari kiriman yang sama) — cukup
ulangi langkah 6–7 untuk tiap item sebelum menekan Simpan.

**Kenapa vendor sekarang wajib?** Supaya harga beli tiap item bisa
dilacak per vendor dari waktu ke waktu (harga terakhir, riwayat harga,
pembanding antar vendor) — lihat § 6 "Tab Vendor" di bawah. Sebelum
perubahan ini pembelian cuma punya kolom "Supplier" teks bebas yang tidak
tersambung ke mana-mana; kolom itu sekarang **sudah dihapus** dari form
(pembelian lama yang masih punya catatan supplier teks tetap bisa dilihat
di Laporan Harian, ditandai "Supplier (lama)").

### 5.2 Cara input produksi

**Skenario**: Samsara Central Kitchen membuat 1 batch **Kuah bubur**
(resep RP-002) untuk stok hari ini, dan hasil aktualnya sedikit berbeda
dari target di atas kertas.

1. Buka menu **Transaksi**, pilih tab **Produksi**.
2. Di kotak **Lokasi produksi**, pilih **Samsara Central Kitchen**.
3. Di kotak **Resep produksi**, pilih **RP-002 -- Kuah bubur**. Di bawahnya
   akan muncul keterangan "1 batch resep ini menghasilkan 2500 gr Kuah
   bubur (yield teoretis)" — ini target di atas kertas, bukan hasil
   sungguhan.
4. Isi **Qty batch**: `1` (kalau mau bikin dua batch sekaligus, isi `2`,
   dst).
5. Isi **Hasil aktual (gr)**: masukkan angka gram Kuah bubur yang
   *benar-benar* jadi setelah dimasak — misalnya `2450` kalau ternyata
   sedikit menyusut dari target 2500 gr. Angka inilah yang benar-benar
   masuk ke stok, bukan angka target.
6. Isi **Tanggal** produksi.
7. Tekan **Simpan produksi**.
8. Hasilnya muncul: "Produksi #... tersimpan. Yield teoretis: 2500.
   Selisih vs aktual: -50." — artinya sistem mencatat bahwa hasil produksi
   ini 50 gr lebih sedikit dari target. Di belakang layar, sistem otomatis
   mengurangi stok semua bahan resep RP-002 (susu evaporasi, minyak,
   kunyit bubuk, bumbu kare, masako, garam, air) sesuai qty batch, dan
   menambah stok Kuah bubur di Samsara Central Kitchen sebesar hasil
   aktual (2450 gr) — bukan sebesar target teoretis.

### 5.3 Cara transfer barang dua tahap (kirim & terima)

**Skenario**: Samsara Central Kitchen mengirim persediaan **Bubur** 5 kg
ke **Samsara Outlet 1 Malang** untuk stok hari ini.

**Kenapa dua tahap, dan apa arti "dalam perjalanan":**
Transfer di sistem ini **selalu** dua langkah terpisah, biasanya dilakukan
dua orang berbeda di dua waktu berbeda: (1) orang di lokasi asal menekan
**Kirim**, dan (2) orang di lokasi tujuan menekan **Terima** — bisa nanti,
bisa besok, tidak harus langsung. Begitu langkah "Kirim" ditekan, stok di
lokasi asal **langsung berkurang** — tapi barang itu **belum masuk ke
stok lokasi tujuan mana pun**. Statusnya "dalam perjalanan": sudah keluar
dari asal, belum tercatat di tujuan. Barang baru benar-benar masuk ke
stok tujuan setelah ada orang di lokasi tujuan yang menekan "Terima".

Ini disengaja, bukan bug: dengan cara ini, kalau qty yang dikirim ternyata
tidak sama dengan qty yang benar-benar sampai (ada yang tumpah, hilang,
atau salah hitung di jalan), selisihnya — disebut **susut** — otomatis
tercatat saat langkah "Terima", bukan diam-diam hilang. Ini juga jadi
bentuk pertanggungjawaban: jelas siapa yang mengirim dan berapa, dan jelas
siapa yang mengonfirmasi terima dan berapa yang benar-benar sampai.

**Tahap 1 — Kirim (dilakukan di Samsara Central Kitchen):**

1. Buka menu **Transaksi**, pilih tab **Transfer**, pastikan sub-tab
   **Kirim** aktif (hanya muncul kalau peranmu Owner/Manajer Ops/
   Supervisor).
2. Di kotak **Lokasi asal**, pilih **Samsara Central Kitchen**.
3. Di kotak **Lokasi tujuan**, pilih **Samsara Outlet 1 Malang**.
4. Isi **Tanggal**.
5. Di **"Tambah item"**, cari dan pilih **Bubur**.
6. Isi kolom di baris Bubur:
   - **Qty kirim**: `5000` (satuan resep Bubur adalah gram, jadi 5 kg =
     5000 gr).
   - **Satuan**: sudah otomatis terisi `gr`.
   - **Harga transfer (opsional)**: boleh dikosongkan — kalau kosong,
     sistem otomatis memakai HPP Bubur di Central Kitchen sebagai harga
     transfer (ini dipakai untuk pembukuan internal antar cost-center,
     bukan sesuatu yang perlu dihitung manual olehmu).
7. Tekan **Kirim transfer**.
8. Muncul konfirmasi: "Transfer #... dikirim -- stok lokasi asal sudah
   berkurang, menunggu diterima di tujuan." Stok Bubur di Samsara Central
   Kitchen langsung berkurang 5000 gr saat ini juga.

**Tahap 2 — Terima (dilakukan di Samsara Outlet 1 Malang, bisa oleh orang
lain, bisa hari lain):**

1. Buka menu **Transaksi**, pilih tab **Transfer**, pilih sub-tab
   **Terima** (tab ini muncul untuk semua peran).
2. Di kotak **Lokasi tujuan (lokasi saya)**, pilih **Samsara Outlet 1
   Malang**.
3. Akan muncul daftar transfer yang sedang menunggu diterima di lokasi
   ini. Cari dan tekan **Transfer #... — Dari Samsara Central Kitchen**.
4. Untuk setiap item di transfer itu (di sini: Bubur), kamu akan melihat
   dua kolom: **Qty dikirim** (terkunci, tidak bisa diubah — menampilkan
   angka yang dikirim di Tahap 1, yaitu 5000 gr) dan **Qty diterima**
   (bisa diisi/diubah). Kolom Qty diterima sudah otomatis terisi sama
   dengan qty dikirim sebagai default — **ubah angkanya kalau yang
   benar-benar diterima berbeda**, misalnya isi `4950` kalau ada yang
   tumpah 50 gr di perjalanan.
5. Tekan **Konfirmasi terima**.
6. Muncul hasil: "Transfer #... diterima. Susut per item: BB-001
   (50)." — susut (selisih qty kirim dikurangi qty terima) tercatat
   otomatis. Stok Bubur di Samsara Outlet 1 Malang sekarang bertambah
   sebesar qty yang benar-benar diterima (4950 gr), bukan qty yang
   dikirim.

Catatan penting: transfer yang sudah ditekan "Terima" **tidak bisa
diterima ulang atau dibatalkan** dari layar ini. Kalau ternyata salah
input, perbaikannya lewat **Mutasi Lain** (lihat bagian 5.4) untuk
mengoreksi stok secara manual, dengan alasan yang jelas.

### 5.4 Cara catat waste / mutasi lain

**Skenario**: di **Samsara Outlet 1 Malang**, satu Paper Bowl 650 ml berisi
Bubur Polos tumpah dan tidak bisa dijual. Perlu dicatat sebagai kerugian
supaya stok Bubur dan Paper Bowl tetap akurat — bukan lewat transaksi
Penjualan (karena memang tidak terjual).

1. Buka menu **Transaksi**, pilih tab **Mutasi Lain** (muncul untuk semua
   peran).
2. Pilih **Lokasi**: **Samsara Outlet 1 Malang**.
3. Isi **Alasan** — wajib diisi, contoh: `Bubur Polos tumpah saat servis`.
4. Isi **Tanggal**.
5. Di **"Tambah item"**, cari dan pilih item yang berkurang. Kalau mau
   mencatat rugi bahan mentahnya langsung, tambahkan misalnya **Bubur**
   dan **Paper Bowl 650 ml + tutup**.
6. Untuk tiap item, isi kolom qty dengan **angka negatif** untuk
   mengurangi stok (misalnya `-300` untuk Bubur kalau porsi itu berisi
   300 gr, `-1` untuk Paper Bowl). Kolom ini juga bisa diisi angka positif
   kalau suatu saat kamu perlu **menambah** stok secara manual (misalnya
   koreksi setelah salah catat sebelumnya) — bukan cuma untuk kerugian.
7. Tekan **Simpan mutasi**.
8. Muncul konfirmasi "Mutasi lain #... tersimpan." Stok item-item itu di
   Samsara Outlet 1 Malang langsung disesuaikan sesuai angka yang diisi.

Mutasi Lain ini juga jalur yang dipakai kalau perlu **membatalkan/
mengoreksi** transaksi lain yang sudah kadung disimpan (misalnya transfer
yang salah terima) — karena tidak ada tombol "hapus transaksi" di sistem
ini untuk jenis apa pun, semua koreksi harus lewat pencatatan baru yang
alasannya jelas, supaya riwayatnya tetap lengkap dan bisa ditelusuri.

### 5.5 Cara opname dua tahap (hitung fisik & persetujuan)

**Skenario**: setiap periode tertentu, tim di **Samsara Outlet 1 Malang**
menghitung fisik stok yang ada di outlet, dan ternyata angkanya beda dari
yang dicatat sistem — misalnya sistem mencatat stok Gula pasir 4000 gr,
tapi hasil hitung fisik cuma 3800 gr.

**Kenapa harus dua tahap:** siapa pun yang menghitung (termasuk Staf) bisa
salah — salah timbang, salah hitung, atau kelewatan satu tempat
penyimpanan. Kalau hasil hitungan langsung mengubah angka stok resmi tanpa
ada yang mengecek, satu kesalahan hitung bisa langsung merusak catatan
stok tanpa ada yang sadar. Karena itu, hasil hitung fisik selalu masuk
sebagai **draft** dulu — stok sistem belum berubah sama sekali — dan baru
benar-benar mengubah angka stok setelah **Owner atau Manajer Ops**
meninjau dan menyetujuinya secara terpisah. Ini seperti mekanisme
"empat mata" (dua orang berbeda) sebelum angka stok resmi berubah.

**Tahap 1 — Input Hitungan (bisa dilakukan siapa saja, termasuk Staf, di
Samsara Outlet 1 Malang):**

1. Buka menu **Transaksi**, pilih tab **Opname**, pastikan sub-tab
   **Input Hitungan** aktif.
2. Perhatikan catatan kecil di atas form: "Status masih **draft** -- stok
   BELUM berubah sampai owner/manajer ops menyetujui di tab Persetujuan."
3. Pilih **Lokasi**: **Samsara Outlet 1 Malang**.
4. Isi **Tanggal** penghitungan.
5. Di **"Tambah item"**, cari dan pilih item yang dihitung, misalnya
   **Gula pasir**.
6. Isi qty hasil hitung fisik yang sebenarnya di lapangan, misalnya
   `3800` (gram).
7. Ulangi langkah 5–6 untuk item lain yang ikut dihitung dalam sesi opname
   ini.
8. Tekan **Simpan sebagai draft**.
9. Muncul hasil: "Opname #... tersimpan sebagai draft. Selisih: BB-039
   (-200). Sampaikan nomor draft ini ke owner/manajer ops untuk
   disetujui." Catat atau screenshot nomor opname ini (misalnya "Opname
   #12") untuk disampaikan ke Owner/Manajer Ops. Stok Gula pasir di
   sistem **belum berubah** sama sekali pada tahap ini.

**Tahap 2 — Persetujuan (hanya Owner/Manajer Ops):**

1. Buka menu **Transaksi**, pilih tab **Opname**, pilih sub-tab
   **Persetujuan** (hanya muncul untuk Owner/Manajer Ops).
2. Akan tampil daftar semua opname berstatus draft yang menunggu
   keputusan, dari semua lokasi. Cari dan tekan opname yang dimaksud,
   misalnya **Opname #12** dari Samsara Outlet 1 Malang.
3. Akan tampil rincian tiap item: "Gula pasir — sistem 4000 → fisik 3800
   (-200)" — bandingkan dengan kondisi sebenarnya kalau perlu cek ulang.
4. Ada dua tombol:
   - **Setujui** — kalau hasil hitungnya benar. Stok sistem langsung
     dikoreksi mengikuti hasil hitung fisik (Gula pasir jadi 3800 gr).
   - **Tolak** — kalau hasil hitungnya diragukan/salah (misalnya salah
     timbang). Stok sistem **tidak berubah sama sekali**, draft ini
     ditandai ditolak.
5. Setelah ditekan salah satu, muncul konfirmasi hasilnya, dan draft itu
   otomatis hilang dari daftar "Persetujuan" (sudah diputuskan, tidak bisa
   diputuskan ulang).

### 5.6 Cara minta barang ke Central Kitchen (Permintaan)

### Apa gunanya

Tab **Permintaan ke CK** ini untuk outlet yang butuh barang dari Central
Kitchen tapi belum siap mengirim sendiri (beda dari tab **Transfer** di
bagian 5.3, yang langsung memindahkan stok). Di sini outlet cukup
**mengajukan permintaan** — belum ada stok yang berpindah sama sekali.
Central Kitchen yang nanti melihat permintaan itu dan memenuhinya lewat
proses kirim transfer (sama seperti 5.3, tapi lebih cepat karena
form-nya sudah terisi otomatis dari permintaannya).

Tab ini punya dua sub-tab: **Ajukan** (buat permintaan baru + lihat
riwayat permintaanmu sendiri) dan **Permintaan Masuk (CK)** (khusus kalau
akunmu ditugaskan ke lokasi Central Kitchen — untuk melihat & memenuhi
permintaan yang masuk dari outlet-outlet).

**Skenario**: Samsara Outlet 1 Malang kehabisan **Bubur** menjelang sore
dan butuh kiriman tambahan besok pagi.

**Bagian 1 — Ajukan permintaan (dari Samsara Outlet 1 Malang):**

1. Buka menu **Transaksi**, pilih tab **Permintaan ke CK**, pastikan
   sub-tab **Ajukan** aktif.
2. Di kotak **"Minta dari (Central Kitchen)"**, pilih Central Kitchen
   tujuan permintaan (kalau cuma ada satu CK, biasanya sudah terpilih
   otomatis).
3. Kotak **"Untuk lokasi (outlet saya)"** biasanya sudah otomatis terisi
   lokasimu sendiri (kalau akunmu cuma ditugaskan ke satu lokasi, kotak
   ini terkunci, tidak bisa diubah).
4. Isi **Tanggal dibutuhkan**.
5. Di **"Tambah item"**, cari dan pilih **Bubur**. Isi kolom **Qty**
   dengan jumlah yang dibutuhkan. Bisa menambah lebih dari satu item
   sebelum mengirim.
6. (Opsional) Isi **Catatan**, misalnya "butuh sebelum jam makan siang".
7. Tekan **Ajukan permintaan**.
8. Muncul konfirmasi "Permintaan berhasil diajukan: PT-..." — belum ada
   stok yang berpindah, ini baru permintaan. Central Kitchen akan melihat
   permintaan ini di sub-tab "Permintaan Masuk (CK)" mereka dan mengirim
   barangnya lewat transfer.
9. Di bawah form ada **"Riwayat permintaan saya"** — menampilkan semua
   permintaan yang pernah diajukan dari lokasimu, dengan status
   (**Diminta**, **Dipenuhi**, atau **Dibatalkan**). Permintaan yang
   masih berstatus **Diminta** punya tombol **Batalkan permintaan** kalau
   ternyata tidak dibutuhkan lagi — permintaan yang sudah **Dipenuhi**
   atau **Dibatalkan** tidak bisa dibatalkan lagi (tombolnya hilang).

**Bagian 2 — Penuhi permintaan (dari Samsara Central Kitchen, hanya Owner/
Manajer Ops/Supervisor):**

1. Buka menu **Transaksi**, pilih tab **Permintaan ke CK**, pilih sub-tab
   **Permintaan Masuk (CK)** (hanya muncul kalau akunmu ditugaskan ke
   lokasi Central Kitchen).
2. Di kotak **Status**, defaultnya sudah "Menunggu dipenuhi" — daftar di
   bawahnya menampilkan semua permintaan dari outlet yang belum
   ditindaklanjuti, termasuk siapa yang mengajukan.
3. Cari permintaan **Bubur** dari Samsara Outlet 1 Malang, lalu tekan
   **Penuhi permintaan**.
4. Akan muncul form kirim yang sebagian sudah otomatis terisi: **Qty
   kirim** (default sama dengan qty yang diminta, bisa diubah kalau mau
   mengirim jumlah berbeda), **Satuan**, dan **Harga transfer per satuan**
   (opsional — kalau dikosongkan, sistem otomatis memakai HPP Bubur di
   Central Kitchen, sama seperti transfer biasa di 5.3).
5. Tekan **Kirim transfer**.
6. Muncul konfirmasi "Transfer #... dikirim untuk memenuhi permintaan
   PT-...". Di belakang layar ini **persis sama** dengan transfer Tahap 1
   (Kirim) di bagian 5.3 — stok Bubur di Central Kitchen langsung
   berkurang, tapi **belum masuk ke stok Samsara Outlet 1 Malang** sampai
   ada yang menekan **Terima** di tab Transfer (lihat 5.3 Tahap 2). Status
   permintaan otomatis berubah jadi **Dipenuhi**.

Catatan: siapa pun boleh mengajukan permintaan (termasuk Staf), tapi
**memenuhi** permintaan (mengirim barangnya) tetap mengikuti aturan yang
sama seperti transfer biasa — Staf tidak bisa melakukannya, walaupun dia
ditugaskan ke Central Kitchen dan bisa melihat daftar permintaan masuk.

---

## 6. Halaman Master

### Apa gunanya

Halaman ini untuk mengelola **data induk**: daftar item (bahan baku,
kemasan, hasil produksi), resep produksi (misalnya cara bikin Kuah bubur
dari bahan-bahannya), dan resep menu (bahan apa saja yang dipakai satu
menu, misalnya isi lengkap Bubur Polos). Ini beda dari halaman Transaksi —
di sini kamu mengatur "definisi"-nya (nama item, harga standar, komposisi
resep), bukan mencatat kejadian harian (beli/produksi/jual).

### Siapa boleh apa

Halaman **Master** hanya muncul di menu untuk **Owner dan Manajer Ops**.
**Supervisor dan Staf tidak bisa membuka halaman ini sama sekali** — baik
untuk menambah item baru, mengubah resep, maupun menonaktifkan sesuatu.
Antara Owner dan Manajer Ops sendiri tidak ada perbedaan akses di halaman
ini — keduanya punya hak yang sama untuk mengelola item, resep, dan
vendor (bedanya baru muncul di halaman Menu & HPP soal siapa boleh ubah
harga jual, dan di halaman Pengaturan yang khusus Owner).

Pengecualian untuk **data Vendor**: Supervisor memang tidak bisa membuka
halaman Master sama sekali, tapi tetap bisa **memilih** vendor dari
dropdown saat input Pembelian (§ 5.1) — dia cuma tidak bisa menambah atau
mengubah data vendor itu sendiri (tidak muncul opsi "+ Vendor baru..." di
dropdown-nya, beda dari Owner/Manajer Ops yang melihat opsi itu).

### Cara pakai (ringkas)

Halaman ini punya 4 tab: **Item**, **Resep Produksi**, **Resep Menu**,
**Vendor**.

- **Tab Item**: menampilkan daftar semua item. Tekan **+ Item** untuk
  menambah item baru (wajib isi Kode unik seperti `BB-058`, Nama yang
  harus unik juga, Tipe — bahan_baku/packaging/operasional/setengah_jadi,
  dan Satuan resep; boleh mengosongkan Satuan beli/Konversi/Harga master
  kalau datanya belum lengkap — item itu otomatis berstatus "Menunggu
  data" dan tidak akan menghalangi bagian lain sistem berjalan). Tekan
  satu item di daftar untuk mengubah data atau menonaktifkannya (item yang
  masih dipakai di resep/menu aktif akan ditolak dinonaktifkan, sistem
  akan menyebutkan resep/menu mana saja yang masih memakainya).
- **Tab Resep Produksi**: kelola resep seperti RP-002 (Kuah bubur) —
  tambah resep baru atau ubah daftar bahan & jumlahnya. Aturan penting:
  bahan di resep produksi **hanya boleh** bahan baku atau kemasan, tidak
  boleh memakai hasil produksi lain — sistem akan menolak otomatis kalau
  dicoba.
- **Tab Resep Menu**: kelola bahan yang dipakai satu menu (misalnya isi
  lengkap Bubur Polos: Bubur, Kertas thermal, Paper Bowl, dst). Berbeda
  dari resep produksi, resep menu **boleh** memakai hasil produksi (mis.
  Kuah bubur, Chili oil) selain bahan baku/kemasan/operasional. Mengubah
  resep menu di sini langsung memengaruhi perhitungan HPP menu itu di
  halaman Menu & HPP.
- **Tab Vendor**: daftar vendor/supplier langganan. Tekan **+ Tambah
  vendor** untuk menambah vendor baru (nama wajib unik, kontak/telepon/
  alamat/termin pembayaran opsional). Tekan **Lihat katalog** di satu
  vendor untuk melihat/mencatat harga item yang pernah dibeli darinya —
  tiap kali harga dicatat (manual di sini, atau otomatis lewat Pembelian),
  riwayatnya tersimpan dan bisa dilihat, tidak pernah ditimpa. Harga di
  tab ini **disembunyikan** untuk role yang tidak boleh melihat harga/HPP
  (Supervisor dan Staf tidak punya akses ke halaman ini sama sekali,
  jadi ini relevan kalau suatu saat aksesnya diperluas). Di bagian bawah
  ada kartu **"Teks supplier lama (belum jadi vendor)"** — daftar nama
  supplier teks bebas dari pembelian SEBELUM vendor diwajibkan, murni
  untuk ditinjau manual; sistem **tidak pernah** menggabungkannya otomatis
  ke vendor manapun karena nama yang mirip belum tentu vendor yang sama.

Kategori dan satuan yang muncul di dropdown form Item sudah diambil dari
daftar master sungguhan (bukan data contoh) — kalau nilai yang kamu
butuhkan belum ada di pilihan, ada opsi "+ Tambah baru..." langsung di
dalam dropdown-nya.

---

## 7. Halaman Laporan Harian

### Apa gunanya

Halaman ini menampilkan **ringkasan satu lokasi pada satu tanggal** dalam
satu layar — supaya tidak perlu buka tab Transaksi satu per satu untuk
tahu apa saja yang terjadi hari itu. Ada 4 bagian:

- **Keluar (menu terjual)** — ringkasan menu yang terjual pada tanggal
  itu, dijumlah per menu.
- **Masuk (pembelian)** — barang yang dibeli pada tanggal itu, lengkap
  dengan nama **vendor** dan harga per satuan. Untuk pembelian lama dari
  sebelum vendor diwajibkan (lihat § 5.1), di sini tampil
  **"Supplier (lama): ..."** memakai catatan teks lama itu, bukan nama
  vendor — murni supaya data lama tetap kebaca, bukan berarti vendornya
  bisa dipilih ulang untuk pembelian baru.
- **Permintaan ke CK** — permintaan transfer yang diajukan lokasi itu ke
  Central Kitchen pada tanggal itu (lihat bagian 5.6), dengan status
  Menunggu dipenuhi/Dipenuhi/Dibatalkan.
- **Perlu Dibeli (Central Kitchen)** — item di Central Kitchen yang
  stoknya **sekarang** sudah di bawah stok minimum. **Bagian ini beda
  dari tiga yang lain**: isinya selalu kondisi Central Kitchen *saat
  halaman dibuka*, tidak terikat ke lokasi/tanggal yang kamu pilih di
  atas (meskipun kamu sedang melihat laporan outlet lain tanggal
  kemarin, bagian ini tetap menunjukkan kondisi CK hari ini).

### Siapa boleh apa

- **Owner, Manajer Ops, Supervisor** — bisa membuka halaman ini. Owner
  dan Manajer Ops bisa memilih lokasi mana pun; Supervisor hanya bisa
  memilih lokasi yang ditugaskan ke akunnya.
- **Staf** — **tidak bisa membuka halaman ini sama sekali**. Menu
  "Laporan Harian" tidak akan muncul di sisi kiri/bawah layar untuk akun
  Staf.

### Cara pakai

1. Buka menu **Laporan Harian**.
2. Di kotak **Lokasi**, pilih lokasi yang mau dilihat (kalau akunmu cuma
   ditugaskan ke satu lokasi, otomatis cuma itu pilihannya).
3. Di kotak **Tanggal**, pilih tanggal yang mau dilihat (defaultnya
   tanggal hari ini).
4. Keempat kartu di bawahnya otomatis memuat ulang begitu lokasi/tanggal
   diganti — tidak perlu tombol "Cari" terpisah.
5. Kalau salah satu bagian kosong (misalnya belum ada penjualan tercatat
   pada tanggal itu), akan muncul pesan "Belum ada ... tercatat pada
   tanggal ini" — bukan error, memang belum ada datanya.
6. Kartu **"Perlu Dibeli (Central Kitchen)"** menandai item dengan warna
   **kuning** (stok menipis tapi belum nol) atau **merah** (stok sudah 0
   atau negatif) dan menunjukkan selisihnya dari stok minimum. Kalau
   kartu ini menunjukkan "Tidak ada item yang stoknya di bawah minimum
   saat ini. Aman." — berarti memang belum ada yang perlu dibeli menurut
   sistem.

## 8. Halaman Jadwal & Izin

### Apa gunanya

Halaman ini punya dua tab: **Jadwal** (jadwal shift tim per lokasi per
tanggal) dan **Pengajuan Libur** (staf mengajukan libur, owner/manajer
ops menyetujui atau menolak).

### Siapa boleh apa

- **Tab Jadwal**:
  - **Owner & Manajer Ops** — bisa melihat jadwal **lokasi mana pun**,
    dan bisa **menambah, mengubah, menghapus** shift siapa saja.
  - **Supervisor & Staf** — hanya bisa **melihat** (tidak ada tombol
    tambah/ubah/hapus), dan yang ditampilkan **otomatis hanya jadwal
    milik akun itu sendiri** — tidak ada cara memilih lokasi atau melihat
    jadwal orang lain dari halaman ini.
- **Tab Pengajuan Libur**:
  - **Semua peran** (termasuk Owner dan Manajer Ops sendiri) boleh
    mengajukan libur untuk **diri sendiri** — tidak ada cara mengajukan
    atas nama orang lain.
  - **Owner & Manajer Ops** — tambahan bisa melihat daftar **"Menunggu
    Persetujuan"** (antrian semua pengajuan dari semua orang) dan
    menekan **Setujui**/**Tolak**. **Tidak bisa menyetujui/menolak
    pengajuan milik diri sendiri** — kalau dicoba, sistem akan menolak
    dengan pesan jelas (bukan ikut di-approve diam-diam).
  - **Supervisor & Staf** — hanya bisa melihat riwayat pengajuan milik
    sendiri, tidak ada akses ke antrian persetujuan.

### Cara pakai — Tab Jadwal (Owner/Manajer Ops)

**Skenario**: menambahkan shift pagi untuk seorang staf di Samsara Outlet
1 Malang besok.

1. Buka menu **Jadwal & Izin**, pastikan tab **Jadwal** aktif.
2. Di kotak **Lokasi**, pilih **Samsara Outlet 1 Malang**.
3. Atur **Dari tanggal** dan **Sampai tanggal** untuk menentukan rentang
   yang ditampilkan di daftar (defaultnya Senin–Minggu minggu ini).
4. Tekan **+ Tambah shift**.
5. Di form yang muncul: pilih **Staf** dari dropdown, pilih **Tanggal**
   shift, lalu pilih **Shift** dari dropdown template yang sudah
   disiapkan (misalnya "Pagi" 06.00–14.00 atau "Siang" 14.00–21.00) —
   tidak perlu mengetik jam manual.
6. Tekan **Simpan**.
7. Shift baru langsung muncul di daftar, dikelompokkan per tanggal,
   menampilkan nama staf dan jam mulai–selesai sesuai template yang
   dipilih.

Untuk **mengubah** shift yang sudah ada, tekan **Ubah** di baris shift
itu (staf yang sudah tercatat tidak bisa diganti lewat sini — hapus
shift itu lalu buat baru kalau salah pilih staf). Untuk **menghapus**,
tekan **Hapus**, lalu konfirmasi di dialog yang muncul.

Daftar jenis shift yang muncul di dropdown ("Pagi", "Siang", dst) diatur
lewat menu **Pengaturan > Shift** (khusus Owner/Manajer Ops) — kalau
butuh jenis shift baru (misalnya shift malam), tambahkan dulu di sana
sebelum bisa dipilih di sini.

### Cara pakai — Tab Jadwal (Supervisor/Staf)

1. Buka menu **Jadwal & Izin**, tab **Jadwal**.
2. Atur **Dari tanggal** dan **Sampai tanggal** kalau mau melihat rentang
   selain minggu ini.
3. Daftar yang muncul **otomatis hanya jadwal shift milik akunmu
   sendiri**, dikelompokkan per tanggal, menunjukkan jam mulai–selesai.
   Tidak ada kotak pilih lokasi atau staf di tampilan ini.

### Cara pakai — Tab Pengajuan Libur

**Mengajukan libur (semua peran):**

1. Buka menu **Jadwal & Izin**, pilih tab **Pengajuan Libur**.
2. Di bagian atas ("Ajukan libur"), isi **Tanggal mulai** dan **Tanggal
   selesai** (boleh sama kalau cuma libur 1 hari).
3. Isi **Alasan** (opsional), misalnya "acara keluarga".
4. Tekan **Ajukan libur**.
5. Muncul konfirmasi "Pengajuan libur terkirim, menunggu persetujuan."
   Pengajuan ini langsung muncul di kartu **"Riwayat Pengajuan Saya"** di
   bawahnya dengan status **Menunggu**.

**Menyetujui/menolak pengajuan (hanya Owner/Manajer Ops):**

1. Di halaman yang sama, kartu **"Menunggu Persetujuan"** menampilkan
   semua pengajuan dari semua staf/supervisor (dan owner/manajer ops
   lain) yang belum diputuskan.
2. Untuk setiap baris, tekan **Setujui** atau **Tolak**, lalu konfirmasi
   di dialog yang muncul.
3. Status pengajuan itu berubah jadi **Disetujui** atau **Ditolak** dan
   hilang dari antrian "Menunggu Persetujuan" (tidak bisa diputuskan
   ulang).
4. Kalau pengajuan di antrian itu kebetulan milik akunmu sendiri, tombol
   **Setujui**/**Tolak** akan ditolak sistem dengan pesan jelas — pengajuan
   sendiri harus diputuskan oleh Owner/Manajer Ops yang lain.

---

## Cara Verifikasi Isi Panduan Ini

Panduan ini ditulis dengan memeriksa langsung ke kode sumber sistem
(bukan berdasarkan ingatan/asumsi), supaya matriks izin dan langkah di
atas cocok dengan yang sungguhan ada di layar:

- Matriks izin (siapa boleh apa) diverifikasi dari `permission.roles` tiap
  endpoint di `modules/inventory/module.json`, disilangkan dengan helper
  tampilan di `apps/web/src/auth/permissions.ts` (yang menentukan
  tombol/tab apa yang muncul di layar per peran).
- Langkah klik demi klik diverifikasi dari kode halaman sungguhan di
  `apps/web/src/pages/` (label tombol, urutan field, pesan konfirmasi —
  disalin persis dari teks yang ada di kode, bukan dikarang).
- Contoh lokasi/item/menu yang dipakai (Samsara Central Kitchen, Samsara
  Outlet 1 Malang, Gula pasir, Kuah bubur/RP-002, Bubur/Bubur Polos) adalah
  data referensi asli yang sudah ada di sistem, bukan nama karangan.
- Bagian 5.6 (Permintaan ke CK), 7 (Laporan Harian), dan bagian "Tab
  Pengajuan Libur" di 8 diverifikasi dengan cara yang sama: dibaca
  langsung dari `apps/web/src/pages/transaksi/PermintaanTab.tsx`,
  `PermintaanTransferForm.tsx`, `PermintaanMasukPanel.tsx`,
  `apps/web/src/pages/LaporanHarianPage.tsx`,
  `apps/web/src/pages/hr/PengajuanLiburTab.tsx`, dan endpoint terkait di
  `modules/inventory/src/api/router.ts`/`module.json` serta
  `modules/hr/module.json` — bukan dikarang. **Kecuali bagian dropdown
  "Shift" di 8 (Tab Jadwal, cara "Tambah shift"), lihat catatan di bawah.**

## Hal yang Belum Bisa Dipastikan / Perlu Dicek Ulang

- Status **"Menipis"** di halaman Stok bergantung pada kolom "stok
  minimum" per item — sampai dokumen ini ditulis, kolom itu belum pernah
  diisi untuk item mana pun (dikonfirmasi dari data referensi), jadi
  status ini secara praktis belum akan pernah muncul sampai ada yang
  mengisinya lewat halaman Master. Ini bukan bug, tapi perlu diketahui
  tim operasional supaya tidak bingung kenapa peringatan "Menipis" tidak
  pernah muncul.
- Daftar nama menu/item/resep di beberapa halaman (ditandai kotak kuning
  "Data contoh") adalah **snapshot**, bukan pembaruan otomatis — kalau ada
  item/menu baru ditambahkan lewat Master setelah snapshot itu dibuat,
  ada kemungkinan kecil ia tidak langsung muncul di daftar pencarian
  sampai snapshot itu diperbarui oleh tim teknis. Ini keterbatasan yang
  sudah diketahui dan dicatat di `docs/architecture-decisions.md`, bukan
  sesuatu yang saya putuskan sendiri untuk diselesaikan di sini.
- Panduan ini tidak membahas halaman **Pengaturan** (khusus Owner) karena
  di luar cakupan yang diminta — kalau tim operasional mulai perlu
  memakainya, panduan terpisah sebaiknya ditambahkan.
- **PENTING, perlu dicek ulang**: bagian "Cara pakai — Tab Jadwal
  (Owner/Manajer Ops)" di § 8 (langkah "+ Tambah shift" memilih dropdown
  **Shift** berisi template seperti "Pagi"/"Siang", dan menu **Pengaturan
  > Shift** untuk mengelolanya) ditulis berdasarkan rencana perubahan
  yang **sedang dikerjakan paralel** saat panduan ini ditulis (2026-10-06)
  — **BUKAN** hasil baca kode `apps/web/src/pages/hr/JadwalTab.tsx` yang
  sungguhan ada saat itu (kode yang dibaca saat itu masih input jam mulai/
  selesai manual, belum ada dropdown template maupun halaman Pengaturan >
  Shift). Begitu `frontend-web` selesai membangunnya, bagian ini **wajib
  dicek ulang langsung ke kode/layar sungguhan** — kemungkinan nama field,
  urutan langkah, atau nama menu Pengaturan-nya sedikit berbeda dari yang
  ditulis di sini.
- Bagian lain di § 8 (Tab Jadwal untuk Supervisor/Staf, dan seluruh Tab
  Pengajuan Libur) **sudah** diverifikasi ke kode sungguhan seperti biasa
  — tidak termasuk dalam catatan "perlu dicek ulang" di atas.
