-- Snapshot HPP per baris transaksi penjualan (inventory_transaksi_penjualan_baris,
-- detail per menu per transaksi -- lihat 0004). Sebelum migrasi ini, tabel ini
-- cuma punya id/header_id/menu_id/qty: HPP menu TIDAK pernah disimpan "pada
-- saat itu", selalu dihitung ulang (live) dari harga ITEM TERKINI. Itu
-- masalah untuk laporan historis -- kalau harga item berubah, laporan HPP
-- bulan lalu ikut berubah padahal transaksinya sudah lewat.
--
-- Dua kolom baru:
--
-- 1) hpp_saat_transaksi NUMERIC(18, 2), NULLABLE -- snapshot HPP (rupiah)
--    menu itu PADA SAAT baris ini dicatat. NULLABLE karena HPP bisa gagal
--    dihitung (mis. menu bergantung ke item berstatus pending_data yang
--    harga/konversi/yield-nya belum lengkap -- lihat CLAUDE.md aturan
--    Inventory). Presisi NUMERIC(18, 2) mengikuti kolom uang lain yang
--    sudah ada (inventory_items.harga_master, inventory_menu_harga_channel
--    .harga_jual di 0001 & 0021) -- TIDAK memperkenalkan presisi baru.
--
-- 2) hpp_sumber inventory_hpp_sumber (ENUM baru), NULLABLE -- menjelaskan
--    DARI MANA angka hpp_saat_transaksi berasal:
--      - 'snapshot_asli'      = dihitung otomatis PERSIS saat transaksi
--        penjualan itu dibuat (jalur normal ke depan).
--      - 'snapshot_estimasi'  = diisi BELAKANGAN lewat proses backfill
--        terpisah (bukan bagian migrasi ini -- butuh mesin kalkulasi HPP
--        rekursif yang cuma ada di TypeScript, modules/inventory/src/domain
--        /hpp.ts, karena resep bisa berjenjang lewat hasil_produksi dan
--        logic pending_data; tidak aman direplikasi di SQL murni) memakai
--        harga SAAT backfill dijalankan sebagai PERKIRAAN, karena harga
--        historis asli tidak pernah disimpan sebelum migrasi ini ada.
--    Dipilih native Postgres ENUM (bukan TEXT+CHECK seperti kolom `jenis`
--    di inventory_transaksi_mutasi_lain, 0026/0027) karena di sini cuma
--    2 nilai yang akan selalu tetap/fixed (asal data, bukan kategori bisnis
--    yang bisa nambah terus seperti `jenis`). Pola ENUM ini konsisten
--    dengan inventory_order_type (0014).
--
-- Kedua kolom NULLABLE di level DB -- konsisten dengan pola kolom `jenis`
-- (0026/0027): baris LAMA (sebelum migrasi ini) tetap NULL dulu sampai
-- di-backfill terpisah oleh agen backend. "Wajib diisi untuk baris BARU"
-- ditegakkan di level APLIKASI (domain function pencatatan penjualan),
-- BUKAN lewat NOT NULL constraint di sini, supaya pesan error "wajib
-- diisi"-nya bisa Bahasa Indonesia yang jelas, bukan error constraint
-- Postgres mentah.
--
-- Idempotent: cek dulu type/kolom sudah ada sebelum CREATE/ADD (pola
-- cek-dulu seperti 0026/0027), supaya aman kalau migrasi ini pernah
-- jalan sebagian lalu diulang.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_hpp_sumber') THEN
    CREATE TYPE inventory_hpp_sumber AS ENUM ('snapshot_asli', 'snapshot_estimasi');
  END IF;
END $$;

ALTER TABLE inventory_transaksi_penjualan_baris
  ADD COLUMN IF NOT EXISTS hpp_saat_transaksi NUMERIC(18, 2),
  ADD COLUMN IF NOT EXISTS hpp_sumber inventory_hpp_sumber;

COMMENT ON COLUMN inventory_transaksi_penjualan_baris.hpp_saat_transaksi IS
  'Snapshot HPP (rupiah) menu ini PADA SAAT baris transaksi penjualan dicatat. NULLABLE: bisa NULL kalau HPP gagal dihitung saat itu (mis. menu bergantung ke item berstatus pending_data yang harga/konversi/yield-nya belum lengkap -- lihat CLAUDE.md), dan baris LAMA (sebelum migrasi 0028) tetap NULL sampai dibackfill terpisah oleh agen backend. Presisi NUMERIC(18, 2) mengikuti kolom uang lain yang sudah ada (inventory_items.harga_master, inventory_menu_harga_channel.harga_jual). "Wajib diisi" untuk baris BARU ditegakkan di level aplikasi, bukan NOT NULL constraint.';

COMMENT ON COLUMN inventory_transaksi_penjualan_baris.hpp_sumber IS
  'Asal angka hpp_saat_transaksi. "snapshot_asli" = dihitung otomatis persis saat transaksi penjualan itu dibuat (jalur normal). "snapshot_estimasi" = diisi belakangan lewat backfill terpisah (di luar migrasi ini, pakai mesin kalkulasi HPP rekursif di modules/inventory/src/domain/hpp.ts) memakai harga SAAT backfill dijalankan sebagai perkiraan, karena harga historis asli tidak pernah disimpan sebelum migrasi 0028. NULLABLE: baris lama dibiarkan NULL sampai dibackfill. ENUM native (bukan TEXT+CHECK seperti kolom `jenis` di inventory_transaksi_mutasi_lain) karena nilainya cuma 2 dan tetap/fixed -- pola konsisten dengan inventory_order_type (0014).';
