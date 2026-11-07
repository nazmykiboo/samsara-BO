-- Tabel BARU untuk baris refund Majoo yang datang dari endpoint TERPISAH
-- (`GET /v1/refund_sales`, lihat `devops/n8n/raw-majoo-direct.json`) --
-- baris ini TIDAK PERNAH punya `id` Majoo sendiri (hanya `refund_id`), jadi
-- tidak bisa dipaksakan ke `salessync_raw_majoo` yang kunci primernya `id`
-- (lihat diagnosis Tahap 0: SETIAP baris refund dari endpoint ini SELALU
-- gagal masuk sejauh ini karena `bilanganBulatWajib("id")` menolak id
-- kosong). Kolom refund_* yang sudah ada di `salessync_raw_majoo` TETAP
-- ADA & TIDAK diubah -- itu untuk refund yang kebetulan ter-embed pada
-- baris transaksi (punya `id`) itu sendiri, kasus berbeda dari tabel ini.

CREATE TABLE IF NOT EXISTS salessync_majoo_refund (
  refund_id BIGINT PRIMARY KEY,
  refund_no TEXT,
  transaction_no TEXT NOT NULL,
  refund_date TIMESTAMPTZ NOT NULL,
  refund_amount NUMERIC(18, 2) NOT NULL,
  refund_reason TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salessync_majoo_refund_transaction_no
  ON salessync_majoo_refund (transaction_no);

COMMENT ON TABLE salessync_majoo_refund IS
  'Arsip mentah refund Majoo dari endpoint /v1/refund_sales (raw-majoo-direct.json, node "Petakan Baris Refund"). Kunci unik refund_id (id refund asli dari Majoo, BUKAN id transaksi). Dihubungkan ke salessync_raw_majoo lewat transaction_no (teks bebas, bukan FK -- baris transaksi aslinya mungkin belum/tidak pernah ter-sync lewat jalur raw-majoo).';

COMMENT ON COLUMN salessync_majoo_refund.refund_id IS
  'Id refund asli dari Majoo (field "id" pada respons /v1/refund_sales) -- diisi apa adanya, BUKAN identity. Upsert di kode backend (ON CONFLICT (refund_id) DO UPDATE).';

COMMENT ON COLUMN salessync_majoo_refund.transaction_no IS
  'Nomor transaksi asal yang direfund (field "no_transaksi_penjualan" pada sumber) -- dipakai menghubungkan ke salessync_raw_majoo.transaction_no DAN salessync_log_penjualan.order_id secara teks, bukan FK.';

COMMENT ON COLUMN salessync_majoo_refund.raw_payload IS
  'Payload mentah baris CSV refund (seluruh 20 kolom KOLOM_MAJOO apa adanya, termasuk yang kosong) -- disimpan untuk ketertelusuran/debug, tidak dipakai logic apa pun.';
