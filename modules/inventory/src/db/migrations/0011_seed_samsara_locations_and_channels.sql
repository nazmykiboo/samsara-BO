-- Seed lokasi & channel penjualan -- SAMSARA SAJA. Sheet Ref di spreadsheet
-- sumber mencantumkan lokasi lain (Burnas, Ajiep Sutami, Ajiep Dau) yang
-- kelihatan seperti brand lain milik owner -- SENGAJA TIDAK diseed, sesuai
-- batasan keras CLAUDE.md (jangan campur data antar bisnis/brand) dan
-- instruksi eksplisit owner. Lihat docs/architecture-decisions.md § 8.

INSERT INTO inventory_locations (name, entitas, is_active) VALUES
  ('Samsara Central Kitchen', 'samsara_ck', true),
  ('Samsara Outlet 1 Malang', 'samsara_outlet', true);

-- Channel penjualan: tabel referensi baru (belum ada FK dari
-- inventory_transaksi_penjualan.sumber -- itu keputusan Tahap 3 saat modul
-- Penjualan dibangun, lihat docs/architecture-decisions.md § 8).
CREATE TABLE inventory_sales_channel (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO inventory_sales_channel (name) VALUES
  ('Offline'),
  ('GrabFood'),
  ('GoFood'),
  ('ShopeeFood');
