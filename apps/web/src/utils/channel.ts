/**
 * Urutan tampil channel penjualan.
 *
 * Channel yang ada di daftar ini tampil lebih dulu sesuai urutannya (Offline = penjualan di
 * outlet, jadi paling kiri/atas); channel aktif lain yang belum terdaftar di sini tampil di
 * belakang, urut apa adanya dari API. SENGAJA bukan alfabetis: urutan ini keputusan bisnis
 * (channel yang paling sering dipakai staf duluan), sama seperti urutan kategori menu.
 *
 * Daftar channel sebenarnya tetap datang dari server (`inventory_sales_channel` yang aktif) --
 * konstanta ini CUMA soal urutan tampil, jangan dipakai sebagai sumber daftar channel.
 */
export const URUTAN_CHANNEL = ["Offline", "GrabFood", "GoFood", "ShopeeFood"];

function peringkat(nama: string): number {
  const i = URUTAN_CHANNEL.indexOf(nama);
  return i === -1 ? URUTAN_CHANNEL.length : i;
}

/** Urutkan daftar NAMA channel (string) sesuai URUTAN_CHANNEL. Tidak mengubah array masukan. */
export function urutkanNamaChannel(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const selisih = peringkat(a) - peringkat(b);
    return selisih !== 0 ? selisih : a.localeCompare(b, "id-ID");
  });
}
