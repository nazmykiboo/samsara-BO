-- Persiapan ke depan (diminta owner, Tahap 3 poin 3): kolom nomor_order dan
-- tipe_pesanan di sisi Penjualan. NULLABLE, TIDAK ADA logika yang memakainya
-- sekarang -- disiapkan untuk integrasi POS/delivery nanti.

CREATE TYPE inventory_order_type AS ENUM (
  'dine_in',
  'take_away',
  'delivery'
);

ALTER TABLE inventory_transaksi_penjualan
  ADD COLUMN nomor_order TEXT,
  ADD COLUMN tipe_pesanan inventory_order_type;
