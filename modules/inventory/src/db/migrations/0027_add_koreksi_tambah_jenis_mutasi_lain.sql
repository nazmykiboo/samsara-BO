-- Koreksi migrasi 0026: tambah 1 nilai baru ke CHECK constraint kolom
-- `jenis` di inventory_transaksi_mutasi_lain.
--
-- Migrasi 0026 membuat kolom `jenis` dengan 5 nilai valid, SEMUANYA
-- bernuansa PENGURANGAN stok (waste_rusak, hilang_tidak_diketahui,
-- staff_meal, sampel, retur_supplier). Di lapangan, Mutasi Lain juga
-- dipakai staf untuk KOREKSI TAMBAH (qty POSITIF) -- misalnya stok awal
-- saat pertama kali pakai sistem, atau temuan fisik lebih banyak dari
-- pencatatan sistem saat opname manual (BUKAN lewat endpoint Opname resmi,
-- itu jalur dua-tahap terpisah di migrasi 0017) -- dan staf terpaksa
-- memilih salah satu dari 5 kategori pengurangan yang tidak cocok sama
-- sekali. Migrasi ini menambah 1 kategori baru: `koreksi_tambah`.
--
-- Transfer antar lokasi SUDAH punya jalur sendiri sepenuhnya terpisah
-- (POST /transaksi/transfer, POST /transaksi/transfer/:id/terima, GET
-- /transaksi/transfer/dalam-perjalanan -- tabel inventory_transaksi_transfer
-- milik migrasi 0016), jadi TIDAK PERLU kategori "transfer masuk" di sini.
--
-- Postgres tidak bisa ALTER CHECK constraint langsung -- harus DROP lalu
-- ADD ulang. Nama constraint dipertahankan SAMA seperti sebelumnya
-- (inventory_transaksi_mutasi_lain_jenis_check) supaya tidak ada migrasi
-- lain yang mereferensikan nama lama jadi usang.
--
-- Idempotent: cek dulu definisi constraint saat ini sebelum DROP+ADD --
-- kalau constraint sudah berisi 'koreksi_tambah' (migrasi ini sudah
-- pernah jalan), skip supaya aman dijalankan berkali-kali (pola serupa
-- cek-dulu seperti migrasi 0026, hanya di sini perlu DROP+ADD bukan
-- cuma ADD karena mengubah definisi constraint yang sudah ada, bukan
-- membuat constraint baru).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_transaksi_mutasi_lain_jenis_check'
      AND pg_get_constraintdef(oid) LIKE '%koreksi_tambah%'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transaksi_mutasi_lain_jenis_check'
  ) THEN
    ALTER TABLE inventory_transaksi_mutasi_lain
      DROP CONSTRAINT inventory_transaksi_mutasi_lain_jenis_check;
  END IF;

  ALTER TABLE inventory_transaksi_mutasi_lain
    ADD CONSTRAINT inventory_transaksi_mutasi_lain_jenis_check
    CHECK (jenis IS NULL OR jenis IN (
      'waste_rusak',
      'hilang_tidak_diketahui',
      'staff_meal',
      'sampel',
      'retur_supplier',
      'koreksi_tambah'
    ));
END $$;

COMMENT ON COLUMN inventory_transaksi_mutasi_lain.jenis IS
  'Kategori terstruktur mutasi non-standar. 6 nilai valid: waste_rusak (barang rusak/waste sungguhan), hilang_tidak_diketahui (hilang tanpa sebab jelas -- juga dihitung waste), staff_meal (dipakai untuk makan staf -- BUKAN waste), sampel (dipakai untuk sample/testing -- BUKAN waste), retur_supplier (dikembalikan ke supplier -- BUKAN waste), koreksi_tambah (stok bertambah TANPA lewat jalur transaksi standar Pembelian/Produksi/Transfer -- misal stok awal saat pertama kali pakai sistem, atau temuan fisik lebih banyak dari pencatatan sistem saat opname manual; BUKAN dari endpoint Opname resmi di migrasi 0017, itu jalur terpisah -- ditambahkan migrasi 0027). 5 nilai pertama tetap bernuansa pengurangan stok seperti semula (lihat migrasi 0026); koreksi_tambah adalah satu-satunya nilai bernuansa penambahan. NULLABLE di level skema untuk kompatibilitas data lama (baris historis sebelum migrasi 0026 dibiarkan NULL), TAPI diwajibkan diisi untuk entri BARU di level aplikasi (domain function createMutasiLain) -- bukan lewat NOT NULL constraint, supaya pesan error "wajib diisi" bisa Bahasa Indonesia yang jelas. Kolom `alasan` TETAP ADA berdampingan sebagai catatan/detail bebas, BUKAN digantikan oleh kolom ini. Dipakai GET /analitik/operasional untuk memfilter insight waste supaya hanya menghitung waste_rusak + hilang_tidak_diketahui (koreksi_tambah TIDAK dihitung sebagai waste, qty-nya positif).';
