-- Modul Notifikasi (2026-11-14) -- Bagian 1: kolom tautan Telegram per user
-- + penanda sumber aksi di audit log. Pola kolom ditambah ke `core_users`
-- langsung (bukan tabel terpisah) SAMA seperti `nomor_whatsapp`/
-- `reminder_aktif` di migrasi 0007 -- disiapkan duluan, logikanya dibangun
-- di sesi ini juga (beda dari 0007 yang masih "disiapkan untuk nanti").
--
-- `telegram_kode_tautan`/`telegram_kode_tautan_kadaluwarsa` menyimpan kode
-- verifikasi SEMENTARA (one-time code) yang ditampilkan ke user lewat UI
-- "Hubungkan Telegram" -- user kirim kode ini ke bot, webhook mencocokkan
-- lalu mengisi `telegram_chat_id` dan MENGOSONGKAN kode (sekali pakai).
-- `telegram_chat_id` NULL = belum terhubung.

ALTER TABLE core_users
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_kode_tautan TEXT,
  ADD COLUMN IF NOT EXISTS telegram_kode_tautan_kadaluwarsa TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS telegram_terhubung_pada TIMESTAMPTZ;

-- Partial unique: kebanyakan user TIDAK akan punya telegram_chat_id (NULL),
-- jadi index biasa (UNIQUE polos) akan menolak lebih dari satu NULL secara
-- keliru -- partial index ini cuma menegakkan keunikan di baris yang
-- SUDAH terisi, mencegah satu akun Telegram tertaut ke lebih dari satu user.
CREATE UNIQUE INDEX IF NOT EXISTS core_users_telegram_chat_id_key
  ON core_users (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

COMMENT ON COLUMN core_users.telegram_chat_id IS
  'Chat ID Telegram (dari API Telegram, BUKAN username) setelah tautan diverifikasi. NULL = belum terhubung. Diisi webhook /api/telegram/webhook setelah user mengirim kode tautan ke bot.';
COMMENT ON COLUMN core_users.telegram_kode_tautan IS
  'Kode verifikasi SEMENTARA (sekali pakai) untuk proses hubungkan Telegram, digenerate saat user menekan "Hubungkan Telegram" di Akun Saya. Dikosongkan (NULL) setelah dipakai ATAU kadaluwarsa.';
COMMENT ON COLUMN core_users.telegram_kode_tautan_kadaluwarsa IS
  'Batas waktu kode tautan di atas masih berlaku (lihat kodeTautanTelegram.ts) -- kode yang sudah lewat waktu ini ditolak walau formatnya cocok.';

-- Sumber aksi audit log (Tahap notifikasi) -- NULL = jalur biasa (lewat app),
-- diisi 'telegram' kalau aksinya dipicu dari tombol notifikasi Telegram.
-- Nullable & opsional di `writeAuditLog`/`logFieldChanges` supaya SEMUA
-- caller lama (ratusan titik di seluruh modul) tetap jalan tanpa perubahan.
ALTER TABLE core_audit_log ADD COLUMN IF NOT EXISTS source TEXT;

COMMENT ON COLUMN core_audit_log.source IS
  'NULL = aksi biasa lewat app (jalur normal, mayoritas baris). Diisi "telegram" kalau aksi ini dipicu dari tombol notifikasi Telegram (lihat modul notifikasi, core/src/notifikasi/webhook.ts) -- dicatat supaya riwayat bisa membedakan "siapa menekan tombol di mana", bukan menambah tabel audit terpisah.';
