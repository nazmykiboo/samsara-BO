-- Audit trail: siapa yang membuat tiap transaksi. Nullable (transaksi lama/
-- import batch tanpa user tetap valid), terisi otomatis dari user yang
-- login saat request masuk lewat API (lihat modules/inventory/src/domain/stok.ts
-- dan src/api/router.ts) -- tidak ada logika yang MEWAJIBKAN kolom ini
-- terisi di level database, supaya tidak memblokur skenario lain (migrasi,
-- import data lama, dsb).
--
-- FK ke core_users(id) -- ini arah dependency yang NORMAL/diharapkan (modul
-- boleh mereferensikan tabel core, beda dengan core yang sengaja TIDAK
-- FK ke tabel modul manapun, lihat core/src/db/migrations/0001_create_auth_tables.sql).
-- Tabel-tabel ini masih 0 baris (belum ada transaksi sungguhan), jadi aman
-- ditambah kolom tanpa backfill.

ALTER TABLE inventory_transaksi_pembelian ADD COLUMN dibuat_oleh BIGINT REFERENCES core_users (id);
ALTER TABLE inventory_transaksi_produksi ADD COLUMN dibuat_oleh BIGINT REFERENCES core_users (id);
ALTER TABLE inventory_transaksi_penjualan ADD COLUMN dibuat_oleh BIGINT REFERENCES core_users (id);
ALTER TABLE inventory_transaksi_transfer ADD COLUMN dibuat_oleh BIGINT REFERENCES core_users (id);
ALTER TABLE inventory_transaksi_mutasi_lain ADD COLUMN dibuat_oleh BIGINT REFERENCES core_users (id);
ALTER TABLE inventory_transaksi_opname ADD COLUMN dibuat_oleh BIGINT REFERENCES core_users (id);
