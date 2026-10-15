-- Koreksi data: baris resep "Kacang" di menu Bubur Original (M-002) yang
-- dikecualikan saat seed Tahap 2 (migrasi 0007).
--
-- Investigasi (diminta owner): dicek ulang teks mentah sel Resep_Menu_Baris
-- baris M-002/Kacang -- tidak ada spasi tersembunyi, tidak ada masalah
-- case/encoding ('Kacang', 6 karakter, persis). Ini BUKAN bug parser seed.
-- Sel itu memang berisi nama singkat "Kacang" di sumber data, berbeda dari
-- nama lengkap item "Kacang dele panda 5 kg" (BB-011) yang dipakai apa
-- adanya (dan berhasil di-seed) di 5 menu serupa: M-003, M-004, M-005,
-- M-045, M-046 -- semuanya qty 5 gr, pola yang sama persis dengan M-002.
-- Owner mengonfirmasi "Kacang" di M-002 memang dimaksudkan BB-011.

INSERT INTO inventory_menu_resep_baris (menu_id, item_id, qty, unit)
SELECT
  (SELECT id FROM inventory_menu WHERE kode = 'M-002'),
  (SELECT id FROM inventory_items WHERE kode = 'BB-011'),
  5,
  'gr'
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_menu_resep_baris b
  WHERE b.menu_id = (SELECT id FROM inventory_menu WHERE kode = 'M-002')
    AND b.item_id = (SELECT id FROM inventory_items WHERE kode = 'BB-011')
);

UPDATE inventory_menu
SET catatan = '[Tahap 2] Baris resep "Kacang" (qty 5, gr) awalnya dikecualikan karena nama tidak cocok item manapun. Dikonfirmasi owner (2026-09-28): merujuk ke "Kacang dele panda 5 kg" (BB-011), sama seperti pola di menu Bubur lain (M-003/M-004/M-005/M-045/M-046). Sudah ditambahkan ke inventory_menu_resep_baris lewat migrasi 0008.'
WHERE kode = 'M-002';
