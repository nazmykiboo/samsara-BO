-- Pemrosesan sinkronisasi penjualan OTOMATIS (bukan cuma tombol manual) +
-- riwayat impor/auto-proses untuk halaman Sinkronisasi Penjualan.
--
-- Dua tabel riwayat di bawah ini DIPERLUKAN SEBAGAI STORAGE (beda dari
-- status "tertahan/perlu ditinjau" yang dihitung LIVE tiap request lewat
-- `pratinjauProses`, TIDAK disimpan) karena keduanya historis -- tidak bisa
-- dihitung ulang dari state SAAT INI setelah kejadiannya lewat (mis. error
-- terakhir dari eksekusi otomatis yang sudah selesai).
--
-- Pengaturan `otomatis_aktif`/`tanggal_mulai_otomatis` SENGAJA TIDAK dapat
-- kolom baru -- salessync_settings SUDAH generic key-value (dipakai
-- default_location_id sejak migrasi 0001), baris baru cukup INSERT di sini.

-- =====================================================================
-- 1. salessync_otomatis_log -- riwayat tiap kali pemrosesan otomatis jalan
-- =====================================================================

CREATE TABLE IF NOT EXISTS salessync_otomatis_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dipicu_oleh TEXT NOT NULL CHECK (dipicu_oleh IN ('impor', 'pemetaan')),
  transaksi_dibuat INTEGER NOT NULL,
  baris_diproses INTEGER NOT NULL,
  tertahan INTEGER NOT NULL,
  perlu_ditinjau INTEGER NOT NULL,
  gagal INTEGER NOT NULL,
  pesan_error_terakhir TEXT,
  dijalankan_pada TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE salessync_otomatis_log IS
  'Riwayat APPEND-ONLY satu baris per kali pemrosesan otomatis dijalankan (dipicu setelah impor log-penjualan atau setelah pemetaan item disimpan) -- dibaca endpoint GET /otomatis/status untuk angka "terakhir dijalankan". Baris TIDAK PERNAH diupdate, cuma di-INSERT -- kalau tabel ini membesar signifikan di masa depan, retensi/pembersihan adalah keputusan terpisah (belum ada di migrasi ini).';

COMMENT ON COLUMN salessync_otomatis_log.dipicu_oleh IS
  '''impor'' = dipanggil setelah POST /import/log-penjualan sukses. ''pemetaan'' = dipanggil setelah PATCH /item-mapping/:id sukses.';

COMMENT ON COLUMN salessync_otomatis_log.tertahan IS
  'Jumlah order yang dilewati karena ada baris belum terpetakan (bucket dilewatiBelumTerpetakan di prosesSinkronisasi) pada eksekusi ini.';

COMMENT ON COLUMN salessync_otomatis_log.perlu_ditinjau IS
  'Jumlah order yang dilewati karena punya baris item_type=''refund'' (bucket perluDitinjau, lihat proses.ts) pada eksekusi ini. TIDAK termasuk baris inv_status=''EXCEPTION'' -- baris itu sudah tersaring sebelum sampai ke prosesSinkronisasi sama sekali (filter inv_status=''OK'' di bacaDataProses), jadi tidak pernah muncul di sini.';

COMMENT ON COLUMN salessync_otomatis_log.pesan_error_terakhir IS
  'NULLABLE. Pesan error PERTAMA dari bucket "gagal" pada eksekusi ini (kalau ada lebih dari satu, cuma yang pertama dicatat -- daftar lengkap tidak disimpan, cukup untuk sinyal "ada yang perlu dicek", detail lengkap ada di log aplikasi server).';

-- =====================================================================
-- 2. salessync_import_log -- riwayat tiap panggilan endpoint import CSV
-- =====================================================================

CREATE TABLE IF NOT EXISTS salessync_import_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jenis_impor TEXT NOT NULL CHECK (jenis_impor IN ('log-penjualan', 'transaksi', 'raw-majoo', 'biaya-platform')),
  dibuat INTEGER NOT NULL,
  diperbarui INTEGER NOT NULL,
  dilewati INTEGER NOT NULL,
  jumlah_error INTEGER NOT NULL,
  contoh_pesan_error TEXT,
  dijalankan_pada TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE salessync_import_log IS
  'Riwayat APPEND-ONLY satu baris per panggilan endpoint POST /import/* (4 jenis), TANPA membedakan upload CSV manual dari UI vs panggilan API/n8n (keduanya lewat fungsi importer yang sama, lihat router.ts endpointImport -- tidak ada kolom "sumber" karena memang tidak ada cara membedakannya di layer ini). Dibaca GET /otomatis/status untuk kartu "impor terakhir per jenis" di dashboard Sinkronisasi.';

COMMENT ON COLUMN salessync_import_log.contoh_pesan_error IS
  'NULLABLE. Pesan error BARIS PERTAMA dari array errors[] hasil import (kalau ada) -- sinyal ringkas, bukan daftar lengkap (daftar lengkap sudah ada di response HasilImport saat itu, tidak disimpan ulang di sini).';

-- =====================================================================
-- 3. Pengaturan pemrosesan otomatis (baris baru di salessync_settings)
-- =====================================================================

INSERT INTO salessync_settings (key, value) VALUES ('otomatis_aktif', 'false')
ON CONFLICT (key) DO NOTHING;

-- `tanggal_mulai_otomatis` SENGAJA TIDAK diseed di sini -- "belum ada baris"
-- berarti "belum pernah diisi owner" (beda dari string kosong/NULL yang
-- butuh penanganan khusus di kolom TEXT NOT NULL), dibaca lewat fungsi
-- domain yang mentoleransi baris tidak ada (lihat settings.ts). Diisi
-- pertama kali lewat PUT /otomatis/pengaturan dari UI.
