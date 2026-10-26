-- Lanjutan Tahap 3 "Vendor & Katalog": vendor sekarang WAJIB dipilih di form
-- Pembelian (bukan opsional lagi, lihat domain/stok.ts createPembelian).
-- Dua perubahan:
-- 1. Kolom `termin` (syarat pembayaran, teks bebas -- "Tunai", "Net 30",
--    dst) supaya form tambah-vendor-cepat di dalam Pembelian (nama,
--    telepon, termin) punya tempat menyimpannya.
-- 2. Seed vendor "Pembelian Umum (pasar/warung)" -- vendor generik untuk
--    pembelian dadakan yang tidak akan pernah cocok dengan vendor
--    terstruktur manapun (mis. beli garam di warung). SENGAJA tidak diberi
--    baris katalog apa pun -- bukan vendor utama untuk item manapun, murni
--    "tempat jatuh" supaya field vendor yang sekarang wajib tetap bisa
--    diisi untuk pembelian dadakan semacam itu.

ALTER TABLE inventory_vendor ADD COLUMN termin TEXT;

COMMENT ON COLUMN inventory_vendor.termin IS
  'Syarat pembayaran, teks bebas (mis. "Tunai", "Net 30", "7 hari"). Opsional, informasional saja -- TIDAK ada logika hutang/jatuh tempo yang membacanya (modul Purchasing penuh sengaja di luar scope, lihat docs/architecture-decisions.md §28).';

INSERT INTO inventory_vendor (name, is_active)
VALUES ('Pembelian Umum (pasar/warung)', true)
ON CONFLICT (name) DO NOTHING;

-- Kolom `supplier` resmi deprecated mulai sekarang: createPembelian() TIDAK
-- lagi menulis ke kolom ini untuk pembelian BARU (selalu NULL), form
-- Pembelian juga sudah tidak punya field ini lagi. Baris LAMA (sebelum
-- perubahan ini) TETAP ADA apa adanya, dibaca sebagai "Supplier (lama)" di
-- Laporan Harian -- lihat domain/laporan.ts.
COMMENT ON COLUMN inventory_transaksi_pembelian.supplier IS
  'DEPRECATED sejak vendor_id diwajibkan di createPembelian() -- TIDAK ditulis lagi untuk pembelian baru (selalu NULL). Baris lama (sebelum perubahan ini) dipertahankan apa adanya, SENGAJA TIDAK digabung/dimigrasikan ke inventory_vendor (lihat laporkanSupplierLama di domain/vendor.ts) -- ditampilkan ke user sebagai "Supplier (lama)" di Laporan Harian kalau terisi.';
