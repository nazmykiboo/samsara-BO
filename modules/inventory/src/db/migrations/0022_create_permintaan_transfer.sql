-- Permintaan transfer: tahap SEBELUM transfer kirim yang sudah ada
-- (inventory_transaksi_transfer, lihat 0003/0004 & 0016). Alur bisnisnya:
-- outlet MENGAJUKAN permintaan ("butuh X qty item Y dari CK") -> CK melihat
-- daftar permintaan masuk -> CK MEMENUHI lewat transfer kirim yang SUDAH ADA
-- (endpoint/tabel transfer tidak berubah), transfer itu merujuk balik ke
-- baris permintaan ini lewat kolom permintaan_id yang ditambahkan di bawah.
--
-- Penamaan location_asal_id/location_tujuan_id SENGAJA sama dengan
-- inventory_transaksi_transfer: location_asal_id = lokasi yang DIMINTA
-- mengirim (biasanya CK), location_tujuan_id = lokasi yang MENGAJUKAN
-- (outlet). Ini supaya saat CK memenuhi permintaan, location_asal_id &
-- location_tujuan_id transfer kirim yang dibuat cocok langsung dengan
-- location_asal_id & location_tujuan_id permintaan (lihat createTransferKirim
-- di modules/inventory/src/domain/stok.ts) -- tidak perlu mapping terbalik.
--
-- "Status otomatis jadi dipenuhi saat transfer dikirim" adalah LOGIKA
-- APLIKASI (Tahap 3/backend), BUKAN trigger database -- pola yang sama
-- dipakai di 0020 (min_stok_lokasi) untuk hal-hal yang butuh resolusi
-- business logic, bukan DDL murni. Migrasi ini hanya menyediakan kolom
-- link (permintaan_id) dan nilai CHECK status yang valid; kode aplikasi
-- yang bertanggung jawab mengubah status 'diminta' -> 'dipenuhi' saat
-- transfer kirim dibuat, dan -> 'dibatalkan' kalau outlet/CK membatalkan.

CREATE TABLE IF NOT EXISTS inventory_permintaan_transfer (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  location_asal_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  location_tujuan_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  qty_diminta NUMERIC(18, 6) NOT NULL,
  status TEXT NOT NULL DEFAULT 'diminta',
  diminta_oleh BIGINT REFERENCES core_users (id),
  tanggal_diminta DATE NOT NULL,
  catatan TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('diminta', 'dipenuhi', 'dibatalkan')),
  CHECK (location_asal_id <> location_tujuan_id)
);

COMMENT ON TABLE inventory_permintaan_transfer IS
  'Permintaan transfer dari outlet ke lokasi lain (biasanya Central Kitchen), tahap SEBELUM transfer kirim. CK memenuhi permintaan lewat inventory_transaksi_transfer yang sudah ada (0003/0004/0016) -- transfer itu merujuk balik ke baris ini lewat inventory_transaksi_transfer.permintaan_id. Status "dipenuhi" diset oleh kode aplikasi saat transfer kirim dibuat, BUKAN trigger DB (pola sama seperti 0020_create_min_stok_lokasi.sql).';
COMMENT ON COLUMN inventory_permintaan_transfer.kode IS
  'Kode referensi human-readable, diisi aplikasi (app-supplied) -- bukan digenerate SQL/trigger. Sama seperti pola items.kode/menu.kode di 0001/0002; format persisnya ditentukan backend Tahap 3.';
COMMENT ON COLUMN inventory_permintaan_transfer.location_asal_id IS
  'Lokasi yang DIMINTA untuk mengirim (biasanya Central Kitchen). Penamaan sengaja sama dengan inventory_transaksi_transfer.location_asal_id supaya saat CK memenuhi permintaan ini, location_asal_id transfer kirim = location_asal_id permintaan (cocok langsung, lihat createTransferKirim di modules/inventory/src/domain/stok.ts).';
COMMENT ON COLUMN inventory_permintaan_transfer.location_tujuan_id IS
  'Lokasi yang MENGAJUKAN permintaan (outlet) -- akan jadi location_tujuan_id transfer kirim yang memenuhinya.';
COMMENT ON COLUMN inventory_permintaan_transfer.status IS
  '"diminta" = baru diajukan, belum ada transfer kirim yang memenuhinya. "dipenuhi" = sudah ada transfer kirim yang merujuk ke baris ini (diset kode aplikasi, bukan trigger). "dibatalkan" = outlet/CK membatalkan permintaan sebelum dipenuhi.';
COMMENT ON COLUMN inventory_permintaan_transfer.diminta_oleh IS
  'User yang mengajukan permintaan. Nullable, pola sama seperti dibuat_oleh/diputuskan_oleh/diterima_oleh di tabel transaksi lain (lihat 0015, 0016, 0017, 0020) -- tidak ada logika yang mewajibkan kolom ini terisi di level database.';

-- Index untuk query umum "daftar permintaan masuk per lokasi+status", dari
-- dua sisi: CK melihat permintaan yang DITUJUKAN ke mereka (location_asal_id
-- = lokasi CK, filter status), outlet melihat permintaan yang MEREKA ajukan
-- (location_tujuan_id = lokasi outlet, filter status).
CREATE INDEX IF NOT EXISTS idx_inventory_permintaan_transfer_asal_status
  ON inventory_permintaan_transfer (location_asal_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_permintaan_transfer_tujuan_status
  ON inventory_permintaan_transfer (location_tujuan_id, status);

-- Link balik dari transfer kirim ke permintaan yang dipenuhinya. Nullable --
-- transfer kirim biasa (bukan hasil memenuhi permintaan) tetap boleh NULL,
-- tabel inventory_transaksi_transfer tidak berubah perilakunya untuk kasus
-- itu. Tabel masih 0 baris transaksi sungguhan sampai migrasi ini ditulis
-- (lihat catatan "masih 0 baris" di 0015/0016), jadi aman ditambah kolom
-- nullable tanpa backfill.
ALTER TABLE inventory_transaksi_transfer
  ADD COLUMN IF NOT EXISTS permintaan_id BIGINT REFERENCES inventory_permintaan_transfer (id);

COMMENT ON COLUMN inventory_transaksi_transfer.permintaan_id IS
  'Link OPSIONAL ke inventory_permintaan_transfer yang dipenuhi oleh transfer kirim ini. NULL = transfer kirim biasa, tidak berasal dari permintaan outlet. Saat transfer kirim dibuat dengan permintaan_id terisi, kode aplikasi (BUKAN trigger DB) yang mengubah status baris permintaan terkait menjadi ''dipenuhi''.';
