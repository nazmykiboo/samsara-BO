-- Satu-satunya sumber kebenaran stok. Stok TIDAK PERNAH diedit langsung —
-- setiap baris di sini lahir dari salah satu tabel transaksi (0004).

CREATE TYPE inventory_transaction_type AS ENUM (
  'pembelian',
  'produksi',
  'penjualan',
  'transfer_keluar',
  'transfer_masuk',
  'mutasi_lain',
  'opname'
);

CREATE TABLE inventory_stock_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  location_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  transaction_type inventory_transaction_type NOT NULL,
  reference_table TEXT NOT NULL,
  reference_id BIGINT NOT NULL,
  qty_change NUMERIC(18, 6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN inventory_stock_ledger.reference_table IS
  'Nama tabel baris transaksi asal, mis. "inventory_transaksi_pembelian_baris" — link balik ke transaksi yang memicu baris ledger ini.';
COMMENT ON COLUMN inventory_stock_ledger.qty_change IS
  'Dalam recipe_unit item. Positif = stok masuk, negatif = stok keluar.';

CREATE INDEX idx_inventory_stock_ledger_item_location
  ON inventory_stock_ledger (item_id, location_id);

-- Stok saat ini = SUM(qty_change) per item+lokasi — view ini yang dibaca,
-- bukan kolom stok yang diedit manual.
CREATE VIEW inventory_current_stock AS
SELECT item_id, location_id, SUM(qty_change) AS qty
FROM inventory_stock_ledger
GROUP BY item_id, location_id;
