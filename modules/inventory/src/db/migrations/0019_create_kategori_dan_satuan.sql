-- Master kategori item & satuan (resep + beli), supaya form tambah/ubah
-- item di frontend jadi dropdown, bukan isian bebas -- mengurangi human
-- error (typo, variasi penulisan beda-beda untuk hal yang sama).
--
-- Keputusan desain: kolom `inventory_items.category` / `recipe_unit` /
-- `purchase_unit` TETAP TEXT bebas (tidak diubah jadi foreign key ke tabel
-- ini). Alasan: mengubahnya jadi FK berarti migrasi skema besar yang
-- menyentuh 92 baris item yang sudah ada plus banyak titik kode yang baca
-- kolom itu sebagai teks (HPP, laporan, dst) -- risiko tinggi untuk manfaat
-- yang sama. Sebagai gantinya dipakai pola yang sama seperti
-- `core_user_lokasi` (lihat catatan di core/0001): validasi di application
-- layer (dicek exist di tabel ini sebelum insert/update item), bukan FK
-- database. Tabel ini jadi SUMBER DAFTAR untuk dropdown di frontend dan
-- SUMBER VALIDASI di backend saat createItem/updateItem, bukan pemaksaan
-- struktural di level database.
--
-- `inventory_satuan` sengaja SATU tabel dipakai untuk satuan resep MAUPUN
-- satuan beli (bukan dua tabel terpisah) -- di data nyata banyak nilai yang
-- sama dipakai untuk keduanya (mis. "gr", "pcs", "botol"), jadi satu daftar
-- satuan yang bisa dipilih untuk kolom mana pun lebih masuk akal daripada
-- dua daftar yang isinya tumpang tindih.
--
-- Diseed dari nilai DISTINCT yang sudah dipakai 92 item aktif saat ini
-- (dicek lewat query langsung) supaya tidak ada item existing yang jadi
-- "tidak valid" begitu validasi ini aktif.

CREATE TABLE inventory_kategori_item (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_kategori_item IS
  'Daftar kategori item untuk dropdown master item. Dikelola lewat API (permission master_item.edit -- owner & manajer_ops, sama seperti yang boleh tambah/ubah item).';

CREATE TABLE inventory_satuan (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_satuan IS
  'Daftar satuan untuk dropdown satuan resep DAN satuan beli di form master item (satu daftar dipakai untuk keduanya). Dikelola lewat API (permission master_item.edit).';

INSERT INTO inventory_kategori_item (name) VALUES
  ('Buah & Sayur'),
  ('Bubur & Karbo'),
  ('Bumbu, Saus & Minyak'),
  ('Es & Dessert'),
  ('Hasil Produksi'),
  ('Minuman & Pendukung'),
  ('Operasional'),
  ('Packaging'),
  ('Protein'),
  ('Topping & Kerupuk');

INSERT INTO inventory_satuan (name) VALUES
  ('bal'), ('batang'), ('blok'), ('botol'), ('btg'), ('buah'), ('bungkus'),
  ('butir'), ('crg'), ('crt'), ('dus'), ('gr'), ('kemasan 500gr'), ('kg'),
  ('kotak'), ('kotak (8L)'), ('lembar'), ('ml'), ('pack'), ('pcs'),
  ('peti'), ('porsi'), ('rtg'), ('sachet'), ('tetes'), ('unit');
