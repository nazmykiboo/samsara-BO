-- Koreksi atas migrasi 0005: trigger yang menolak item bertipe 'operasional'
-- di inventory_menu_resep_baris ternyata SALAH terhadap data asli.
--
-- Asumsi semula (dari header sheet Resep_Menu_Baris: "Bahan (bahan baku /
-- setengah jadi / packaging)") ternyata tidak berlaku ketat di data
-- sungguhan: hampir semua menu (47 dari 57) memakai "Kertas thermal
-- Coreless 5730" (struk) dan/atau "Cup Sealer" sebagai baris resep — kedua
-- item itu bertipe Operasional di Master_Item, bukan Packaging, tapi jelas
-- dipakai/habis per transaksi penjualan seperti halnya packaging.
--
-- Kesimpulan: tidak ada pembatasan tipe item yang berlaku di
-- inventory_menu_resep_baris. Trigger analog di inventory_resep_produksi_baris
-- (hanya boleh bahan_baku/packaging) TETAP berlaku — itu terverifikasi benar
-- di data (lihat docs/inventory-schema.md).

DROP TRIGGER IF EXISTS trg_inventory_menu_resep_baris_check ON inventory_menu_resep_baris;
DROP FUNCTION IF EXISTS inventory_check_menu_resep_baris();
