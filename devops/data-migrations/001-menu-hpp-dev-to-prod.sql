-- STATUS: SUDAH DIJALANKAN ke production 2026-10-17 (hasil 0 error, terverifikasi
-- cocok persis dengan dev termasuk perhitungan HPP 70 menu/item). Disimpan di sini
-- sebagai arsip/dokumentasi, BUKAN untuk dijalankan ulang.
-- ============================================================================
-- MIGRASI DATA: Menu & HPP dev -> production
-- Dibuat: 2026-10-17. HANYA UNTUK DIREVIEW -- JANGAN dijalankan ke production
-- sebelum owner setuju eksplisit.
--
-- Konteks: production di-seed dari migrasi SQL yang sama persis dengan dev
-- (lihat devops/README.md -- deploy #1), jadi SEBAGIAN BESAR item/menu/resep
-- sudah identik di kedua sisi. Delta ini ditemukan lewat perbandingan isi
-- PENUH (bukan cuma hitung baris) antara dev dan production pada 2026-10-17:
-- 93 item dev vs 92 production, 58 menu dev vs 57 production, dan beberapa
-- resep menu yang KONTENNYA beda walau jumlah barisnya kebetulan sama di
-- beberapa kasus -- makanya perbandingan baris-per-baris wajib, bukan cuma
-- count(*).
--
-- Dijalankan sebagai SATU transaksi -- kalau ada satu bagian gagal, semuanya
-- batal (tidak ada perubahan setengah jadi).
--
-- WAJIB dijalankan SEBELUM 002-salessync-config-dev-to-prod.sql -- skrip itu
-- punya 1 baris item_mapping dan 4 baris harga_channel yang menunjuk ke
-- menu BURJOKET-004 yang baru dibuat di sini.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Item baru: PK-015 "Stiker" -- dibuat di dev 2026-10-05 (insiden koreksi
--    resep M-001, lihat docs/architecture-decisions.md riwayat terkait OP-005),
--    belum pernah ada di production karena dibuat SETELAH migrasi seed asli.
--    status 'pending_data' dipertahankan apa adanya (sama seperti di dev --
--    item ini memang belum lengkap datanya, BUKAN kesalahan skrip).
-- ----------------------------------------------------------------------------
INSERT INTO inventory_items
  (name, type, status, recipe_unit, purchase_unit, purchase_to_recipe_factor, harga_master, is_active, kode, category, min_stok, shelf_life_hari, catatan)
SELECT 'Stiker', 'packaging', 'pending_data', 'pcs', 'lembar', 113.000000, 63.72, true, 'PK-015', 'Packaging', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE kode = 'PK-015');

-- ----------------------------------------------------------------------------
-- 2. Koreksi harga: BB-023 "Susu evaporasi Tiga Sapi 500 gr" -- owner
--    mengubah harga_master dari 13.92 ke 28.00 di dev pada 2026-10-12 (lihat
--    diagnosis sesi sebelumnya soal selisih HPP M-034/"Saraf-an Sehat").
--    Production masih punya harga seed asli (13.92) -- SALAH, harus
--    disamakan ke harga terkini.
-- ----------------------------------------------------------------------------
UPDATE inventory_items SET harga_master = 28.00, updated_at = now()
WHERE kode = 'BB-023' AND harga_master <> 28.00;

-- ----------------------------------------------------------------------------
-- 3. Menu baru: BURJOKET-004 "Burjoket Panas" -- dibuat di dev 2026-10-09,
--    belum ada di production. kategori_id=3 dipertahankan sama seperti dev
--    (kategori tidak berubah antara dev/production, sudah diverifikasi sama).
-- ----------------------------------------------------------------------------
INSERT INTO inventory_menu (name, is_active, kode, kategori_id)
SELECT 'Burjoket Panas', true, 'BURJOKET-004', 3
WHERE NOT EXISTS (SELECT 1 FROM inventory_menu WHERE kode = 'BURJOKET-004');

-- ----------------------------------------------------------------------------
-- 4. Resep BURJOKET-004 (6 baris) -- disalin persis dari dev. Dicari lewat
--    kode (bukan id numerik -- id PK-015/BURJOKET-004 di production PASTI
--    beda dari dev karena sequence masing-masing database independen).
-- ----------------------------------------------------------------------------
INSERT INTO inventory_menu_resep_baris (menu_id, item_id, qty, unit)
SELECT m.id, i.id, v.qty, v.unit
FROM (VALUES
  ('BB-002', 75.000000, 'gr'),
  ('BB-003', 90.000000, 'gr'),
  ('BB-020', 10.000000, 'gr'),
  ('BB-023', 20.000000, 'ml'),
  ('PK-001', 1.000000, 'pcs'),
  ('PK-002', 1.000000, 'pcs')
) AS v(item_kode, qty, unit)
JOIN inventory_items i ON i.kode = v.item_kode
JOIN inventory_menu m ON m.kode = 'BURJOKET-004'
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_menu_resep_baris b WHERE b.menu_id = m.id AND b.item_id = i.id
);

