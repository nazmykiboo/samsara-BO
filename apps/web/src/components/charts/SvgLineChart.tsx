import {
  PAD,
  PLOT_LEBAR,
  VB_LEBAR,
  VB_TINGGI,
  buatSkalaY,
  labelTampil,
  warnaSeri,
  xTitik,
} from "./skala";

export interface SeriGaris {
  nama: string;
  /** Satu nilai per label di sumbu X, urutan HARUS sama panjang dengan `labels`.
   * `null` = seri ini tidak punya data di titik itu -> garis diputus, bukan dianggap nol. */
  nilai: Array<number | null>;
}

/**
 * Grafik garis sederhana, bisa beberapa seri (mis. satu garis per lokasi) di atas SATU sumbu X
 * kategori yang sama.
 *
 * Kenapa sumbu X berupa kategori bersama (bukan per-seri): seri yang dibandingkan bisa punya
 * jumlah titik berbeda (jumlah siklus opname tiap lokasi tidak sama). Kalau tiap seri dibentang
 * sendiri sepanjang grafik, dua titik yang sejajar di layar bisa berasal dari tanggal yang
 * berbeda -- menyesatkan. Jadi pemanggil menyiapkan daftar label gabungan (urut kronologis) dan
 * menaruh `null` di titik yang seri itu tidak punya.
 *
 * Nilai negatif didukung: garis nol digambar tegas supaya "di bawah nol" langsung terbaca.
 */
export function SvgLineChart({
  labels,
  seri,
  formatNilai,
  labelAria,
  formatTitik,
}: {
  labels: string[];
  seri: SeriGaris[];
  /** Pemformat label sumbu Y -- pakai formatRupiahSingkat / formatAngka dari utils/format. */
  formatNilai: (nilai: number) => string;
  labelAria: string;
  /** Keterangan tooltip tiap titik. Default: "<nama seri> - <label>: <nilai>". */
  formatTitik?: (namaSeri: string, label: string, nilai: number) => string;
}) {
  const semuaNilai = seri.flatMap((s) => s.nilai.filter((n): n is number => n !== null));

  if (labels.length === 0 || semuaNilai.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">Belum ada data untuk periode ini.</p>;
  }

  const skala = buatSkalaY(semuaNilai, { ratakanKeTengah: true });
  const keterangan =
    formatTitik ?? ((nama: string, label: string, nilai: number) => `${nama} - ${label}: ${formatNilai(nilai)}`);

  return (
    <div>
      <svg
        viewBox={`0 0 ${VB_LEBAR} ${VB_TINGGI}`}
        className="h-auto w-full"
        role="img"
        aria-label={labelAria}
      >
        {/* Garis bantu + label sumbu Y (garis nol dibuat lebih tegas) */}
        {skala.ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.kiri}
              x2={PAD.kiri + PLOT_LEBAR}
              y1={skala.y(t)}
              y2={skala.y(t)}
              stroke={t === 0 ? "#64748b" : "#e2e8f0"}
              strokeWidth={t === 0 ? 1 : 0.75}
              strokeDasharray={t === 0 ? "3 2" : undefined}
            />
            <text x={PAD.kiri - 5} y={skala.y(t) + 3} textAnchor="end" fontSize="8" fill="#64748b">
              {formatNilai(t)}
            </text>
          </g>
        ))}

        {/* Label sumbu X */}
        {labels.map((label, i) =>
          labelTampil(i, labels.length, 6) ? (
            <text
              key={`${label}-${i}`}
              x={xTitik(i, labels.length)}
              y={VB_TINGGI - 9}
              textAnchor="middle"
              fontSize="8"
              fill="#64748b"
            >
              {label}
            </text>
          ) : null,
        )}

        {seri.map((s, idxSeri) => {
          const warna = warnaSeri(idxSeri);
          // Jalur digambar per-segmen: titik null memutus garis (M lagi), tidak dijembatani.
          let jalur = "";
          let sambung = false;
          s.nilai.forEach((n, i) => {
            if (n === null) {
              sambung = false;
              return;
            }
            const x = xTitik(i, labels.length);
            const y = skala.y(n);
            jalur += `${sambung ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
            sambung = true;
          });

          return (
            <g key={s.nama}>
              <path d={jalur.trim()} fill="none" stroke={warna} strokeWidth={1.75} strokeLinejoin="round" />
              {s.nilai.map((n, i) =>
                n === null ? null : (
                  <circle key={i} cx={xTitik(i, labels.length)} cy={skala.y(n)} r={2.4} fill={warna}>
                    <title>{keterangan(s.nama, labels[i], n)}</title>
                  </circle>
                ),
              )}
            </g>
          );
        })}
      </svg>

      {seri.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {seri.map((s, idx) => (
            <span key={s.nama} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: warnaSeri(idx) }}
              />
              {s.nama}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
