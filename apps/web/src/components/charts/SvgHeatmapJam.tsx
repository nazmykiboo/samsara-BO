import { VB_LEBAR, warnaSeri } from "./skala";

/**
 * Heatmap "jam ramai": 24 kolom (jam 00..23) x 2 baris (di tempat / pesanan antar), intensitas
 * warna mengikuti jumlah porsi terjual.
 *
 * KENAPA GRID WARNA, BUKAN BATANG BERKELOMPOK: di layar HP (lebar viewBox 320) 24 jam x 2 seri =
 * 48 batang berarti tiap batang cuma ~2,5 satuan lebarnya -- jadi garis-garis tipis yang tidak
 * terbaca. Dengan grid, tiap sel dapat ~11 satuan lebar dan 22 satuan tinggi, masih nyaman
 * disentuh dan dilihat. Angka persisnya tetap bisa didapat dari keterangan tiap sel (ditekan/
 * di-hover) dan dari ringkasan jam tersibuk di kartu pemanggil.
 *
 * Geometri memakai VB_LEBAR yang sama dengan grafik lain (./skala) supaya semua grafik di halaman
 * Analitik melebar seragam mengikuti kartu induknya. Tinggi/padding-nya sendiri karena bentuknya
 * grid, bukan grafik bersumbu Y.
 *
 * SEMUA NILAI 0 bukan kondisi error: grid tetap digambar penuh 24 kolom dengan sel abu-abu muda,
 * supaya terbaca "jamnya sudah dipantau, datanya yang belum terkumpul" -- bukan grafik gagal muat.
 */

export interface SelJamHeatmap {
  jam: number;
  offline: number;
  online: number;
}

/** Warna baris: ikut palet seri grafik lain supaya konsisten antar kartu Analitik. */
export const WARNA_OFFLINE = warnaSeri(0);
export const WARNA_ONLINE = warnaSeri(1);

/** Jam operasional outlet (06.00-21.00) -- cuma untuk menyorot label, BUKAN untuk membuang data.
 * Jam di luar rentang ini tetap digambar penuh; transaksi di luar jam operasional (mis. pesanan
 * antar yang jam platform-nya meleset) harus tetap kelihatan. */
const JAM_BUKA = 6;
const JAM_TUTUP = 21;

const JAM_PER_HARI = 24;
/** Cukup lebar untuk label baris terpanjang ("Di tempat", 9 karakter pada font-size 7 ≈ 32 satuan
 * viewBox) supaya teksnya tidak terpotong di tepi kiri layar HP. */
const PAD_KIRI = 44;
const PAD_KANAN = 4;
const PAD_ATAS = 3;
const GRID_LEBAR = VB_LEBAR - PAD_KIRI - PAD_KANAN;
const KOLOM_LEBAR = GRID_LEBAR / JAM_PER_HARI;
const SEL_TINGGI = 21;
const SEL_JARAK = 2;
const Y_BARIS = [PAD_ATAS, PAD_ATAS + SEL_TINGGI + SEL_JARAK] as const;
const GRID_BAWAH = Y_BARIS[1] + SEL_TINGGI;
const Y_LABEL_JAM = GRID_BAWAH + 9;
const VB_TINGGI = Y_LABEL_JAM + 3;

/** Opasitas minimum untuk sel yang nilainya > 0, supaya jam dengan 1-2 porsi tidak terlihat sama
 * dengan jam yang benar-benar kosong. */
const OPASITAS_MIN = 0.22;

function labelJam(jam: number): string {
  return String(jam).padStart(2, "0");
}

/** "12.00-12.59" -- rentang satu jam penuh, supaya tidak terbaca sebagai titik waktu persis. */
function rentangJam(jam: number): string {
  return `${labelJam(jam)}.00-${labelJam(jam)}.59`;
}

/** Lengkapi jadi 24 entri berurutan. Backend sudah menjamin 24 entri; normalisasi ini jaring
 * pengaman supaya grid tidak pernah bolong/bergeser kalau urutannya berbeda. */
function normalisasi(data: SelJamHeatmap[]): SelJamHeatmap[] {
  return Array.from({ length: JAM_PER_HARI }, (_, jam) => {
    const cocok = data.find((d) => d.jam === jam);
    return { jam, offline: cocok?.offline ?? 0, online: cocok?.online ?? 0 };
  });
}

