-- Persiapan "katalog menu" yang bisa dikelola owner/Ibnu sendiri, bukan lagi
-- teks bebas hasil impor spreadsheet. Tiga kelompok perubahan di file ini:
--
--   1) Kategori menu jadi TABEL REFERENSI (inventory_kategori_menu) +
--      inventory_menu.kategori_id, menggantikan kolom teks bebas
--      inventory_menu.kategori_menu (0005).
--   2) Visibilitas menu per LOKASI dan per CHANNEL -- dua tabel pengecualian
--      (lihat penjelasan semantik di COMMENT ON TABLE masing-masing).
--   3) Skema modifier/add-on (3 tabel) -- STRUKTUR SAJA, belum dipakai kode.
--
-- Pola yang diikuti (sengaja tidak bikin pola baru):
--   * Tabel referensi + seed dari nilai DISTINCT yang sudah ada di data
--     -> sama seperti inventory_kategori_item / inventory_satuan (0019).
--   * Kolom lama tidak dihapus/diubah, cuma ditandai lewat COMMENT ON COLUMN
--     -> sama seperti inventory_items.min_stok (0020). Lihat CLAUDE.md:
--        migrasi baru, bukan edit migrasi yang sudah applied.
--   * FK ke natural key TEXT (kode_menu -> inventory_menu.kode, channel ->
--     inventory_sales_channel.name) -> sama seperti
--     inventory_menu_harga_channel (0021).
--   * FK lokasi ke core_locations, BUKAN inventory_locations (tabel itu sudah
--     dihapus di 0023_move_locations_to_core.sql).
--
-- Semua DDL pakai IF NOT EXISTS dan semua DML pakai ON CONFLICT DO NOTHING /
-- guard IS NULL supaya file ini aman kalau sampai dijalankan ulang.

-- ---------------------------------------------------------------------------
-- 1) Master kategori menu
-- ---------------------------------------------------------------------------
-- Beda dari inventory_kategori_item (0019) yang cuma name/is_active: tabel ini
-- WAJIB punya `urutan_tampil` karena urutan kategori di menu/kasir itu
-- keputusan bisnis (Buryam dulu, Add on terakhir), bukan alfabetis. Dan punya
-- `kode` karena kode kategori akan dipakai sebagai PREFIX kode menu otomatis
-- nanti (kode menu existing masih format impor M-001..M-057, lihat 0007).
CREATE TABLE IF NOT EXISTS inventory_kategori_menu (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL UNIQUE,
  urutan_tampil INTEGER NOT NULL DEFAULT 0,
  aktif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_kategori_menu IS
  'Master kategori menu (Buryam, Burjo, Paket Hemat, dst) -- menggantikan kolom teks bebas inventory_menu.kategori_menu. Diseed dari 10 nilai DISTINCT kategori_menu yang dipakai 57 menu existing, 1:1 tanpa penggabungan (dikonfirmasi owner: Burjo/Burjoket/Burket/Buryam tetap 4 kategori terpisah, jangan digabung).';
COMMENT ON COLUMN inventory_kategori_menu.kode IS
  'Kode singkat UPPERCASE tanpa spasi, dipakai sebagai PREFIX kode menu otomatis nanti (mis. BURYAM-01). Unik, maksimal ~10 karakter.';
COMMENT ON COLUMN inventory_kategori_menu.urutan_tampil IS
  'Urutan tampil kategori di daftar menu/kasir. Seed awal diisi 1-10 alfabetis berdasar nama (default netral, bukan keputusan bisnis) -- owner bebas mengubahnya lewat API nanti.';

-- `nama` diisi PERSIS seperti nilai kategori_menu lama (termasuk ejaan
-- "Add on" yang huruf kecil di kata kedua) supaya JOIN data di bawah cocok
-- 100% dan tidak ada menu yang gagal ter-mapping.
-- `kode` berbasis nama: spasi dibuang, UPPERCASE. Pengecualian satu-satunya
-- "Paket Hemat" -> PAHE, bukan PAKETHEMAT: "PaHe" adalah singkatan yang sudah
-- dipakai di nama 8 dari 11 menu kategori itu (PaHe Solo, PaHe Ber-2 Pagi,
-- dst, lihat seed 0007), jadi itu istilah yang sudah dikenal tim ops dan
-- lebih enak sebagai prefix kode menu.
INSERT INTO inventory_kategori_menu (kode, nama, urutan_tampil) VALUES
  ('ADDON',    'Add on',      1),
  ('BURJO',    'Burjo',       2),
  ('BURJOKET', 'Burjoket',    3),
  ('BURKET',   'Burket',      4),
  ('BURYAM',   'Buryam',      5),
  ('DRINKS',   'Drinks',      6),
  ('ESTELER',  'Es Teler',    7),
  ('PAHE',     'Paket Hemat', 8),
  ('ROTICANE', 'Roti Cane',   9),
  ('SATE',     'Sate',       10)
ON CONFLICT (nama) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) inventory_menu.kategori_id + deprecate inventory_menu.kategori_menu
-- ---------------------------------------------------------------------------
-- NULLABLE dengan sengaja: tidak semua menu wajib punya kategori (menu baru
-- bisa dibuat dulu, dikategorikan belakangan), dan kolom NOT NULL di tabel
-- yang sudah berisi 57 baris butuh default palsu yang tidak ada artinya.
ALTER TABLE inventory_menu
  ADD COLUMN IF NOT EXISTS kategori_id BIGINT REFERENCES inventory_kategori_menu (id);