-- ----------------------------------------------------------------------------
-- 5. Resep M-001 "Bubur Polos" -- koreksi 2026-10-05: OP-005 (Kertas thermal)
--    DIHAPUS dari resep, diganti PK-015 (Stiker). Production masih punya
--    resep LAMA (dengan OP-005, tanpa PK-015) -- harus disamakan ke resep
--    terkini yang dev pakai sekarang.
-- ----------------------------------------------------------------------------
INSERT INTO inventory_menu_resep_baris (menu_id, item_id, qty, unit)
SELECT m.id, i.id, 1.000000, 'pcs'
FROM inventory_menu m, inventory_items i
WHERE m.kode = 'M-001' AND i.kode = 'PK-015'
  AND NOT EXISTS (SELECT 1 FROM inventory_menu_resep_baris b WHERE b.menu_id = m.id AND b.item_id = i.id);

DELETE FROM inventory_menu_resep_baris b
USING inventory_menu m, inventory_items i
WHERE b.menu_id = m.id AND b.item_id = i.id AND m.kode = 'M-001' AND i.kode = 'OP-005';

-- ----------------------------------------------------------------------------
-- 6. Resep M-002 "Bubur Original" -- OP-005 dihapus dari resep di dev (tanpa
--    penggantian item lain), production masih punya baris lama ini.
-- ----------------------------------------------------------------------------
DELETE FROM inventory_menu_resep_baris b
USING inventory_menu m, inventory_items i
WHERE b.menu_id = m.id AND b.item_id = i.id AND m.kode = 'M-002' AND i.kode = 'OP-005';

-- ----------------------------------------------------------------------------
-- 7. Resep M-006 -- OP-005 dan PK-011 (Kresek kecil Tic-Tas) dihapus dari
--    resep di dev, production masih punya keduanya.
-- ----------------------------------------------------------------------------
DELETE FROM inventory_menu_resep_baris b
USING inventory_menu m, inventory_items i
WHERE b.menu_id = m.id AND b.item_id = i.id AND m.kode = 'M-006' AND i.kode IN ('OP-005', 'PK-011');

-- ----------------------------------------------------------------------------
-- 8. Visibilitas channel BURJOKET-004 (4 baris, semua aktif=false -- menu
--    baru ini belum dipasarkan ke channel manapun) dan M-057 (3 baris,
--    disembunyikan dari GoFood/GrabFood/ShopeeFood, tetap tampil di Offline
--    lewat semantik "tidak ada baris = tayang").
-- ----------------------------------------------------------------------------
INSERT INTO inventory_menu_channel_visibilitas (kode_menu, channel, aktif)
SELECT v.kode_menu, v.channel, v.aktif
FROM (VALUES
  ('BURJOKET-004', 'GoFood', false),
  ('BURJOKET-004', 'GrabFood', false),
  ('BURJOKET-004', 'Offline', false),
  ('BURJOKET-004', 'ShopeeFood', false),
  ('M-057', 'GoFood', false),
  ('M-057', 'GrabFood', false),
  ('M-057', 'ShopeeFood', false)
) AS v(kode_menu, channel, aktif)
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_menu_channel_visibilitas x WHERE x.kode_menu = v.kode_menu AND x.channel = v.channel
);

-- ----------------------------------------------------------------------------
-- 9. Visibilitas lokasi BURJOKET-004 (1 baris: disembunyikan dari lokasi
--    "Samsara Central Kitchen" -- dicari lewat NAMA, bukan id numerik,
--    karena id lokasi bisa berbeda urutan antar database).
-- ----------------------------------------------------------------------------
INSERT INTO inventory_menu_lokasi (menu_id, lokasi_id, aktif)
SELECT m.id, l.id, false
FROM inventory_menu m, core_locations l
WHERE m.kode = 'BURJOKET-004' AND l.name = 'Samsara Central Kitchen'
  AND NOT EXISTS (SELECT 1 FROM inventory_menu_lokasi x WHERE x.menu_id = m.id AND x.lokasi_id = l.id);

-- ----------------------------------------------------------------------------
-- VERIFIKASI (jalankan manual setelah COMMIT, bandingkan dengan hasil yang
-- sama persis di dev):
--   SELECT count(*) FROM inventory_items;              -- harus 93
--   SELECT count(*) FROM inventory_menu;                -- harus 58
--   SELECT count(*) FROM inventory_menu_resep_baris;    -- harus 399
--   SELECT harga_master FROM inventory_items WHERE kode='BB-023'; -- harus 28.00
-- ----------------------------------------------------------------------------

-- SENGAJA ROLLBACK, bukan COMMIT -- ganti ke COMMIT manual setelah direview
-- dan disetujui owner. Jangan ganti baris ini tanpa instruksi eksplisit.
ROLLBACK;
