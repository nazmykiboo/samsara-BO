-- core_users punya username (identifier login, unik, wajib untuk semua
-- role) tapi belum punya nama tampilan manusiawi. Dibutuhkan untuk alur
-- login PIN staf: staf pilih namanya dari daftar (bukan ketik username),
-- jadi UI perlu field "Nama" yang enak dibaca -- bukan username, yang untuk
-- staf nanti berupa slug yang dibuat sistem (keputusan app-layer, bukan di
-- migrasi ini). Dikumpulkan juga saat owner membuat user baru untuk role
-- apa pun, bukan cuma staf.
--
-- Nullable dulu supaya ALTER TABLE tidak gagal di baris existing, lalu
-- dibackfill (name = username, karena untuk role non-staf yang sudah ada
-- -- owner -- username memang nama yang pantas ditampilkan), baru di-SET
-- NOT NULL. Tidak diasumsikan tabel kosong.
ALTER TABLE core_users ADD COLUMN IF NOT EXISTS name TEXT;

UPDATE core_users SET name = username WHERE name IS NULL;

ALTER TABLE core_users ALTER COLUMN name SET NOT NULL;

COMMENT ON COLUMN core_users.name IS
  'Nama tampilan manusiawi, dipakai di UI (misal daftar staf di layar login PIN) -- beda dari username yang adalah identifier login internal, dan untuk staf dibuat otomatis oleh sistem (slug dari nama) bukan diketik user. Diisi/diubah lewat form buat/edit user, berlaku untuk semua role.';