COMMENT ON COLUMN inventory_menu.kategori_id IS
  'Kategori menu, referensi ke inventory_kategori_menu. Pengganti kolom teks bebas kategori_menu. Nullable: menu boleh belum punya kategori.';

-- Migrasi data: cocokkan nilai teks lama ke nama kategori baru. Saat migrasi
-- ini ditulis (2026-10-08) 57 dari 57 menu punya kategori_menu terisi dan
-- semuanya salah satu dari 10 nilai di seed atas, jadi seharusnya 57 baris
-- ter-update dan 0 baris sisa (diverifikasi lewat psql setelah migrate).
-- Guard `m.kategori_id IS NULL` supaya kalau file ini dijalankan ulang di
-- masa depan, ia tidak menimpa kategori yang sudah diubah manual lewat API.
UPDATE inventory_menu m
SET kategori_id = k.id
FROM inventory_kategori_menu k
WHERE k.nama = m.kategori_menu
  AND m.kategori_id IS NULL;

COMMENT ON COLUMN inventory_menu.kategori_menu IS
  'DEPRECATED sejak 0024_create_kategori_menu_visibilitas_dan_modifier.sql -- kategori menu sekarang tabel referensi, bukan teks bebas (teks bebas bikin variasi ejaan untuk kategori yang sama dan tidak bisa menyimpan urutan tampil). Gunakan kategori_id -> inventory_kategori_menu, bukan kolom ini. Kolom ini dibiarkan (tidak dihapus) untuk data historis & kompatibilitas mundur; isinya sudah dimigrasikan ke kategori_id. TIDAK BOLEH ditulis lagi oleh kode baru.';

-- ---------------------------------------------------------------------------
-- 3) Visibilitas menu per lokasi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_menu_lokasi (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  menu_id BIGINT NOT NULL REFERENCES inventory_menu (id),
  lokasi_id BIGINT NOT NULL REFERENCES core_locations (id),
  aktif BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (menu_id, lokasi_id)
);

