-- Harga jual menu selama ini satu kolom global (inventory_menu.harga_jual,
-- ditambahkan di 0005) -- tidak cukup karena kebutuhan bisnis sebenarnya
-- adalah harga BERBEDA per channel penjualan (Offline vs ShopeeFood/GoFood/
-- GrabFood, biasanya dinaikkan untuk menutup komisi platform). Dipecah jadi
-- tabel baru per menu+channel (pola sama seperti inventory_min_stok_lokasi
-- di 0020: satu kolom tunggal yang tidak cukup granular -> tabel baru
-- per kombinasi, kolom lama dibiarkan apa adanya).
--
-- SENGAJA independen murni per channel -- TIDAK ADA logika auto-sync/derive
-- (mis. "harga ShopeeFood = harga Offline + komisi") di level database.
-- Kalkulasi harga yang menyarankan angka berdasarkan komisi (inventory_channel_
-- komisi di bawah) adalah urusan layer domain/UI saat input, bukan trigger DB
-- -- supaya owner/Ibnu tetap bisa override manual per channel kapan saja
-- tanpa terikat rumus, dan supaya perubahan di satu channel tidak pernah
-- diam-diam mengubah channel lain.
--
-- inventory_menu.harga_jual TIDAK dihapus/diubah (lihat CLAUDE.md -- migrasi
-- baru, bukan edit yang sudah applied) -- dibiarkan sebagai kolom legacy.
-- Saat migrasi ini ditulis (2026-10-04) kolom itu 0 baris terisi (harga jual
-- belum pernah diimpor), jadi backfill di bawah ini pada praktiknya tidak
-- insert apa pun -- tapi logikanya tetap ditulis untuk kasus datanya sudah
-- terisi di environment lain / di masa depan sebelum migrasi ini jalan.

CREATE TABLE IF NOT EXISTS inventory_menu_harga_channel (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode_menu TEXT NOT NULL REFERENCES inventory_menu (kode),
  channel TEXT NOT NULL REFERENCES inventory_sales_channel (name),
  harga_jual NUMERIC(18, 2) NOT NULL,
  diubah_oleh BIGINT REFERENCES core_users (id) ON DELETE SET NULL,
  diubah_pada TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kode_menu, channel)
);

COMMENT ON TABLE inventory_menu_harga_channel IS
  'Harga jual menu PER CHANNEL PENJUALAN, independen (tidak ada auto-sync antar channel di level database). Menggantikan inventory_menu.harga_jual (kolom tunggal global, dibiarkan sebagai legacy, lihat 0005). Satu baris per pasangan kode_menu+channel (UNIQUE), upsert lewat INSERT ... ON CONFLICT (kode_menu, channel) DO UPDATE di layer domain.';
COMMENT ON COLUMN inventory_menu_harga_channel.diubah_oleh IS
  'User yang terakhir mengubah harga baris ini. Nullable + ON DELETE SET NULL, sama seperti core_audit_log.user_id dan core_login_attempts.user_id -- user yang dihapus tidak boleh menggagalkan/menghapus riwayat harga (lihat core/src/db/migrations/0003 & 0004).';

-- Index tambahan khusus kode_menu: UNIQUE (kode_menu, channel) di atas sudah
-- bisa dipakai planner untuk filter kode_menu saja, tapi index sendiri lebih
-- murah/jelas untuk query umum "tampilkan semua channel untuk 1 menu" (mis.
-- halaman edit harga menu di UI yang menampilkan 4 channel sekaligus).
CREATE INDEX IF NOT EXISTS idx_inventory_menu_harga_channel_kode_menu
  ON inventory_menu_harga_channel (kode_menu);

-- Migrasi data lama: setiap inventory_menu.harga_jual yang terisi dianggap
-- sebagai harga Offline (itu yang selama ini dipakai de facto, sebelum ada
-- konsep per-channel). diubah_oleh NULL karena tidak ada informasi siapa
-- yang mengisi harga_jual lama itu.
INSERT INTO inventory_menu_harga_channel (kode_menu, channel, harga_jual, diubah_oleh, diubah_pada)
SELECT m.kode, 'Offline', m.harga_jual, NULL, now()
FROM inventory_menu m
WHERE m.harga_jual IS NOT NULL
ON CONFLICT (kode_menu, channel) DO NOTHING;

-- Komisi per channel -- singleton per channel (satu baris per nama channel),
-- pola PK-on-natural-key sama seperti inventory_settings (0018). Dipakai
-- layer domain untuk MENYARANKAN harga per channel (mis. harga Offline +
-- komisi dibagi sisa persen), bukan untuk menghitung ulang harga_jual
-- otomatis -- lihat catatan "tidak ada auto-sync" di atas.
CREATE TABLE IF NOT EXISTS inventory_channel_komisi (
  channel TEXT PRIMARY KEY REFERENCES inventory_sales_channel (name),
  persen_komisi NUMERIC(5, 2) NOT NULL,
  potongan_tetap NUMERIC(18, 2) NOT NULL DEFAULT 0
);

COMMENT ON TABLE inventory_channel_komisi IS
  'Komisi platform per channel penjualan (persen + potongan tetap/pembulatan, mis. GoFood Rp1.000). Dipakai layer domain sebagai referensi saat menyarankan harga per channel di inventory_menu_harga_channel -- TIDAK ada trigger yang menghitung ulang harga_jual otomatis dari tabel ini.';

INSERT INTO inventory_channel_komisi (channel, persen_komisi, potongan_tetap) VALUES
  ('ShopeeFood', 20.00, 0),
  ('GoFood', 20.00, 1000),
  ('GrabFood', 20.00, 0),
  ('Offline', 0.00, 0)
ON CONFLICT (channel) DO NOTHING;

-- Target food cost % -- setting global (bukan per channel/menu) dipakai
-- layer domain untuk menandai menu yang food cost-nya di atas target saat
-- owner mengevaluasi harga per channel baru. ON CONFLICT DO NOTHING supaya
-- migrasi ini aman dijalankan ulang kalau key-nya sudah ada (jaga-jaga,
-- meskipun migrasi 0018 yang membuat tabel ini masih pakai INSERT polos).
INSERT INTO inventory_settings (key, value) VALUES ('target_food_cost_persen', '30')
ON CONFLICT (key) DO NOTHING;
