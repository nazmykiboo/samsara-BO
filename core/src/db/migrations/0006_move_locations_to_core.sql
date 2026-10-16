-- Pindahkan kepemilikan tabel lokasi dari modul Inventory ke CORE.
-- Keputusan owner (dikonfirmasi eksplisit, 2026-10-06): modul bisnis baru
-- (hr, dan modul lain di masa depan) butuh foreign key SUNGGUHAN ke
-- lokasi outlet/gudang (misal hr_jadwal_shift.lokasi_id), tapi menurut
-- CLAUDE.md §3 modul bisnis tidak boleh bergantung langsung ke tabel milik
-- modul bisnis LAIN (hanya lewat API yang diekspos) -- isolasi antar modul
-- bisnis. Modul manapun boleh bergantung ke `core`, karena core memang
-- lapisan platform bersama (itu alasan core ada, lihat core_users/core_roles
-- di 0001_create_auth_tables.sql). Jadi lokasi dipindah jadi milik core:
-- `core_locations`, dan `inventory_locations` di modul Inventory akan
-- dihapus (lihat migrasi modul Inventory yang merepoint 11 foreign key
-- yang tadinya menunjuk ke inventory_locations, lalu DROP TABLE-nya --
-- selalu jalan SETELAH migrasi core ini, lihat runMigrations() di
-- core/src/db/migrate.ts yang selalu menjalankan migrasi core dulu).
--
-- Preseden desain lama: `core_user_lokasi.location_id` SENGAJA dibuat
-- TANPA foreign key ke inventory_locations di 0001_create_auth_tables.sql,
-- justru karena saat itu lokasi masih "milik" modul Inventory dan core
-- tidak boleh hard-depend ke tabel modul bisnis. Alasan itu sudah tidak
-- berlaku lagi sekarang lokasi pindah ke core sendiri -- FK sungguhan
-- ditambahkan di bawah.

CREATE TABLE IF NOT EXISTS core_locations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  entitas TEXT NOT NULL
);

COMMENT ON TABLE core_locations IS
  'Master lokasi (outlet/gudang) Samsara -- pindah dari inventory_locations (modul Inventory) ke core supaya modul bisnis lain (hr, dst) bisa FK langsung tanpa melanggar isolasi antar modul bisnis. Lihat komentar migrasi ini dan docs/architecture-decisions.md.';

COMMENT ON COLUMN core_locations.entitas IS
  'Kode entitas internal Samsara, snake_case (mis. samsara_ck, samsara_outlet) -- dipakai modul Inventory untuk filter nilai stok/HPP per cost-center. Dipertahankan persis sama seperti kolom asalnya di inventory_locations (ditambahkan di migrasi 0010_add_entitas_and_transfer_pricing.sql modul Inventory).';

-- Copy data dari inventory_locations, WAJIB preserve id yang sama persis
-- karena 11 foreign key constraint di modul Inventory (dan baris yang
-- sudah ada di core_user_lokasi, soft reference) masih memegang nilai id
-- lama. ON CONFLICT (id) DO NOTHING supaya aman kalau migrasi ini pernah
-- dicoba jalan lagi di luar mekanisme tracking schema_migrations.
--
-- KOREKSI 2026-10-16 (bug nyata, ditemukan saat deploy production #1 ke
-- database BENAR-BENAR fresh): blok ini awalnya mengasumsikan
-- inventory_locations SUDAH ADA -- benar untuk database dev yang sudah
-- lama berjalan (tabel itu sudah ada sejak modul Inventory 0001, jauh
-- sebelum migrasi ini ditulis), tapi SALAH untuk database baru: runMigrations()
-- (core/src/db/migrate.ts) selalu menjalankan SEMUA migrasi core dulu
-- sebelum migrasi modul manapun, jadi migrasi ini jalan SEBELUM modul
-- Inventory sempat membuat inventory_locations sama sekali -- `INSERT ...
-- FROM inventory_locations` gagal dengan "relation does not exist" dan
-- menggagalkan SELURUH migrate (core & modul lain ikut tidak jalan).
-- Dibungkus IF EXISTS supaya PERILAKU TIDAK BERUBAH SAMA SEKALI di database
-- manapun yang sudah menjalankan migrasi ini (tabelnya memang ada, blok ini
-- tetap jalan persis seperti sebelumnya) -- cuma menambal database baru
-- (tabelnya belum ada = memang tidak ada data lama yang perlu disalin,
-- modul Inventory akan membuat inventory_locations kosong sendiri nanti,
-- lalu menghapusnya lagi di modules/inventory/0023_move_locations_to_core.sql
-- yang sudah idempotent/aman dari awal lewat DROP TABLE IF EXISTS).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_locations') THEN
    INSERT INTO core_locations (id, name, is_active, created_at, entitas)
    OVERRIDING SYSTEM VALUE
    SELECT id, name, is_active, created_at, entitas FROM inventory_locations
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- Reset sequence identity supaya INSERT berikutnya (lokasi baru, bukan
-- hasil copy) lanjut dari nomor yang benar, bukan mulai dari 1 lagi. Aman
-- juga untuk database baru (blok di atas di-skip, core_locations kosong):
-- COALESCE jatuh ke 1, sequence mulai dari awal seperti seharusnya.
SELECT setval(
  pg_get_serial_sequence('core_locations', 'id'),
  COALESCE((SELECT MAX(id) FROM core_locations), 1)
);

-- FK sungguhan ke core_user_lokasi -- lihat preseden di komentar atas file
-- ini. SENGAJA TANPA ON DELETE CASCADE: kalau sebuah lokasi masih punya
-- user yang di-assign ke situ, menghapus lokasi itu harus GAGAL dengan
-- error FK yang jelas, bukan diam-diam ikut menghapus baris assignment
-- user (yang bisa bikin user kehilangan akses tanpa jejak/alasan jelas).
-- Idempotent lewat pengecekan pg_constraint karena ALTER TABLE ... ADD
-- CONSTRAINT di Postgres tidak punya syntax IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'core_user_lokasi_location_id_fkey'
  ) THEN
    ALTER TABLE core_user_lokasi
      ADD CONSTRAINT core_user_lokasi_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES core_locations (id);
  END IF;
END $$;

COMMENT ON COLUMN core_user_lokasi.location_id IS
  'Referensi ke core_locations.id, SEKARANG dengan foreign key constraint sungguhan (core_user_lokasi_location_id_fkey) -- sejak lokasi pindah jadi milik core (lihat migrasi ini), preseden lama "soft reference tanpa FK" karena lokasi dulu milik modul Inventory sudah tidak relevan lagi.';
