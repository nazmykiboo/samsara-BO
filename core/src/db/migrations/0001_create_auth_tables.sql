-- Auth & permission lintas modul, dibangun di CORE (bukan modul Inventory)
-- -- sesuai instruksi owner: sistem role/permission harus dipakai bersama
-- oleh modul apa pun, bukan milik satu modul bisnis. Prefix tabel "core_"
-- (bukan tanpa prefix) supaya konsisten dengan filosofi isolasi prefix yang
-- sudah dipakai modul lain, dan tidak ambigu kalau nanti ada tabel lain di
-- level platform.

CREATE TABLE core_roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

COMMENT ON TABLE core_roles IS
  'Daftar role tetap: owner, manajer_ops, supervisor, staf. Baris baru cuma ditambah lewat migrasi (bukan self-service), karena role dipakai sebagai kunci di permission matrix module.json.';

INSERT INTO core_roles (name) VALUES ('owner'), ('manajer_ops'), ('supervisor'), ('staf');

CREATE TABLE core_users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_id BIGINT NOT NULL REFERENCES core_roles (id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN core_users.password_hash IS
  'Hash bcrypt (bcryptjs), bukan plaintext. Tidak ada password default di kode/repo -- user owner pertama dibuat lewat script seed yang baca password dari .env (lihat apps/api/src/seed-owner.ts).';

-- Pembatasan akses per lokasi untuk role supervisor/staf. SENGAJA TANPA
-- foreign key ke inventory_locations: core adalah platform yang dipakai
-- semua modul, tidak boleh hard-depend ke tabel milik satu modul bisnis
-- tertentu (kalau nanti modul Inventory dinonaktifkan/diganti, core tidak
-- boleh ikut rusak). Validasi "location_id ini benar-benar ada" dilakukan
-- di application layer (core/src/auth/users.ts) saat assign, bukan lewat
-- constraint database. Lihat docs/architecture-decisions.md untuk detail.
CREATE TABLE core_user_lokasi (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES core_users (id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL,
  UNIQUE (user_id, location_id)
);

COMMENT ON COLUMN core_user_lokasi.location_id IS
  'Referensi lunak (soft reference) ke id lokasi milik modul Inventory (inventory_locations.id) -- TIDAK ADA foreign key constraint, sengaja, lihat komentar di atas tabel.';
