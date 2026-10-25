-- Tahap 1 "Outlet & Kitchen": channel penjualan aktif PER LOKASI.
--
-- `inventory_sales_channel` (0011) sampai sekarang GLOBAL -- satu daftar
-- channel untuk semua lokasi, tidak ada cara bilang "outlet A tidak jual
-- lewat GoFood". Tabel pivot ini menambah granularity itu TANPA mengubah
-- `inventory_sales_channel` sama sekali (tetap jadi master channel; tabel
-- ini cuma pivot aktif/nonaktif per kombinasi lokasi+channel).
--
-- TIDAK ADA BARIS = channel itu dianggap AKTIF di lokasi itu (konsisten
-- dengan pola "tidak ada baris = tayang" yang sudah dipakai visibilitas
-- menu per lokasi/channel di modul ini, migrasi 0024) -- supaya lokasi yang
-- SUDAH ADA sebelum migrasi ini (2 baris core_locations saat ini) otomatis
-- tetap berlaku seperti sebelumnya (semua channel aktif), tidak perlu
-- backfill baris apa pun.
CREATE TABLE inventory_location_channel (
  location_id BIGINT NOT NULL REFERENCES core_locations (id) ON DELETE CASCADE,
  channel_id BIGINT NOT NULL REFERENCES inventory_sales_channel (id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, channel_id)
);

COMMENT ON TABLE inventory_location_channel IS
  'Pivot channel penjualan aktif/nonaktif PER LOKASI. TIDAK ADA BARIS untuk kombinasi lokasi+channel = dianggap AKTIF (pola "tidak ada baris = tayang", sama seperti visibilitas menu per lokasi/channel di migrasi 0024) -- baris di sini HANYA dibuat untuk kombinasi yang dinonaktifkan secara eksplisit, atau hasil endpoint salin konfigurasi antar lokasi.';
