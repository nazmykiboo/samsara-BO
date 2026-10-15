Migrasi SQL modul Inventory, dijalankan berurutan sesuai nama file lewat
`npm run migrate` dan dicatat di tabel `schema_migrations` supaya tidak
dobel-jalan. Postgres mendukung DDL transaksional, jadi satu file = satu
transaksi (gagal di tengah → seluruh file itu rollback, bukan cuma statement
yang gagal).

Skema di sini masih **DRAFT Tahap 1** (Arsitek Platform) — strukturnya
mengikuti aturan bisnis di `CLAUDE.md`, tapi belum diverifikasi field-by-field
ke spreadsheet `Inventori_FnB_Standar`. Finalisasi ada di Tahap 2
(Data Modeler). Detail & asumsi ada di
[`docs/inventory-schema.md`](../../../../docs/inventory-schema.md).
