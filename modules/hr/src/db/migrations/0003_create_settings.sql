-- Pengaturan modul HR (key-value sederhana), pola sama seperti
-- inventory_settings di modules/inventory/src/db/migrations/0018_create_settings.sql.
-- Kebutuhan pertama: kuota cuti bulanan default per staf, dipakai modul hr
-- untuk menghitung sisa kuota pengajuan libur (hr_pengajuan_libur, 0001).

CREATE TABLE IF NOT EXISTS hr_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE hr_settings IS
  'Key-value pengaturan modul hr. Dikelola lewat API (endpoint pengaturan belum dibuat di migrasi ini, akan ditambahkan menyusul).';

INSERT INTO hr_settings (key, value) VALUES ('cuti_kuota_bulanan', '2')
ON CONFLICT (key) DO NOTHING;
