-- core_audit_log.user_id awalnya REFERENCES core_users(id) tanpa ON DELETE,
-- artinya default Postgres (NO ACTION) -- user yang PERNAH menulis audit
-- log tidak bisa dihapus sama sekali. Ketahuan saat cleanup test HTTP
-- (apps/api/src/auth.test.ts) gagal karena user test masih direferensikan
-- audit log. Diperbaiki: SET NULL saat user dihapus -- riwayat audit
-- (field, nilai lama/baru, waktu) tetap ada, cuma "siapa"-nya jadi kosong.
-- Migrasi baru (bukan edit 0002 yang sudah applied).

ALTER TABLE core_audit_log DROP CONSTRAINT core_audit_log_user_id_fkey;
ALTER TABLE core_audit_log
  ADD CONSTRAINT core_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES core_users (id) ON DELETE SET NULL;
