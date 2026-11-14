-- Modul Notifikasi (2026-11-14) -- Bagian 2: aturan notifikasi, log
-- pengiriman (dengan dedup), dan token aksi sekali pakai untuk tombol
-- interaktif di pesan Telegram. Semuanya hidup di `core` (prefix `core_`)
-- karena notifikasi lintas modul (dipicu dari Inventory/Sales-Sync,
-- dikonsumsi dari core/apps-api) -- BUKAN modul bisnis terpisah dengan
-- module.json sendiri, sama seperti auth/audit/locations yang sudah ada.

-- =====================================================================
-- 1. core_notifikasi_aturan -- siapa dapat notifikasi apa, lewat kanal apa
-- =====================================================================
--
-- Satu KEJADIAN bisa punya BANYAK baris aturan (mis. "permintaan_belum_dijawab"
-- punya 2 baris: ambang_jam=2 untuk role supervisor, ambang_jam=6 untuk role
-- owner -- pola eskalasi bertingkat tanpa kode tambahan, cuma data).
-- `penerima_user_id` kalau diisi berarti SATU user spesifik (role/lokasi
-- diabaikan untuk resolusi penerima, tapi tetap tersimpan sebagai metadata).
-- `penerima_lokasi_id` NULL = berlaku lintas lokasi (global); terisi =
-- aturan ini CUMA berlaku kalau kejadian terjadi di lokasi itu DAN penerima
-- (hasil filter role) juga ditugaskan ke lokasi itu.
CREATE TABLE IF NOT EXISTS core_notifikasi_aturan (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kejadian TEXT NOT NULL,
  penerima_role TEXT,
  penerima_user_id BIGINT REFERENCES core_users (id),
  penerima_lokasi_id BIGINT REFERENCES core_locations (id),
  kanal TEXT NOT NULL,
  aktif BOOLEAN NOT NULL DEFAULT true,
  ambang_jam NUMERIC(6, 2),
  dibuat_oleh BIGINT REFERENCES core_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kejadian IN (
    'permintaan_baru_ck', 'jawaban_ck', 'permintaan_belum_dijawab',
    'transfer_belum_diterima', 'sumber_data_tidak_masuk', 'otomatis_error',
    'stok_minus', 'opname_menunggu_persetujuan'
  )),
  CHECK (kanal IN ('telegram', 'email')),
  CHECK (penerima_role IS NOT NULL OR penerima_user_id IS NOT NULL)
);

COMMENT ON TABLE core_notifikasi_aturan IS
  'Aturan notifikasi: kejadian apa -> siapa (role/user, opsional dipersempit lokasi) -> kanal apa. Dikelola owner lewat Pengaturan > Notifikasi (permission notifikasi.manage). Beberapa baris aktif untuk kejadian yang sama = eskalasi bertingkat (ambang_jam berbeda per baris).';
COMMENT ON COLUMN core_notifikasi_aturan.penerima_role IS
  'NULL kalau penerima_user_id diisi (user spesifik). Kalau diisi, cocokkan ke SEMUA user aktif dengan role ini (lihat resolveNotifikasiPenerima).';
COMMENT ON COLUMN core_notifikasi_aturan.ambang_jam IS
  'HANYA relevan untuk kejadian berbasis ambang waktu (permintaan_belum_dijawab, transfer_belum_diterima) -- diabaikan untuk kejadian event-driven lain. NULL = tidak relevan/belum diisi.';

CREATE INDEX IF NOT EXISTS idx_core_notifikasi_aturan_kejadian_aktif
  ON core_notifikasi_aturan (kejadian, aktif);

-- =====================================================================
-- 2. core_notifikasi_log -- riwayat tiap notifikasi yang (dicoba) dikirim
-- =====================================================================
--
-- `dedup_key` + `user_id` UNIQUE: jaring pengaman DI LEVEL DATABASE supaya
-- notifikasi yang sama (kejadian+referensi+aturan tertentu) ke penerima yang
-- sama TIDAK PERNAH terkirim dobel -- caller INSERT dulu (ON CONFLICT DO
-- NOTHING), cuma lanjut kirim pesan kalau baris BENAR-BENAR baru (lihat
-- notifyEvent). Ini yang menjaga "eskalasi tidak terkirim dobel" walau
-- scheduler jalan berkali-kali sebelum kejadiannya selesai/berubah status.
CREATE TABLE IF NOT EXISTS core_notifikasi_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aturan_id BIGINT REFERENCES core_notifikasi_aturan (id),
  kejadian TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES core_users (id),
  kanal TEXT NOT NULL,
  referensi_tipe TEXT,
  referensi_id BIGINT,
  dedup_key TEXT NOT NULL,
  status TEXT NOT NULL,
  pesan_error TEXT,
  judul TEXT NOT NULL,
  pesan TEXT NOT NULL,
  dikirim_pada TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('terkirim', 'gagal', 'ditunda')),
  UNIQUE (dedup_key, user_id)
);

