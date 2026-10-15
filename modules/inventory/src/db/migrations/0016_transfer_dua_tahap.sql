-- Transfer jadi 2 tahap (keputusan owner, 2026-09-29): "dikirim" lalu
-- "diterima". Kirim langsung mengurangi stok lokasi asal; barang yang
-- belum diterima dicatat "dalam perjalanan" (view di bawah), TIDAK masuk
-- stok lokasi manapun. Terima mengisi qty_terima & menambah stok lokasi
-- tujuan. Ganti perilaku endpoint lama (bukan tabel baru) -- tabel masih
-- kosong (0 baris) sejak awal, aman diubah strukturnya.

CREATE TYPE inventory_transfer_status AS ENUM ('dikirim', 'diterima');

-- Tabel masih 0 baris, jadi kolom NOT NULL baru bisa ditambah langsung
-- tanpa DEFAULT (setiap insert baru dari domain layer selalu mengisi
-- status = 'dikirim' secara eksplisit saat transfer dibuat).
ALTER TABLE inventory_transaksi_transfer
  ADD COLUMN status inventory_transfer_status NOT NULL,
  ADD COLUMN diterima_oleh BIGINT REFERENCES core_users (id),
  ADD COLUMN diterima_at TIMESTAMPTZ;

COMMENT ON COLUMN inventory_transaksi_transfer.status IS
  '"dikirim" = qty_kirim sudah keluar dari stok asal, qty_terima belum diisi (barang dalam perjalanan). "diterima" = qty_terima sudah diisi & masuk stok tujuan, susut final.';

-- qty_terima cuma diisi saat tahap "terima", jadi NOT NULL dilonggarkan.
ALTER TABLE inventory_transaksi_transfer_baris
  ALTER COLUMN qty_terima DROP NOT NULL;

COMMENT ON COLUMN inventory_transaksi_transfer_baris.qty_terima IS
  'NULL selama status header masih "dikirim" (belum diterima). Diisi saat tahap terima.';

-- "Dalam perjalanan": qty_kirim yang headernya masih berstatus "dikirim" --
-- belum ada di stok lokasi manapun (bukan di ledger lokasi asal maupun
-- tujuan), tapi nilainya perlu bisa dilihat terpisah (instruksi owner).
CREATE VIEW inventory_transfer_dalam_perjalanan AS
SELECT
  t.id AS transfer_id,
  t.location_asal_id,
  t.location_tujuan_id,
  t.tanggal,
  b.item_id,
  b.qty_kirim,
  b.unit,
  b.harga_transfer_per_satuan,
  (b.qty_kirim * b.harga_transfer_per_satuan) AS nilai
FROM inventory_transaksi_transfer t
JOIN inventory_transaksi_transfer_baris b ON b.header_id = t.id
WHERE t.status = 'dikirim';

COMMENT ON VIEW inventory_transfer_dalam_perjalanan IS
  'Barang yang sudah dikirim (keluar dari stok asal) tapi belum diterima. nilai bisa NULL kalau harga_transfer_per_satuan belum terisi (transfer bukan antar-entitas, tidak wajib diisi).';
