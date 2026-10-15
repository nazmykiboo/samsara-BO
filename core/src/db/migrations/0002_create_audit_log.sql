-- Audit log lintas modul, di CORE (sama alasannya dengan auth: dipakai
-- modul apa pun, bukan spesifik satu modul bisnis). Satu baris = satu field
-- yang berubah (bukan satu baris per aksi) supaya gampang di-query "field
-- X pernah diubah kapan saja" tanpa parse JSON diff.

CREATE TABLE core_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT REFERENCES core_users (id),
  table_name TEXT NOT NULL,
  record_id BIGINT NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_core_audit_log_table_record ON core_audit_log (table_name, record_id);

COMMENT ON TABLE core_audit_log IS
  'Ditulis otomatis dari application layer (core/src/auth/audit.ts) saat field sensitif berubah -- harga beli/konversi item, resep, harga jual menu. old_value/new_value disimpan sebagai TEXT (stringified) supaya satu tabel bisa menampung field dengan tipe data apa pun.';
