/**
 * Geometri & skala bersama untuk grafik SVG buatan sendiri (SvgBarChart, SvgLineChart).
 *
 * KENAPA SVG MANUAL: `apps/web` sengaja TIDAK memasang library chart. Yang dibutuhkan halaman
 * Analitik cuma grafik tren baca-saja (8 titik, tanpa animasi/zoom/pan), jadi dependency baru
 * tidak sebanding dengan manfaatnya.
 *
 * Semua ukuran di bawah adalah satuan viewBox, BUKAN piksel: grafiknya dirender dengan
 * `viewBox` + `className="w-full"` tanpa atribut width/height, jadi ikut melebar mengikuti
 * kartu induknya (mobile-first: layar HP sempit tetap kebaca, layar lebar ikut menyesuaikan).
 */

export const VB_LEBAR = 320;
export const VB_TINGGI = 180;

/** Ruang kosong di tepi: kiri untuk label sumbu Y (nilai rupiah/angka), bawah untuk label
 * sumbu X (tanggal). */
/** `kiri` dihitung dari label sumbu Y TERPANJANG yang realistis ("Rp 288,5 rb" -- 11 karakter
 * pada font-size 8 ≈ 48 satuan viewBox) supaya labelnya tidak terpotong di tepi kiri. */
/** `kanan` menyisakan ruang untuk SETENGAH label sumbu X terakhir: di grafik garis titik terakhir
 * menempel tepi kanan area plot, dan labelnya rata-tengah -- tanpa jarak ini teksnya terpotong
 * (dikonfirmasi saat render uji). */
export const PAD = { atas: 10, kanan: 14, bawah: 26, kiri: 58 } as const;

export const PLOT_LEBAR = VB_LEBAR - PAD.kiri - PAD.kanan;
export const PLOT_TINGGI = VB_TINGGI - PAD.atas - PAD.bawah;

export interface SkalaY {
  /** Batas bawah/atas sumbu Y setelah penyesuaian (SELALU memuat angka 0). */
  bawah: number;
  atas: number;
  /** Posisi vertikal (satuan viewBox) untuk satu nilai data. */
  y: (nilai: number) => number;
  /** Posisi vertikal garis nol -- dipakai sebagai alas batang dan garis acuan. */
  yNol: number;
  /** Nilai-nilai yang diberi label + garis bantu (maksimal 3: atas, 0, bawah). */
  ticks: number[];
  /** true kalau SEMUA nilai data 0 (atau tidak ada data) -- rentang sumbu Y-nya buatan,
   * jadi label selain "0" tidak boleh ditampilkan supaya tidak menyesatkan. */
  semuaNol: boolean;
}

/**
 * Skala Y otomatis dari data. SELALU memuat angka 0 supaya:
 * - batang tumbuh dari garis nol yang benar, dan
 * - nilai NEGATIF (selisih opname minus, susut transfer minus) tetap kelihatan di bawah garis nol
 *   alih-alih terpotong.
 *
 * `ratakanKeTengah` dipakai grafik GARIS: kalau semua nilainya 0, rentang dibuat -1..1 supaya
 * garisnya jatuh di tengah dan jelas terbaca sebagai "nol", bukan menempel di dasar grafik.
 */
export function buatSkalaY(nilai: number[], opsi: { ratakanKeTengah?: boolean } = {}): SkalaY {
  const terpakai = nilai.filter((n) => Number.isFinite(n));
  const maksData = terpakai.length > 0 ? Math.max(...terpakai) : 0;
  const minData = terpakai.length > 0 ? Math.min(...terpakai) : 0;
  const semuaNol = maksData === 0 && minData === 0;

  const atas = semuaNol ? 1 : Math.max(0, maksData);
  const bawah = semuaNol ? (opsi.ratakanKeTengah ? -1 : 0) : Math.min(0, minData);

  const rentang = atas - bawah || 1;
  const y = (v: number) => PAD.atas + ((atas - v) / rentang) * PLOT_TINGGI;

  const ticks = semuaNol
    ? [0]
    : [atas, ...(bawah < 0 && atas > 0 ? [0] : []), bawah].filter(
        (v, i, arr) => arr.indexOf(v) === i,
      );

  return { bawah, atas, y, yNol: y(0), ticks, semuaNol };
}

/** Posisi titik ke-i untuk grafik GARIS: titik pertama menempel tepi kiri area plot, titik
 * terakhir tepi kanan. Satu titik saja -> ditaruh di tengah. */
export function xTitik(i: number, jumlah: number): number {
  if (jumlah <= 1) return PAD.kiri + PLOT_LEBAR / 2;
  return PAD.kiri + (i / (jumlah - 1)) * PLOT_LEBAR;
}

/** Slot ke-i untuk grafik BATANG: area plot dibagi rata, batang dipasang di tengah slot. */
export function slotBatang(i: number, jumlah: number): { tengah: number; lebar: number } {
  const lebarSlot = PLOT_LEBAR / Math.max(jumlah, 1);
  return { tengah: PAD.kiri + lebarSlot * (i + 0.5), lebar: lebarSlot * 0.58 };
}

/**
 * true kalau label sumbu X indeks ke-i layak ditampilkan. Kalau titiknya banyak, label diambil
 * setiap n langkah supaya tidak tumpang tindih -- dihitung dari titik TERAKHIR (bukan pertama)
 * supaya minggu/siklus terbaru SELALU berlabel; itu titik yang paling sering dilihat.
 */
export function labelTampil(i: number, jumlah: number, maksLabel = 8): boolean {
  const langkah = Math.max(1, Math.ceil(jumlah / maksLabel));
  return (jumlah - 1 - i) % langkah === 0;
}

/** Palet warna seri grafik (hex, bukan class Tailwind -- atribut `stroke`/`fill` SVG tidak
 * mengerti class utilitas). Urutannya dipilih supaya tetap bisa dibedakan di layar HP. */
export const WARNA_SERI = ["#2563eb", "#d97706", "#059669", "#7c3aed", "#db2777", "#0891b2"];

export function warnaSeri(i: number): string {
  return WARNA_SERI[i % WARNA_SERI.length];
}
