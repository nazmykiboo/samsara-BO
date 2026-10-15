-- inventory_items.min_stok (0001) adalah satu ambang batas per ITEM, bukan
-- per item+lokasi. Kebutuhan bisnis sebenarnya: Central Kitchen dan tiap
-- outlet bisa punya ambang batas minimum stok yang beda untuk item yang
-- sama (mis. gula 10kg cukup untuk outlet kecil, tapi CK butuh 50kg).
-- Desain kolom tunggal di inventory_items tidak bisa merepresentasikan ini,
-- jadi dipecah jadi tabel baru per item+lokasi (pola sama seperti stok itu
-- sendiri: satu baris per item+lokasi, lihat inventory_stock_ledger di 0003).
--
-- inventory_items.min_stok TIDAK dihapus/diubah (lihat CLAUDE.md -- migrasi
-- baru, bukan edit yang sudah applied, dan kolomnya juga masih NULL semua
-- di data saat ini sesuai docs/inventory-schema.md baris 61, jadi tidak ada
-- data yang hilang) -- hanya ditandai deprecated lewat COMMENT ON COLUMN,
-- supaya histori & kode lama yang masih membacanya tidak rusak.

CREATE TABLE inventory_min_stok_lokasi (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  location_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  min_stok NUMERIC(18, 6) NOT NULL,
  diubah_oleh BIGINT REFERENCES core_users (id),
  diubah_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, location_id)
);

COMMENT ON TABLE inventory_min_stok_lokasi IS
  'Ambang batas minimum stok per item PER LOKASI -- menggantikan inventory_items.min_stok yang cuma satu nilai per item (tidak bisa beda antar Central Kitchen vs outlet). Satu baris per pasangan item+lokasi (UNIQUE item_id,location_id) supaya endpoint upsert ("set or update") backend bisa pakai INSERT ... ON CONFLICT (item_id, location_id) DO UPDATE.';
COMMENT ON COLUMN inventory_min_stok_lokasi.diubah_oleh IS
  'User yang terakhir mengubah nilai min_stok baris ini. Nullable, sama seperti dibuat_oleh/diputuskan_oleh/diterima_oleh di tabel transaksi lain (lihat 0015, 0016, 0017) -- tidak ada logika yang mewajibkan kolom ini terisi di level database.';
COMMENT ON COLUMN inventory_min_stok_lokasi.diubah_at IS
  'Waktu perubahan terakhir nilai min_stok baris ini. Default now() supaya selalu terisi walau diubah_oleh NULL.';

COMMENT ON COLUMN inventory_items.min_stok IS
  'DEPRECATED sejak 0020_create_min_stok_lokasi.sql -- satu ambang batas per item tidak cukup karena kebutuhan bisnis sebenarnya adalah ambang batas PER ITEM PER LOKASI (mis. Central Kitchen vs outlet butuh angka beda untuk item yang sama). Gunakan inventory_min_stok_lokasi, bukan kolom ini, untuk fitur reorder alert baru. Kolom ini dibiarkan (tidak dihapus) untuk kompatibilitas mundur; datanya saat ini semua NULL.';
