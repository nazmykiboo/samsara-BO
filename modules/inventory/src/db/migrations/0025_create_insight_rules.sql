-- Ambang batas (threshold) untuk fitur analitik Inventory yang akan dibangun
-- terpisah setelah migrasi ini (endpoint `GET /analitik/penjualan` dan
-- `GET /analitik/operasional` -- BELUM ada saat migrasi ini dibuat). Tujuannya
-- supaya owner bisa mengubah angka ambang batas insight (mis. "berapa persen
-- penurunan penjualan dianggap signifikan") lewat UI nanti, tanpa perlu
-- deploy ulang kode -- pola yang sama dengan `inventory_settings` (lihat
-- migrasi 0018) untuk konfigurasi yang bisa diubah owner.
--
-- Kolom `ambang_batas` sengaja NUMERIC generik (bukan dipecah jadi beberapa
-- kolom bertipe/bersatuan berbeda) karena dipakai untuk macam-macam arti
-- tergantung `kode` masing-masing baris:
--   - 'turun_signifikan_persen' / 'naik_signifikan_persen': satuan PERSEN.
--   - 'waste_streak_minggu': satuan JUMLAH MINGGU berturut-turut.
--   - 'opname_selisih_streak': satuan JUMLAH SIKLUS opname berturut-turut.
-- Pembaca kode/data jangan berasumsi semua baris di tabel ini bersatuan
-- sama -- selalu cek kolom `kode` dan `deskripsi` untuk tahu arti angka di
-- `ambang_batas` pada baris tersebut.

CREATE TABLE IF NOT EXISTS inventory_insight_rules (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  deskripsi TEXT NOT NULL,
  ambang_batas NUMERIC(18, 4) NOT NULL,
  aktif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_insight_rules IS
  'Ambang batas (threshold) yang dipakai fitur analitik Inventory (endpoint GET /analitik/penjualan, GET /analitik/operasional -- dibangun terpisah setelah migrasi ini) untuk memicu insight, supaya owner bisa mengubah angka ambang batas lewat UI tanpa deploy ulang kode. Kolom ambang_batas NUMERIC generik dipakai untuk satuan yang berbeda-beda (persen, jumlah minggu, jumlah siklus) tergantung kode baris masing-masing -- lihat komentar di awal file migrasi ini untuk daftar kode dan satuannya.';

INSERT INTO inventory_insight_rules (kode, deskripsi, ambang_batas) VALUES
  ('turun_signifikan_persen', 'Persentase penurunan qty terjual satu menu (minggu ini vs minggu lalu) yang dianggap signifikan dan dimasukkan ke insight penjualan.', 20),
  ('naik_signifikan_persen', 'Persentase kenaikan qty terjual satu menu (minggu ini vs minggu lalu) yang dianggap signifikan dan dimasukkan ke insight penjualan.', 20),
  ('waste_streak_minggu', 'Jumlah minggu BERTURUT-TURUT nilai waste (dari Mutasi Lain qty berkurang) terus naik yang memicu insight peringatan tren waste.', 3),
  ('opname_selisih_streak', 'Jumlah siklus opname BERTURUT-TURUT dengan selisih (qty fisik - qty sistem) negatif di satu lokasi yang memicu insight peringatan susut berulang.', 2)
ON CONFLICT (kode) DO NOTHING;
