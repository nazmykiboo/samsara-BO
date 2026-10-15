-- Modul HR — Tahap 1 (DRAFT). Jadwal shift dan pengajuan libur staf
-- Samsara. FK ke core_users (identitas staf) dan core_locations (outlet/
-- gudang, lihat core/src/db/migrations/0006_move_locations_to_core.sql --
-- lokasi sekarang milik core, jadi modul bisnis manapun termasuk hr boleh
-- FK sungguhan ke sana tanpa melanggar isolasi antar modul bisnis,
-- CLAUDE.md §3).

CREATE TABLE hr_jadwal_shift (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES core_users (id) ON DELETE CASCADE,
  lokasi_id BIGINT NOT NULL REFERENCES core_locations (id),
  tanggal DATE NOT NULL,
  jam_mulai TIME NOT NULL,
  jam_selesai TIME NOT NULL,
  dibuat_oleh BIGINT REFERENCES core_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (jam_selesai > jam_mulai)
);

COMMENT ON TABLE hr_jadwal_shift IS
  'Jadwal shift satu staf di satu lokasi pada satu tanggal.';

COMMENT ON CONSTRAINT hr_jadwal_shift_check ON hr_jadwal_shift IS
  'Batasan desain sederhana Tahap 1: shift tidak boleh lintas tengah malam (jam_selesai harus di hari yang sama dengan jam_mulai). Shift lintas hari (mis. 22:00-02:00) butuh keputusan produk terpisah -- TIDAK diputuskan di migrasi ini, tanya owner dulu kalau dibutuhkan.';

CREATE INDEX idx_hr_jadwal_shift_user_tanggal ON hr_jadwal_shift (user_id, tanggal);
CREATE INDEX idx_hr_jadwal_shift_lokasi_tanggal ON hr_jadwal_shift (lokasi_id, tanggal);

COMMENT ON INDEX idx_hr_jadwal_shift_user_tanggal IS
  'Lookup jadwal shift milik satu staf (mis. "jadwal saya minggu ini").';
COMMENT ON INDEX idx_hr_jadwal_shift_lokasi_tanggal IS
  'Lookup jadwal shift satu lokasi per tanggal -- dipakai tampilan "jadwal mingguan per lokasi" (mis. supervisor lihat jadwal outletnya).';

-- Pola gaya enum status mengikuti inventory_opname_status di
-- modules/inventory/src/db/migrations/0017_opname_dua_tahap.sql.
CREATE TYPE hr_pengajuan_libur_status AS ENUM ('diajukan', 'disetujui', 'ditolak');

CREATE TABLE hr_pengajuan_libur (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES core_users (id) ON DELETE CASCADE,
  tanggal_mulai DATE NOT NULL,
  tanggal_selesai DATE NOT NULL,
  alasan TEXT,
  status hr_pengajuan_libur_status NOT NULL DEFAULT 'diajukan',
  diputuskan_oleh BIGINT REFERENCES core_users (id) ON DELETE SET NULL,
  diputuskan_pada TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (tanggal_selesai >= tanggal_mulai)
);

COMMENT ON TABLE hr_pengajuan_libur IS
  'Pengajuan cuti/libur satu staf untuk rentang tanggal tertentu, menunggu keputusan approver.';
COMMENT ON COLUMN hr_pengajuan_libur.status IS
  '"diajukan" = menunggu keputusan. "disetujui"/"ditolak" = sudah diputuskan (lihat diputuskan_oleh & diputuskan_pada). Siapa yang boleh memutuskan adalah aturan permission di module.json, bukan di skema ini.';

CREATE INDEX idx_hr_pengajuan_libur_user_status ON hr_pengajuan_libur (user_id, status);
CREATE INDEX idx_hr_pengajuan_libur_status ON hr_pengajuan_libur (status);

COMMENT ON INDEX idx_hr_pengajuan_libur_user_status IS
  'Lookup riwayat pengajuan libur milik satu staf, bisa difilter status.';
COMMENT ON INDEX idx_hr_pengajuan_libur_status IS
  'Antrian approval (mis. "semua pengajuan yang masih diajukan") -- dipakai approver, tidak difilter per user.';
