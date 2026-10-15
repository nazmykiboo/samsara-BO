import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import {
  batchUpsertHargaChannel,
  exportHargaChannelCsv,
  getMenuHpp,
  importHargaChannelPreview,
} from "../../api/hpp";
import { getTargetFoodCostPersen } from "../../api/pengaturan";
import type { BarisHargaBatch, MenuListItem, PreviewHargaChannel } from "../../api/types";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox, ResultBox, WarningBox } from "../../components/ResultBox";
import { formatPersen, todayIso } from "../../utils/format";
import { urutkanNamaChannel } from "../../utils/channel";
import { PreviewImportHargaSection } from "./PreviewImportHargaSection";

/**
 * Mode "Edit Harga Massal" halaman Menu & HPP -- grid menu x channel yang bisa diketik langsung,
 * plus jalur spreadsheet (export CSV -> edit di Excel/Google Sheets -> import + preview).
 * Permission `harga_jual.edit` (owner saja); gate-nya ada di pemanggil (MenuHppPage).
 *
 * SUMBER DATA GRID: `GET /menu/harga-channel/export` -- SATU permintaan yang sudah berisi tepat
 * kombinasi menu AKTIF x channel AKTIF beserta harga tersimpannya (kosong kalau belum pernah
 * diisi). Sengaja BUKAN `GET /menu/:kode/hpp` per menu: itu satu permintaan PER MENU (N+1) dan
 * akan bikin layar ini lambat dibuka. Konsekuensinya HPP per porsi TIDAK ikut di data awal, jadi
 * food cost % per sel baru bisa dihitung setelah owner menekan "Hitung food cost %" (lihat
 * `muatHpp` di bawah) -- sebelum itu kolomnya menampilkan "-", bukan angka tebakan.
 */

interface DataGrid {
  /** Nama channel aktif, urut tampil (Offline duluan). */
  channels: string[];
  /** Kode menu aktif, urut sesuai server (urut kode). */
  kodeMenus: string[];
  /** harga[kodeMenu][channel] -- `null` = belum pernah diisi (bukan 0, bukan error). */
  harga: Record<string, Record<string, number | null>>;
}

/** Teks yang sedang diketik per sel: draft[kodeMenu][channel]. String (bukan number) supaya sel
 * yang dikosongkan user tidak berubah jadi 0 diam-diam. */
type DraftGrid = Record<string, Record<string, string>>;

/** Pecah satu baris CSV jadi kolom. Menangani kolom berkutip ganda (`"GoFood, Promo"`) dan kutip
 * yang di-escape (`""`) -- export backend memakai pengutipan standar lewat helper `csvField`. */
function pecahBarisCsv(baris: string): string[] {
  const kolom: string[] = [];
  let nilai = "";
  let dalamKutip = false;
  for (let i = 0; i < baris.length; i += 1) {
    const c = baris[i];
    if (dalamKutip) {
      if (c === '"') {
        if (baris[i + 1] === '"') {
          nilai += '"';
          i += 1;
        } else {
          dalamKutip = false;
        }
      } else {
        nilai += c;
      }
    } else if (c === '"') {
      dalamKutip = true;
    } else if (c === ",") {
      kolom.push(nilai);
      nilai = "";
    } else {
      nilai += c;
    }
  }
  kolom.push(nilai);
  return kolom;
}

/** Ubah teks CSV export jadi struktur grid. Baris yang kolomnya kurang/kode menunya kosong
 * dilewati (tidak bisa jadi sel grid) -- tidak pernah terjadi untuk CSV dari server. */
