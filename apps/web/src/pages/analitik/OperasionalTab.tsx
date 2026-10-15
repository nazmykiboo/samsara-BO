import { useEffect, useMemo, useState } from "react";
import { getAnalitikOperasional } from "../../api/analitik";
import { ApiError } from "../../api/client";
import type { AnalitikOperasional } from "../../api/types";
import { ErrorBox } from "../../components/ResultBox";
import { SvgBarChart, type TitikBatang } from "../../components/charts/SvgBarChart";
import { SvgLineChart, type SeriGaris } from "../../components/charts/SvgLineChart";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import {
  formatAngka,
  formatRupiah,
  formatRupiahSingkat,
  formatTanggalHariBulan,
  formatTanggalSingkat,
} from "../../utils/format";
import { InsightCard } from "./InsightCard";

/** Tab "Operasional": tiga tren 8 minggu terakhir (nilai barang terbuang, selisih opname, susut
 * transfer dari Central Kitchen ke outlet). Semua grafik baca-saja, digambar manual dengan SVG. */
export function OperasionalTab({
  periode,
  lokasiId,
  lokasiNama,
}: {
  periode: string;
  lokasiId: number | null;
  /** Nama lokasi yang sedang difilter -- null kalau "Semua lokasi". Dipakai untuk menjelaskan
   * grafik susut transfer yang memang TIDAK ikut filter lokasi. */
  lokasiNama: string | null;
}) {
  const [data, setData] = useState<AnalitikOperasional | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getAnalitikOperasional({ periode: periode || undefined, lokasi: lokasiId })
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof ApiError ? err.message : "Gagal memuat analitik operasional. Coba muat ulang halaman.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [periode, lokasiId]);

  if (loading) return <Spinner label="Memuat analitik operasional..." />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <WasteCard data={data} />
      <OpnameCard data={data} />
      <SusutTransferCard data={data} lokasiNama={lokasiNama} />
      <CogsCard data={data} />
      <InsightCard
        insight={data.insight}
        pesanKosong="Tidak ada pola yang perlu diperhatikan dari 8 minggu terakhir."
      />
    </div>
  );
}

function WasteCard({ data }: { data: AnalitikOperasional }) {
  const titik: TitikBatang[] = data.wasteTren.map((w) => ({
    label: formatTanggalHariBulan(w.minggu.mulai),
    nilai: w.nilaiTotal,
    keterangan: `Minggu ${formatTanggalSingkat(w.minggu.mulai)} - ${formatTanggalSingkat(w.minggu.selesai)}: ${formatRupiah(w.nilaiTotal)}`,
  }));
  const terakhir = data.wasteTren[data.wasteTren.length - 1];

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Nilai Barang Terbuang (8 minggu)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Nilai semua barang yang dicatat keluar lewat Mutasi Lain (rusak, terbuang, sampel, makan staf). Dihitung dari
        harga master item; item yang harganya belum diisi dihitung Rp 0, jadi angkanya bisa lebih rendah dari
        kenyataan.
      </p>
      <SvgBarChart
        data={titik}
        formatNilai={formatRupiahSingkat}
        labelAria="Grafik batang nilai barang terbuang per minggu selama 8 minggu terakhir"
      />
      {terakhir ? (
        <p className="mt-2 text-xs text-slate-500">
          Minggu terakhir ({formatTanggalSingkat(terakhir.minggu.mulai)} &ndash;{" "}
          {formatTanggalSingkat(terakhir.minggu.selesai)}): {formatRupiah(terakhir.nilaiTotal)}
          {terakhir.nilaiTotal === 0 ? " — tidak ada pencatatan barang keluar minggu itu." : ""}
        </p>
      ) : null}
    </Card>
  );
}

function OpnameCard({ data }: { data: AnalitikOperasional }) {
  /** Sumbu X dibuat dari GABUNGAN tanggal semua lokasi, urut kronologis: tiap lokasi bisa punya
   * jumlah siklus opname yang berbeda, jadi kalau masing-masing dibentang sendiri, titik yang
   * sejajar di layar bisa berasal dari tanggal yang berbeda. Lokasi yang tidak punya siklus di
   * satu tanggal diisi null -> garisnya diputus, BUKAN dianggap selisih nol. Dua siklus di lokasi
   * dan tanggal yang sama (jarang, tapi mungkin) dijumlahkan. */
  const { labels, seri, adaData } = useMemo(() => {
    const tanggalUnik = Array.from(
      new Set(data.opnameSelisihTren.flatMap((l) => l.siklus.map((s) => s.tanggal))),
    ).sort(); // format "YYYY-MM-DD" -> urutan teks = urutan kronologis

    const seriLokasi: SeriGaris[] = data.opnameSelisihTren.map((lokasi) => ({
      nama: lokasi.lokasiNama,
      nilai: tanggalUnik.map((tanggal) => {
        const cocok = lokasi.siklus.filter((s) => s.tanggal === tanggal);
        if (cocok.length === 0) return null;
        return cocok.reduce((total, s) => total + s.selisihTotal, 0);
      }),
    }));

    return {
      labels: tanggalUnik.map(formatTanggalHariBulan),
      seri: seriLokasi,
      adaData: tanggalUnik.length > 0,
    };
  }, [data.opnameSelisihTren]);

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Selisih Stok Opname per Siklus</h2>
      <p className="mb-3 text-xs text-slate-500">
        Selisih = hitungan fisik dikurangi catatan sistem, dijumlah untuk semua item dalam satu siklus opname yang
        sudah disetujui. Angka minus berarti barang fisik lebih sedikit daripada catatan sistem. Satuan tiap item
        berbeda-beda, jadi angka ini untuk melihat ARAH tren, bukan jumlah yang bisa dijumlah ke rupiah.
      </p>
      {adaData ? (
        <SvgLineChart
          labels={labels}
          seri={seri}
          formatNilai={formatAngka}
          labelAria="Grafik garis selisih stok opname per siklus, per lokasi"
          formatTitik={(nama, label, nilai) => `${nama} - opname ${label}: selisih ${formatAngka(nilai)}`}
        />
      ) : (
        <p className="py-4 text-center text-sm text-slate-500">
          Belum ada siklus opname yang disetujui pada rentang ini.
        </p>
      )}
    </Card>
  );
}

