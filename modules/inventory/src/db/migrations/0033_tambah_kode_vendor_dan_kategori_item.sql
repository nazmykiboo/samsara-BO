-- Tahap 1C: kode otomatis untuk Master Item, Resep Produksi, Vendor, dan
-- Kategori Item (lihat README devops & CLAUDE.md untuk aturan lengkap).
-- Item & Resep Produksi SUDAH punya kolom `kode` sejak awal (migrasi 0005) --
-- yang berubah cuma CARA mengisinya (server generate, bukan user ketik
-- manual), tidak ada perubahan skema untuk keduanya.
--
-- Vendor & Kategori Item SEBELUM migrasi ini TIDAK PUNYA kolom kode sama
-- sekali (dikonfirmasi owner lewat AskUserQuestion sesi ini -- scope
-- ditambah, bukan cuma 2 entitas yang sudah ada kodenya). Prefix VN-/KT-
-- dipilih sendiri (owner cuma menegaskan RP- untuk resep produksi secara
-- eksplisit) -- konsisten dengan pola 2 huruf kapital + nomor urut yang
-- sudah dipakai BB-/PK-/OP-/SJ-/RP-.
--
-- Backfill: baris LAMA diberi kode urut berdasarkan `id` (urutan dibuat),
-- supaya constraint UNIQUE/NOT NULL di bawah bisa langsung dipasang tanpa
-- nilai kosong. Idempoten: kolom/index/constraint pakai IF NOT EXISTS, dan
-- backfill WHERE kode IS NULL (aman dijalankan ulang).

ALTER TABLE inventory_vendor ADD COLUMN IF NOT EXISTS kode TEXT;
ALTER TABLE inventory_kategori_item ADD COLUMN IF NOT EXISTS kode TEXT;

WITH urut AS (
  SELECT id, 'VN-' || lpad(row_number() OVER (ORDER BY id)::text, 3, '0') AS kode_baru
  FROM inventory_vendor
  WHERE kode IS NULL
)
UPDATE inventory_vendor v SET kode = urut.kode_baru FROM urut WHERE v.id = urut.id;

WITH urut AS (
  SELECT id, 'KT-' || lpad(row_number() OVER (ORDER BY id)::text, 3, '0') AS kode_baru
  FROM inventory_kategori_item
  WHERE kode IS NULL
)
UPDATE inventory_kategori_item k SET kode = urut.kode_baru FROM urut WHERE k.id = urut.id;

ALTER TABLE inventory_vendor ALTER COLUMN kode SET NOT NULL;
ALTER TABLE inventory_kategori_item ALTER COLUMN kode SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_vendor_kode_key') THEN
    ALTER TABLE inventory_vendor ADD CONSTRAINT inventory_vendor_kode_key UNIQUE (kode);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_kategori_item_kode_key') THEN
    ALTER TABLE inventory_kategori_item ADD CONSTRAINT inventory_kategori_item_kode_key UNIQUE (kode);
  END IF;
END $$;

COMMENT ON COLUMN inventory_vendor.kode IS
  'Kode singkat vendor, prefix VN- + nomor urut 3 digit. Dibuat otomatis di server (createVendor) kalau tidak dikirim client, TETAP BISA diedit manual (lihat updateVendor) -- bukan kunci pencarian, cuma identifier ringkas (sama pola dengan inventory_items.kode).';
COMMENT ON COLUMN inventory_kategori_item.kode IS
  'Kode singkat kategori item, prefix KT- + nomor urut 3 digit. Dibuat otomatis di server (createKategori) kalau tidak dikirim client, TETAP BISA diedit manual -- bukan kunci pencarian (kunci tetap `name`), sama pola dengan inventory_items.kode.';
