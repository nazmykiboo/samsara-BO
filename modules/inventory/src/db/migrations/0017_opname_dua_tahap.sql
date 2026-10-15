-- Opname jadi 2 tahap (keputusan owner, 2026-09-29): "draft" (hitungan
-- masuk, snapshot qty_sistem diambil, stok BELUM berubah) lalu
-- "disetujui"/"ditolak" (owner/manajer_ops saja). Selisih baru diposting
-- ke ledger saat disetujui. Tabel masih kosong (0 baris), aman diubah.

CREATE TYPE inventory_opname_status AS ENUM ('draft', 'disetujui', 'ditolak');

ALTER TABLE inventory_transaksi_opname
  ADD COLUMN status inventory_opname_status NOT NULL,
  ADD COLUMN diputuskan_oleh BIGINT REFERENCES core_users (id),
  ADD COLUMN diputuskan_at TIMESTAMPTZ;

COMMENT ON COLUMN inventory_transaksi_opname.status IS
  '"draft" = hitungan sudah dicatat, qty_sistem sudah snapshot, TAPI selisih belum diposting ke ledger. "disetujui" = selisih sudah diposting. "ditolak" = tidak ada perubahan stok.';
