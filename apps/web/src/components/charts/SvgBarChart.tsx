import {
  PAD,
  PLOT_LEBAR,
  VB_LEBAR,
  VB_TINGGI,
  buatSkalaY,
  labelTampil,
  slotBatang,
} from "./skala";

export interface TitikBatang {
  /** Label sumbu X, mis. "6 Okt". */
  label: string;
  nilai: number;
  /** Keterangan lengkap yang muncul saat batang disentuh/di-hover (tooltip bawaan browser)
   * dan dibacakan pembaca layar. Mis. "Minggu 6-12 Okt 2026: Rp 28.800". */
  keterangan: string;
}

/**
 * Grafik batang sederhana satu seri, untuk tren mingguan (waste, susut transfer).
 *
 * Nilai 0 TETAP digambar sebagai batang tipis abu-abu, bukan dihilangkan -- "minggu ini nol"
 * adalah fakta yang berbeda dari "datanya tidak ada", dan staf tidak boleh salah membacanya.
 * Nilai negatif digambar ke BAWAH garis nol (lihat buatSkalaY).
 */
export function SvgBarChart({
  data,
  formatNilai,
  labelAria,
}: {
  data: TitikBatang[];
  /** Pemformat label sumbu Y -- pakai formatRupiahSingkat / formatAngka dari utils/format. */
  formatNilai: (nilai: number) => string;
  /** Ringkasan isi grafik untuk pembaca layar. */
  labelAria: string;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">Belum ada data untuk periode ini.</p>;
  }

  const skala = buatSkalaY(data.map((d) => d.nilai));

  return (
    <svg
      viewBox={`0 0 ${VB_LEBAR} ${VB_TINGGI}`}
      className="h-auto w-full"
      role="img"
      aria-label={labelAria}
    >
      {/* Garis bantu + label sumbu Y */}
      {skala.ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.kiri}
            x2={PAD.kiri + PLOT_LEBAR}
            y1={skala.y(t)}
            y2={skala.y(t)}
            stroke={t === 0 ? "#94a3b8" : "#e2e8f0"}
            strokeWidth={t === 0 ? 1 : 0.75}
          />
          <text x={PAD.kiri - 5} y={skala.y(t) + 3} textAnchor="end" fontSize="8" fill="#64748b">
            {formatNilai(t)}
          </text>
        </g>
      ))}

      {data.map((d, i) => {
        const { tengah, lebar } = slotBatang(i, data.length);
        const yNilai = skala.y(d.nilai);
        const atas = Math.min(yNilai, skala.yNol);
        // Minimal 1,5 supaya batang bernilai 0 tetap terlihat sebagai "tercatat, nilainya nol".
        const tinggi = Math.max(Math.abs(skala.yNol - yNilai), 1.5);
        return (
          <g key={`${d.label}-${i}`}>
            <rect
              x={tengah - lebar / 2}
              y={atas}
              width={lebar}
              height={tinggi}
              rx={1.5}
              fill={d.nilai === 0 ? "#cbd5e1" : d.nilai < 0 ? "#059669" : "#2563eb"}
            >
              <title>{d.keterangan}</title>
            </rect>
            {labelTampil(i, data.length) ? (
              <text
                x={tengah}
                y={VB_TINGGI - 9}
                textAnchor="middle"
                fontSize="8"
                fill="#64748b"
              >
                {d.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
