-- Resep produksi: HANYA 1 level. Bahannya wajib bahan_baku atau packaging,
-- TIDAK BOLEH hasil_produksi lain — dijaga trigger di bawah, bukan cuma konvensi.

CREATE TABLE inventory_resep_produksi (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  output_item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  yield_qty NUMERIC(18, 6),
  yield_unit TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN inventory_resep_produksi.yield_qty IS
  'Berapa recipe_unit dari output_item dihasilkan per 1 kali batch resep ini dijalankan.';

CREATE TABLE inventory_resep_produksi_baris (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resep_id BIGINT NOT NULL REFERENCES inventory_resep_produksi (id) ON DELETE CASCADE,
  bahan_item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  qty NUMERIC(18, 6) NOT NULL,
  unit TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION inventory_check_resep_produksi_baris()
RETURNS TRIGGER AS $$
DECLARE
  bahan_type inventory_item_type;
BEGIN
  SELECT type INTO bahan_type FROM inventory_items WHERE id = NEW.bahan_item_id;
  IF bahan_type NOT IN ('bahan_baku', 'packaging') THEN
    RAISE EXCEPTION
      'Resep produksi cuma boleh pakai bahan_baku/packaging, item id % bertipe %',
      NEW.bahan_item_id, bahan_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_resep_produksi_baris_check
  BEFORE INSERT OR UPDATE ON inventory_resep_produksi_baris
  FOR EACH ROW EXECUTE FUNCTION inventory_check_resep_produksi_baris();

-- Menu (dijual ke pelanggan). Resep menu BOLEH pakai bahan_baku, packaging,
-- ATAU hasil_produksi — beda dengan resep produksi di atas.

CREATE TABLE inventory_menu (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_menu_resep_baris (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  menu_id BIGINT NOT NULL REFERENCES inventory_menu (id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  qty NUMERIC(18, 6) NOT NULL,
  unit TEXT NOT NULL
);
