/**
 * Kode otomatis server-side: prefix + nomor urut 3 digit (contoh: BB-013,
 * RP-013, VN-004, KT-002) -- Tahap 1C. Dipakai Master Item, Resep Produksi,
 * Vendor, dan Kategori Item supaya user tidak wajib mengetik kode manual,
 * tapi TETAP BISA menimpa saran ini saat membuat data baru (caller cukup
 * tidak memanggil fungsi ini kalau client sudah mengirim kode sendiri).
 *
 * Kode yang SUDAH tersimpan (hasil create sebelumnya) tetap TIDAK BISA
 * diedit lewat update -- itu aturan lama yang sudah ada untuk item/menu/
 * kategori ("rename, kode TETAP", 2026-10-30) dan sengaja TIDAK diubah di
 * sini, cuma diperluas konsisten ke vendor/kategori item.
 */

/**
 * @param prefix Prefix 2 huruf kapital, TANPA tanda hubung (mis. "BB", "RP").
 * @param cariAngkaTerbesar Angka urut TERBESAR yang sudah dipakai untuk
 *   prefix ini (0 kalau belum ada baris sama sekali).
 * @param kodeSudahDipakai Cek satu kandidat kode terhadap tabel tujuan.
 */
export async function kodeOtomatis(
  prefix: string,
  cariAngkaTerbesar: () => Promise<number>,
  kodeSudahDipakai: (kode: string) => Promise<boolean>,
): Promise<string> {
  let next = (await cariAngkaTerbesar()) + 1;
  // Retry increment kalau collision (race antar request bersamaan) --
  // UNIQUE constraint DB tetap penjamin akhir ("penanda unik"), loop ini
  // cuma usaha terbaik supaya request normal tidak sering gagal karena
  // tabrakan nomor urut.
  for (let attempt = 0; attempt < 50; attempt++) {
    const kandidat = `${prefix}-${String(next).padStart(3, "0")}`;
    if (!(await kodeSudahDipakai(kandidat))) return kandidat;
    next++;
  }
  throw new Error(`Gagal membuat kode unik untuk prefix "${prefix}" setelah 50 percobaan`);
}
