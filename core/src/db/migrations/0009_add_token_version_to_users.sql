-- Mekanisme revoke token: counter per-user yang disisipkan ke payload JWT
-- saat login, dibandingkan ke nilai di database pada SETIAP request lewat
-- middleware requireAuth. Kalau beda, token dianggap basi (401) walau masih
-- valid secara kriptografis dan belum kedaluwarsa (TOKEN_TTL 12 jam).
--
-- Ini realisasi dari gap yang sudah tercatat di
-- docs/architecture-decisions.md § 13.6 / poin 14 ("sistem ini belum punya
-- revoke token") -- sebelumnya, user yang dinonaktifkan atau di-reset
-- kredensialnya tetap bisa dipakai tokennya sampai 12 jam berikutnya karena
-- requireAuth murni verify-signature, tidak pernah query database.
--
-- Dinaikkan (+1) oleh domain code (core/src/auth/users.ts) saat:
--   - user dinonaktifkan (isActive -> false)
--   - password atau PIN di-reset
--   - daftar lokasi (locationIds) user diubah
-- TIDAK ada trigger SQL otomatis -- dinaikkan eksplisit di kode aplikasi,
-- supaya mudah ditelusuri kapan & kenapa sebuah versi naik (sama seperti
-- pola audit log lain di repo ini, bukan logic tersembunyi di level DB).
--
-- NOT NULL DEFAULT 0: semua user existing mulai dari versi 0, konsisten
-- dengan versi yang akan disisipkan ke token manapun yang diterbitkan
-- sebelum migrasi ini (token lama tetap valid sampai TTL alami, tidak ada
-- backfill yang memaksa re-login massal -- bukan insiden keamanan, cuma
-- user baru/existing mulai dari baseline yang sama).
ALTER TABLE core_users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN core_users.token_version IS
  'Counter revoke token. Disisipkan ke payload JWT saat login (lihat core/src/auth/jwt.ts), dibandingkan ke nilai kolom ini pada SETIAP request oleh requireAuth (core/src/auth/permissions.ts) -- mismatch berarti token basi, ditolak 401. Dinaikkan eksplisit oleh core/src/auth/users.ts saat user dinonaktifkan, password/PIN di-reset, atau locationIds diubah.';
