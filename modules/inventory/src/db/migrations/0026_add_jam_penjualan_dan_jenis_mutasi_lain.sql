-- Dua perubahan skema independen (tidak ada hubungan satu sama lain, hanya
-- digabung dalam satu file migrasi bernomor berikutnya).

-- 1) Kolom `jam` di inventory_transaksi_penjualan -- untuk fitur "heatmap jam
--    ramai" yang akan dibangun terpisah setelah migrasi ini. NULLABLE karena
--    data historis (sebelum migrasi ini) tidak pernah punya jam -- itu bukan
--    data cacat, memang belum ada sumbernya saat transaksi lama dibuat.
--    Pengisian ke depan:
--      - Transaksi dari sales-sync: diisi dari
--        salessync_log_penjualan.transaction_time (jam order asli dari
--        platform POS/delivery), bukan jam proses sync.
--      - Transaksi input manual kasir: diisi dari form (opsional). Kalau
--        kasir tidak isi, default ke waktu submit -- tapi default itu logic
--        FRONTEND, bukan DEFAULT kolom di database, karena itu perlu tahu
--        "jam submit form" bukan "jam INSERT row" (bisa beda kalau ada
--        retry/antrian). Makanya kolom ini tetap NULLABLE tanpa DEFAULT di
--        level skema.
ALTER TABLE inventory_transaksi_penjualan
  ADD COLUMN IF NOT EXISTS jam TIME;

COMMENT ON COLUMN inventory_transaksi_penjualan.jam IS
  'Jam transaksi (bukan tanggal), untuk fitur "heatmap jam ramai" (dibangun terpisah setelah migrasi ini). NULLABLE: data SEBELUM migrasi ini selalu NULL (tidak ada sumbernya saat itu). Transaksi dari sales-sync diisi dari salessync_log_penjualan.transaction_time (jam order asli di platform). Transaksi input manual kasir diisi dari form, opsional -- kalau kosong, default ke waktu submit ditentukan di FRONTEND, bukan DEFAULT kolom ini, karena kolom ini tetap NULLABLE di level skema.';

-- 2) Kolom `jenis` di inventory_transaksi_mutasi_lain -- kategori terstruktur
--    untuk mutasi non-standar, supaya analitik waste (GET /analitik/operasional)
--    bisa membedakan waste sungguhan dari pemakaian lain yang qty-nya juga
--    berkurang tapi BUKAN waste (staff meal, sampel, retur supplier).
--    Sebelumnya endpoint itu menghitung SEMUA qty negatif sebagai waste --
--    ini koreksinya.
--
--    NULLABLE di level skema untuk kompatibilitas data historis: tabel ini
--    sudah dicek isinya sebelum migrasi dibuat, cuma ada 1 baris
--    (id=2, alasan='#test1', tanggal 2026-10-05) -- jelas data uji coba
--    lama, BUKAN mutasi nyata, sengaja TIDAK diisi `jenis` apa pun oleh
--    migrasi ini dan dibiarkan NULL selamanya.
--
--    Untuk entri BARU, "wajib diisi" ditegakkan di level APLIKASI (domain
--    function createMutasiLain), bukan lewat NOT NULL constraint di sini --
--    supaya pesan error-nya bisa Bahasa Indonesia yang jelas ("Jenis mutasi
--    wajib dipilih") ketimbang error constraint Postgres mentah.
--
--    `alasan` (kolom lama, TEXT bebas) TETAP ADA berdampingan, BUKAN
--    digantikan oleh `jenis` -- `jenis` adalah kategori terstruktur (dipakai
--    untuk filter/agregasi di analitik), `alasan` adalah keterangan bebas
--    (dipakai untuk catatan manusia), keduanya punya peran berbeda dan tidak
--    saling menggantikan.
ALTER TABLE inventory_transaksi_mutasi_lain
  ADD COLUMN IF NOT EXISTS jenis TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transaksi_mutasi_lain_jenis_check'
  ) THEN
    ALTER TABLE inventory_transaksi_mutasi_lain
      ADD CONSTRAINT inventory_transaksi_mutasi_lain_jenis_check
      CHECK (jenis IS NULL OR jenis IN (
        'waste_rusak',
        'hilang_tidak_diketahui',
        'staff_meal',
        'sampel',
        'retur_supplier'
      ));
  END IF;
END $$;

COMMENT ON COLUMN inventory_transaksi_mutasi_lain.jenis IS
  'Kategori terstruktur mutasi non-standar. 5 nilai valid: waste_rusak (barang rusak/waste sungguhan), hilang_tidak_diketahui (hilang tanpa sebab jelas -- juga dihitung waste), staff_meal (dipakai untuk makan staf -- BUKAN waste), sampel (dipakai untuk sample/testing -- BUKAN waste), retur_supplier (dikembalikan ke supplier -- BUKAN waste). NULLABLE di level skema untuk kompatibilitas data lama (baris historis sebelum migrasi ini dibiarkan NULL, lihat migrasi 0026), TAPI diwajibkan diisi untuk entri BARU di level aplikasi (domain function createMutasiLain) -- bukan lewat NOT NULL constraint, supaya pesan error "wajib diisi" bisa Bahasa Indonesia yang jelas. Kolom `alasan` TETAP ADA berdampingan sebagai catatan/detail bebas, BUKAN digantikan oleh kolom ini. Dipakai GET /analitik/operasional untuk memfilter insight waste supaya hanya menghitung waste_rusak + hilang_tidak_diketahui (perbaikan dari versi sebelumnya yang menghitung semua qty negatif tanpa pandang jenis).';
