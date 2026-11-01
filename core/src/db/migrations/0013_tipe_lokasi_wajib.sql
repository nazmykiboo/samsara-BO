-- Tahap 1 "Tipe lokasi jadi sumber kebenaran CK" (lihat docs/architecture-decisions.md).
-- Bug nyata yang owner alami: rename lokasi Central Kitchen (ganti `name`
-- saja) membuatnya berhenti dikenali sebagai Kitchen di menu transaksi.
-- Akar masalah: `entitas` (teks bebas, independen dari `tipe`) adalah
-- SATU-SATUNYA sumber pengenalan "ini Central Kitchen" di kode, bukan
-- `tipe`. Mulai sekarang `entitas` DERIVED dari `tipe` (selalu sama
-- persis), dan `tipe` jadi WAJIB diisi.

-- Backfill `tipe` untuk baris yang masih NULL (kalau ada) berdasarkan
-- `entitas` LAMA (sebelum jadi derived) -- pola backfill yang sama seperti
-- migrasi 0010 (akhiran "_ck" = kitchen, selain itu = outlet). Migrasi 0010
-- sudah membackfill 2 baris lama saat itu, tapi baris yang dibuat SETELAH
-- 0010 dan SEBELUM migrasi ini (lewat form yang masih mengizinkan `tipe`
-- kosong) bisa saja masih NULL.
UPDATE core_locations SET tipe = CASE WHEN entitas LIKE '%_ck' THEN 'kitchen' ELSE 'outlet' END
WHERE tipe IS NULL;

-- Kalau SETELAH backfill di atas masih ada baris `tipe IS NULL` (semestinya
-- tidak mungkin, `entitas` selalu NOT NULL), berhenti dengan pesan jelas
-- daripada diam-diam gagal pasang constraint NOT NULL di bawah.
DO $$
DECLARE
  sisa_null INT;
BEGIN
  SELECT count(*) INTO sisa_null FROM core_locations WHERE tipe IS NULL;
  IF sisa_null > 0 THEN
    RAISE EXCEPTION 'Migrasi 0013 dibatalkan: % baris core_locations masih tipe NULL setelah backfill otomatis -- isi manual dulu lewat SQL yang dikaji, baru jalankan migrasi ini lagi.', sisa_null;
  END IF;
END $$;

-- `entitas` sekarang derived dari `tipe` (literal "outlet"/"kitchen"), BUKAN
-- lagi teks bebas independen -- samakan nilai lama (mis. "samsara_ck",
-- "outlet_01") supaya konsisten dengan aturan baru SEBELUM kode aplikasi
-- yang membaca `entitas` di-deploy.
UPDATE core_locations SET entitas = tipe WHERE entitas IS DISTINCT FROM tipe;

ALTER TABLE core_locations ALTER COLUMN tipe SET NOT NULL;

COMMENT ON COLUMN core_locations.tipe IS
  'Jenis lokasi: "outlet" (titik jual) atau "kitchen" (dapur pemasok, mis. Central Kitchen). WAJIB diisi sejak migrasi 0013 -- SATU-SATUNYA sumber kebenaran untuk pengenalan "ini Central Kitchen" di seluruh aplikasi (bukan `entitas` lagi, lihat COMMENT kolom entitas).';
COMMENT ON COLUMN core_locations.entitas IS
  'DERIVED dari `tipe` sejak migrasi 0013 -- selalu persis sama dengan nilai `tipe` ("outlet"/"kitchen"), diisi otomatis oleh createLokasi/updateLokasi (modules/inventory/src/domain/pengaturan.ts), BUKAN input manual lagi. Dipakai HANYA oleh trigger inventory_set_transfer_antar_entitas() (migrasi inventory 0010) untuk menandai transfer Kitchen<->Outlet sebagai antar_entitas=true. JANGAN dipakai lagi untuk pengenalan CK di kode baru -- pakai `tipe = ''kitchen''`.';
