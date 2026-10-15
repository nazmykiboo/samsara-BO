import { useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { batchUpsertHargaChannel } from "../../api/hpp";
import type { BarisHargaBatch, PreviewHargaChannel } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ErrorBox, WarningBox } from "../../components/ResultBox";
import { formatRupiah } from "../../utils/format";

/**
 * Pesan backend untuk baris CSV yang kolom harganya kosong atau 0.
 *
 * Backend menandainya `status: "error"` (sengaja: di CSV massal, 0 nyaris selalu salah ketik),
 * tapi untuk owner ini BUKAN kesalahan -- template export memang mengosongkan harga yang belum
 * pernah diisi, jadi baris semacam ini normal muncul di hampir setiap file. Di layar ditampilkan
 * netral sebagai "Belum diisi" (abu-abu, bukan merah). Istilah backend TIDAK diubah; yang
 * diterjemahkan cuma tampilannya.
 */
const PESAN_HARGA_KOSONG = "Kolom harga_jual kosong";

type JenisTampilan = "baru" | "berubah" | "sama" | "belum_diisi" | "bermasalah";

function jenisTampilan(b: PreviewHargaChannel): JenisTampilan {
  if (b.status !== "error") return b.status;
  return b.pesan === PESAN_HARGA_KOSONG ? "belum_diisi" : "bermasalah";
}

const LABEL: Record<JenisTampilan, string> = {
  baru: "Harga baru",
  berubah: "Harga berubah",
  sama: "Tidak berubah",
  belum_diisi: "Belum diisi",
  bermasalah: "Perlu diperbaiki",
};

/** Hanya `baru` dan `berubah` yang dikirim ke server. */
function perluDisimpan(b: PreviewHargaChannel): boolean {
  return b.status === "baru" || b.status === "berubah";
}

/**
 * Layar PREVIEW hasil import CSV harga per channel -- menampilkan apa yang AKAN terjadi, belum
 * ada satu pun harga yang tersimpan saat layar ini muncul (endpoint import-nya read-only).
 *
 * Penyimpanan baru terjadi saat owner menekan "Terapkan Perubahan", dan HANYA untuk baris
 * berstatus `baru`/`berubah`. Baris `sama` (harga di file persis sama dengan yang tersimpan),
 * `belum_diisi`, dan `bermasalah` tidak dikirim sama sekali.
 */
