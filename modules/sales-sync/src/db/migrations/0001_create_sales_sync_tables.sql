-- Modul sales-sync: arsip data sinkronisasi penjualan dari platform delivery
-- (Shopee/GrabFood/GoFood) dan POS Majoo, lalu pemetaan ke menu internal.
--
-- Tabel 1-4 (salessync_log_penjualan, salessync_transaksi, salessync_raw_majoo,
-- salessync_biaya_platform) adalah ARSIP MENTAH hasil import CSV/API sumber --
-- kolomnya sengaja mengikuti persis struktur sumber data asli (sudah
-- diverifikasi langsung dari sample), bukan dirancang ulang. Tidak ada kolom
-- lokasi di tabel-tabel ini: lokasi tujuan transaksi Penjualan Inventory hasil
-- sinkronisasi ditentukan nanti lewat salessync_settings.default_location_id
-- (fase backend), bukan disimpan di baris arsip.
--
-- Isolasi antar modul: sales-sync TIDAK FK ke tabel modul bisnis manapun
-- (termasuk inventory_menu) -- lihat salessync_item_mapping.kode_menu di bawah.
-- FK ke core_users/core_locations diizinkan karena core adalah layer platform
-- bersama (precedent: core/src/db/migrations/0006_move_locations_to_core.sql).

-- =====================================================================
-- 1. salessync_log_penjualan -- export harian log penjualan per baris item
-- =====================================================================

CREATE TABLE IF NOT EXISTS salessync_log_penjualan (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_date DATE NOT NULL,
  transaction_time TIME NOT NULL,
  platform TEXT NOT NULL,
  order_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  menu_id TEXT,
  quantity INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  parent_item TEXT,
  unique_key TEXT NOT NULL,
  inv_status TEXT NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT salessync_log_penjualan_unique_key_key UNIQUE (unique_key)
);

COMMENT ON TABLE salessync_log_penjualan IS
  'Arsip mentah export harian log penjualan per baris item (1 baris = 1 item dalam 1 order), dari platform delivery dan POS Majoo. Kolom sengaja mengikuti persis struktur sumber data asli.';

COMMENT ON COLUMN salessync_log_penjualan.platform IS
  'Contoh nilai mentah dari sumber: ''Shopee'', ''GoFood'', ''GrabFood'', ''Majoo''. Pemetaan ke channel internal ada di salessync_platform_channel_map.';

COMMENT ON COLUMN salessync_log_penjualan.menu_id IS
  'Kode menu versi EKSTERNAL dari platform (BUKAN kode_menu internal Samsara). Nullable -- raw data sumber kadang kosong.';

COMMENT ON COLUMN salessync_log_penjualan.item_type IS
  'Salah satu dari: ''menu'' | ''addon'' | ''refund''.';

COMMENT ON COLUMN salessync_log_penjualan.parent_item IS
  'Nullable, nama menu induk kalau item_type = ''addon''.';

COMMENT ON COLUMN salessync_log_penjualan.inv_status IS
  'Salah satu dari: ''OK'' | ''SKIP-HISTORIS'' | ''SKIP-REFUND'' | ''EXCEPTION''.';

COMMENT ON COLUMN salessync_log_penjualan.processed_at IS
  'NULLABLE, diisi saat baris sudah diproses jadi transaksi Penjualan Inventory (fase backend, belum dikerjakan di migrasi ini). NULL = belum diproses.';

COMMENT ON COLUMN salessync_log_penjualan.unique_key IS
  'Kunci upsert: proses import dipakai sebagai ON CONFLICT (unique_key) DO UPDATE supaya import ulang file CSV yang sama tidak membuat duplikat. CATATAN PENTING dari verifikasi sample data asli: ~148 dari 19652 baris (0.75%) punya unique_key yang sama dengan baris lain padahal quantity berbeda -- ini keterbatasan struktur sumber data asli (tidak ada nomor urut baris di export sumber), BUKAN bug di pipeline sync. Sudah diverifikasi: TIDAK ADA satupun baris berstatus inv_status=''OK'' yang kena kasus ini (ke-15 baris OK yang kebetulan unique_key-nya duplikat ternyata isinya identik persis, bukan beda quantity) -- jadi tidak berdampak ke transaksi Penjualan riil, cuma catatan historis pada baris yang sudah di-skip/exception.';

-- =====================================================================
-- 2. salessync_transaksi -- rekonsiliasi transaksi per platform (income/fee)
-- =====================================================================

CREATE TABLE IF NOT EXISTS salessync_transaksi (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_order_number TEXT NOT NULL,
  platform_transaction_id TEXT,
  order_time TIMESTAMPTZ NOT NULL,
  settled_time TIMESTAMPTZ,
  status TEXT NOT NULL,
  gross_amount NUMERIC(18, 2) NOT NULL,
  total_fees NUMERIC(18, 2) NOT NULL,
  net_revenue NUMERIC(18, 2) NOT NULL,
  currency TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT salessync_transaksi_source_id_order_number_key UNIQUE (source_id, platform_order_number)
);

