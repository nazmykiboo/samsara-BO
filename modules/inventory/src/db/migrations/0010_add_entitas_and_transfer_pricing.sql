-- Konsep "entitas": pengelompokan internal antar lokasi Samsara sendiri
-- (mis. Central Kitchen sebagai satu cost-center, Outlet sebagai cost-center
-- lain) -- BUKAN pemisahan antar brand (Burnas/Ajiep tetap tidak disentuh
-- sama sekali, lihat docs/architecture-decisions.md § 7 dan § 8).
-- Tabel masih kosong (belum ada lokasi/transfer di-seed), aman ditambah
-- kolom NOT NULL tanpa DEFAULT.

ALTER TABLE inventory_locations
  ADD COLUMN entitas TEXT NOT NULL;

COMMENT ON COLUMN inventory_locations.entitas IS
  'Kode entitas internal Samsara, snake_case (mis. samsara_ck, samsara_outlet). Dipakai untuk filter nilai stok & laporan HPP per entitas, dan untuk menentukan transfer antar-entitas (lihat inventory_transaksi_transfer.antar_entitas). TEXT bebas (bukan enum) supaya entitas/outlet baru tidak perlu migrasi skema.';

-- Stok difilter per entitas lewat view ini (join ke lokasi). Kolom baru
-- (entitas) ditambahkan SETELAH qty -- CREATE OR REPLACE VIEW cuma boleh
-- menambah kolom baru di akhir, tidak boleh menyisipkan/mengubah posisi
-- kolom yang sudah ada (item_id, location_id, qty tetap di posisi semula).
CREATE OR REPLACE VIEW inventory_current_stock AS
SELECT s.item_id, s.location_id, SUM(s.qty_change) AS qty, l.entitas
FROM inventory_stock_ledger s
JOIN inventory_locations l ON l.id = s.location_id
GROUP BY s.item_id, s.location_id, l.entitas;

-- Transfer antar lokasi: tandai otomatis kalau lintas entitas, dan siapkan
-- kolom harga transfer per baris (perlu ada terutama kalau antar_entitas,
-- untuk pembukuan internal antar cost-center).
ALTER TABLE inventory_transaksi_transfer
  ADD COLUMN antar_entitas BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION inventory_set_transfer_antar_entitas()
RETURNS TRIGGER AS $$
DECLARE
  entitas_asal TEXT;
  entitas_tujuan TEXT;
BEGIN
  SELECT entitas INTO entitas_asal FROM inventory_locations WHERE id = NEW.location_asal_id;
  SELECT entitas INTO entitas_tujuan FROM inventory_locations WHERE id = NEW.location_tujuan_id;
  NEW.antar_entitas := (entitas_asal IS DISTINCT FROM entitas_tujuan);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_transfer_antar_entitas
  BEFORE INSERT OR UPDATE OF location_asal_id, location_tujuan_id ON inventory_transaksi_transfer
  FOR EACH ROW EXECUTE FUNCTION inventory_set_transfer_antar_entitas();

COMMENT ON COLUMN inventory_transaksi_transfer.antar_entitas IS
  'Dihitung otomatis oleh trigger dari entitas lokasi asal vs tujuan -- jangan diisi manual, nilai yang dikirim client akan ditimpa trigger.';

ALTER TABLE inventory_transaksi_transfer_baris
  ADD COLUMN harga_transfer_per_satuan NUMERIC(18, 2);

COMMENT ON COLUMN inventory_transaksi_transfer_baris.harga_transfer_per_satuan IS
  'Harga transfer internal per satuan resep, dalam Rp. Nullable -- relevan terutama kalau header.antar_entitas = true (pembukuan lintas cost-center). Kebijakan default saat ini ("Skema A", 2026-09-28): sama dengan biaya produksi/HPP item tersebut di lokasi asal (harga_master untuk bahan_baku/packaging/operasional, atau biaya per satuan dari resep produksinya untuk setengah_jadi). Ini kebijakan level aplikasi (dihitung/diisi Tahap 3 saat insert), BUKAN default SQL statis -- karena biayanya butuh resolusi resep yang sama dengan mesin HPP, tidak boleh diduplikasi sebagai trigger/DEFAULT terpisah di database (dua sumber kebenaran). Kalau transfer tidak antar_entitas, kolom ini boleh NULL (tidak relevan).';
