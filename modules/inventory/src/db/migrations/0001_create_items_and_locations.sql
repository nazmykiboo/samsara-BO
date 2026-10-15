-- Modul Inventory — Tahap 1 (DRAFT, lihat docs/inventory-schema.md).
-- Master item (bahan baku, packaging, hasil produksi, maupun non-bahan
-- seperti alat kebersihan) dan master lokasi (outlet/gudang).

CREATE TYPE inventory_item_type AS ENUM (
  'bahan_baku',
  'packaging',
  'hasil_produksi',
  'non_bahan'
);

CREATE TYPE inventory_item_status AS ENUM (
  'active',
  'pending_data'
);

CREATE TABLE inventory_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type inventory_item_type NOT NULL,
  status inventory_item_status NOT NULL DEFAULT 'pending_data',

  recipe_unit TEXT NOT NULL,
  purchase_unit TEXT,
  purchase_to_recipe_factor NUMERIC(18, 6),

  harga_master NUMERIC(18, 2),

  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN inventory_items.recipe_unit IS
  'Satuan stok = satuan resep. Pembelian diinput dalam purchase_unit lalu dikonversi otomatis pakai purchase_to_recipe_factor.';
COMMENT ON COLUMN inventory_items.status IS
  'pending_data = ada field wajib yang masih kosong (harga_master, purchase_to_recipe_factor, atau yield resep produksinya). HPP/food cost % menu terkait ditandai "menunggu data", tidak memblokir modul lain.';

CREATE TABLE inventory_locations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
