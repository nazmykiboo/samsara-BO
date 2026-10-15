-- Koreksi data: "Kertas thermal Coreless 5730" (OP-005) di Master_Item
-- tercatat harga_master Rp1.590/pcs (Rp159.000/pack ÷ 100 pcs), TAPI nilai
-- yang sudah dipakai & dihitung konsisten di 47 baris Resep_Menu_Baris
-- (dan di kolom HPP Master_Menu) semuanya Rp50/pcs -- inkonsistensi di
-- dalam spreadsheet sumber itu sendiri (kemungkinan harga/konversi di
-- Master_Item diedit setelah HPP resep terakhir dihitung, tidak sempat
-- di-recalculate ulang).
--
-- Ditemukan lewat verifikasi HPP sistem vs HPP sheet (selisih tetap
-- ~Rp1.540 = 1590-50 di 34 dari 46 menu dasar). Dikonfirmasi owner
-- (2026-09-28): Rp50/pcs yang benar. purchase_unit dan
-- purchase_to_recipe_factor TIDAK diubah (kita tidak tahu pasti bagian
-- mana -- harga beli per pack atau faktor konversi -- yang salah di data
-- asli, cuma hasil akhirnya yang bisa diverifikasi silang). Kalau owner
-- dapat angka pembelian aktual dari supplier, purchase_unit/harga
-- beli/konversi bisa diperbaiki lebih presisi lewat migrasi lain.

UPDATE inventory_items
SET
  harga_master = 50.00,
  catatan = 'Dikoreksi owner (2026-09-28): Master_Item awalnya mencatat Rp1.590/pcs (159.000/pack / 100), tapi seluruh Resep_Menu_Baris & HPP Master_Menu konsisten pakai Rp50/pcs -- dikonfirmasi Rp50 yang benar. purchase_unit ("pack") dan purchase_to_recipe_factor (100) dibiarkan apa adanya karena belum jelas bagian mana yang salah di data asli -- cuma harga_master efektif yang dikoreksi.'
WHERE kode = 'OP-005';
