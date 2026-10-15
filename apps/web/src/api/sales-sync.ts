import { api, postCsv } from "./client";
import type { BarisBelumDiproses, HasilImportCsv, HasilProsesSinkronisasi, ItemMapping } from "./types";

/**
 * Modul sales-sync -- semua endpoint permission `sales_sync.manage` (owner/manajer_ops).
 *
 * Keempat fungsi import di bawah mengirim TEKS CSV MENTAH lewat `postCsv` (Content-Type: text/csv),
 * bukan JSON dan bukan FormData -- lihat catatan di ./client.ts dan `modules/sales-sync/module.json`.
 * Pembacaan filenya dilakukan di komponen dengan `await file.text()` (API bawaan browser), jadi
 * fungsi-fungsi ini cuma menerima string, tidak pernah objek `File`.
 */

/** Import export harian log penjualan per baris item. Import berhasil juga MENYEGARKAN antrian
 * pemetaan item di backend, jadi panggil ulang `getItemMapping` setelah ini. */
export function importLogPenjualan(csvText: string): Promise<HasilImportCsv> {
  return postCsv<HasilImportCsv>("/api/sales-sync/import/log-penjualan", csvText);
}

/** Import laporan rekonsiliasi transaksi per platform (pendapatan & potongan). */
export function importTransaksi(csvText: string): Promise<HasilImportCsv> {
  return postCsv<HasilImportCsv>("/api/sales-sync/import/transaksi", csvText);
}

/** Import export transaksi mentah dari API Majoo POS. */
export function importRawMajoo(csvText: string): Promise<HasilImportCsv> {
  return postCsv<HasilImportCsv>("/api/sales-sync/import/raw-majoo", csvText);
}

/** Import rincian biaya/potongan platform (iklan, komisi, adjustment, dll). */
export function importBiayaPlatform(csvText: string): Promise<HasilImportCsv> {
  return postCsv<HasilImportCsv>("/api/sales-sync/import/biaya-platform", csvText);
}

/** GET /api/sales-sync/item-mapping. `status` opsional -- kosongkan untuk SEMUA baris.
 * Backend menyegarkan antriannya dulu dari arsip log sebelum menjawab, jadi hasilnya selalu
 * mencerminkan kode eksternal terbaru tanpa perlu aksi tambahan dari UI. */
export function getItemMapping(status?: "belum_dipetakan" | "dipetakan"): Promise<ItemMapping[]> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  const query = qs.toString();
  return api.get<ItemMapping[]>(`/api/sales-sync/item-mapping${query ? `?${query}` : ""}`);
}

/** PATCH /api/sales-sync/item-mapping/:id -- tetapkan kode menu internal untuk satu baris antrian.
 *
 * Backend SENGAJA TIDAK memvalidasi bahwa `kodeMenu` benar-benar ada/aktif di modul Inventory:
 * kode yang salah baru muncul sebagai order `gagal` saat POST /proses dijalankan, dan bisa
 * dikoreksi lalu diproses ulang. Karena itu dropdown di UI mengambil pilihannya dari
 * GET /api/inventory/menu supaya user tidak bisa mengetik kode sembarangan. */
export function setItemMapping(id: string, kodeMenu: string): Promise<ItemMapping> {
  return api.patch<ItemMapping>(`/api/sales-sync/item-mapping/${encodeURIComponent(id)}`, { kodeMenu });
}

/** GET /api/sales-sync/belum-diproses -- MURNI BACA, aman dipanggil berkali-kali: tidak menandai
 * baris apa pun sudah-diproses dan tidak menyentuh stok (BEDA dari `prosesSinkronisasi` di bawah
 * yang MENULIS). Dipakai halaman Riwayat Transaksi untuk menampilkan penjualan yang sudah terarsip
 * tapi belum memotong stok.
 *
 * KEDUA filter tanggal OPSIONAL -- beda dari `prosesSinkronisasi` yang mewajibkan `tanggalMulai`.
 * Tanpa filter sama sekali backend mengembalikan SELURUH arsip yang belum diproses tanpa batas
 * tanggal (juga beda dari `listDetailTransaksiPenjualan` yang default 30 hari terakhir), jadi
 * hasilnya bisa ratusan baris -- UI sebaiknya menyarankan rentang tanggal.
 *
 * Tidak ada parameter channel/lokasi/menu di endpoint ini. */
export function listBelumDiproses(
  filter: { tanggalMulai?: string; tanggalSelesai?: string } = {},
): Promise<BarisBelumDiproses[]> {
  const params = new URLSearchParams();
  if (filter.tanggalMulai) params.set("tanggal_mulai", filter.tanggalMulai);
  if (filter.tanggalSelesai) params.set("tanggal_selesai", filter.tanggalSelesai);
  const query = params.toString();
  return api.get<BarisBelumDiproses[]>(`/api/sales-sync/belum-diproses${query ? `?${query}` : ""}`);
}

/** POST /api/sales-sync/proses -- body {tanggalMulai} WAJIB. Mengubah arsip log penjualan jadi
 * transaksi Penjualan di modul Inventory. Bisa lama kalau ordernya banyak (satu transaksi database
 * per order, sekuensial). Selalu 200 walau sebagian order dilewati/gagal -- lihat
 * HasilProsesSinkronisasi.
 *
 * `tanggalMulai` ("YYYY-MM-DD") adalah PENGAMAN WAJIB di backend, bukan filter opsional: arsip log
 * berisi ribuan baris penjualan historis, dan tanpa batas tanggal satu klik bisa memotong stok
 * untuk seluruh riwayat sekaligus. Kalau kosong/formatnya salah, backend menolak dengan HTTP 400
 * (ditangkap sebagai ApiError seperti endpoint lain), jadi UI wajib mengisinya.
 *
 * Order yang tanggalnya lebih awal dari `tanggalMulai` tetap tersimpan sebagai arsip tapi TIDAK
 * memotong stok, dan oleh backend tetap ditandai sudah-diproses -- jadi keputusan tanggal ini
 * sifatnya satu arah, tidak bisa dibatalkan dengan memanggil ulang pakai tanggal lebih awal. */
export function prosesSinkronisasi(tanggalMulai: string): Promise<HasilProsesSinkronisasi> {
  return api.post<HasilProsesSinkronisasi>("/api/sales-sync/proses", { tanggalMulai });
}
