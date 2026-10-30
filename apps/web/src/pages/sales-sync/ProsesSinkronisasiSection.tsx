import { useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { prosesSinkronisasi } from "../../api/sales-sync";
import type { HasilProsesSinkronisasi, OrderSinkronisasi } from "../../api/types";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { ErrorBox } from "../../components/ResultBox";

/** Daftar order yang bisa dilipat -- isinya bisa panjang, jangan sampai mendorong halaman turun.
 *
 * `nada` menandai apakah isinya perlu ditindaklanjuti atau tidak:
 * - `slate` = sekadar INFORMASI, tidak ada yang perlu dikerjakan (mis. order sebelum tanggal mulai
 *   yang memang disengaja user). Sengaja kelabu supaya tidak terbaca sebagai masalah.
 * - `amber` = perlu tindakan lanjutan.
 * - `red` = gagal/ditolak sistem.
 */
function DaftarOrder({
  judul,
  catatan,
  nada,
  orders,
  aksi,
}: {
  judul: string;
  catatan: string;
  nada: "slate" | "amber" | "red";
  orders: Array<OrderSinkronisasi & { pesan?: string }>;
  aksi?: ReactNode;
}) {
  const [terbuka, setTerbuka] = useState(false);
  const kelas =
    nada === "slate"
      ? "border-slate-200 bg-slate-50 text-slate-600"
      : nada === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-red-200 bg-red-50 text-red-700";

  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${kelas}`}>
      <button
        type="button"
        onClick={() => setTerbuka((v) => !v)}
        aria-expanded={terbuka}
        className="flex w-full items-center justify-between gap-2 text-left font-medium"
      >
        <span>{judul}</span>
        <span aria-hidden>{terbuka ? "▲" : "▼"}</span>
      </button>
      <p className="mt-0.5 text-xs">{catatan}</p>
      {aksi ? <div className="mt-2">{aksi}</div> : null}
      {terbuka ? (
        <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto border-t border-black/10 pt-2 text-xs">
          {orders.map((o, idx) => (
            <li key={`${o.platform}-${o.orderId}-${idx}`}>
              <span className="font-medium">
                {o.platform} · {o.orderId}
              </span>
              <span> · {o.tanggal}</span>
              {o.pesan ? <span className="block break-words">{o.pesan}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ProsesSinkronisasiSection({
  onKeDaftarPemetaan,
  onSelesai,
}: {
  /** Gulir layar ke bagian "Item belum dipetakan" di halaman yang sama. */
  onKeDaftarPemetaan: () => void;
  /** Dipanggil setelah proses selesai -- daftar item belum dipetakan dimuat ulang oleh halaman. */
  onSelesai: () => void;
}) {
  const [berjalan, setBerjalan] = useState(false);
  const [hasil, setHasil] = useState<HasilProsesSinkronisasi | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sengaja TIDAK diisi tanggal default (mis. hari ini): pilihan tanggal di sini menentukan
  // penjualan mana yang memotong stok dan efeknya tidak bisa dibatalkan, jadi harus keputusan sadar
  // user -- bukan nilai bawaan yang ikut terkirim karena user tidak memperhatikan.
  const [tanggalMulai, setTanggalMulai] = useState("");

  async function handleProses() {
    // Tombolnya sudah dimatikan saat tanggal kosong; ini jaring pengaman kedua, pola sama seperti
    // cek `if (!file)` di UploadCsvCard.
    if (!tanggalMulai) {
      setError("Isi tanggal mulai dulu sebelum menjalankan proses.");
      return;
    }
    setError(null);
    setHasil(null);
    setBerjalan(true);
    try {
      const res = await prosesSinkronisasi(tanggalMulai);
      setHasil(res);
      onSelesai();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Proses gagal dijalankan. Coba lagi.");
    } finally {
      setBerjalan(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">3. Proses jadi transaksi penjualan</h2>
        <p className="text-sm text-slate-500">
          Mengubah data penjualan yang sudah diupload menjadi transaksi penjualan dan mengurangi stok.
          Data yang sudah pernah diproses tidak akan dihitung dua kali, jadi aman dijalankan berulang.
        </p>
      </div>

      <Card>
        <Field label="Mulai potong stok dari tanggal">
          <Input
            type="date"
            value={tanggalMulai}
            disabled={berjalan}
            required
            onChange={(e) => {
              setTanggalMulai(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <p className="mt-1.5 text-sm text-slate-500">
          Wajib diisi. Penjualan <strong>sebelum</strong> tanggal ini tetap tersimpan untuk riwayat dan
          laporan, tapi <strong>tidak</strong> akan mengurangi stok. Hanya penjualan dari tanggal ini dan
          sesudahnya yang benar-benar memotong stok.
        </p>
        <p className="mt-1.5 text-sm text-slate-500">
          Pilih tanggal saat stok di sistem ini mulai dihitung dari hitungan nyata di outlet — biasanya
          tanggal opname terakhir. Tanggal yang lebih awal dari itu akan memotong stok untuk penjualan yang
          barangnya sudah lama habis.
        </p>
        <p className="mt-1.5 text-sm text-slate-500">
          Penjualan dari tanggal ini dan sesudahnya yang <strong>sudah</strong> dipotong ke stok tidak bisa
          dibatalkan lagi lewat halaman ini. Kalau ragu dengan tanggalnya, tanyakan Owner dulu sebelum
          menekan tombol di bawah.
        </p>
      </Card>

      <Button
        type="button"
        onClick={handleProses}
        disabled={berjalan || !tanggalMulai}
        className="w-full py-3.5 text-base"
      >
        {berjalan ? "Memproses, mohon tunggu..." : "Proses Sinkronisasi"}
      </Button>
      {!tanggalMulai && !berjalan ? (
        <p className="text-sm text-slate-500">Isi dulu tanggal di atas supaya tombol ini bisa ditekan.</p>
      ) : null}
      {berjalan ? (
        <p className="text-sm text-slate-500">
          Jangan tutup halaman ini. Kalau ordernya banyak, prosesnya bisa sampai beberapa menit.
        </p>
      ) : null}

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {hasil ? (
        <div className="space-y-2">
          <Card className="border-emerald-200 bg-emerald-50">
            <p className="text-sm font-semibold text-emerald-900">Proses selesai.</p>
            <p className="mt-0.5 text-sm text-emerald-800">
              {hasil.transaksiDibuat} transaksi terbentuk dari {hasil.barisDiproses} baris penjualan.
            </p>
            {hasil.transaksiDibuat === 0 &&
            hasil.dilewatiSebelumTanggalMulai.length === 0 &&
            hasil.dilewatiBelumTerpetakan.length === 0 &&
            hasil.perluDitinjau.length === 0 &&
            hasil.channelTidakDikenal.length === 0 &&
            hasil.gagal.length === 0 ? (
              <p className="mt-1 text-sm text-emerald-800">
                Tidak ada data baru yang perlu diproses — semuanya sudah pernah diproses sebelumnya.
              </p>
            ) : null}
          </Card>

          {/* Kelabu & ditaruh paling atas: ini SEKADAR INFORMASI, bukan masalah dan bukan antrian
              pekerjaan -- order ini dilewati persis sesuai tanggal yang user pilih sendiri. */}
          {hasil.dilewatiSebelumTanggalMulai.length > 0 ? (
            <DaftarOrder
              nada="slate"
              judul={`${hasil.dilewatiSebelumTanggalMulai.length} order sebelum tanggal mulai tidak dipotong dari stok`}
              catatan="Sesuai tanggal yang Anda pilih. Datanya tetap tersimpan sebagai riwayat untuk laporan penjualan — tidak ada yang perlu dikerjakan."
              orders={hasil.dilewatiSebelumTanggalMulai}
            />
          ) : null}

          {hasil.dilewatiBelumTerpetakan.length > 0 ? (
            <DaftarOrder
              nada="amber"
              judul={`${hasil.dilewatiBelumTerpetakan.length} order dilewati karena item belum terpetakan`}
              catatan="Order ini belum dihitung. Pasangkan dulu item-nya ke menu Samsara, lalu jalankan Proses Sinkronisasi lagi."
              orders={hasil.dilewatiBelumTerpetakan}
              aksi={
                <Button type="button" variant="secondary" onClick={onKeDaftarPemetaan}>
                  Buka daftar item belum dipetakan
                </Button>
              }
            />
          ) : null}

          {hasil.perluDitinjau.length > 0 ? (
            <DaftarOrder
              nada="amber"
              judul={`${hasil.perluDitinjau.length} order perlu ditinjau manual (ada retur/refund)`}
              catatan="Order ini TIDAK dipotong dari stok sama sekali, dan tidak akan otomatis terpotong di proses berikutnya -- sistem belum bisa menghitung retur/refund secara otomatis. Periksa manual dan sesuaikan stoknya lewat halaman Stok kalau memang perlu."
              orders={hasil.perluDitinjau}
            />
          ) : null}

          {hasil.channelTidakDikenal.length > 0 ? (
            <DaftarOrder
              nada="amber"
              judul={`${hasil.channelTidakDikenal.length} order dilewati karena aplikasi penjualannya belum terdaftar`}
              catatan={`Masalahnya BUKAN pemetaan menu: nama aplikasi di file (${[
                ...new Set(hasil.channelTidakDikenal.map((o) => o.platform)),
              ].join(", ")}) belum terdaftar sebagai sumber penjualan di sistem. Laporkan ke Owner untuk didaftarkan dulu — tidak bisa dibereskan dari halaman ini.`}
              orders={hasil.channelTidakDikenal}
            />
          ) : null}

          {hasil.gagal.length > 0 ? (
            <DaftarOrder
              nada="red"
              judul={`${hasil.gagal.length} order gagal diproses`}
              catatan="Order ini ditolak sistem stok. Perbaiki penyebabnya (lihat pesan di tiap order), lalu jalankan Proses Sinkronisasi lagi."
              orders={hasil.gagal}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
