// Harus di-import PALING PERTAMA di sales-sync-proses.test.ts -- internal-api.ts
// (modules/sales-sync/src/lib/internal-api.ts) membaca process.env.PORT sebagai
// konstanta top-level saat modul itu pertama di-import (bukan per-panggilan), dan
// import ESM selalu di-hoist di atas statement biasa -- jadi env var ini HARUS
// sudah diset lewat modul import terpisah sebelum modules.ts (yang transitif
// mengimpor internal-api.ts) sempat ter-load. Port tetap (bukan listen(0)
// acak) supaya BASE_URL yang ter-capture di internal-api.ts cocok dengan port
// sungguhan server test ini.
//
// Konsekuensi kalau ini dilewatkan: createPenjualanViaApi di dalam
// prosesSinkronisasi akan memanggil http://localhost:4000 -- port server DEV
// yang biasanya sedang jalan di mesin ini -- jadi test akan membuat transaksi
// Penjualan sungguhan lewat proses lain yang tidak bisa dibersihkan test ini.
process.env.PORT = "4319";