COMMENT ON TABLE salessync_transaksi IS
  'Arsip rekonsiliasi transaksi per platform (laporan income/fee). 2 kolom tanpa nama di akhir header sample asli (artefak sisa pivot/summary export spreadsheet, isi acak/junk di sebagian baris) SUDAH DIBUANG dari skema ini dengan sengaja, bukan kelupaan.';

COMMENT ON COLUMN salessync_transaksi.source_id IS
  'DEVIASI dari desain awal -- WAJIB dibaca sebelum diubah. Upsert key tabel ini BUKAN source_id sendirian. Sudah diverifikasi langsung dari sample data: source_id TIDAK unik per baris (satu email laporan harian = satu source_id, berisi BANYAK order berbeda sebagai baris terpisah -- 11689 baris cuma 8723 source_id unik). Kombinasi (source_id, platform_order_number) TERBUKTI 100% unik di seluruh sample (11689/11689), karena itu constraint unique dipasang pada kombinasi keduanya (lihat salessync_transaksi_source_id_order_number_key), BUKAN pada source_id sendirian. Jangan "diperbaiki" balik ke source_id saja tanpa verifikasi ulang terhadap data sumber -- itu akan membuat baris2 order berbeda dalam satu laporan saling menimpa (upsert salah).';

-- =====================================================================
-- 3. salessync_raw_majoo -- export transaksi mentah dari API Majoo POS
-- =====================================================================

