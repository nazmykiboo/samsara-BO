-- SOP cuti Samsara: pengajuan cuti NORMAL (lewat POST /pengajuan-libur)
-- sekarang wajib H-2 (minimal 2 hari sebelum tanggal_mulai) -- aturan ini
-- diterapkan di domain layer (modules/hr/src/domain/pengajuan-libur.ts),
-- BUKAN sebagai CHECK constraint: "hari ini" bukan nilai immutable, jadi
-- constraint tanggal relatif akan membuat baris lama ikut invalid tiap kali
-- tabel di-rewrite (sama alasannya dengan kenapa kuota cuti bulanan juga
-- dihitung di runtime, bukan disimpan sebagai kolom -- lihat 0003).
--
-- Jalur DARURAT: owner/manajer_ops bisa membuatkan cuti untuk staf lain
-- lewat POST /pengajuan-libur/override, yang MENEMBUS H-2 dan langsung
-- berstatus 'disetujui' (buat + setujui dalam satu langkah). Dua kolom di
-- bawah ini yang menandai dan melengkapi jalur itu.
--
-- Tidak ada kolom lama yang dihapus/diubah di migrasi ini (lihat CLAUDE.md
-- -- migrasi selalu file baru), dan tidak ada tabel baru: cuti override
-- tetap baris hr_pengajuan_libur biasa supaya SEMUA pembacaan yang sudah
-- ada (antrian approval, kuota bulanan, kuota harian lokasi) otomatis ikut
-- menghitungnya tanpa perubahan query.

ALTER TABLE hr_pengajuan_libur
  ADD COLUMN IF NOT EXISTS pengganti_nama TEXT;

COMMENT ON COLUMN hr_pengajuan_libur.pengganti_nama IS
  'Nama staf yang menggantikan shift selama cuti ini. WAJIB diisi (divalidasi di domain layer, bukan NOT NULL di skema) HANYA pada pengajuan override yang melanggar kuota harian cuti lokasi -- yaitu kalau di lokasi staf ini sudah ada cuti lain berstatus disetujui yang tanggalnya overlap (maksimal 1 cuti disetujui per lokasi per tanggal, supaya outlet tidak kehilangan >1 staf di hari yang sama). NULL untuk pengajuan normal dan untuk override yang tidak menabrak kuota harian itu -- karena itu kolom ini nullable, bukan NOT NULL.';

ALTER TABLE hr_pengajuan_libur
  ADD COLUMN IF NOT EXISTS dibuat_via_override BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN hr_pengajuan_libur.dibuat_via_override IS
  'true = baris ini dibuat owner/manajer_ops lewat POST /pengajuan-libur/override (jalur darurat: mengajukan UNTUK STAF LAIN, menembus aturan H-2, langsung status disetujui tanpa tahap keputusan terpisah). false (default) = pengajuan normal staf untuk dirinya sendiri lewat POST /pengajuan-libur, yang tetap kena H-2 dan tetap harus diputuskan approver. Dipakai untuk jejak audit/laporan "berapa banyak cuti darurat di luar SOP" -- bukan untuk mengubah perilaku pembacaan lain (baris override ikut dihitung di kuota bulanan & kuota harian lokasi seperti baris biasa). Detail aturan mana yang ditembus per baris dicatat di core_audit_log, field_name = created_via_override.';
