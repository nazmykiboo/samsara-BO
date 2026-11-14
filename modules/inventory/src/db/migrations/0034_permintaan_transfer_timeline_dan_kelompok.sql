-- Tahap 1B (2026-11-14): Permintaan ke CK -- timeline lengkap (diminta,
-- dijawab, dikirim, diterima), "dibutuhkan sebelum" (tanggal+shift), dan
-- pengelompokan multi-item (tabel ini TETAP 1 baris = 1 item, lihat migrasi
-- 0022 -- kelompok_id cuma penanda tampilan supaya baris-baris dari SATU
-- pengajuan multi-item bisa dikelompokkan jadi satu kartu di UI, TANPA
-- mengubah granularitas pemenuhan per-item yang sudah benar).
--
-- "dikirim"/"diterima" TIDAK perlu kolom baru di tabel ini -- sudah
-- tersedia lewat join ke inventory_transaksi_transfer yang merujuk balik
-- lewat permintaan_id (lihat migrasi 0022): created_at = waktu kirim,
-- diterima_at = waktu terima (migrasi 0017). Yang BENAR-BENAR baru cuma
-- "dijawab" (keputusan CK: penuhi/penuhi sebagian/tolak -- belum ada
-- konsep ini sama sekali sebelumnya, status cuma lompat diminta->dipenuhi
-- otomatis saat transfer kirim dibuat).

ALTER TABLE inventory_permintaan_transfer
  ADD COLUMN IF NOT EXISTS kelompok_id BIGINT,
  ADD COLUMN IF NOT EXISTS dibutuhkan_sebelum_tanggal DATE,
  ADD COLUMN IF NOT EXISTS dibutuhkan_sebelum_shift TEXT,
  ADD COLUMN IF NOT EXISTS dijawab_pada TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dijawab_oleh BIGINT REFERENCES core_users (id),
  ADD COLUMN IF NOT EXISTS alasan_tolak TEXT;

-- Backfill idempoten: baris LAMA (dan baris baru yang belum sempat diisi
-- oleh createPermintaanTransfer) jadi kelompok tunggal berisi dirinya
-- sendiri -- konsisten dengan "data lama tampil '-'" untuk kolom timeline
-- BARU (dibutuhkan_sebelum_*/dijawab_*/alasan_tolak tetap NULL, HANYA
-- kelompok_id yang WAJIB terisi supaya grouping di UI tidak pernah NULL).
UPDATE inventory_permintaan_transfer SET kelompok_id = id WHERE kelompok_id IS NULL;

ALTER TABLE inventory_permintaan_transfer ALTER COLUMN kelompok_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_permintaan_transfer_shift_check'
  ) THEN
    ALTER TABLE inventory_permintaan_transfer ADD CONSTRAINT inventory_permintaan_transfer_shift_check
      CHECK (dibutuhkan_sebelum_shift IS NULL OR dibutuhkan_sebelum_shift IN ('pagi', 'siang', 'sore', 'malam'));
  END IF;
END $$;

-- Ganti CHECK status lama (migrasi 0022: diminta/dipenuhi/dibatalkan) --
-- tambah 'ditolak' (keputusan CK, BARU) dan 'dipenuhi_sebagian' (qty
-- dikirim < qty_diminta, dibedakan dari 'dipenuhi' penuh supaya riwayat
-- tidak menyamakan keduanya).
ALTER TABLE inventory_permintaan_transfer DROP CONSTRAINT inventory_permintaan_transfer_status_check;
ALTER TABLE inventory_permintaan_transfer ADD CONSTRAINT inventory_permintaan_transfer_status_check
  CHECK (status IN ('diminta', 'dipenuhi', 'dipenuhi_sebagian', 'dibatalkan', 'ditolak'));

COMMENT ON COLUMN inventory_permintaan_transfer.kelompok_id IS
  'Penanda pengelompokan TAMPILAN untuk baris-baris yang diajukan dalam SATU pengajuan multi-item (lihat createPermintaanTransfer) -- bukan FK/entitas baru, cuma dipakai GROUP BY di layar. Baris lama (sebelum kolom ini ada) = kelompok tunggal berisi dirinya sendiri.';
COMMENT ON COLUMN inventory_permintaan_transfer.dibutuhkan_sebelum_tanggal IS
  'Opsional -- kapan outlet butuh barang ini sudah sampai. NULL untuk baris lama (migrasi ini) ATAU kalau outlet tidak mengisi saat mengajukan -- tampil "-" di UI, BUKAN ditebak/di-default.';
COMMENT ON COLUMN inventory_permintaan_transfer.dibutuhkan_sebelum_shift IS
  'Opsional, salah satu dari pagi/siang/sore/malam -- label shift GENERIK (BUKAN merujuk hr_shift_template, modul HR punya template shift sendiri yang bisa di-custom nama/jamnya; isolasi antar modul, lihat CLAUDE.md -- ini cuma hint kasar "butuh sebelum shift apa", bukan constraint jadwal).';
COMMENT ON COLUMN inventory_permintaan_transfer.dijawab_pada IS
  'Kapan CK mengambil keputusan (penuhi/penuhi sebagian/tolak) atas permintaan ini. Untuk penuhi/penuhi sebagian, SAMA PERSIS waktunya dengan transfer kirim dibuat (keputusan = aksinya, tidak ada tahap "sudah diputuskan tapi belum dikirim" di alur ini) -- diisi createTransferKirim. Untuk tolak, diisi endpoint tolak permintaan TANPA transfer sama sekali.';
COMMENT ON COLUMN inventory_permintaan_transfer.alasan_tolak IS
  'WAJIB diisi kalau status = ditolak (ditegakkan di application layer, bukan CHECK constraint -- pola sama dengan alasan di inventory_transaksi_mutasi_lain). NULL untuk status lain.';
