-- STATUS: SUDAH DIJALANKAN ke production 2026-10-17 (hasil 0 error, terverifikasi
-- cocok persis dengan dev termasuk perhitungan HPP 70 menu/item). Disimpan di sini
-- sebagai arsip/dokumentasi, BUKAN untuk dijalankan ulang.
-- ============================================================================
-- MIGRASI DATA: pengaturan sistem dev -> production. Dibuat 2026-10-17.
-- HANYA UNTUK DIREVIEW -- JANGAN dijalankan ke production sebelum owner
-- setuju eksplisit.
--
-- Hasil perbandingan KOMPREHENSIF (bukan cuma 5 tabel seperti sebelumnya) --
-- SEMUA tabel non-transaksional diperiksa isi PENUHNYA (bukan cuma
-- count(*)): core_locations, hr_settings, hr_shift_template,
-- inventory_channel_komisi, inventory_insight_rules, inventory_menu_modifier_grup,
-- inventory_modifier_grup, inventory_modifier_opsi, inventory_sales_channel,
-- inventory_settings, salessync_platform_channel_map, salessync_settings --
-- SEMUANYA identik antara dev dan production KECUALI satu baris di bawah.
-- (salessync_platform_channel_map sempat kelihatan beda tapi ternyata cuma
-- beda urutan collation Postgres antar instance, bukan beda data -- sudah
-- diverifikasi ulang dengan sort locale-independent.)
--
-- Tidak ditemukan baris sisa uji (kode TEST-*/QA) di tabel manapun yang
-- diperiksa -- tidak ada yang perlu dikeluarkan dari skrip 001/002.
--
-- WAJIB dijalankan SETELAH 001 dan 002 (urutan tidak terlalu kritis untuk
-- skrip ini spesifik karena tidak ada dependency FK ke data baru 001/002,
-- tapi tetap ikuti urutan 001 -> 002 -> 003 untuk konsistensi).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- target_food_cost_persen: dev=50, production=30 (nilai seed asli). Owner
-- mengubah target ini di dev pada 2026-10-08 lewat halaman Pengaturan --
-- production masih pakai nilai seed lama. hpp_default_method SUDAH identik
-- di kedua sisi ('harga_master'), tidak perlu disentuh.
-- ----------------------------------------------------------------------------
UPDATE inventory_settings SET value = '50', updated_at = now()
WHERE key = 'target_food_cost_persen' AND value <> '50';

-- ----------------------------------------------------------------------------
-- VERIFIKASI (jalankan manual setelah COMMIT):
--   SELECT value FROM inventory_settings WHERE key='target_food_cost_persen'; -- harus '50'
-- ----------------------------------------------------------------------------

-- SENGAJA ROLLBACK -- ganti ke COMMIT manual setelah direview dan disetujui
-- owner. Jangan ganti baris ini tanpa instruksi eksplisit.
ROLLBACK;
