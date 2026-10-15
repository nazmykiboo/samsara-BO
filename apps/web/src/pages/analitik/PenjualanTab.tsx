import { useEffect, useState } from "react";
import { getAnalitikPenjualan } from "../../api/analitik";
import { ApiError } from "../../api/client";
import type { AnalitikHeatmapJam, AnalitikPenjualan, AnalitikProduk } from "../../api/types";
import { ErrorBox } from "../../components/ResultBox";
import { SvgHeatmapJam } from "../../components/charts/SvgHeatmapJam";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { formatAngka, formatPersen, formatTanggalSingkat } from "../../utils/format";
import { InsightCard } from "./InsightCard";

/** Tab "Penjualan": perbandingan jumlah porsi terjual minggu ini vs minggu lalu, per menu.
 * Yang dibandingkan PORSI, bukan rupiah -- baris penjualan tidak menyimpan nilai uang, jadi
 * jangan menampilkan apa pun sebagai pendapatan di sini. */
export function PenjualanTab({ periode, lokasiId }: { periode: string; lokasiId: number | null }) {
  const [data, setData] = useState<AnalitikPenjualan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getAnalitikPenjualan({ periode: periode || undefined, lokasi: lokasiId })
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof ApiError ? err.message : "Gagal memuat analitik penjualan. Coba muat ulang halaman.",
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

  if (loading) return <Spinner label="Memuat analitik penjualan..." />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <RingkasanCard data={data} />
      <ProdukCard
        judul="10 Menu Terlaris"
        penjelasan="Diurutkan dari porsi terbanyak minggu ini."
        produk={data.topProduk}
        pesanKosong="Belum ada penjualan tercatat pada minggu ini."
      />
      <ProdukCard
        judul="10 Menu Paling Sepi"
        penjelasan="Menu dengan porsi paling sedikit. Menu yang tidak terjual sama sekali di dua minggu terakhir tidak masuk daftar ini."
        produk={data.bottomProduk}
        pesanKosong="Belum ada penjualan tercatat pada dua minggu terakhir."
      />
      <JamRamaiCard heatmap={data.heatmapJam} />
      <InsightCard insight={data.insight} pesanKosong="Tidak ada perubahan signifikan minggu ini." />
    </div>
  );
}

/**
 * Kartu "Jam Ramai" -- sebaran porsi terjual per jam minggu ini, dipisah penjualan di tempat vs
 * pesanan antar. Ditaruh SETELAH daftar menu dan SEBELUM kartu insight: urutannya dari angka
 * ringkas -> rincian menu -> pola jam, baru ditutup kartu "Hal yang Perlu Diperhatikan" (pola
 * sama dengan tab Operasional yang selalu menutup dengan InsightCard).
 *
 * Catatan penting soal cakupan data: transaksi yang jamnya TIDAK tercatat sengaja tidak masuk
 * grafik ini (jam tidak boleh dikira-kira dari waktu input kasir), jadi jumlah porsi di grafik
 * bisa lebih kecil dari total porsi di kartu paling atas. Itu dijelaskan terbuka di kotak info,
 * dengan nada NETRAL -- fitur jam baru mulai mengumpulkan data, ini bukan kegagalan.
 */
function JamRamaiCard({ heatmap }: { heatmap: AnalitikHeatmapJam }) {
  const { totalTransaksiMingguIni: total, transaksiDenganJam: denganJam } = heatmap;
  // Cakupan dianggap "masih sedikit" kalau belum separuh transaksi yang jamnya tercatat -- di
  // kondisi itu polanya belum mewakili penjualan sesungguhnya, jadi perlu diberi konteks.
  const cakupanSedikit = denganJam === 0 || denganJam * 2 < total;

  const totalPorsi = heatmap.data.reduce((jumlah, d) => jumlah + d.offline + d.online, 0);
  const terpadat = heatmap.data.reduce(
    (puncak, d) => (d.offline + d.online > puncak.offline + puncak.online ? d : puncak),
    { jam: 0, offline: 0, online: 0 },
  );
  const adaIsi = totalPorsi > 0;

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Jam Ramai Minggu Ini</h2>
      <p className="mb-3 text-xs text-slate-500">
        Sebaran porsi terjual menurut jam transaksi, dipisah penjualan di tempat dan pesanan antar (GrabFood, GoFood,
        ShopeeFood dihitung bersama sebagai pesanan antar). Dipakai untuk mengatur jumlah staf dan siapan bahan per
        jam.
      </p>

      {cakupanSedikit ? (
        <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800" role="status">
          {total === 0
            ? "Belum ada transaksi penjualan tercatat minggu ini, jadi grafik di bawah masih kosong. Begitu penjualan mulai dicatat, pola jam ramainya langsung muncul di sini."
            : denganJam === 0
              ? `Minggu ini ada ${formatAngka(total)} transaksi, tapi jamnya belum ada yang terisi — grafik di bawah karena itu masih kosong. Jam transaksi mulai terkumpul dari pencatatan penjualan yang mengisi kolom jam.`
              : `Baru ${formatAngka(denganJam)} dari ${formatAngka(total)} transaksi minggu ini yang tercatat jamnya, jadi grafik di bawah belum mewakili semua penjualan. Pola jam ramai akan makin akurat seiring data terkumpul.`}
        </p>
      ) : denganJam < total ? (
        <p className="mb-3 text-xs text-slate-500">
          {formatAngka(denganJam)} dari {formatAngka(total)} transaksi minggu ini tercatat jamnya &mdash; sisanya tidak
          ikut ke grafik ini karena jamnya tidak diisi.
        </p>
      ) : null}

      <SvgHeatmapJam
        data={heatmap.data}
        formatNilai={formatAngka}
        labelAria={
          adaIsi
            ? `Grafik jam ramai minggu ini: porsi terjual per jam, baris atas penjualan di tempat, baris bawah pesanan antar. Jam paling padat ${String(terpadat.jam).padStart(2, "0")}.00 dengan ${terpadat.offline + terpadat.online} porsi.`
            : "Grafik jam ramai minggu ini: semua jam masih bernilai nol porsi karena jam transaksi belum terkumpul."
        }
      />

      {adaIsi ? (
        <p className="mt-2 text-xs text-slate-600">
          Jam paling padat: <span className="font-medium">{String(terpadat.jam).padStart(2, "0")}.00</span> &mdash;{" "}
          {formatAngka(terpadat.offline + terpadat.online)} porsi ({formatAngka(terpadat.offline)} di tempat,{" "}
          {formatAngka(terpadat.online)} pesanan antar). Total {formatAngka(totalPorsi)} porsi masuk ke grafik ini.
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          Semua jam masih bernilai nol porsi. Grafiknya tetap ditampilkan supaya terlihat bahwa jamnya sudah dipantau
          &mdash; yang belum ada hanya datanya.
        </p>
      )}
    </Card>
  );
}