function SusutTransferCard({
  data,
  lokasiNama,
}: {
  data: AnalitikOperasional;
  lokasiNama: string | null;
}) {
  const titik: TitikBatang[] = data.transferSusutTren.map((t) => ({
    label: formatTanggalHariBulan(t.minggu.mulai),
    nilai: t.susutTotal,
    keterangan: `Minggu ${formatTanggalSingkat(t.minggu.mulai)} - ${formatTanggalSingkat(t.minggu.selesai)}: selisih ${formatAngka(t.susutTotal)}`,
  }));

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Susut Kiriman Central Kitchen ke Outlet (8 minggu)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Selisih antara jumlah yang dikirim dan jumlah yang diterima, dihitung hanya dari kiriman yang sudah
        dikonfirmasi diterima. Satuan tiap item berbeda-beda, jadi angka ini untuk melihat ARAH tren saja.
      </p>
      {lokasiNama ? (
        <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800" role="status">
          Grafik ini selalu gabungan semua outlet, termasuk saat filter lokasi "{lokasiNama}" sedang aktif &mdash; satu
          kiriman menyentuh dua lokasi (pengirim dan penerima), jadi tidak bisa dipisah per outlet.
        </p>
      ) : null}
      <SvgBarChart
        data={titik}
        formatNilai={formatAngka}
        labelAria="Grafik batang susut kiriman Central Kitchen ke outlet per minggu selama 8 minggu terakhir"
      />
    </Card>
  );
}

/** Tren HPP/cost of goods sold penjualan (migrasi 0028), pola sama seperti WasteCard/SusutTransferCard
 * di atas: grafik batang rupiah per minggu, 8 titik. Dilengkapi catatan transparansi soal data
 * historis yang sebagian masih estimasi (lihat `adaDataEstimasi`/`tanggalMulaiDataAsli`) -- ini
 * bukan kegagalan, cuma fakta tentang akurasi data lama. */
function CogsCard({ data }: { data: AnalitikOperasional }) {
  const titik: TitikBatang[] = data.cogsTren.map((c) => ({
    label: formatTanggalHariBulan(c.minggu.mulai),
    nilai: c.totalCogs,
    keterangan: `Minggu ${formatTanggalSingkat(c.minggu.mulai)} - ${formatTanggalSingkat(c.minggu.selesai)}: ${formatRupiah(c.totalCogs)} dari ${c.jumlahBaris} baris penjualan${c.jumlahBarisEstimasi > 0 ? ` (${c.jumlahBarisEstimasi} di antaranya estimasi)` : ""}`,
  }));
  const terakhir = data.cogsTren[data.cogsTren.length - 1];

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">HPP Penjualan / Cost of Goods Sold (8 minggu)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Total HPP (modal bahan) dari semua menu yang terjual, dijumlah per minggu. Baris yang HPP-nya belum bisa
        dihitung saat itu (resep bergantung ke item yang datanya belum lengkap) dihitung Rp 0, bukan dibuang --
        jadi angkanya bisa lebih rendah dari kenyataan.
      </p>
      {data.adaDataEstimasi ? (
        <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800" role="status">
          {data.tanggalMulaiDataAsli
            ? `Sebagian data sebelum ${formatTanggalSingkat(data.tanggalMulaiDataAsli)} adalah estimasi dari harga saat ini, bukan harga historis asli.`
            : "Seluruh data saat ini adalah estimasi dari harga sekarang, belum ada transaksi dengan HPP historis asli tercatat."}
        </p>
      ) : null}
      <SvgBarChart
        data={titik}
        formatNilai={formatRupiahSingkat}
        labelAria="Grafik batang total HPP penjualan per minggu selama 8 minggu terakhir"
      />
      {terakhir ? (
        <p className="mt-2 text-xs text-slate-500">
          Minggu terakhir ({formatTanggalSingkat(terakhir.minggu.mulai)} &ndash;{" "}
          {formatTanggalSingkat(terakhir.minggu.selesai)}): {formatRupiah(terakhir.totalCogs)} dari{" "}
          {terakhir.jumlahBaris} baris penjualan
          {terakhir.jumlahBaris === 0 ? " — tidak ada penjualan tercatat minggu itu." : ""}
        </p>
      ) : null}
    </Card>
  );
}