function bacaGridDariCsv(csv: string): DataGrid {
  const barisTeks = csv.split(/\r?\n/).filter((b) => b.trim() !== "");
  if (barisTeks.length === 0) return { channels: [], kodeMenus: [], harga: {} };

  const header = pecahBarisCsv(barisTeks[0]).map((h) => h.trim().toLowerCase());
  const iKode = header.indexOf("kode_menu");
  const iChannel = header.indexOf("channel");
  const iHarga = header.indexOf("harga_jual");
  if (iKode === -1 || iChannel === -1 || iHarga === -1) {
    throw new Error('Format daftar harga dari server tidak dikenali (kolom "kode_menu", "channel", "harga_jual" tidak lengkap).');
  }

  const kodeMenus: string[] = [];
  const channelSet = new Set<string>();
  const harga: Record<string, Record<string, number | null>> = {};

  for (const teks of barisTeks.slice(1)) {
    const kolom = pecahBarisCsv(teks);
    const kode = (kolom[iKode] ?? "").trim();
    const channel = (kolom[iChannel] ?? "").trim();
    if (!kode || !channel) continue;
    const hargaTeks = (kolom[iHarga] ?? "").trim();
    const angka = hargaTeks === "" ? null : Number(hargaTeks);

    if (!harga[kode]) {
      harga[kode] = {};
      kodeMenus.push(kode);
    }
    harga[kode][channel] = angka === null || !Number.isFinite(angka) ? null : angka;
    channelSet.add(channel);
  }

  return { channels: urutkanNamaChannel([...channelSet]), kodeMenus, harga };
}

function draftDariData(data: DataGrid): DraftGrid {
  const draft: DraftGrid = {};
  for (const kode of data.kodeMenus) {
    const baris: Record<string, string> = {};
    for (const ch of data.channels) {
      const nilai = data.harga[kode]?.[ch] ?? null;
      baris[ch] = nilai === null ? "" : String(nilai);
    }
    draft[kode] = baris;
  }
  return draft;
}

/** Satu sel dianggap DIUBAH kalau angkanya beda dari nilai server. Sel yang dikosongkan user
 * TIDAK dihitung berubah: backend tidak punya cara "hapus harga", jadi mengosongkan sel tidak
 * pernah dikirim (dijelaskan ke user lewat catatan di layar). */
function nilaiBerubah(awal: number | null, teks: string): boolean {
  const bersih = teks.trim();
  if (bersih === "") return false;
  const angka = Number(bersih);
  if (!Number.isFinite(angka)) return true; // ditolak saat validasi, tapi tetap ditandai berubah
  return angka !== awal;
}

const MAKS_PARALEL_HPP = 5;

