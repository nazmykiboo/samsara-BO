-- Tahap 1 "Outlet & Kitchen": pemetaan ID outlet platform -> lokasi
-- Samsara, supaya `/proses` tidak selalu jatuh ke SATU lokasi default
-- (sebelumnya: `getDefaultLocationId`, lihat `domain/settings.ts`) begitu
-- bisnis ekspansi ke outlet ke-2+.
--
-- 1. Kolom opsional BARU di `salessync_log_penjualan`: `outlet_ref`, ID/kode
--    outlet APA ADANYA dari sumber (platform delivery atau Majoo) -- bukan
--    lokasi Samsara. Nullable: sumber lama/export yang belum menyertakan
--    info ini (semua baris existing) tetap valid, `/proses` jatuh ke lokasi
--    default seperti sebelumnya untuk baris begini (lihat perubahan kode
--    `proses.ts`).
-- 2. Tabel pemetaan BARU: `(platform, outlet_ref) -> location_id`. Terpisah
--    dari `salessync_platform_channel_map` (yang memetakan NAMA PLATFORM
--    mentah -> channel internal, konsepnya beda sama sekali -- channel
--    "GoFood" vs lokasi fisik mana pesanannya berasal).

ALTER TABLE salessync_log_penjualan ADD COLUMN IF NOT EXISTS outlet_ref TEXT;

COMMENT ON COLUMN salessync_log_penjualan.outlet_ref IS
  'ID/kode outlet APA ADANYA dari sumber (platform delivery/Majoo) -- BUKAN location_id Samsara. Nullable (sumber lama/belum menyertakan info ini). Dipetakan ke lokasi Samsara lewat salessync_outlet_location_map; kosong atau tidak ada pemetaan -> proses sinkronisasi jatuh ke lokasi default (salessync_settings.default_location_id), lihat domain/proses.ts.';

CREATE TABLE IF NOT EXISTS salessync_outlet_location_map (
  platform TEXT NOT NULL,
  outlet_ref TEXT NOT NULL,
  location_id BIGINT NOT NULL REFERENCES core_locations (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, outlet_ref)
);

COMMENT ON TABLE salessync_outlet_location_map IS
  'Pemetaan ID outlet platform (nilai mentah salessync_log_penjualan.outlet_ref, digrup per platform karena skema ID outlet beda-beda antar platform) -> lokasi Samsara (core_locations.id). Dibaca prosesSinkronisasi: ada pemetaan -> pakai location_id itu; outlet_ref kosong ATAU tidak ada baris pemetaan yang cocok -> jatuh ke lokasi default (salessync_settings.default_location_id), TIDAK pernah error/skip baris cuma karena belum terpetakan.';
