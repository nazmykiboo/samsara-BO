// Harus di-import PALING PERTAMA di lokasi.test.ts -- pola identik
// `sales-sync-test-port.ts` (lihat komentar lengkap di sana). Port BEDA
// (4321, bukan 4319) supaya tidak bertabrakan kalau `node --test` menjalankan
// kedua file test lintas-modul-HTTP ini di proses yang sama.
//
// Dipakai di sini oleh `modules/inventory/src/lib/internal-api.ts`
// (`adaJadwalKeDepanViaApi`, dipanggil guard nonaktifkan lokasi) -- fungsi itu
// membaca `process.env.PORT` sebagai konstanta top-level saat modul itu
// pertama di-import.
process.env.PORT = "4321";
