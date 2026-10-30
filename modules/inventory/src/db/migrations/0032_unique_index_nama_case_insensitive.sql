-- Fitur baru: rename item/menu/kategori item/kategori menu (kode tetap,
-- nama bisa diubah), dibangun 2026-10-30. Owner minta keunikan nama TANPA
-- membedakan huruf besar/kecil dan TANPA terpengaruh spasi di ujung --
-- lebih ketat dari constraint `UNIQUE(name)`/`UNIQUE(nama)` mentah yang
-- sudah ada di 4 tabel ini (case-sensitive, tidak trim).
--
-- Index BARU ini jaring pengaman RACE-CONDITION di level database saja --
-- pesan error yang dilihat user datang dari pre-check aplikasi (fungsi
-- `namaSudahDipakai` di modules/inventory/src/domain/referensi.ts), BUKAN
-- dari pesan constraint-violation Postgres mentah (repo ini tidak punya
-- mekanisme menerjemahkan error 23505 ke Bahasa Indonesia, lihat audit
-- Tahap 0 sesi ini). Index LAMA (`UNIQUE(name)`/`UNIQUE(nama)` polos)
-- SENGAJA TIDAK di-DROP -- menambah index baru tidak mengganggu yang lama,
-- lebih aman daripada DROP+ADD untuk tabel inti seperti ini.
--
-- Pengaman SEBELUM menambah index: kalau ada data lama yang bentrok di
-- bawah aturan baru (dua nama beda besar/kecil atau beda spasi tepi tapi
-- sama kalau dinormalisasi), index UNIQUE akan GAGAL dibuat dengan pesan
-- Postgres yang membingungkan ("could not create unique index"). Migrasi
-- ini mengecek dulu lewat `RAISE EXCEPTION` dengan pesan jelas supaya kalau
-- terjadi, orang yang menjalankan migrasi tahu PERSIS tabel & nama mana
-- yang perlu dibereskan manual dulu sebelum migrasi ini bisa jalan.

DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT 'inventory_items' AS tabel, lower(trim(name)) AS kunci, count(*) AS jumlah
    FROM inventory_items GROUP BY lower(trim(name)) HAVING count(*) > 1
    UNION ALL
    SELECT 'inventory_menu', lower(trim(name)), count(*)
    FROM inventory_menu GROUP BY lower(trim(name)) HAVING count(*) > 1
    UNION ALL
    SELECT 'inventory_kategori_item', lower(trim(name)), count(*)
    FROM inventory_kategori_item GROUP BY lower(trim(name)) HAVING count(*) > 1
    UNION ALL
    SELECT 'inventory_kategori_menu', lower(trim(nama)), count(*)
    FROM inventory_kategori_menu GROUP BY lower(trim(nama)) HAVING count(*) > 1
  LOOP
    RAISE EXCEPTION 'Migrasi 0032 dibatalkan: tabel % punya % baris dengan nama "%" (setelah disamakan huruf besar/kecil & spasi tepi) -- bereskan data ini manual dulu (ganti salah satu namanya) sebelum migrasi ini dijalankan ulang.',
      dup.tabel, dup.jumlah, dup.kunci;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_name_ci_key ON inventory_items (lower(trim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS inventory_menu_name_ci_key ON inventory_menu (lower(trim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS inventory_kategori_item_name_ci_key ON inventory_kategori_item (lower(trim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS inventory_kategori_menu_nama_ci_key ON inventory_kategori_menu (lower(trim(nama)));