-- POLA BARU di repo ini (belum ada presedennya) -- "tabel pengecualian",
-- bukan "tabel keanggotaan". Dijelaskan panjang di sini karena salah baca
-- tabel ini akan bikin semua menu kelihatan MATI di semua lokasi.
COMMENT ON TABLE inventory_menu_lokasi IS
  'TABEL PENGECUALIAN visibilitas menu per lokasi, BUKAN tabel keanggotaan. DEFAULT-nya: TIDAK ADA baris untuk pasangan (menu_id, lokasi_id) berarti menu itu TERLIHAT/AKTIF di lokasi itu. Baris HANYA dibuat untuk menandai PENGECUALIAN -- biasanya aktif=false, untuk menyembunyikan satu menu di satu lokasi tertentu. Jadi tabel kosong = semua menu aktif di semua lokasi (itu kondisi awal, migrasi ini sengaja TIDAK menyeed apa pun). Kolom aktif tetap ada untuk fleksibilitas (secara teknis boleh menyimpan baris aktif=true eksplisit, artinya sama dengan tidak ada baris). Pembacaan yang BENAR untuk "apakah menu X tampil di lokasi Y": NOT EXISTS (SELECT 1 FROM inventory_menu_lokasi WHERE menu_id=X AND lokasi_id=Y AND aktif=false). JANGAN pakai EXISTS/INNER JOIN untuk menentukan menu tampil -- itu akan salah total karena tabel ini nyaris selalu kosong.';
COMMENT ON COLUMN inventory_menu_lokasi.aktif IS
  'false = menu ini DISEMBUNYIKAN di lokasi ini (satu-satunya alasan praktis baris ini ada). true = eksplisit tampil, sama artinya dengan tidak ada baris sama sekali.';

-- ---------------------------------------------------------------------------
-- 4) Visibilitas menu per channel penjualan
-- ---------------------------------------------------------------------------
-- SENGAJA tabel terpisah dari inventory_menu_harga_channel (0021), JANGAN
-- digabung: harga dan visibilitas punya siklus hidup berbeda -- menu bisa
-- disembunyikan sementara di GoFood tanpa kehilangan harga yang sudah
-- disetel, dan sebaliknya harga bisa disetel untuk channel yang menunya belum
-- ditayangkan. Menggabungnya memaksa harga NOT NULL ada setiap kali orang
-- cuma mau menyembunyikan satu menu.
-- FK natural key TEXT (kode_menu, channel) mengikuti pola 0021 supaya kedua
-- tabel per-channel ini bisa di-JOIN langsung dengan kunci yang sama.
CREATE TABLE IF NOT EXISTS inventory_menu_channel_visibilitas (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode_menu TEXT NOT NULL REFERENCES inventory_menu (kode),
  channel TEXT NOT NULL REFERENCES inventory_sales_channel (name),
  aktif BOOLEAN NOT NULL DEFAULT true,
  diubah_oleh BIGINT REFERENCES core_users (id) ON DELETE SET NULL,
  diubah_pada TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kode_menu, channel)
);

COMMENT ON TABLE inventory_menu_channel_visibilitas IS
  'TABEL PENGECUALIAN visibilitas menu per channel penjualan (Offline/ShopeeFood/GoFood/GrabFood), BUKAN tabel keanggotaan -- semantiknya sama persis seperti inventory_menu_lokasi. DEFAULT-nya: TIDAK ADA baris untuk pasangan (kode_menu, channel) berarti menu itu TERLIHAT/AKTIF di channel itu. Baris HANYA dibuat untuk PENGECUALIAN, biasanya aktif=false (mis. paket dine-in disembunyikan di GoFood). Tabel kosong = semua menu aktif di semua channel (kondisi awal, migrasi ini sengaja TIDAK menyeed apa pun). Pembacaan yang BENAR: NOT EXISTS (SELECT 1 FROM inventory_menu_channel_visibilitas WHERE kode_menu=X AND channel=Y AND aktif=false) -- JANGAN pakai EXISTS/INNER JOIN. Tabel ini TERPISAH dari inventory_menu_harga_channel (0021) dan tidak boleh digabung: harga per channel dan tayang/tidak per channel diubah pada waktu yang berbeda oleh orang yang berbeda.';
COMMENT ON COLUMN inventory_menu_channel_visibilitas.aktif IS
  'false = menu ini DISEMBUNYIKAN di channel ini. true = eksplisit tampil, sama artinya dengan tidak ada baris sama sekali.';
