-- Jadwal shift (hr_jadwal_shift, 0001) selama ini input jam_mulai/jam_selesai
-- manual per baris -- tidak ada daftar shift standar, jadi tiap admin bisa
-- ketik jam yang beda-beda untuk shift yang sebenarnya sama (mis. "Pagi"
-- kadang 06:00-14:00, kadang 06:00-14:30 karena typo). Kebutuhan bisnis
-- sebenarnya: daftar shift standar (PAGI, SIANG, dst) yang jamnya konsisten
-- dan bisa diubah terpusat. Dibuat tabel referensi baru hr_shift_template
-- (pola sama seperti inventory_sales_channel/inventory_kategori -- tabel
-- referensi kecil, kode unik, dipakai dropdown).
--
-- hr_jadwal_shift.jam_mulai/jam_selesai TIDAK dihapus/diubah (lihat CLAUDE.md
-- -- migrasi baru, bukan edit yang sudah applied). Kolom shift_template_id
-- ditambahkan NULLABLE (bukan NOT NULL) supaya baris lama yang mungkin
-- sudah ada tidak langsung melanggar constraint -- NULL berarti "belum
-- migrasi ke template". Kolom jam_mulai/jam_selesai lama ditandai DEPRECATED
-- lewat COMMENT ON COLUMN saja (pola sama seperti inventory_items.min_stok
-- di modules/inventory/src/db/migrations/0020_create_min_stok_lokasi.sql) --
-- beda dengan kasus itu, kolom ini TETAP WAJIB diisi tiap create baru (tidak
-- boleh kosong/NULL), hanya SUMBERNYA yang berubah: dulu input manual,
-- sekarang hasil lookup dari shift_template_id lalu diduplikasi ke kolom ini
-- supaya kode lama yang masih baca jam_mulai/jam_selesai langsung dari
-- hr_jadwal_shift tidak rusak.

CREATE TABLE IF NOT EXISTS hr_shift_template (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  jam_mulai TIME NOT NULL,
  jam_selesai TIME NOT NULL,
  aktif BOOLEAN NOT NULL DEFAULT true,
  urutan_tampil INTEGER NOT NULL DEFAULT 0,

  CHECK (jam_selesai > jam_mulai)
);

COMMENT ON TABLE hr_shift_template IS
  'Daftar shift standar (kode+nama+jam) yang bisa dipilih saat membuat hr_jadwal_shift, supaya jam shift konsisten antar baris jadwal (tidak diketik manual tiap kali). aktif dipakai filter dropdown (hanya tampilkan yang aktif); urutan_tampil dipakai urutan tampilan di UI (bukan urutan jam, supaya shift baru bisa disisipkan di tengah tanpa renumber semua baris).';

COMMENT ON CONSTRAINT hr_shift_template_check ON hr_shift_template IS
  'Batasan sama seperti hr_jadwal_shift_check di 0001: shift tidak boleh lintas tengah malam. Shift lintas hari butuh keputusan produk terpisah, belum diputuskan di migrasi ini.';

INSERT INTO hr_shift_template (kode, nama, jam_mulai, jam_selesai, urutan_tampil) VALUES
  ('PAGI', 'Pagi', '06:00', '14:00', 1),
  ('SIANG', 'Siang', '14:00', '21:00', 2)
ON CONFLICT (kode) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_hr_shift_template_aktif ON hr_shift_template (aktif);

COMMENT ON INDEX idx_hr_shift_template_aktif IS
  'Dipakai filter dropdown pemilihan shift supaya hanya menampilkan template yang masih aktif.';

ALTER TABLE hr_jadwal_shift
  ADD COLUMN IF NOT EXISTS shift_template_id BIGINT REFERENCES hr_shift_template (id);

COMMENT ON COLUMN hr_jadwal_shift.shift_template_id IS
  'Sumber kebenaran BARU untuk jam shift baris ini -- lookup jam dari hr_shift_template. Nullable: NULL berarti baris lama yang belum (atau tidak perlu) dikaitkan ke template standar; endpoint baru selalu mengisi kolom ini saat membuat jadwal lewat pemilihan template.';

COMMENT ON COLUMN hr_jadwal_shift.jam_mulai IS
  'DEPRECATED sejak 0002_add_shift_template.sql sebagai SUMBER input -- sumber kebenaran baru adalah shift_template_id (lookup jam dari hr_shift_template). Kolom ini dipertahankan WAJIB terisi tiap create (tidak NULL-able, tidak berubah jadi opsional) untuk kompatibilitas mundur dan supaya query lama yang masih baca kolom ini langsung tidak rusak -- endpoint baru mengisi nilainya dengan cara menduplikasi jam_mulai dari template yang dipilih (shift_template_id), bukan dari input manual lagi.';
COMMENT ON COLUMN hr_jadwal_shift.jam_selesai IS
  'DEPRECATED sejak 0002_add_shift_template.sql sebagai SUMBER input -- sumber kebenaran baru adalah shift_template_id (lookup jam dari hr_shift_template). Kolom ini dipertahankan WAJIB terisi tiap create (tidak NULL-able, tidak berubah jadi opsional) untuk kompatibilitas mundur dan supaya query lama yang masih baca kolom ini langsung tidak rusak -- endpoint baru mengisi nilainya dengan cara menduplikasi jam_selesai dari template yang dipilih (shift_template_id), bukan dari input manual lagi.';
