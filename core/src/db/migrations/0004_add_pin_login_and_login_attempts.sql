-- Dua metode login paralel: owner/manajer_ops/supervisor tetap pakai
-- username+password; staf login pakai PIN (pilih dari daftar staf aktif
-- di satu lokasi, lalu input PIN -- tanpa ketik username). Satu user hanya
-- punya salah satu dari password_hash/pin_hash, tidak pernah dua-duanya.
--
-- SENGAJA TANPA CHECK constraint "exactly one of password_hash/pin_hash".
-- Invariant ini dijaga di application layer (core/src/auth/*.ts), bukan di
-- database, karena keunikan PIN pun fundamentally tidak bisa dicek lewat
-- SQL: dua hash bcrypt dari PIN plaintext yang sama tidak akan pernah sama
-- (salt random setiap kali), jadi tidak ada UNIQUE/CHECK yang bisa
-- memvalidasi kombinasi password_hash/pin_hash secara database-level sama
-- sekali -- app harus fetch baris kandidat lalu bcrypt.compare satu per
-- satu. Constraint keras di sini cuma akan memberi rasa aman yang salah.
ALTER TABLE core_users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE core_users ADD COLUMN IF NOT EXISTS pin_hash TEXT;

COMMENT ON COLUMN core_users.password_hash IS
  'Hash bcrypt (bcryptjs), bukan plaintext. Nullable -- staf tidak punya password sama sekali, cuma PIN (lihat pin_hash). Tidak ada password default di kode/repo -- user owner pertama dibuat lewat script seed yang baca password dari .env (lihat apps/api/src/seed-owner.ts).';

COMMENT ON COLUMN core_users.pin_hash IS
  'Hash bcrypt (bcryptjs) dari PIN staf, bukan plaintext. Nullable -- cuma role staf yang punya PIN, role lain (owner/manajer_ops/supervisor) login pakai password_hash dan kolom ini kosong. Alur login PIN: pilih user dari daftar staf aktif di satu lokasi (tanpa ketik username) lalu input PIN, app bcrypt.compare terhadap kandidat.';

-- Rate-limit + audit trail untuk kedua metode login. Satu baris per
-- percobaan login (bukan cuma yang gagal) supaya rate-limit bisa hitung
-- "N percobaan gagal dalam 15 menit terakhir" dan audit bisa lihat riwayat
-- lengkap siapa login kapan, berhasil atau tidak.
CREATE TABLE core_login_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES core_users (id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('password', 'pin')),
  success BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ON DELETE SET NULL (bukan default NO ACTION/CASCADE) -- pelajaran dari
-- migrasi 0003: core_audit_log.user_id awalnya NO ACTION membuat user yang
-- pernah tercatat tidak bisa dihapus sama sekali. Di sini diterapkan dari
-- awal supaya tidak perlu migrasi koreksi lagi. user_id nullable karena
-- percobaan login dengan username yang tidak match user manapun (salah
-- ketik, brute force, dst) tetap harus tercatat untuk visibility walau
-- tidak ada baris core_users yang bisa dirujuk.
CREATE INDEX idx_core_login_attempts_user_time ON core_login_attempts (user_id, attempted_at);

COMMENT ON TABLE core_login_attempts IS
  'Basis rate-limiting (5 kali gagal dalam 15 menit -> akun dikunci sementara) sekaligus audit trail login, untuk kedua metode (password & pin). username disimpan sebagai TEXT mentah (bukan cuma via user_id) supaya percobaan dengan username tidak valid tetap terekam, dan supaya percobaan PIN (dipilih via id, bukan diketik) tetap punya identifier yang manusiawi dibaca saat audit.';