export function EditHargaMassalSection({
  menuList,
  onTutup,
}: {
  /** Daftar menu dari GET /menu -- dipakai untuk NAMA & status "menunggu data" tiap baris grid
   * (CSV export cuma berisi kode menu). */
  menuList: MenuListItem[];
  onTutup: () => void;
}) {
  const [data, setData] = useState<DataGrid | null>(null);
  const [draft, setDraft] = useState<DraftGrid>({});
  const [memuat, setMemuat] = useState(true);
  const [errorMuat, setErrorMuat] = useState<string | null>(null);

  const [menyimpan, setMenyimpan] = useState(false);
  const [errorSimpan, setErrorSimpan] = useState<string | null>(null);
  const [pesanSukses, setPesanSukses] = useState<string | null>(null);

  const [query, setQuery] = useState("");

  const [mengunduh, setMengunduh] = useState(false);
  const [errorUnduh, setErrorUnduh] = useState<string | null>(null);

  const [mengimpor, setMengimpor] = useState(false);
  const [errorImpor, setErrorImpor] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ namaFile: string; baris: PreviewHargaChannel[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // hppPerMenu[kode] === undefined -> belum pernah dihitung; null -> menunggu data/gagal dibaca.
  const [hppPerMenu, setHppPerMenu] = useState<Record<string, number | null>>({});
  const [memuatHpp, setMemuatHpp] = useState(false);
  const [progresHpp, setProgresHpp] = useState<{ selesai: number; total: number } | null>(null);
  const [targetFoodCost, setTargetFoodCost] = useState<number | null>(null);
  const hidupRef = useRef(true);

  useEffect(() => {
    hidupRef.current = true;
    return () => {
      hidupRef.current = false;
    };
  }, []);

  const muatGrid = useCallback(async () => {
    setMemuat(true);
    setErrorMuat(null);
    try {
      const csv = await exportHargaChannelCsv();
      const hasil = bacaGridDariCsv(csv);
      if (!hidupRef.current) return;
      setData(hasil);
      setDraft(draftDariData(hasil));
    } catch (err) {
      if (!hidupRef.current) return;
      setErrorMuat(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Gagal memuat daftar harga. Periksa koneksi internet lalu coba lagi.",
      );
    } finally {
      if (hidupRef.current) setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muatGrid();
  }, [muatGrid]);

  // Target food cost standar cuma untuk penanda warna di sel -- endpoint-nya owner-only dan
  // mode ini juga owner-only, tapi kegagalannya tetap didiamkan (bukan inti layar ini).
  useEffect(() => {
    getTargetFoodCostPersen()
      .then((res) => {
        if (hidupRef.current) setTargetFoodCost(res.targetFoodCostPersen);
      })
      .catch(() => {
        /* diamkan */
      });
  }, []);

  const infoMenu = useMemo(() => {
    const map = new Map<string, MenuListItem>();
    for (const m of menuList) if (m.kode) map.set(m.kode, m);
    return map;
  }, [menuList]);

  const namaMenu = useCallback(
    (kode: string) => infoMenu.get(kode)?.name ?? kode,
    [infoMenu],
  );

  const barisTampil = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.kodeMenus
      .map((kode) => {
        const m = infoMenu.get(kode);
        return {
          kode,
          nama: m?.name ?? kode,
          kategori: m?.kategori ?? null,
          menungguData: m?.status === "pending_data",
        };
      })
      .filter((b) =>
        !q
          ? true
          : b.nama.toLowerCase().includes(q) ||
            b.kode.toLowerCase().includes(q) ||
            (b.kategori ?? "").toLowerCase().includes(q),
      );
  }, [data, infoMenu, query]);

  const perubahan = useMemo<BarisHargaBatch[]>(() => {
    if (!data) return [];
    const hasil: BarisHargaBatch[] = [];
    for (const kode of data.kodeMenus) {
      for (const ch of data.channels) {
        const teks = draft[kode]?.[ch] ?? "";
        const awal = data.harga[kode]?.[ch] ?? null;
        if (!nilaiBerubah(awal, teks)) continue;
        hasil.push({ kodeMenu: kode, channel: ch, hargaJual: Number(teks.trim()) });
      }
    }
    return hasil;
  }, [data, draft]);

  /** Sel yang isinya dihapus user padahal di server ada harganya -- tidak dikirim ke server. */
  const jumlahDikosongkan = useMemo(() => {
    if (!data) return 0;
    let n = 0;
    for (const kode of data.kodeMenus) {
      for (const ch of data.channels) {
        const teks = (draft[kode]?.[ch] ?? "").trim();
        const awal = data.harga[kode]?.[ch] ?? null;
        if (teks === "" && awal !== null) n += 1;
      }
    }
    return n;
  }, [data, draft]);

  const handleUbahSel = useCallback((kode: string, channel: string, nilai: string) => {
    setPesanSukses(null);
    setErrorSimpan(null);
    setDraft((lama) => ({ ...lama, [kode]: { ...(lama[kode] ?? {}), [channel]: nilai } }));
  }, []);

  async function handleSimpanSemua() {
    if (perubahan.length === 0) {
      setErrorSimpan(null);
      setPesanSukses("Tidak ada harga yang diubah.");
      return;
    }
    const tidakValid = perubahan.find((p) => !Number.isFinite(p.hargaJual) || p.hargaJual < 0);
    if (tidakValid) {
      setPesanSukses(null);
      setErrorSimpan(
        `Harga ${namaMenu(tidakValid.kodeMenu)} di ${tidakValid.channel} harus berupa angka 0 atau lebih (tanpa titik/koma pemisah ribuan).`,
      );
      return;
    }

    setErrorSimpan(null);
    setPesanSukses(null);
    setMenyimpan(true);
    try {
      const res = await batchUpsertHargaChannel(perubahan);
      // Sukses -> ambil ulang keadaan server supaya angka di grid pasti sama dengan yang tersimpan.
      await muatGrid();
      if (hidupRef.current) setPesanSukses(`${res.disimpan} harga tersimpan.`);
    } catch (err) {
      // ATOMIK: tidak ada satu pun harga yang tersimpan. Grid TIDAK dimuat ulang -- angka yang
      // sudah diketik dibiarkan di layar supaya user bisa memperbaiki baris yang disebut di
      // pesan error tanpa mengetik ulang semuanya.
      setErrorSimpan(
        err instanceof ApiError
          ? `${err.message} — tidak ada harga yang tersimpan, semua angka di layar masih utuh. Perbaiki baris itu lalu simpan lagi.`
          : "Harga gagal disimpan. Periksa koneksi internet lalu coba lagi — tidak ada harga yang tersimpan.",
      );
    } finally {
      if (hidupRef.current) setMenyimpan(false);
    }
  }

  async function handleExport() {
    setErrorUnduh(null);
    setMengunduh(true);
    try {
      const csv = await exportHargaChannelCsv();
      // Unduhan file di browser: Blob -> URL sementara -> elemen <a download> yang langsung
      // diklik lalu dibuang. Tidak dipakai `window.open(url)` karena di HP itu membuka tab
      // berisi teks CSV, bukan mengunduh file.
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `harga-menu-${todayIso()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorUnduh(
        err instanceof ApiError ? err.message : "File gagal diunduh. Periksa koneksi internet lalu coba lagi.",
      );
    } finally {
      if (hidupRef.current) setMengunduh(false);
    }
  }

  async function handlePilihFile(file: File | null) {
    if (!file) return;
    setErrorImpor(null);
    setPesanSukses(null);
    setMengimpor(true);
    try {
      // File.text() = API bawaan browser; yang dikirim ke server adalah TEKS CSV-nya.
      const csvText = await file.text();
      const baris = await importHargaChannelPreview(csvText);
      if (hidupRef.current) setPreview({ namaFile: file.name, baris });
    } catch (err) {
      setErrorImpor(
        err instanceof ApiError
          ? err.message
          : "File gagal dibaca. Pastikan filenya CSV hasil tombol “Download CSV” di halaman ini.",
      );
    } finally {
      if (hidupRef.current) setMengimpor(false);
      // Kosongkan pilihan file supaya file yang sama bisa dipilih lagi setelah diedit.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /**
   * Hitung food cost % -- SENGAJA tidak otomatis saat layar dibuka.
   *
   * HPP per porsi tidak ada di data grid (lihat catatan di atas file), jadi angkanya harus
   * diambil satu permintaan per menu (`GET /menu/:kode/hpp`). Supaya layar tetap cepat dibuka,
   * perhitungannya DITUNDA sampai owner memintanya, dan dibatasi:
   * - hanya menu yang sedang tampil (ikut kotak pencarian), jadi bisa dipersempit dulu;
   * - menu berstatus "menunggu data" dilewati (HPP-nya memang belum bisa dihitung);
   * - maksimal 5 permintaan berjalan bersamaan, bukan semuanya sekaligus.
   * Menu yang gagal diambil cukup ditampilkan "-", tidak menggagalkan menu lain.
   */
  async function muatHpp() {
    const target = barisTampil.filter((b) => !b.menungguData && hppPerMenu[b.kode] === undefined);
    if (target.length === 0) return;
    setMemuatHpp(true);
    setProgresHpp({ selesai: 0, total: target.length });
    try {
      for (let i = 0; i < target.length; i += MAKS_PARALEL_HPP) {
        if (!hidupRef.current) return;
        const potongan = target.slice(i, i + MAKS_PARALEL_HPP);
        const hasil = await Promise.all(
          potongan.map(async (b): Promise<[string, number | null]> => {
            try {
              const laporan = await getMenuHpp(b.kode);
              return [b.kode, laporan.hpp_per_porsi ?? null];
            } catch {
              return [b.kode, null];
            }
          }),
        );
        if (!hidupRef.current) return;
        setHppPerMenu((lama) => ({ ...lama, ...Object.fromEntries(hasil) }));
        setProgresHpp({ selesai: Math.min(i + MAKS_PARALEL_HPP, target.length), total: target.length });
      }
    } finally {
      if (hidupRef.current) {
        setMemuatHpp(false);
        setProgresHpp(null);
      }
    }
  }

  if (preview) {
    return (
      <PreviewImportHargaSection
        namaFile={preview.namaFile}
        baris={preview.baris}
        namaMenu={namaMenu}
        onBatal={() => setPreview(null)}
        onSelesai={(jumlah) => {
          setPreview(null);
          setPesanSukses(`${jumlah} harga tersimpan dari file CSV.`);
          void muatGrid();
        }}
      />
    );
  }

  const adaFoodCost = Object.keys(hppPerMenu).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Edit Harga Massal</h2>
          <p className="text-sm text-slate-500">
            Ubah harga jual banyak menu sekaligus. Ketik langsung di kotak harga, lalu tekan “Simpan Semua”.
          </p>
        </div>
        <Button type="button" variant="ghost" onClick={onTutup} className="shrink-0">
          Selesai
        </Button>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-sm font-medium text-slate-900">Lewat spreadsheet (opsional)</p>
        <p className="text-xs text-slate-500">
          Download daftar harga, edit di Excel atau Google Sheets, lalu import lagi. Setelah import Anda akan
          melihat ringkasan perubahannya dulu sebelum disimpan.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={handleExport}
            disabled={mengunduh}
          >
            {mengunduh ? "Menyiapkan..." : "Download CSV"}
          </Button>
          <label className="w-full sm:w-auto">
            <span className="mb-1 block text-xs font-medium text-slate-600">Import CSV</span>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              aria-label="Pilih file CSV harga menu"
              disabled={mengimpor}
              onChange={(e) => void handlePilihFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 disabled:opacity-60"
            />
          </label>
        </div>
        {mengimpor ? <Spinner label="Membaca file..." /> : null}
        {errorUnduh ? <ErrorBox>{errorUnduh}</ErrorBox> : null}
        {errorImpor ? <ErrorBox>{errorImpor}</ErrorBox> : null}
      </div>

      <Input
        placeholder="Cari nama menu, kategori, atau kode..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void muatHpp()}
          disabled={memuatHpp || memuat || barisTampil.length === 0}
        >
          {memuatHpp
            ? `Menghitung... (${progresHpp?.selesai ?? 0}/${progresHpp?.total ?? 0})`
            : adaFoodCost
              ? "Hitung food cost % menu lainnya"
              : "Hitung food cost %"}
        </Button>
        {!adaFoodCost && !memuatHpp ? (
          <p className="text-xs text-slate-500">
            Food cost % belum dihitung (“-”). Perhitungannya perlu mengambil HPP tiap menu satu per satu, jadi
            tidak dijalankan otomatis supaya halaman ini cepat terbuka.
          </p>
        ) : null}
      </div>

      {errorMuat ? <ErrorBox>{errorMuat}</ErrorBox> : null}
      {memuat ? <Spinner label="Memuat daftar harga..." /> : null}

      {data && !memuat ? (
        <>
          <p className="text-xs text-slate-500">
            Menampilkan {barisTampil.length} menu aktif x {data.channels.length} channel. Kotak harga yang
            masih kosong berarti harga jual di channel itu belum pernah diisi — itu kondisi normal, bukan error.
          </p>

          {/* Grid lebar memang perlu digeser ke samping di layar HP. Sengaja TIDAK dipecah jadi
              kartu per baris: untuk edit massal, membandingkan harga antar channel dalam satu
              baris justru inti kegunaannya. */}
          <div className="-mx-4 overflow-x-auto border-y border-slate-200 bg-white sm:mx-0 sm:rounded-xl sm:border">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 min-w-[11rem] bg-slate-50 px-3 py-2 text-left font-medium">
                    Menu
                  </th>
                  {data.channels.map((ch) => (
                    <th key={ch} className="min-w-[8.5rem] px-3 py-2 text-left font-medium">
                      {ch}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {barisTampil.map((b) => (
                  <BarisGrid
                    key={b.kode}
                    kode={b.kode}
                    nama={b.nama}
                    menungguData={b.menungguData}
                    channels={data.channels}
                    awal={data.harga[b.kode] ?? {}}
                    nilai={draft[b.kode] ?? {}}
                    hppPerPorsi={hppPerMenu[b.kode]}
                    targetFoodCost={targetFoodCost}
                    onUbah={handleUbahSel}
                  />
                ))}
                {barisTampil.length === 0 ? (
                  <tr>
                    <td
                      colSpan={data.channels.length + 1}
                      className="px-3 py-6 text-center text-sm text-slate-500"
                    >
                      Tidak ada menu yang cocok.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {jumlahDikosongkan > 0 ? (
            <WarningBox>
              {jumlahDikosongkan} kotak harga Anda kosongkan. Mengosongkan kotak tidak menghapus harga yang
              sudah tersimpan — kotak itu dilewati saat menyimpan. Untuk menghentikan penjualan di satu
              channel, pakai pengaturan “Tampil di channel ini” di detail menu.
            </WarningBox>
          ) : null}

          {errorSimpan ? <ErrorBox>{errorSimpan}</ErrorBox> : null}
          {pesanSukses ? <ResultBox>{pesanSukses}</ResultBox> : null}

          <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 sm:mx-0 sm:rounded-xl sm:border">
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-slate-600">
                {perubahan.length === 0
                  ? "Belum ada harga yang diubah."
                  : `${perubahan.length} harga siap disimpan.`}
              </p>
              <Button type="button" onClick={() => void handleSimpanSemua()} disabled={menyimpan}>
                {menyimpan ? "Menyimpan..." : "Simpan Semua"}
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Semua perubahan disimpan sekaligus. Kalau ada satu yang ditolak, tidak ada yang tersimpan dan
              angka di layar tetap seperti yang Anda ketik.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Satu baris menu di grid. `memo` supaya mengetik di satu sel tidak merender ulang seluruh grid
 * (ratusan input) -- karena itu `nilai`/`awal` dikirim sebagai objek PER MENU, bukan satu peta
 * besar untuk semua menu. */
const BarisGrid = memo(function BarisGrid({
  kode,
  nama,
  menungguData,
  channels,
  awal,
  nilai,
  hppPerPorsi,
  targetFoodCost,
  onUbah,
}: {
  kode: string;
  nama: string;
  menungguData: boolean;
  channels: string[];
  awal: Record<string, number | null>;
  nilai: Record<string, string>;
  /** `undefined` = belum dihitung, `null` = HPP menunggu data. */
  hppPerPorsi: number | null | undefined;
  targetFoodCost: number | null;
  onUbah: (kode: string, channel: string, nilai: string) => void;
}) {
  return (
    <tr className="border-t border-slate-100">
      <th
        scope="row"
        className="sticky left-0 z-10 min-w-[11rem] max-w-[13rem] bg-white px-3 py-2 text-left align-top font-normal"
      >
        <p className="truncate text-sm font-medium text-slate-900" title={nama}>
          {nama}
        </p>
        <p className="text-xs text-slate-500">{kode}</p>
        {menungguData ? <p className="text-xs text-amber-700">HPP menunggu data</p> : null}
      </th>
      {channels.map((ch) => {
        const teks = nilai[ch] ?? "";
        const nilaiAwal = awal[ch] ?? null;
        const berubah = nilaiBerubah(nilaiAwal, teks);
        return (
          <td key={ch} className="px-3 py-2 align-top">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={100}
              value={teks}
              placeholder="Belum diisi"
              aria-label={`Harga ${nama} di ${ch}`}
              onChange={(e) => onUbah(kode, ch, e.target.value)}
              className={`w-28 rounded-lg border px-2 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                berubah ? "border-amber-400 bg-amber-50" : "border-slate-300"
              }`}
            />
            <FoodCostSel
              hppPerPorsi={menungguData ? null : hppPerPorsi}
              hargaTeks={teks}
              targetFoodCost={targetFoodCost}
            />
          </td>
        );
      })}
    </tr>
  );
});

/** Food cost % satu sel -- dihitung LIVE di layar dari HPP per porsi menu itu, jadi angkanya ikut
 * berubah sambil harga diketik (tanpa menyimpan dan tanpa memanggil API lagi). */
function FoodCostSel({
  hppPerPorsi,
  hargaTeks,
  targetFoodCost,
}: {
  hppPerPorsi: number | null | undefined;
  hargaTeks: string;
  targetFoodCost: number | null;
}) {
  if (hppPerPorsi === undefined) {
    return <p className="mt-1 text-xs text-slate-400">-</p>;
  }
  if (hppPerPorsi === null || hppPerPorsi <= 0) {
    return <p className="mt-1 text-xs text-amber-700">Menunggu data</p>;
  }
  const harga = Number(hargaTeks.trim());
  if (hargaTeks.trim() === "" || !Number.isFinite(harga) || harga <= 0) {
    return <p className="mt-1 text-xs text-slate-400">Harga belum diisi</p>;
  }
  const foodCostPct = (hppPerPorsi / harga) * 100;
  const diAtasTarget = targetFoodCost !== null && foodCostPct > targetFoodCost;
  return (
    <p className={`mt-1 text-xs ${diAtasTarget ? "font-medium text-amber-700" : "text-slate-500"}`}>
      Bahan {formatPersen(foodCostPct)}
      {diAtasTarget ? " ↑" : ""}
    </p>
  );
}