CREATE TABLE IF NOT EXISTS salessync_raw_majoo (
  id BIGINT PRIMARY KEY,
  transaction_no TEXT NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL,
  payment_date TIMESTAMPTZ,
  order_type_name TEXT,
  payment_method_name TEXT,
  payment_cashier_name TEXT,
  total_sales NUMERIC(18, 2) NOT NULL,
  receivables NUMERIC(18, 2) NOT NULL,
  total_discount_amount NUMERIC(18, 2) NOT NULL,
  refund_amount NUMERIC(18, 2) NOT NULL,
  is_paid BOOLEAN NOT NULL,
  outlet_id TEXT NOT NULL,
  has_more TEXT,
  next_page TEXT,
  empty_field TEXT,
  refund_id TEXT,
  refund_no TEXT,
  refund_date TIMESTAMPTZ,
  refund_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE salessync_raw_majoo IS
  'Arsip mentah export transaksi dari API Majoo POS. id BUKAN identity/auto-generated -- diisi apa adanya dari id asli Majoo saat insert/upsert (ON CONFLICT (id) DO UPDATE nanti di kode backend, tidak perlu constraint tambahan karena id sudah primary key).';

COMMENT ON COLUMN salessync_raw_majoo.outlet_id IS
  'ID outlet versi Majoo sendiri, BUKAN FK ke core_locations -- sengaja disimpan sebagai reference text mentah dari sumber, bukan dinormalisasi.';

COMMENT ON COLUMN salessync_raw_majoo.has_more IS
  'Metadata sisa pagination API Majoo yang ikut ter-export. Selalu kosong di sample, dipertahankan demi struktur lengkap sesuai sumber.';

COMMENT ON COLUMN salessync_raw_majoo.next_page IS
  'Idem has_more -- metadata pagination API Majoo, selalu kosong di sample, dipertahankan demi struktur lengkap sesuai sumber.';

COMMENT ON COLUMN salessync_raw_majoo.empty_field IS
  'Idem has_more/next_page. Nama kolom ASLI di sumber adalah "_empty" -- diganti ke empty_field di sini karena leading-underscore bukan konvensi penamaan kolom di repo ini. Dicatat di sini untuk ketertelusuran ke sumber.';

-- =====================================================================
-- 4. salessync_biaya_platform -- rincian biaya/potongan platform
-- =====================================================================

CREATE TABLE IF NOT EXISTS salessync_biaya_platform (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tanggal_closing TIMESTAMPTZ NOT NULL,
  platform TEXT NOT NULL,
  kategori_biaya TEXT NOT NULL,
  deskripsi TEXT,
  transaction_type_raw TEXT,
  amount NUMERIC(18, 2) NOT NULL,
  amount_raw NUMERIC(18, 4),
  reference_id TEXT,
  id_platform TEXT,
  create_time TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT salessync_biaya_platform_id_platform_key UNIQUE (id_platform)
);

COMMENT ON TABLE salessync_biaya_platform IS
  'Arsip rincian biaya/potongan platform (iklan, komisi, adjustment, dll).';

COMMENT ON COLUMN salessync_biaya_platform.transaction_type_raw IS
  'WAJIB TEXT bukan INTEGER -- di sample asli kolom ini campuran nilai numerik-sebagai-string ATAU teks bebas.';

COMMENT ON COLUMN salessync_biaya_platform.id_platform IS
  'Nullable (3 dari 168 baris sample kosong). UNIQUE constraint ini plain (bukan partial index) -- Postgres mengizinkan banyak NULL di kolom UNIQUE (NULL tidak dianggap sama dengan NULL lain), jadi baris yang id_platform-nya kosong akan SELALU INSERT baru (tidak pernah ke-upsert/dedup) kalau file yang sama diupload ulang. Ini konsekuensi struktur sumber data (tidak semua baris historis punya id platform), bukan bug.';

-- =====================================================================
-- 5. salessync_item_mapping -- pemetaan item eksternal ke menu internal
-- =====================================================================

CREATE TABLE IF NOT EXISTS salessync_item_mapping (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform TEXT NOT NULL,
  kode_eksternal TEXT NOT NULL,
  nama_eksternal TEXT NOT NULL,
  kode_menu TEXT,
  status TEXT NOT NULL DEFAULT 'belum_dipetakan' CHECK (status IN ('belum_dipetakan', 'dipetakan')),
  dipetakan_oleh BIGINT REFERENCES core_users (id) ON DELETE SET NULL,
  dipetakan_pada TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT salessync_item_mapping_platform_kode_eksternal_key UNIQUE (platform, kode_eksternal)
);

COMMENT ON TABLE salessync_item_mapping IS
  'Pemetaan item/kode eksternal dari platform ke kode_menu internal Samsara. dipetakan_oleh FK ke core_users karena core adalah layer platform bersama (precedent: core/src/db/migrations/0006_move_locations_to_core.sql) -- berbeda dari kode_menu di bawah.';

COMMENT ON COLUMN salessync_item_mapping.kode_menu IS
  'NULLABLE, BUKAN FOREIGN KEY ke tabel menu Inventory manapun (inventory_menu). Sesuai aturan isolasi antar modul (CLAUDE.md § "Module manifest"): modul bisnis TIDAK BOLEH FK langsung ke tabel modul bisnis lain -- hanya core yang boleh di-FK semua modul (precedent: core/src/db/migrations/0006_move_locations_to_core.sql membedakan secara eksplisit "core boleh di-FK semua modul" vs "modul bisnis tidak boleh FK ke modul bisnis lain"). Validasi bahwa kode_menu benar-benar ada di Inventory dilakukan di layer aplikasi (panggilan HTTP ke GET /api/inventory/menu), bukan constraint database.';

-- =====================================================================
-- 6. salessync_platform_channel_map -- normalisasi nama platform mentah
-- =====================================================================

CREATE TABLE IF NOT EXISTS salessync_platform_channel_map (
  platform_raw TEXT PRIMARY KEY,
  channel_internal TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE salessync_platform_channel_map IS
  'Normalisasi nilai platform mentah (variasi penulisan dari sumber data berbeda) ke channel internal Samsara. Baris seed di bawah cuma default awal, bisa diubah/ditambah owner lewat UI nanti -- bukan hardcode permanen.';

COMMENT ON COLUMN salessync_platform_channel_map.channel_internal IS
  'Majoo -> Offline adalah ASUMSI (Majoo = kasir POS fisik outlet, bukan platform delivery), bisa dikoreksi owner kalau perlu nama channel lain.';

INSERT INTO salessync_platform_channel_map (platform_raw, channel_internal) VALUES
  ('Shopee', 'ShopeeFood'),
  ('shopeefood', 'ShopeeFood'),
  ('GrabFood', 'GrabFood'),
  ('grabfood', 'GrabFood'),
  ('GoFood', 'GoFood'),
  ('gofood', 'GoFood'),
  ('Majoo', 'Offline')
ON CONFLICT (platform_raw) DO NOTHING;

-- =====================================================================
-- 7. salessync_settings -- pengaturan key-value modul sales-sync
-- =====================================================================

CREATE TABLE IF NOT EXISTS salessync_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE salessync_settings IS
  'Key-value pengaturan modul sales-sync, pola sama seperti hr_settings/inventory_settings yang sudah ada. Sengaja TIDAK ada foreign key dari tabel ini ke core_locations (pola key-value TEXT generik yang sudah established di repo ini tidak pernah di-FK) -- value di-cast ke number di layer domain saat dipakai.';

INSERT INTO salessync_settings (key, value) VALUES ('default_location_id', '2')
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN salessync_settings.value IS
  'Untuk key default_location_id: lokasi tujuan transaksi Penjualan hasil sinkronisasi. Value ''2'' = core_locations.id untuk "Samsara Outlet 1 Malang", satu-satunya outlet aktif saat ini -- disimpan sebagai setting (bukan hardcode di kode) supaya siap kalau nanti ada outlet ke-2+.';
