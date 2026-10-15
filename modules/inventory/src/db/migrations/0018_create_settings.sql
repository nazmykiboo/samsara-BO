-- Pengaturan modul Inventory (key-value sederhana). Lokasi & channel sudah
-- punya tabelnya sendiri (inventory_locations, inventory_sales_channel,
-- Tahap 2) -- cuma perlu endpoint kelola, bukan tabel baru. Yang butuh
-- tabel baru cuma metode HPP default.

CREATE TABLE inventory_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_settings IS
  'Key-value pengaturan modul. Owner-only lewat API (lihat permission pengaturan.manage di module.json).';

INSERT INTO inventory_settings (key, value) VALUES ('hpp_default_method', 'harga_master');
