-- Persiapan skema untuk Fase 2 (fitur reminder via WhatsApp) -- BELUM ada
-- logika backend/frontend yang memakai kedua kolom ini. Migrasi ini hanya
-- menyiapkan tempat penyimpanan supaya saat Fase 2 digarap, tidak perlu lagi
-- ALTER TABLE core_users (yang berarti migrasi baru lagi, bukan edit
-- migrasi ini -- sesuai pola "migrasi baru, bukan edit yang sudah applied"
-- di docs/architecture-decisions.md).
--
-- nomor_whatsapp: nullable, TEXT (konsisten dengan kolom string lain di
-- core_users seperti username/name yang juga TEXT). Nullable karena belum
-- semua user (terutama yang sudah ada) akan mengisi nomor ini, dan tidak
-- ada backfill -- diisi nanti lewat form edit user saat Fase 2 dibangun.
--
-- reminder_aktif: flag on/off untuk fitur reminder WhatsApp, default false
-- supaya tidak ada user existing yang "tiba-tiba" dianggap aktif reminder
-- padahal belum pernah di-setup. NOT NULL karena ini saklar biner, tidak
-- ada state "belum diketahui" yang masuk akal untuk kolom ini.
ALTER TABLE core_users ADD COLUMN IF NOT EXISTS nomor_whatsapp TEXT;

ALTER TABLE core_users ADD COLUMN IF NOT EXISTS reminder_aktif BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN core_users.nomor_whatsapp IS
  'Nomor WhatsApp user, untuk fitur reminder WhatsApp Fase 2 (belum dibangun). Nullable, tidak di-backfill -- NULL untuk semua user sampai diisi manual lewat form edit user saat Fase 2 digarap.';

COMMENT ON COLUMN core_users.reminder_aktif IS
  'Saklar aktif/nonaktif fitur reminder WhatsApp per user, untuk Fase 2 (belum dibangun). Default false untuk semua user (termasuk yang sudah ada) sampai fitur ini benar-benar dirilis dan diaktifkan secara eksplisit.';