COMMENT ON COLUMN inventory_menu_channel_visibilitas.diubah_oleh IS
  'User yang terakhir mengubah baris ini. Nullable + ON DELETE SET NULL, sama seperti inventory_menu_harga_channel.diubah_oleh (0021) -- user yang dihapus tidak boleh menghapus/menggagalkan riwayat perubahan.';

CREATE INDEX IF NOT EXISTS idx_inventory_menu_channel_visibilitas_kode_menu
  ON inventory_menu_channel_visibilitas (kode_menu);

-- ---------------------------------------------------------------------------
-- 5) Modifier / add-on -- SKEMA SAJA
-- ---------------------------------------------------------------------------
-- Catatan: add-on saat ini masih dimodelkan sebagai MENU biasa berkategori
-- "Add on" (M-048..M-057 di seed 0007, mis. "Ekstra keju"). Tiga tabel di
-- bawah adalah struktur untuk cara yang lebih tepat di masa depan (opsi yang
-- menempel ke menu induk, bukan baris menu sendiri). Data existing TIDAK
-- disentuh dan TIDAK dimigrasikan ke sini -- itu keputusan terpisah yang
-- harus diputuskan owner, bukan efek samping migrasi skema.
CREATE TABLE IF NOT EXISTS inventory_modifier_grup (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  wajib_pilih BOOLEAN NOT NULL DEFAULT false,
  maks_pilihan INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_modifier_grup IS
  'Grup pilihan modifier/add-on untuk menu (mis. "Level pedas", "Topping tambahan"). Skema disiapkan untuk fitur modifier/add-on di masa depan. BELUM dihubungkan ke endpoint, domain function, atau tampilan apa pun -- jangan tambahkan logika bisnis di migrasi ini.';
COMMENT ON COLUMN inventory_modifier_grup.maks_pilihan IS
  'Maksimal jumlah opsi yang boleh dipilih dari grup ini. NULL = tidak ada batas maksimal.';
COMMENT ON COLUMN inventory_modifier_grup.wajib_pilih IS
  'true = pembeli wajib memilih minimal satu opsi dari grup ini (mis. level pedas). Validasinya nanti di layer domain, tidak dipaksakan di database.';

CREATE TABLE IF NOT EXISTS inventory_modifier_opsi (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grup_id BIGINT NOT NULL REFERENCES inventory_modifier_grup (id),
  nama TEXT NOT NULL,
  harga_tambahan NUMERIC(18, 2) NOT NULL DEFAULT 0,
  item_id BIGINT REFERENCES inventory_items (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_modifier_opsi IS
  'Opsi di dalam satu grup modifier (mis. "Keju +3000"). Skema disiapkan untuk fitur modifier/add-on di masa depan. BELUM dihubungkan ke endpoint, domain function, atau tampilan apa pun -- jangan tambahkan logika bisnis di migrasi ini.';
COMMENT ON COLUMN inventory_modifier_opsi.item_id IS
  'Item stok yang terpakai kalau opsi ini dipilih (untuk pengurangan stok & HPP nanti). NULLABLE: opsi add-on belum tentu terhubung ke item stok tertentu (mis. "Tanpa sambal", "Level 0" tidak memakai item apa pun).';
COMMENT ON COLUMN inventory_modifier_opsi.harga_tambahan IS
  'Tambahan harga jual kalau opsi ini dipilih. Default 0 untuk opsi yang gratis (mis. pilihan level pedas).';

CREATE TABLE IF NOT EXISTS inventory_menu_modifier_grup (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  menu_id BIGINT NOT NULL REFERENCES inventory_menu (id),
  grup_id BIGINT NOT NULL REFERENCES inventory_modifier_grup (id),
  UNIQUE (menu_id, grup_id)
);

COMMENT ON TABLE inventory_menu_modifier_grup IS
  'Grup modifier mana yang berlaku untuk menu mana (many-to-many: satu grup bisa dipakai banyak menu). Skema disiapkan untuk fitur modifier/add-on di masa depan. BELUM dihubungkan ke endpoint, domain function, atau tampilan apa pun -- jangan tambahkan logika bisnis di migrasi ini.';