export function SvgHeatmapJam({
  data,
  labelAria,
  formatNilai = (n) => String(n),
}: {
  data: SelJamHeatmap[];
  /** Ringkasan isi grafik untuk pembaca layar. */
  labelAria: string;
  /** Pemformat jumlah porsi (pakai formatAngka dari utils/format) -- komponen grafik sengaja tidak
   * mengimpor util format sendiri, pola sama dengan SvgBarChart/SvgLineChart. */
  formatNilai?: (nilai: number) => string;
}) {
  const jam = normalisasi(data);
  const maks = Math.max(0, ...jam.flatMap((d) => [d.offline, d.online]));

  /** `pendek` = label di samping grid (ruangnya sempit di layar HP); `nama` = nama penuh untuk
   * legenda dan keterangan tiap sel. */
  const baris = [
    { nama: "Di tempat", pendek: "Di tempat", warna: WARNA_OFFLINE, nilai: jam.map((d) => d.offline) },
    { nama: "Pesanan antar", pendek: "Antar", warna: WARNA_ONLINE, nilai: jam.map((d) => d.online) },
  ];

  return (
    <div>
      <svg viewBox={`0 0 ${VB_LEBAR} ${VB_TINGGI}`} className="h-auto w-full" role="img" aria-label={labelAria}>
        {baris.map((b, idxBaris) => (
          <g key={b.nama}>
            <text x={PAD_KIRI - 4} y={Y_BARIS[idxBaris] + SEL_TINGGI / 2 + 2.5} textAnchor="end" fontSize="7" fill="#475569">
              {b.pendek}
            </text>
            {b.nilai.map((nilai, idxJam) => {
              const x = PAD_KIRI + idxJam * KOLOM_LEBAR;
              const kosong = nilai === 0;
              return (
                <rect
                  key={idxJam}
                  x={x + 0.4}
                  y={Y_BARIS[idxBaris]}
                  width={KOLOM_LEBAR - 0.8}
                  height={SEL_TINGGI}
                  rx={1.5}
                  fill={kosong ? "#f1f5f9" : b.warna}
                  fillOpacity={kosong ? 1 : OPASITAS_MIN + (1 - OPASITAS_MIN) * (maks > 0 ? nilai / maks : 0)}
                  stroke={kosong ? "#e2e8f0" : "none"}
                  strokeWidth={0.5}
                >
                  {/* Satu string utuh, bukan beberapa anak: React menolak <title> dengan anak majemuk. */}
                  <title>{`${b.nama}, jam ${rentangJam(idxJam)}: ${formatNilai(nilai)} porsi${kosong ? " (tidak ada penjualan tercatat)" : ""}`}</title>
                </rect>
              );
            })}
          </g>
        ))}

        {/* Penanda jam operasional 06.00-21.00: cuma sorotan, data di luar rentang ini tetap digambar. */}
        <rect
          x={PAD_KIRI + JAM_BUKA * KOLOM_LEBAR}
          y={GRID_BAWAH + 2}
          width={(JAM_TUTUP - JAM_BUKA + 1) * KOLOM_LEBAR}
          height={1.2}
          rx={0.6}
          fill="#94a3b8"
        />

        {jam.map((d) => (
          <text
            key={d.jam}
            x={PAD_KIRI + d.jam * KOLOM_LEBAR + KOLOM_LEBAR / 2}
            y={Y_LABEL_JAM}
            textAnchor="middle"
            // 7 masih muat di kolom selebar ~11 satuan (2 angka ≈ 8 satuan) dan lebih enak dibaca
            // di layar HP daripada 6. Jam di luar jam operasional dibuat pudar, bukan dihapus.
            fontSize="7"
            fill={d.jam >= JAM_BUKA && d.jam <= JAM_TUTUP ? "#334155" : "#cbd5e1"}
          >
            {labelJam(d.jam)}
          </text>
        ))}
      </svg>

      <div className="mt-2 space-y-1.5">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {baris.map((b) => (
            <span key={b.nama} className="flex items-center gap-1.5 text-xs text-slate-600">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.warna }} />
              {b.nama}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span>Sedikit</span>
          <span aria-hidden className="flex gap-0.5">
            {[0.25, 0.5, 0.75, 1].map((tingkat) => (
              <span
                key={tingkat}
                className="inline-block h-2.5 w-3.5 rounded-sm"
                style={{ backgroundColor: "#475569", opacity: tingkat }}
              />
            ))}
          </span>
          {/* "kotak terpadat", bukan "jam terpadat": ini nilai satu KOTAK (satu jam, satu baris),
              bukan jumlah di tempat + pesanan antar pada jam yang sama. */}
          <span>Banyak{maks > 0 ? ` (kotak terpadat ${formatNilai(maks)} porsi)` : ""}</span>
        </div>
        <p className="text-xs text-slate-400">
          Angka di bawah grafik adalah jam (00&ndash;23). Garis abu-abu menandai jam operasional outlet 06.00&ndash;21.00;
          jam di luar itu tetap ditampilkan kalau ada penjualan tercatat. Tekan atau tunjuk satu kotak untuk melihat
          jumlah porsinya.
        </p>
      </div>
    </div>
  );
}
