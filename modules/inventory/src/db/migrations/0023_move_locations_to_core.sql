-- Lanjutan dari core/src/db/migrations/0006_move_locations_to_core.sql
-- (migrasi core SELALU jalan lebih dulu, lihat runMigrations() di
-- core/src/db/migrate.ts) -- lokasi (outlet/gudang) sekarang dimiliki
-- `core` (tabel core_locations, datanya sudah dicopy persis dari
-- inventory_locations dengan id yang sama) supaya modul bisnis lain
-- (hr, dst) bisa FK langsung ke lokasi tanpa melanggar isolasi antar
-- modul bisnis (CLAUDE.md §3). Migrasi ini merepoint 11 foreign key yang
-- tadinya menunjuk ke inventory_locations supaya menunjuk ke core_locations,
-- memperbarui view/fungsi yang baca langsung dari inventory_locations,
-- lalu menghapus inventory_locations (datanya sudah aman di core_locations).
--
-- Nama kolom & tabel TIDAK berubah sama sekali -- cuma target referensinya
-- yang pindah. DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT dengan nama yang
-- sama supaya file ini idempotent kalau tidak sengaja dicoba jalan dua kali.

ALTER TABLE inventory_min_stok_lokasi
  DROP CONSTRAINT IF EXISTS inventory_min_stok_lokasi_location_id_fkey,
  ADD CONSTRAINT inventory_min_stok_lokasi_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES core_locations (id);

ALTER TABLE inventory_permintaan_transfer
  DROP CONSTRAINT IF EXISTS inventory_permintaan_transfer_location_asal_id_fkey,
  ADD CONSTRAINT inventory_permintaan_transfer_location_asal_id_fkey
    FOREIGN KEY (location_asal_id) REFERENCES core_locations (id);

ALTER TABLE inventory_permintaan_transfer
  DROP CONSTRAINT IF EXISTS inventory_permintaan_transfer_location_tujuan_id_fkey,
  ADD CONSTRAINT inventory_permintaan_transfer_location_tujuan_id_fkey
    FOREIGN KEY (location_tujuan_id) REFERENCES core_locations (id);

ALTER TABLE inventory_stock_ledger
  DROP CONSTRAINT IF EXISTS inventory_stock_ledger_location_id_fkey,
  ADD CONSTRAINT inventory_stock_ledger_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES core_locations (id);

ALTER TABLE inventory_transaksi_mutasi_lain
  DROP CONSTRAINT IF EXISTS inventory_transaksi_mutasi_lain_location_id_fkey,
  ADD CONSTRAINT inventory_transaksi_mutasi_lain_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES core_locations (id);

ALTER TABLE inventory_transaksi_opname
  DROP CONSTRAINT IF EXISTS inventory_transaksi_opname_location_id_fkey,
  ADD CONSTRAINT inventory_transaksi_opname_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES core_locations (id);

ALTER TABLE inventory_transaksi_pembelian
  DROP CONSTRAINT IF EXISTS inventory_transaksi_pembelian_location_id_fkey,
  ADD CONSTRAINT inventory_transaksi_pembelian_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES core_locations (id);

ALTER TABLE inventory_transaksi_penjualan
  DROP CONSTRAINT IF EXISTS inventory_transaksi_penjualan_location_id_fkey,
  ADD CONSTRAINT inventory_transaksi_penjualan_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES core_locations (id);

ALTER TABLE inventory_transaksi_produksi
  DROP CONSTRAINT IF EXISTS inventory_transaksi_produksi_location_id_fkey,
  ADD CONSTRAINT inventory_transaksi_produksi_location_id_fkey
    FOREIGN KEY (location_id) REFERENCES core_locations (id);

ALTER TABLE inventory_transaksi_transfer
  DROP CONSTRAINT IF EXISTS inventory_transaksi_transfer_location_asal_id_fkey,
  ADD CONSTRAINT inventory_transaksi_transfer_location_asal_id_fkey
    FOREIGN KEY (location_asal_id) REFERENCES core_locations (id);

ALTER TABLE inventory_transaksi_transfer
  DROP CONSTRAINT IF EXISTS inventory_transaksi_transfer_location_tujuan_id_fkey,
  ADD CONSTRAINT inventory_transaksi_transfer_location_tujuan_id_fkey
    FOREIGN KEY (location_tujuan_id) REFERENCES core_locations (id);

-- inventory_current_stock (dibuat di 0010_add_entitas_and_transfer_pricing.sql)
-- JOIN langsung ke inventory_locations untuk ambil kolom entitas --
-- diarahkan ulang ke core_locations. CREATE OR REPLACE VIEW di sini aman
-- karena daftar & posisi kolom output (item_id, location_id, qty, entitas)
-- tidak berubah sama sekali, cuma sumber JOIN-nya.
CREATE OR REPLACE VIEW inventory_current_stock AS
SELECT s.item_id, s.location_id, SUM(s.qty_change) AS qty, l.entitas
FROM inventory_stock_ledger s
JOIN core_locations l ON l.id = s.location_id
GROUP BY s.item_id, s.location_id, l.entitas;

-- inventory_set_transfer_antar_entitas (trigger function, dibuat di
-- 0010_add_entitas_and_transfer_pricing.sql) SELECT langsung dari
-- inventory_locations di dalam body-nya -- Postgres TIDAK mencatat ini
-- sebagai dependency katalog (beda dari VIEW), jadi DROP TABLE
-- inventory_locations di bawah tidak akan gagal karena fungsi ini, TAPI
-- fungsinya akan diam-diam rusak (selalu NULL) kalau tidak diperbarui.
-- Logika persis sama, cuma sumber tabelnya diganti.
CREATE OR REPLACE FUNCTION inventory_set_transfer_antar_entitas()
RETURNS TRIGGER AS $$
DECLARE
  entitas_asal TEXT;
  entitas_tujuan TEXT;
BEGIN
  SELECT entitas INTO entitas_asal FROM core_locations WHERE id = NEW.location_asal_id;
  SELECT entitas INTO entitas_tujuan FROM core_locations WHERE id = NEW.location_tujuan_id;
  NEW.antar_entitas := (entitas_asal IS DISTINCT FROM entitas_tujuan);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Semua 11 FK yang tadinya menunjuk inventory_locations sudah direpoint
-- ke core_locations di atas, dan view/fungsi yang baca langsung dari
-- inventory_locations sudah diperbarui -- aman dihapus. Datanya sudah
-- dicopy ke core_locations (dengan id yang sama persis) di migrasi core
-- 0006_move_locations_to_core.sql yang selalu jalan sebelum migrasi ini.
DROP TABLE IF EXISTS inventory_locations;
