-- Tambah daftar teks alasan preset "Tolak" ke token aksi notifikasi.
--
-- Kenapa disimpan di SINI (per-token), bukan di tabel aturan atau registry
-- kode: callback_data tombol Telegram cuma membawa INDEX preset (hemat
-- batas 64 byte Telegram), bukan teksnya -- webhook (core/src/notifikasi/router.ts)
-- butuh teks lengkapnya saat callback diproses, dan preset itu SPESIFIK ke
-- kejadian yang memicu notifikasi ini (lihat NotifikasiAksiSpec.alasanPresetTolak,
-- core/src/notifikasi/types.ts). Simpan di baris token-nya sendiri supaya
-- webhook tidak perlu tahu apa-apa soal daftar preset per kejadian -- cukup
-- baca balik dari baris yang sama.
ALTER TABLE core_notifikasi_token_aksi
  ADD COLUMN IF NOT EXISTS alasan_preset_tolak TEXT[];
