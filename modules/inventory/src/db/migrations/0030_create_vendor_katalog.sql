-- Tahap 3 "Vendor & Katalog" (di dalam modul Inventory, BUKAN modul baru).
-- Scope SENGAJA sempit sesuai instruksi: vendor + katalog harga per item +
-- riwayat harga + vendor_id opsional di pembelian. TIDAK ada PO, hutang,
-- retur, atau QC -- itu di luar scope tahap ini.

CREATE TABLE inventory_vendor (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  kontak_nama TEXT,
  telepon TEXT,
  alamat TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_vendor IS
  'Master vendor/supplier -- BARU di Tahap 3 "Vendor & Katalog". Terpisah dari kolom lama inventory_transaksi_pembelian.supplier (TEKS BEBAS, dipertahankan apa adanya) -- lihat COMMENT di kolom itu untuk kenapa keduanya TIDAK digabung otomatis.';

-- Katalog = state TERKINI "vendor ini jual item ini, harga terakhir X" --
-- satu baris per kombinasi vendor+item. Riwayat perubahan harga ADA DI
-- TABEL TERPISAH (inventory_vendor_harga_riwayat) supaya katalog tetap
-- murah dibaca (tidak perlu agregasi) untuk kebutuhan paling umum: isi
-- otomatis harga terakhir di form Pembelian.
CREATE TABLE inventory_vendor_katalog (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES inventory_vendor (id),
  item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  harga_terakhir NUMERIC(18, 2) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, item_id)
);

COMMENT ON TABLE inventory_vendor_katalog IS
  'Katalog vendor-item: harga TERAKHIR yang diketahui per kombinasi vendor+item. Diperbarui otomatis tiap kali ada pembelian baru dengan vendor_id+item ini (lihat createPembelian), atau manual lewat endpoint katalog. Riwayat perubahan harga lengkap ada di inventory_vendor_harga_riwayat, BUKAN di tabel ini.';

CREATE TABLE inventory_vendor_harga_riwayat (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES inventory_vendor (id),
  item_id BIGINT NOT NULL REFERENCES inventory_items (id),
  harga NUMERIC(18, 2) NOT NULL,
  sumber TEXT NOT NULL,
  -- Nullable: sengaja TANPA foreign key -- reference_id bisa menunjuk ke
  -- inventory_transaksi_pembelian (sumber='pembelian') atau tidak ada sama
  -- sekali (sumber='manual'), pola sama seperti reference_table/reference_id
  -- longgar di inventory_stock_ledger.
  reference_id BIGINT,
  dicatat_pada TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_vendor_harga_riwayat IS
  'Riwayat SETIAP perubahan harga per kombinasi vendor+item -- satu baris per kejadian, tidak pernah di-UPDATE/overwrite. sumber = ''pembelian'' (reference_id = inventory_transaksi_pembelian.id) atau ''manual'' (owner/manajer_ops isi langsung lewat katalog, reference_id NULL).';

CREATE INDEX idx_inventory_vendor_harga_riwayat_vendor_item
  ON inventory_vendor_harga_riwayat (vendor_id, item_id, dicatat_pada DESC);

-- vendor_id OPSIONAL di header pembelian -- kolom `supplier` (teks bebas)
-- TETAP ADA apa adanya, TIDAK dihapus dan TIDAK di-backfill dari vendor_id
-- atau sebaliknya. Pembelian lama (supplier teks, vendor_id NULL) tetap
-- valid selamanya; pembelian baru BOLEH isi salah satu, keduanya, atau
-- tidak dua-duanya.
ALTER TABLE inventory_transaksi_pembelian ADD COLUMN vendor_id BIGINT REFERENCES inventory_vendor (id);

COMMENT ON COLUMN inventory_transaksi_pembelian.supplier IS
  'Teks bebas nama supplier, SEBELUM ada master vendor (Tahap 3). SENGAJA TIDAK digabung/dimigrasikan otomatis ke inventory_vendor -- instruksi eksplisit owner: nilai-nilai lama ini cuma DILAPORKAN daftarnya (lihat domain/vendor.ts, laporkanSupplierLama) supaya owner yang menilai sendiri mana yang mau dijadikan vendor sungguhan, bukan di-merge berdasarkan kecocokan teks yang bisa salah (mis. "Toko Budi" vs "Toko Budi Jaya" vs typo).';
COMMENT ON COLUMN inventory_transaksi_pembelian.vendor_id IS
  'Opsional (Tahap 3) -- kalau diisi, createPembelian() otomatis memperbarui inventory_vendor_katalog.harga_terakhir dan mencatat inventory_vendor_harga_riwayat untuk tiap baris pembelian ini.';

-- Ambang kenaikan harga vendor -- pola sama seperti baris lain di
-- inventory_insight_rules (migrasi 0025): satuan PERSEN, bisa diubah owner
-- lewat UI nanti tanpa deploy ulang kode.
INSERT INTO inventory_insight_rules (kode, deskripsi, ambang_batas) VALUES
  ('kenaikan_harga_vendor_persen', 'Persentase kenaikan harga beli dari vendor (dibanding harga terakhir di katalog) yang memicu peringatan di form Pembelian.', 10)
ON CONFLICT (kode) DO NOTHING;