COMMENT ON TABLE core_notifikasi_log IS
  'Riwayat tiap notifikasi yang dicoba dikirim, SATU baris per (aturan+kejadian+referensi) x penerima. UNIQUE(dedup_key, user_id) adalah penjamin anti-dobel di level DB -- dedup_key dibentuk notifyEvent dari kejadian+referensi+aturan_id, BUKAN cuma kejadian saja (supaya 2 aturan eskalasi berbeda untuk kejadian yang sama tetap bisa sama-sama kirim sekali).';
COMMENT ON COLUMN core_notifikasi_log.status IS
  '"terkirim" = berhasil dikirim channel adapter. "gagal" = adapter melempar error (lihat pesan_error). "ditunda" = kanal belum diimplementasi (email, lihat core/src/notifikasi/kanal/email.ts) -- dicatat supaya tetap ada jejak "seharusnya terkirim" walau belum benar-benar jalan.';

CREATE INDEX IF NOT EXISTS idx_core_notifikasi_log_user_dikirim
  ON core_notifikasi_log (user_id, dikirim_pada DESC);

-- =====================================================================
-- 3. core_notifikasi_token_aksi -- token sekali pakai untuk tombol Telegram
-- =====================================================================
--
-- SATU token per notifikasi AKTIF (bukan per tombol) -- tombol Terima/Tolak
-- di Telegram SAMA-SAMA membawa token ini di callback_data (format
-- "<token>|terima" / "<token>|tolak|<indexAlasanPreset>"), dipisah di kode
-- webhook, BUKAN di skema. Begitu salah satu tombol ditekan, `dipakai_pada`
-- diisi sekali (UPDATE ... WHERE dipakai_pada IS NULL) -- tombol lain yang
-- berbagi token yang sama otomatis ikut tidak bisa dipakai lagi (idempoten,
-- lihat kolom `aksi_dipakai` untuk tahu tombol mana yang akhirnya ditekan).
CREATE TABLE IF NOT EXISTS core_notifikasi_token_aksi (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  notifikasi_log_id BIGINT NOT NULL REFERENCES core_notifikasi_log (id),
  referensi_tipe TEXT NOT NULL,
  referensi_id BIGINT NOT NULL,
  user_id_target BIGINT NOT NULL REFERENCES core_users (id),
  role_target TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  telegram_message_id BIGINT,
  dipakai_pada TIMESTAMPTZ,
  aksi_dipakai TEXT,
  kadaluwarsa_pada TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE core_notifikasi_token_aksi IS
  'Token sekali pakai untuk tombol interaktif (Terima/Tolak) di pesan Telegram -- SATU baris per notifikasi yang actionable, bukan per tombol. role_target = snapshot role PENERIMA saat token dibuat, dicek ULANG terhadap role TERKINI di core_users saat callback masuk (bukan dipercaya mentah dari snapshot) -- lihat webhook.ts. telegram_message_id disimpan supaya pesan bisa di-EDIT setelah aksi (menandai "sudah diproses"), bukan dikirim pesan baru.';
COMMENT ON COLUMN core_notifikasi_token_aksi.role_target IS
  'Snapshot role user_id_target SAAT token dibuat -- HANYA untuk log/audit, keputusan izin sebenarnya tetap re-check role TERKINI dari core_users di webhook (pengguna bisa saja diturunkan rolenya setelah notifikasi dikirim, sebelum tombol ditekan).';

CREATE INDEX IF NOT EXISTS idx_core_notifikasi_token_aksi_kadaluwarsa
  ON core_notifikasi_token_aksi (kadaluwarsa_pada) WHERE dipakai_pada IS NULL;
