-- Tahap 2 (Data Modeler) — koreksi skema draft Tahap 1 berdasarkan verifikasi
-- ke spreadsheet asli Inventori_FnB_Standar.xlsx. Detail alasan tiap
-- perubahan ada di docs/inventory-schema.md § "Koreksi dari Tahap 2".

-- 1) inventory_item_type: nilai draft Tahap 1 (bahan_baku, packaging,
--    hasil_produksi, non_bahan) TIDAK COCOK dengan data asli. Sheet Ref dan
--    Master_Item cuma pakai 4 nilai "Tipe": Bahan Baku, Packaging,
--    Operasional, Setengah Jadi. "Hasil Produksi" ternyata Kategori, bukan
--    Tipe. Tabel masih kosong (belum ada data sebelum Tahap 2), jadi aman
--    diganti langsung.
ALTER TYPE inventory_item_type RENAME TO inventory_item_type_old;
CREATE TYPE inventory_item_type AS ENUM (
  'bahan_baku',
  'packaging',
  'operasional',
  'setengah_jadi'
);
ALTER TABLE inventory_items
  ALTER COLUMN type TYPE inventory_item_type USING type::text::inventory_item_type;
DROP TYPE inventory_item_type_old;

-- 2) Kolom yang ada di data asli tapi belum ada di draft Tahap 1.
ALTER TABLE inventory_items
  ADD COLUMN kode TEXT UNIQUE,
  ADD COLUMN category TEXT,
  ADD COLUMN min_stok NUMERIC(18, 6),
  ADD COLUMN shelf_life_hari INTEGER,
  ADD COLUMN catatan TEXT;

COMMENT ON COLUMN inventory_items.kode IS
  'Kode item dari spreadsheet asli (mis. BB-056), dipakai untuk traceability. BUKAN kunci pencarian — kunci pencarian tetap "name" per aturan bisnis.';
COMMENT ON COLUMN inventory_items.category IS
  'Kategori pelaporan (mis. "Protein", "Es & Dessert") — independen dari "type". Bebas diubah, tidak divalidasi ketat.';

ALTER TABLE inventory_menu
  ADD COLUMN kode TEXT UNIQUE,
  ADD COLUMN kategori_menu TEXT,
  ADD COLUMN harga_jual NUMERIC(18, 2),
  ADD COLUMN catatan TEXT;

ALTER TABLE inventory_resep_produksi
  ADD COLUMN kode TEXT UNIQUE,
  ADD COLUMN catatan TEXT;

-- 3) Paket/bundle menu (mis. "PaHe Ber-2 Pagi") — konsep yang tidak
--    tercakup di draft Tahap 1 sama sekali, ditemukan saat verifikasi
--    sheet Paket_Menu_Baris. Sebuah "paket" adalah BARIS BIASA di
--    inventory_menu juga (kode & nama menu yang sama), cuma komposisinya
--    dari menu lain (bukan dari bahan mentah lewat inventory_menu_resep_baris).
CREATE TABLE inventory_paket_menu_baris (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  paket_menu_id BIGINT NOT NULL REFERENCES inventory_menu (id) ON DELETE CASCADE,
  item_menu_id BIGINT NOT NULL REFERENCES inventory_menu (id),
  qty NUMERIC(18, 6) NOT NULL,
  CHECK (paket_menu_id <> item_menu_id)
);

COMMENT ON TABLE inventory_paket_menu_baris IS
  'Komposisi menu paket/bundle dari beberapa menu dasar. paket_menu_id dan item_menu_id sama-sama merujuk ke inventory_menu — satu baris di inventory_menu bisa berupa menu dasar ATAU paket, dibedakan dari ada/tidaknya baris di sini sebagai paket_menu_id.';

-- 4) Resep menu boleh pakai bahan_baku, setengah_jadi, atau packaging —
--    TIDAK BOLEH operasional (dikonfirmasi dari header sheet Resep_Menu_Baris:
--    "Bahan (bahan baku / setengah jadi / packaging)"). Sama seperti trigger
--    resep produksi, dijaga di level database.
CREATE OR REPLACE FUNCTION inventory_check_menu_resep_baris()
RETURNS TRIGGER AS $$
DECLARE
  bahan_type inventory_item_type;
BEGIN
  SELECT type INTO bahan_type FROM inventory_items WHERE id = NEW.item_id;
  IF bahan_type = 'operasional' THEN
    RAISE EXCEPTION
      'Resep menu tidak boleh pakai item operasional, item id % bertipe %',
      NEW.item_id, bahan_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_menu_resep_baris_check
  BEFORE INSERT OR UPDATE ON inventory_menu_resep_baris
  FOR EACH ROW EXECUTE FUNCTION inventory_check_menu_resep_baris();
