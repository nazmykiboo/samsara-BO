-- Koreksi data: Garam (BB-056) sebenarnya SUDAH punya harga (Rp7.100 per
-- kemasan 500 gr) -- angka ini sudah benar di kolom harga_master (14.2/gr
-- = 7100/500) sejak seed Tahap 2, cuma label satuan belinya salah ("gr",
-- padahal maksudnya kemasan berisi 500 gr) dan statusnya masih pending_data
-- mengikuti catatan lama di spreadsheet yang sudah tidak berlaku.
--
-- Dikonfirmasi owner (2026-09-28). Item lain yang TETAP pending_data:
-- Sapu, Pembersih lantai/meja/piring, Cup es teler + tutup, Mutiara --
-- tidak disentuh migrasi ini.

UPDATE inventory_items
SET
  purchase_unit = 'kemasan 500gr',
  status = 'active',
  catatan = 'Dikonfirmasi owner (2026-09-28): harga Rp7.100 per kemasan 500 gr. Konversi (500) dan harga_master (14.2/gr) sudah benar sejak awal -- yang salah cuma label satuan beli ("gr", diperbaiki jadi "kemasan 500gr") dan status (sebelumnya ikut pending_data karena catatan lama, sekarang aktif).'
WHERE kode = 'BB-056';
