-- Tahap 3 (Backend Developer): mesin produksi butuh mencatat hasil AKTUAL
-- (bukan cuma qty_batch teoretis) supaya selisih yield bisa dihitung.
-- Bahan yang dipakai tetap dihitung dari resep x qty_batch (konsumsi bahan
-- tidak berubah walau hasilnya meleset), tapi stok hasil produksi yang
-- benar-benar masuk ke stok adalah hasil_aktual, bukan qty_batch x yield_qty
-- teoretis dari resep.

ALTER TABLE inventory_transaksi_produksi
  ADD COLUMN hasil_aktual NUMERIC(18, 6);

COMMENT ON COLUMN inventory_transaksi_produksi.hasil_aktual IS
  'Qty hasil produksi yang benar-benar diukur/ditimbang, dalam recipe_unit item hasil. Selisih yield = hasil_aktual - (qty_batch * resep.yield_qty). Nullable sementara insert (diisi saat produksi selesai); NULL berarti belum ada hasil aktual (produksi masih berjalan / belum dicatat), TIDAK memposting stok hasil sampai kolom ini diisi.';
