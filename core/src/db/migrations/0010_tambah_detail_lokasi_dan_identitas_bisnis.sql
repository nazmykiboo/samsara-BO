-- Tahap 1 "Outlet & Kitchen + Identitas Bisnis" (dikerjakan di dev, BUKAN
-- production -- lihat instruksi owner). Dua hal di satu migrasi karena
-- keduanya murni milik core (lokasi sudah di core sejak 0006, identitas
-- bisnis juga platform-level, bukan punya modul bisnis tertentu):
--
-- 1. Detail lokasi: kolom baru di `core_locations` yang sebelumnya cuma
--    punya name/is_active/entitas -- form "Outlet & Kitchen" butuh data
--    operasional (alamat, jam buka, PIC, dst) yang belum ada tempatnya.
-- 2. Identitas bisnis: tabel baru `core_business_identity`, SATU baris
--    (pola CHECK id=1, bukan key-value seperti *_settings -- nama+logo
--    selalu dibaca/ditulis bersamaan, tidak ada kebutuhan key lain yang
--    longgar ditambah belakangan seperti pengaturan lain).

-- --- 1. Detail lokasi ------------------------------------------------------

ALTER TABLE core_locations ADD COLUMN IF NOT EXISTS kode TEXT;
ALTER TABLE core_locations ADD COLUMN IF NOT EXISTS tipe TEXT;
ALTER TABLE core_locations ADD COLUMN IF NOT EXISTS alamat TEXT;
ALTER TABLE core_locations ADD COLUMN IF NOT EXISTS kota TEXT;
ALTER TABLE core_locations ADD COLUMN IF NOT EXISTS telepon TEXT;
ALTER TABLE core_locations ADD COLUMN IF NOT EXISTS jam_buka TIME;
ALTER TABLE core_locations ADD COLUMN IF NOT EXISTS jam_tutup TIME;
ALTER TABLE core_locations ADD COLUMN IF NOT EXISTS penanggung_jawab TEXT;
ALTER TABLE core_locations ADD COLUMN IF NOT EXISTS tanggal_buka DATE;
ALTER TABLE core_locations ADD COLUMN IF NOT EXISTS kitchen_default_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'core_locations_kitchen_default_id_fkey'
  ) THEN
    ALTER TABLE core_locations
      ADD CONSTRAINT core_locations_kitchen_default_id_fkey
      -- SET NULL (bukan RESTRICT/default) kalau kitchen yang direferensikan
      -- dihapus suatu saat -- lebih wajar daripada menolak hapus kitchen
      -- cuma karena masih "dirujuk" sebagai default oleh outlet lain;
      -- outlet-nya tetap ada, cuma field ini kosong lagi, bisa diisi ulang.
      FOREIGN KEY (kitchen_default_id) REFERENCES core_locations (id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE core_locations ADD CONSTRAINT core_locations_tipe_check
  CHECK (tipe IS NULL OR tipe IN ('outlet', 'kitchen'));

-- Backfill tipe dari entitas yang sudah ada (konvensi entitas sejak 0010
-- modul Inventory: akhiran "_ck" = central kitchen, selain itu = outlet) --
-- supaya 2 baris lokasi existing tidak kosong `tipe`-nya begitu kolom ini
-- mulai dipakai validasi/filter di UI.
UPDATE core_locations SET tipe = CASE WHEN entitas LIKE '%_ck' THEN 'kitchen' ELSE 'outlet' END
WHERE tipe IS NULL;

COMMENT ON COLUMN core_locations.kode IS
  'Kode singkat lokasi untuk tampilan ringkas (mis. "CK-01", "OUT-01"). Opsional, TIDAK unik secara constraint -- pengisian manual oleh owner, bukan digenerate sistem.';
COMMENT ON COLUMN core_locations.tipe IS
  'Jenis lokasi: "outlet" (titik jual) atau "kitchen" (dapur pemasok, mis. Central Kitchen). Dibackfill dari pola `entitas` existing (akhiran "_ck" -> kitchen) saat migrasi ini jalan -- lokasi baru sesudahnya WAJIB mengisi langsung lewat form, bukan ikut pola entitas lagi.';
COMMENT ON COLUMN core_locations.kitchen_default_id IS
  'Kitchen pemasok default untuk lokasi bertipe "outlet" -- dipakai sebagai referensi "dari kitchen mana outlet ini biasanya menerima transfer stok". NULLABLE: outlet boleh belum punya kitchen default, dan kitchen itu sendiri tidak mengisi field ini (dibiarkan NULL untuk tipe "kitchen"). Tidak ditegakkan oleh sistem (bukan FK yang memblokir transfer dari kitchen lain) -- murni informasi default untuk mempercepat pengisian form, lihat endpoint salin konfigurasi.';

-- --- 2. Identitas bisnis ---------------------------------------------------

CREATE TABLE IF NOT EXISTS core_business_identity (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  display_name TEXT NOT NULL,
  logo_bytes BYTEA,
  logo_content_type TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT core_business_identity_single_row CHECK (id = 1)
);

COMMENT ON TABLE core_business_identity IS
  'Identitas bisnis tampilan (nama + logo), SATU baris (id selalu 1, lihat CHECK). GET nama+logo publik (tanpa login, dipakai halaman login/tab title sebelum ada token auth), PUT khusus owner. Logo disimpan sebagai BYTEA langsung di database (bukan file di disk) -- aplikasi ini belum punya storage/CDN terpisah, dan ukurannya dibatasi kecil (maks 500KB) di validasi aplikasi supaya tidak membengkakkan database.';
COMMENT ON COLUMN core_business_identity.logo_content_type IS
  'MIME type logo tersimpan (image/png, image/jpeg, atau image/webp) -- dipakai endpoint GET logo untuk header Content-Type yang benar. NULL kalau belum pernah upload logo (logo_bytes juga NULL).';

-- Default nama tampilan: "Burnas" (nama brand SUNGGUHAN produksi per
-- CLAUDE.md §1 -- "Samsara" cuma codename development), BUKAN "Samsara
-- Backoffice" yang sebelumnya hardcode di frontend. Owner bisa ganti kapan
-- pun lewat PUT. Baris ini TIDAK pernah dibuat ulang kalau sudah ada
-- (ON CONFLICT DO NOTHING) -- migrasi ini idempotent dan tidak menimpa
-- nama yang mungkin sudah diubah owner kalau migrasi ini "dijalankan ulang"
-- di skenario tidak normal manapun.
INSERT INTO core_business_identity (id, display_name) VALUES (1, 'Burnas')
ON CONFLICT (id) DO NOTHING;