function RingkasanCard({ data }: { data: AnalitikPenjualan }) {
  // Perubahan total dihitung di sini karena backend cuma mengirim perubahan PER MENU. Minggu lalu
  // nol -> sengaja null (tidak dipaksa jadi 0% atau Infinity%), sama perlakuannya dengan
  // persenPerubahan per menu.
  const persenTotal =
    data.totalQtyMingguLalu > 0
      ? ((data.totalQtyMingguIni - data.totalQtyMingguLalu) / data.totalQtyMingguLalu) * 100
      : null;

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Total Porsi Terjual</h2>
      <p className="mb-3 text-xs text-slate-500">
        Minggu ini {formatTanggalSingkat(data.mingguIni.mulai)} &ndash; {formatTanggalSingkat(data.mingguIni.selesai)},
        dibandingkan minggu lalu {formatTanggalSingkat(data.mingguLalu.mulai)} &ndash;{" "}
        {formatTanggalSingkat(data.mingguLalu.selesai)}.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 px-3 py-2">
          <p className="text-xs text-slate-500">Minggu ini</p>
          <p className="text-xl font-semibold text-slate-900">{formatAngka(data.totalQtyMingguIni)}</p>
          <p className="text-xs text-slate-500">porsi</p>
        </div>
        <div className="rounded-lg border border-slate-200 px-3 py-2">
          <p className="text-xs text-slate-500">Minggu lalu</p>
          <p className="text-xl font-semibold text-slate-600">{formatAngka(data.totalQtyMingguLalu)}</p>
          <p className="text-xs text-slate-500">porsi</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <PerubahanBadge persen={persenTotal} />
        <span className="text-xs text-slate-500">
          {persenTotal === null
            ? "Minggu lalu belum ada penjualan tercatat, jadi belum ada pembandingnya."
            : "dibanding minggu lalu"}
        </span>
      </div>
    </Card>
  );
}

function ProdukCard({
  judul,
  penjelasan,
  produk,
  pesanKosong,
}: {
  judul: string;
  penjelasan: string;
  produk: AnalitikProduk[];
  pesanKosong: string;
}) {
  const adaMenuBaru = produk.some((p) => p.persenPerubahan === null);

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">{judul}</h2>
      <p className="mb-3 text-xs text-slate-500">{penjelasan}</p>
      {produk.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">{pesanKosong}</p>
      ) : (
        <div className="space-y-1.5">
          {produk.map((p, idx) => (
            <div key={p.kodeMenu} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-900">
                  <span className="mr-1.5 text-slate-400">{idx + 1}.</span>
                  {p.namaMenu}
                </p>
                <PerubahanBadge persen={p.persenPerubahan} />
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Minggu ini {formatAngka(p.qtyMingguIni)} porsi &middot; minggu lalu {formatAngka(p.qtyMingguLalu)} porsi
              </p>
            </div>
          ))}
        </div>
      )}
      {adaMenuBaru ? (
        <p className="mt-3 text-xs text-slate-400">
          Tanda "Baru" berarti menu itu belum terjual sama sekali minggu lalu, jadi persen perubahannya belum bisa
          dihitung &mdash; bukan berarti datanya salah.
        </p>
      ) : null}
    </Card>
  );
}

/** Badge perubahan antar minggu. `null` = tidak bisa dihitung (pembanding nol) -> "Baru" dengan
 * warna NETRAL, karena itu kondisi normal dan bukan penilaian bagus/buruk. */
function PerubahanBadge({ persen }: { persen: number | null }) {
  if (persen === null) return <Badge tone="info">Baru</Badge>;
  if (persen === 0) return <Badge tone="neutral">Sama</Badge>;
  if (persen > 0) return <Badge tone="success">&#9650; {formatPersen(persen)}</Badge>;
  return <Badge tone="danger">&#9660; {formatPersen(Math.abs(persen))}</Badge>;
}
