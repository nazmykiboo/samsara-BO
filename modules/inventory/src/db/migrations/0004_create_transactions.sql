-- Tabel transaksi per jenis. Semua perubahan stok WAJIB lewat salah satu
-- tabel ini (lalu posting baris ke inventory_stock_ledger) — lihat aturan
-- bisnis di CLAUDE.md § "Aturan bisnis modul Inventory".
-- Logika posting ke ledger & kalkulasi turunan (konversi, food cost, dst)
-- adalah tanggung jawab Backend Developer (Tahap 3), bukan bagian migrasi ini.

-- Pembelian
CREATE TABLE inventory_transaksi_pembelian (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  supplier TEXT,
  no_referensi TEXT,
  tanggal DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_transaksi_pembelian_baris (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  header_id BIGINT NOT NULL REFERENCES inventory_transaksi_pembelian (id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  qty_beli NUMERIC(18, 6) NOT NULL,
  satuan_beli TEXT NOT NULL,
  harga_satuan NUMERIC(18, 2) NOT NULL,
  qty_recipe_unit NUMERIC(18, 6) NOT NULL
);

COMMENT ON COLUMN inventory_transaksi_pembelian_baris.qty_recipe_unit IS
  'Hasil konversi qty_beli ke recipe_unit, disimpan (bukan dihitung ulang) supaya riwayat tidak berubah kalau purchase_to_recipe_factor item diupdate belakangan.';

-- Produksi
CREATE TABLE inventory_transaksi_produksi (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resep_id BIGINT NOT NULL REFERENCES inventory_resep_produksi (id),
  location_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  qty_batch NUMERIC(18, 6) NOT NULL,
  tanggal DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN inventory_transaksi_produksi.qty_batch IS
  'Resep dijalankan berapa kali. Pemakaian bahan = resep_baris.qty * qty_batch; hasil produksi = yield_qty * qty_batch.';

-- Penjualan
CREATE TABLE inventory_transaksi_penjualan (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  sumber TEXT NOT NULL,
  no_referensi TEXT,
  tanggal DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN inventory_transaksi_penjualan.sumber IS
  'Contoh: pos_majoo, shopeefood, grabfood, gofood.';

CREATE TABLE inventory_transaksi_penjualan_baris (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  header_id BIGINT NOT NULL REFERENCES inventory_transaksi_penjualan (id) ON DELETE CASCADE,
  menu_id BIGINT NOT NULL REFERENCES inventory_menu (id),
  qty NUMERIC(18, 6) NOT NULL
);

-- Transfer antar lokasi (mencatat susut = qty_kirim - qty_terima)
CREATE TABLE inventory_transaksi_transfer (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_asal_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  location_tujuan_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  tanggal DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (location_asal_id <> location_tujuan_id)
);

CREATE TABLE inventory_transaksi_transfer_baris (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  header_id BIGINT NOT NULL REFERENCES inventory_transaksi_transfer (id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  qty_kirim NUMERIC(18, 6) NOT NULL,
  qty_terima NUMERIC(18, 6) NOT NULL,
  unit TEXT NOT NULL
);

COMMENT ON TABLE inventory_transaksi_transfer_baris IS
  'Susut = qty_kirim - qty_terima, dihitung saat dibaca (bukan kolom tersimpan).';

-- Mutasi lain (penyesuaian non-standar: rusak, hilang, dll — qty_change bisa +/-)
CREATE TABLE inventory_transaksi_mutasi_lain (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  alasan TEXT NOT NULL,
  tanggal DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_transaksi_mutasi_lain_baris (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  header_id BIGINT NOT NULL REFERENCES inventory_transaksi_mutasi_lain (id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  qty_change NUMERIC(18, 6) NOT NULL
);

-- Opname (stok fisik vs sistem)
CREATE TABLE inventory_transaksi_opname (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES inventory_locations (id),
  tanggal DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_transaksi_opname_baris (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  header_id BIGINT NOT NULL REFERENCES inventory_transaksi_opname (id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  qty_sistem NUMERIC(18, 6) NOT NULL,
  qty_fisik NUMERIC(18, 6) NOT NULL
);

COMMENT ON TABLE inventory_transaksi_opname_baris IS
  'qty_sistem = snapshot inventory_current_stock saat opname dibuat. Selisih = qty_fisik - qty_sistem, diposting ke stock_ledger sebagai penyesuaian.';