export function PreviewImportHargaSection({
  namaFile,
  baris,
  namaMenu,
  onBatal,
  onSelesai,
}: {
  namaFile: string;
  baris: PreviewHargaChannel[];
  /** Nama menu untuk kode tertentu -- kode yang tidak dikenal dikembalikan apa adanya. */
  namaMenu: (kode: string) => string;
  onBatal: () => void;
  /** Dipanggil setelah perubahan BERHASIL tersimpan, dengan jumlah harga yang tersimpan. */
  onSelesai: (jumlahTersimpan: number) => void;
}) {
  const [menyimpan, setMenyimpan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kelompok = useMemo(() => {
    const awal: Record<JenisTampilan, PreviewHargaChannel[]> = {
      baru: [],
      berubah: [],
      sama: [],
      belum_diisi: [],
      bermasalah: [],
    };
    for (const b of baris) awal[jenisTampilan(b)].push(b);
    return awal;
  }, [baris]);

  const akanDisimpan = useMemo(() => baris.filter(perluDisimpan), [baris]);

  async function handleTerapkan() {
    if (akanDisimpan.length === 0) return;
    setError(null);
    setMenyimpan(true);
    try {
      const payload: BarisHargaBatch[] = akanDisimpan.map((b) => ({
        kodeMenu: b.kodeMenu,
        channel: b.channel,
        hargaJual: b.hargaBaru,
      }));
      const res = await batchUpsertHargaChannel(payload);
      onSelesai(res.disimpan);
    } catch (err) {
      // Batch ini atomik: kalau gagal, TIDAK ADA harga yang tersimpan. Pesan backend sudah
      // menyebut baris ke-berapa yang bermasalah, jadi diteruskan apa adanya.
      setError(
        err instanceof ApiError
          ? err.message
          : "Harga gagal disimpan. Periksa koneksi internet lalu coba lagi.",
      );
    } finally {
      setMenyimpan(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Periksa dulu sebelum disimpan</h2>
        <p className="text-sm text-slate-500">
          Ini isi file <span className="font-medium text-slate-700">{namaFile}</span>. Belum ada harga yang
          berubah — perubahan baru tersimpan setelah Anda menekan “Terapkan Perubahan”.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge tone="success">{kelompok.baru.length} harga baru</Badge>
        <Badge tone="warning">{kelompok.berubah.length} harga berubah</Badge>
        <Badge tone="neutral">{kelompok.sama.length} tidak berubah</Badge>
        <Badge tone="neutral">{kelompok.belum_diisi.length} belum diisi</Badge>
        {kelompok.bermasalah.length > 0 ? (
          <Badge tone="danger">{kelompok.bermasalah.length} perlu diperbaiki</Badge>
        ) : null}
      </div>

      {kelompok.bermasalah.length > 0 ? (
        <WarningBox>
          {kelompok.bermasalah.length} baris tidak bisa disimpan (lihat tanda merah di bawah). Baris lain tetap
          bisa diterapkan sekarang — perbaiki baris merah di file, lalu import ulang filenya.
        </WarningBox>
      ) : null}

      {kelompok.belum_diisi.length > 0 ? (
        <p className="text-sm text-slate-500">
          Baris “belum diisi” adalah kombinasi menu dan channel yang kolom harganya masih kosong di file.
          Ini normal dan dilewati tanpa mengubah apa pun — bukan kegagalan.
        </p>
      ) : null}

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {/* Lebar penuh dengan 5 kolom -- di layar HP digeser ke samping, sengaja tidak dipecah
          jadi kartu per baris supaya satu file 400+ baris masih bisa dibaca cepat. */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Baris</th>
              <th className="px-3 py-2 text-left font-medium">Menu</th>
              <th className="px-3 py-2 text-left font-medium">Channel</th>
              <th className="px-3 py-2 text-right font-medium">Harga sekarang</th>
              <th className="px-3 py-2 text-right font-medium">Harga di file</th>
              <th className="px-3 py-2 text-left font-medium">Keterangan</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((b) => (
              <BarisPreview key={`${b.baris}-${b.kodeMenu}-${b.channel}`} baris={b} namaMenu={namaMenu} />
            ))}
            {baris.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                  File ini tidak berisi baris data (hanya baris header).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        <Button type="button" variant="secondary" className="flex-1" onClick={onBatal} disabled={menyimpan}>
          Batal
        </Button>
        <Button
          type="button"
          className="flex-1"
          onClick={handleTerapkan}
          disabled={menyimpan || akanDisimpan.length === 0}
        >
          {menyimpan ? "Menyimpan..." : `Terapkan ${akanDisimpan.length} perubahan`}
        </Button>
      </div>
      {akanDisimpan.length === 0 ? (
        <p className="text-sm text-slate-500">
          Tidak ada harga yang perlu diubah dari file ini. Tekan “Batal” untuk kembali ke grid.
        </p>
      ) : null}
    </div>
  );
}

const WARNA_BARIS: Record<JenisTampilan, string> = {
  baru: "bg-emerald-50",
  berubah: "bg-amber-50",
  sama: "bg-white",
  belum_diisi: "bg-white",
  bermasalah: "bg-red-50",
};

const WARNA_LABEL: Record<JenisTampilan, string> = {
  baru: "text-emerald-700",
  berubah: "text-amber-700",
  sama: "text-slate-500",
  belum_diisi: "text-slate-500",
  bermasalah: "text-red-700",
};

function BarisPreview({
  baris,
  namaMenu,
}: {
  baris: PreviewHargaChannel;
  namaMenu: (kode: string) => string;
}) {
  const jenis = jenisTampilan(baris);
  // Harga "baru" di baris bermasalah/kosong tidak bermakna (backend mengisinya 0), jadi tidak
  // ditampilkan sebagai angka supaya tidak terbaca sebagai "harga akan jadi Rp0".
  const adaHargaBaru = baris.status !== "error";

  return (
    <tr className={`border-t border-slate-100 ${WARNA_BARIS[jenis]}`}>
      <td className="px-3 py-2 text-slate-500">{baris.baris}</td>
      <td className="px-3 py-2">
        <p className="font-medium text-slate-900">{namaMenu(baris.kodeMenu)}</p>
        <p className="text-xs text-slate-500">{baris.kodeMenu || "(kode kosong)"}</p>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{baris.channel || "-"}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-slate-500">
        {baris.hargaLama === null ? "Belum diisi" : formatRupiah(baris.hargaLama)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-slate-900">
        {adaHargaBaru ? formatRupiah(baris.hargaBaru) : "-"}
      </td>
      <td className="px-3 py-2">
        <p className={`font-medium ${WARNA_LABEL[jenis]}`}>{LABEL[jenis]}</p>
        {jenis === "bermasalah" && baris.pesan ? (
          <p className="text-xs text-red-700">{baris.pesan}</p>
        ) : null}
      </td>
    </tr>
  );
}
