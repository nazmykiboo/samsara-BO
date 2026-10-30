import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { listDetailTransaksiPenjualan } from "../../api/laporan";
import { getPengaturanOtomatis } from "../../api/otomatis";
import { listBelumDiproses } from "../../api/sales-sync";
import type {
  BarisBelumDiproses,
  DetailTransaksiPenjualanBaris,
  SumberPencatatan,
} from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { usePermission } from "../../auth/usePermission";
import { DateRangePicker, type RentangTanggal } from "../../components/DateRangePicker";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { ErrorBox, WarningBox } from "../../components/ResultBox";
import { HppSumberBadge, StatusArsipBadge, SumberPencatatanBadge, type StatusArsip } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { MOCK_CHANNEL } from "../../mock/referenceData";
import { MenuKodeCombobox, useMenuOptions, type MenuOption } from "../sales-sync/MenuKodeCombobox";
import { formatRupiah, formatTanggalSingkat } from "../../utils/format";

/** Jumlah transaksi/order dimuat per "halaman" -- ditambah PAGE_SIZE lagi tiap kali tombol "Muat
 * lebih banyak" ditekan (limit server-side bertambah, request diulang dari awal; BUKAN cursor
 * offset -- lebih sederhana & cukup untuk volume yang realistis di sini, lihat juga catatan
 * paginasi di laporan.ts/belum-diproses.ts). Lebih kecil dari batas lama (200) karena sekarang
 * ada ringkasan total asli dari server, jadi tidak perlu menarik banyak sekaligus di awal. */
const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Bentuk data tampilan: SATU ENTRI = SATU ORDER/TRANSAKSI (bukan satu menu).
//
// Kedua endpoint mengirim data FLAT per baris menu, pengelompokan per order dikerjakan di sini:
// - sumber "asli" (GET /inventory/transaksi/penjualan) dikelompokkan per `headerId` -- satu header
//   transaksi Penjualan = satu order.
// - sumber "belum diproses" (GET /sales-sync/belum-diproses) dikelompokkan per
//   `platform|tanggal|orderId`, key gabungan yang SAMA dipakai backend `proses.ts` saat memutuskan
//   baris mana jadi satu transaksi Penjualan -- jadi satu entri di layar = satu transaksi yang
//   nanti akan terbentuk, bukan pengelompokan karangan sendiri.
// ---------------------------------------------------------------------------

interface EntriOrderAsli {
  jenis: "asli";
  key: string;
  tanggal: string;
  jam: string | null;
  lokasiNama: string;
  sumber: string;
  noReferensi: string | null;
  sumberPencatatan: SumberPencatatan;
  items: Array<{
    menuKode: string;
    menuNama: string;
    qty: number;
    hppSaatTransaksi: number | null;
    hppSumber: DetailTransaksiPenjualanBaris["hppSumber"];
  }>;
  totalQty: number;
}

interface EntriOrderBelumDiproses {
  jenis: "belum_diproses";
  key: string;
  tanggal: string;
  jam: string;
  platform: string;
  orderId: string;
  items: Array<{ itemName: string; menuId: string | null; quantity: number; itemType: string; sudahTerpetakan: boolean }>;
  totalQty: number;
}

type EntriRiwayat = EntriOrderAsli | EntriOrderBelumDiproses;

function kelompokkanAsli(rows: DetailTransaksiPenjualanBaris[]): EntriOrderAsli[] {
  const peta = new Map<number, EntriOrderAsli>();
  for (const row of rows) {
    let entri = peta.get(row.headerId);
    if (!entri) {
      entri = {
        jenis: "asli",
        key: `asli-${row.headerId}`,
        tanggal: row.tanggal,
        jam: row.jam,
        lokasiNama: row.lokasiNama,
        sumber: row.sumber,
        noReferensi: row.noReferensi,
        sumberPencatatan: row.sumberPencatatan,
        items: [],
        totalQty: 0,
      };
      peta.set(row.headerId, entri);
    }
    entri.items.push({
      menuKode: row.menuKode,
      menuNama: row.menuNama,
      qty: row.qty,
      hppSaatTransaksi: row.hppSaatTransaksi,
      hppSumber: row.hppSumber,
    });
    entri.totalQty += row.qty;
  }
  return [...peta.values()];
}

function kelompokkanBelumDiproses(rows: BarisBelumDiproses[]): EntriOrderBelumDiproses[] {
  const peta = new Map<string, EntriOrderBelumDiproses>();
  for (const row of rows) {
    // Urutan field key mengikuti `proses.ts` (platform|tanggal|order_id) supaya gampang dicocokkan
    // kalau nanti ada yang membandingkan hasil di layar dengan hasil proses.
    const key = `${row.platform}|${row.tanggal}|${row.orderId}`;
    let entri = peta.get(key);
    if (!entri) {
      entri = {
        jenis: "belum_diproses",
        key: `belum-${key}`,
        tanggal: row.tanggal,
        jam: row.jam,
        platform: row.platform,
        orderId: row.orderId,
        items: [],
        totalQty: 0,
      };
      peta.set(key, entri);
    }
    entri.items.push({
      itemName: row.itemName,
      menuId: row.menuId,
      quantity: row.quantity,
      itemType: row.itemType,
      sudahTerpetakan: row.sudahTerpetakan,
    });
    entri.totalQty += row.quantity;
  }
  return [...peta.values()];
}

/** Status satu order arsip -- lihat `StatusArsip` di components/ui/Badge.tsx untuk arti tiap nilai.
 * Urutan pengecekan SENGAJA refund dulu: order dengan refund dianggap "perlu ditinjau" terlepas
 * status pemetaan/tanggalnya (konsisten dengan urutan kategorisasi di proses.ts/pratinjau.ts). */
function statusArsipOrder(order: EntriOrderBelumDiproses, tanggalMulaiOtomatis: string | null): StatusArsip {
  if (order.items.some((i) => i.itemType === "refund")) return "refund";
  if (order.items.some((i) => !i.sudahTerpetakan)) return "tertahan";
  if (tanggalMulaiOtomatis && order.tanggal < tanggalMulaiOtomatis) return "menunggu_tanggal_mulai";
  return null;
}

/**
 * Riwayat penjualan per TRANSAKSI (satu entri = satu order, rincian menunya di dalam), menggabung
 * DUA sumber yang statusnya beda terhadap stok:
 * 1. Transaksi Penjualan asli di modul Inventory -- SUDAH memotong stok. Bisa diketuk untuk melihat
 *    rincian menu.
 * 2. Baris arsip sinkronisasi yang BELUM diproses -- penjualannya sudah tercatat tapi BELUM
 *    memotong stok. Ditandai beda (garis putus-putus) dan rinciannya langsung terlihat, tanpa bisa
 *    diketuk. Statusnya bisa "normal" (menunggu dipicu otomatis/manual), "Perlu ditinjau" (ada
 *    retur/refund, TIDAK PERNAH otomatis diproses), "Menunggu pemetaan item", atau "Menunggu
 *    tanggal mulai otomatis".
 *
 * Read-only -- tab ini tidak pernah mengubah stok, termasuk untuk sumber kedua (endpoint
 * /belum-diproses murni baca; yang memotong stok cuma tombol di halaman Sinkronisasi Penjualan,
 * atau pemrosesan otomatis kalau dinyalakan owner).
 *
 * Rentang tanggal default "Bulan ini" (tanggal 1 bulan berjalan s.d. hari ini) -- BEDA dari versi
 * sebelumnya yang dibiarkan kosong (backend default 30 hari terakhir); sekarang dipilih eksplisit
 * di sisi tampilan lewat `DateRangePicker` supaya presetnya konsisten dengan filter tanggal di
 * tempat lain.
 */
export function RiwayatTransaksiTab() {
  const { user } = useAuth();
  const lokasiOptions = useLokasiOptions();
  const menuOptions = useMenuOptions();

  const [rentang, setRentang] = useState<RentangTanggal>(() => {
    const sekarang = new Date();
    const awalBulan = new Date(sekarang.getFullYear(), sekarang.getMonth(), 1);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { mulai: iso(awalBulan), selesai: iso(sekarang) };
  });
  const [channel, setChannel] = useState("");
  const [menuTerpilih, setMenuTerpilih] = useState<MenuOption | null>(null);
  // "" = semua lokasi. Filter ini hanya ditampilkan untuk role yang boleh lihat semua lokasi;
  // untuk supervisor backend sudah memaksa lingkupnya ke lokasi sendiri, jadi tidak perlu dikirim.
  const [lokasiId, setLokasiId] = useState<number | "">("");

  // Paginasi: limit bertambah PAGE_SIZE tiap "Muat lebih banyak" ditekan, masing-masing sumber
  // independen (bisa saja sumber asli sudah habis tapi arsip belum, atau sebaliknya).
  const [limitAsli, setLimitAsli] = useState(PAGE_SIZE);
  const [limitBelum, setLimitBelum] = useState(PAGE_SIZE);

  const [rows, setRows] = useState<DetailTransaksiPenjualanBaris[]>([]);
  const [totalAsli, setTotalAsli] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sumber kedua: arsip sinkronisasi yang belum memotong stok. Gagal/kosongnya sumber ini TIDAK
  // boleh menjatuhkan daftar utama -- karena itu state-nya terpisah dan error-nya ditampilkan
  // sebagai keterangan, bukan menggantikan isi halaman.
  const [barisBelum, setBarisBelum] = useState<BarisBelumDiproses[]>([]);
  const [totalBelum, setTotalBelum] = useState(0);
  const [loadingBelum, setLoadingBelum] = useState(false);
  const [errorBelum, setErrorBelum] = useState<string | null>(null);

  // Dipakai status "Menunggu tanggal mulai otomatis" -- gagal dimuat TIDAK masalah, badge itu
  // sekadar tidak muncul (bukan kegagalan halaman).
  const [tanggalMulaiOtomatis, setTanggalMulaiOtomatis] = useState<string | null>(null);

  const bisaPilihLokasi = user?.allLocations ?? false;
  const kodeMenu = menuTerpilih?.kode ?? "";
  // Endpoint /sales-sync/belum-diproses butuh permission `sales_sync.manage` (owner/manajer_ops),
  // sedangkan tab ini juga boleh dibuka supervisor. Untuk supervisor sumber kedua TIDAK diminta
  // sama sekali supaya tidak memunculkan error 403 untuk sesuatu yang bukan salah user --
  // halamannya tetap berfungsi, cuma menampilkan transaksi resmi saja.
  const bisaLihatBelumDiproses = usePermission("sales_sync.manage");
  const rentangTerbalik = rentang.mulai !== "" && rentang.selesai !== "" && rentang.mulai > rentang.selesai;

  // Reset paginasi tiap kali filter (selain limit itu sendiri) berubah -- halaman "Muat lebih
  // banyak" sebelumnya tidak relevan lagi untuk filter yang baru.
  useEffect(() => {
    setLimitAsli(PAGE_SIZE);
    setLimitBelum(PAGE_SIZE);
  }, [rentang.mulai, rentang.selesai, channel, kodeMenu, lokasiId]);

  useEffect(() => {
    getPengaturanOtomatis()
      .then((p) => setTanggalMulaiOtomatis(p.tanggalMulai))
      .catch(() => setTanggalMulaiOtomatis(null));
  }, []);

  useEffect(() => {
    if (rentangTerbalik) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    listDetailTransaksiPenjualan({
      tanggalMulai: rentang.mulai || undefined,
      tanggalSelesai: rentang.selesai || undefined,
      channel: channel || undefined,
      kodeMenu: kodeMenu || undefined,
      lokasiId: lokasiId === "" ? undefined : lokasiId,
      limit: limitAsli,
    })
      .then((res) => {
        if (active) {
          setRows(res.rows);
          setTotalAsli(res.total);
        }
      })
      .catch((err) => {
        if (active) {
          setRows([]);
          setTotalAsli(0);
          setError(err instanceof ApiError ? err.message : "Gagal memuat riwayat penjualan. Coba lagi.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rentang.mulai, rentang.selesai, channel, kodeMenu, lokasiId, limitAsli, rentangTerbalik]);

  // Sumber kedua hanya bergantung ke rentang tanggal: endpoint-nya tidak punya parameter channel,
  // lokasi, maupun menu (lihat listBelumDiproses). Penyaringan tiga filter itu dikerjakan di bawah,
  // di sisi tampilan, dengan batasan yang dijelaskan ke user.
  useEffect(() => {
    if (!bisaLihatBelumDiproses || rentangTerbalik) {
      setBarisBelum([]);
      setTotalBelum(0);
      setLoadingBelum(false);
      setErrorBelum(null);
      return;
    }
    let active = true;
    setLoadingBelum(true);
    setErrorBelum(null);
    listBelumDiproses({
      tanggalMulai: rentang.mulai || undefined,
      tanggalSelesai: rentang.selesai || undefined,
      limit: limitBelum,
    })
      .then((res) => {
        if (active) {
          setBarisBelum(res.rows);
          setTotalBelum(res.total);
        }
      })
      .catch((err) => {
        if (active) {
          setBarisBelum([]);
          setTotalBelum(0);
          setErrorBelum(
            err instanceof ApiError
              ? err.message
              : "Penjualan yang belum diproses ke stok gagal dimuat. Coba muat ulang halaman.",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingBelum(false);
      });
    return () => {
      active = false;
    };
  }, [rentang.mulai, rentang.selesai, limitBelum, rentangTerbalik, bisaLihatBelumDiproses]);

  // Filter menu tidak bisa diterapkan ke arsip yang belum diproses: baris arsip belum punya kode
  // menu Samsara (`menuId` di sana masih kode item dari aplikasi pesan-antar). Daripada menampilkan
  // baris yang mungkin bukan menu yang dicari, seluruh sumber itu disembunyikan selama filter menu
  // aktif -- dan user diberi tahu alasannya di dekat filternya.
  const belumDiprosesDisembunyikanMenu = kodeMenu !== "";
  const { entri, jumlahBelumDitampilkan } = useMemo(() => {
    const asli = kelompokkanAsli(rows);
    const belum = belumDiprosesDisembunyikanMenu
      ? []
      : kelompokkanBelumDiproses(barisBelum).filter(
          // Filter channel untuk sumber ini dibandingkan APA ADANYA (exact match) dengan nama
          // platform di arsip. Penulisan platform di file aplikasi pesan-antar bisa beda dari nama
          // channel di Inventory (mis. "Shopee" vs "ShopeeFood") -- itu tidak dicocok-cocokkan
          // otomatis di sini, keputusan penyeragaman nama bukan urusan tampilan.
          (o) => channel === "" || o.platform === channel,
        );
    // Array#sort di JS stabil, jadi untuk tanggal yang sama transaksi resmi tetap muncul lebih dulu
    // daripada baris arsip (urutan concat di bawah) -- dan urutan dalam tiap sumber tetap seperti
    // yang dikirim backend.
    const gabungan: EntriRiwayat[] = [...asli, ...belum].sort((a, b) =>
      a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0,
    );
    return { entri: gabungan, jumlahBelumDitampilkan: belum.length };
  }, [rows, barisBelum, channel, belumDiprosesDisembunyikanMenu]);

  // Dicek dari data MENTAH yang sudah di-fetch untuk filter saat ini (bukan request tambahan):
  // kalau ADA baris dengan hppSumber 'snapshot_estimasi' yang tampil, HPP-nya adalah perkiraan dari
  // harga sekarang, bukan harga historis asli saat transaksi itu terjadi -- user perlu tahu ini
  // sebelum membaca angka HPP per baris di bawah.
  const adaEstimasiTampil = useMemo(() => rows.some((r) => r.hppSumber === "snapshot_estimasi"), [rows]);

  function resetFilter() {
    const sekarang = new Date();
    const awalBulan = new Date(sekarang.getFullYear(), sekarang.getMonth(), 1);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setRentang({ mulai: iso(awalBulan), selesai: iso(sekarang) });
    setChannel("");
    setMenuTerpilih(null);
    setLokasiId("");
  }

  const adaFilterAktif = channel !== "" || kodeMenu !== "" || lokasiId !== "";
  const bisaMuatLebihAsli = rows.length < totalAsli;
  const bisaMuatLebihBelum = bisaLihatBelumDiproses && !belumDiprosesDisembunyikanMenu && barisBelum.length < totalBelum;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Filter</h2>
        <p className="mb-3 text-xs text-slate-500">
          {bisaLihatBelumDiproses
            ? "Penjualan yang belum diproses ke stok ikut tampil tanpa dipengaruhi filter channel/lokasi/menu di bawah (kecuali rentang tanggal)."
            : ""}
        </p>

        <div className="space-y-3">
          <DateRangePicker value={rentang} onChange={setRentang} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Field label="Channel penjualan">
                <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="">Semua channel</option>
                  {MOCK_CHANNEL.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {bisaLihatBelumDiproses && channel !== "" ? (
                <p className="mt-1 text-xs text-slate-400">
                  Penjualan yang belum diproses ke stok disaring memakai nama aplikasi apa adanya dari filenya.
                  Kalau nama di file berbeda sedikit dari &ldquo;{channel}&rdquo;, penjualan itu tidak ikut
                  tampil.
                </p>
              ) : null}
            </div>

            {bisaPilihLokasi ? (
              <div>
                <Field label="Lokasi">
                  <Select
                    value={lokasiId === "" ? "" : String(lokasiId)}
                    onChange={(e) => setLokasiId(e.target.value === "" ? "" : Number(e.target.value))}
                  >
                    <option value="">Semua lokasi</option>
                    {lokasiOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {bisaLihatBelumDiproses && lokasiId !== "" ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Penjualan yang belum diproses ke stok belum punya lokasi, jadi tetap tampil semuanya walau
                    filter lokasi dipakai.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Menu dipilih lewat kotak pencarian (daftar menunya panjang), bukan dropdown biasa --
              komponen yang sama dipakai di halaman Sinkronisasi Penjualan. */}
          <div>
            <p className="mb-1 block text-sm font-medium text-slate-700">Menu</p>
            {menuTerpilih ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{menuTerpilih.name}</p>
                  <p className="text-xs text-slate-500">{menuTerpilih.kode}</p>
                </div>
                <Button type="button" variant="secondary" onClick={() => setMenuTerpilih(null)} className="shrink-0">
                  Semua menu
                </Button>
              </div>
            ) : null}
            {menuTerpilih && bisaLihatBelumDiproses ? (
              <p className="mt-1 text-xs text-slate-400">
                Penjualan yang belum diproses ke stok tidak bisa disaring per menu (nama menunya masih versi
                aplikasi pesan-antar), jadi untuk sementara tidak ditampilkan. Pilih &ldquo;Semua menu&rdquo;
                untuk melihatnya lagi.
              </p>
            ) : null}
            {!menuTerpilih ? (
              <>
                <MenuKodeCombobox
                  menu={menuOptions}
                  ariaLabel="Cari menu untuk menyaring riwayat penjualan"
                  placeholder="Semua menu — ketik untuk mencari satu menu"
                  onPilih={setMenuTerpilih}
                />
                <p className="mt-1 text-xs text-slate-400">Biarkan kosong untuk menampilkan semua menu.</p>
              </>
            ) : null}
          </div>

          {adaFilterAktif ? (
            <Button type="button" variant="secondary" onClick={resetFilter} className="w-full">
              Atur ulang filter
            </Button>
          ) : null}
        </div>
      </Card>

      {!bisaPilihLokasi ? (
        <p className="text-xs text-slate-400">
          Riwayat yang tampil otomatis hanya untuk lokasi Anda.
        </p>
      ) : null}

      {rentangTerbalik ? (
        <WarningBox>
          Tanggal mulai lebih akhir daripada tanggal selesai. Tukar kedua tanggalnya dulu supaya hasilnya bisa
          ditampilkan.
        </WarningBox>
      ) : null}

      {loading || loadingBelum ? <Spinner label="Memuat riwayat penjualan..." /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {/* Sumber kedua gagal dimuat BUKAN kegagalan halaman: daftar transaksi resmi tetap tampil,
          user cuma perlu tahu bagian "belum diproses" sedang tidak terlihat. */}
      {!error && errorBelum ? <WarningBox>{errorBelum}</WarningBox> : null}

      {!loading && !loadingBelum && !error && !rentangTerbalik && adaEstimasiTampil ? (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800" role="status">
          Sebagian data transaksi di bawah ini (sebelum fitur pelacakan HPP historis ada) memakai estimasi HPP
          dari harga <strong>saat ini</strong>, bukan harga historis asli saat transaksi terjadi. Baris yang
          dimaksud ditandai badge &ldquo;Estimasi&rdquo; di rincian menu.
        </p>
      ) : null}

      {!loading && !loadingBelum && !error && !rentangTerbalik ? (
        <HasilRiwayat
          entri={entri}
          totalAsli={totalAsli}
          jumlahAsliDitampilkan={rows.length > 0 ? new Set(rows.map((r) => r.headerId)).size : 0}
          totalBelum={totalBelum}
          jumlahBelumDitampilkan={jumlahBelumDitampilkan}
          belumDiprosesIkut={bisaLihatBelumDiproses && !belumDiprosesDisembunyikanMenu && errorBelum === null}
          lokasiDifilter={lokasiId !== ""}
          tanggalMulaiOtomatis={tanggalMulaiOtomatis}
          bisaMuatLebihAsli={bisaMuatLebihAsli}
          bisaMuatLebihBelum={bisaMuatLebihBelum}
          onMuatLebihAsli={() => setLimitAsli((v) => v + PAGE_SIZE)}
          onMuatLebihBelum={() => setLimitBelum((v) => v + PAGE_SIZE)}
        />
      ) : null}
    </div>
  );
}

function HasilRiwayat({
  entri,
  totalAsli,
  jumlahAsliDitampilkan,
  totalBelum,
  jumlahBelumDitampilkan,
  belumDiprosesIkut,
  lokasiDifilter,
  tanggalMulaiOtomatis,
  bisaMuatLebihAsli,
  bisaMuatLebihBelum,
  onMuatLebihAsli,
  onMuatLebihBelum,
}: {
  entri: EntriRiwayat[];
  /** Jumlah TOTAL transaksi resmi yang cocok filter (dari server, lihat `total` di HasilDetailTransaksiPenjualan) -- bukan cuma yang sudah dimuat. */
  totalAsli: number;
  jumlahAsliDitampilkan: number;
  /** Jumlah TOTAL order "belum diproses" yang cocok filter (dari server). */
  totalBelum: number;
  jumlahBelumDitampilkan: number;
  belumDiprosesIkut: boolean;
  lokasiDifilter: boolean;
  tanggalMulaiOtomatis: string | null;
  bisaMuatLebihAsli: boolean;
  bisaMuatLebihBelum: boolean;
  onMuatLebihAsli: () => void;
  onMuatLebihBelum: () => void;
}) {
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Riwayat penjualan</h2>
      <p className="mb-1 text-xs text-slate-500">
        Satu baris = satu transaksi (satu pesanan), bukan satu menu. Ketuk transaksi untuk melihat rincian
        menu dan jumlah porsinya.
      </p>
      {belumDiprosesIkut ? (
        <p className="mb-3 text-xs text-slate-500">
          Daftar ini menggabungkan dua hal: penjualan yang <strong>sudah</strong> mengurangi stok, dan
          penjualan hasil upload yang <strong>belum</strong> diproses ke stok (bergaris putus-putus, rinciannya
          sudah langsung terlihat jadi tidak perlu diketuk). Keduanya normal — yang belum diproses akan
          mengurangi stok setelah diproses (otomatis atau lewat halaman Sinkronisasi Penjualan).
        </p>
      ) : (
        <p className="mb-3 text-xs text-slate-500">
          Semua transaksi di daftar ini sudah mengurangi stok.
        </p>
      )}

      {entri.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">
          Belum ada penjualan tercatat untuk filter ini. Coba ubah rentang tanggal, channel, atau menunya.
        </p>
      ) : (
        <>
          {/* Satu kartu ringkas per transaksi (BUKAN tabel 7 kolom): target utamanya layar HP, dan
              tabel selebar itu memaksa geser ke samping. */}
          <div className="space-y-1.5">
            {entri.map((e) =>
              e.jenis === "asli" ? (
                <KartuTransaksiTercatat key={e.key} order={e} />
              ) : (
                <KartuBelumDiproses
                  key={e.key}
                  order={e}
                  lokasiDifilter={lokasiDifilter}
                  status={statusArsipOrder(e, tanggalMulaiOtomatis)}
                />
              ),
            )}
          </div>

          <p className="mt-3 text-xs text-slate-400">
            Menampilkan {jumlahAsliDitampilkan} dari {totalAsli} transaksi yang sudah mengurangi stok
            {belumDiprosesIkut
              ? `, dan ${jumlahBelumDitampilkan} dari ${totalBelum} penjualan yang belum diproses ke stok`
              : ""}
            , diurutkan dari yang terbaru.
          </p>

          {bisaMuatLebihAsli || bisaMuatLebihBelum ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {bisaMuatLebihAsli ? (
                <Button type="button" variant="secondary" onClick={onMuatLebihAsli} className="text-xs">
                  Muat transaksi lebih banyak
                </Button>
              ) : null}
              {bisaMuatLebihBelum ? (
                <Button type="button" variant="secondary" onClick={onMuatLebihBelum} className="text-xs">
                  Muat penjualan belum diproses lebih banyak
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** Satu transaksi Penjualan yang SUDAH tercatat di stok. Bisa dilipat/dibuka untuk melihat rincian
 * menunya -- pola tombol toggle + panah ▲▼ sama seperti `DaftarOrder` di halaman Sinkronisasi
 * Penjualan, supaya gerakannya sudah familier untuk tim outlet. */
function KartuTransaksiTercatat({ order }: { order: EntriOrderAsli }) {
  const [terbuka, setTerbuka] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200 text-sm">
      <button
        type="button"
        onClick={() => setTerbuka((v) => !v)}
        aria-expanded={terbuka}
        className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="min-w-0">
          <p className="font-medium text-slate-900">
            {formatTanggalSingkat(order.tanggal)}
            {order.jam ? ` · ${order.jam.slice(0, 5)}` : ""} &middot; {order.sumber}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {order.lokasiNama} &middot; {order.items.length} menu &middot; {order.totalQty} porsi
          </p>
          <p className="mt-1 break-all text-xs text-slate-400">
            {order.noReferensi ? `No. referensi: ${order.noReferensi}` : "Tanpa no. referensi"}
          </p>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <SumberPencatatanBadge sumber={order.sumberPencatatan} />
          <span className="text-xs text-slate-400" aria-hidden>
            {terbuka ? "▲ Tutup rincian" : "▼ Lihat rincian"}
          </span>
        </span>
      </button>
      {terbuka ? (
        <ul className="space-y-1.5 border-t border-slate-200 px-3 py-2 text-xs">
          {order.items.map((item, idx) => (
            <li key={`${item.menuKode}-${idx}`} className="flex items-start justify-between gap-2">
              <span className="min-w-0 text-slate-700">
                {item.menuNama}
                <span className="text-slate-400"> &middot; {item.menuKode}</span>
              </span>
              <span className="shrink-0 text-right text-slate-600">
                <span className="block">{item.qty} porsi</span>
                <span className="mt-0.5 flex items-center justify-end gap-1 text-slate-500">
                  {item.hppSaatTransaksi === null
                    ? "HPP belum tersedia"
                    : `HPP ${formatRupiah(item.hppSaatTransaksi)}`}
                  <HppSumberBadge sumber={item.hppSumber} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Satu order hasil upload yang BELUM diproses jadi transaksi -- belum mengurangi stok.
 *
 * SENGAJA tidak bisa diketuk: tidak ada rincian tersembunyi di sini (isinya langsung terlihat) dan
 * tidak ada aksi apa pun yang boleh dijalankan dari halaman ini. Gayanya dibedakan lewat garis
 * putus-putus + latar pudar. Badge status BERWARNA (amber) kalau order ini perlu perhatian (refund/
 * tertahan), NETRAL (badge putus-putus generik) kalau sekadar menunggu giliran diproses -- itu
 * kondisi normal, bukan kesalahan yang perlu ditakuti. */
function KartuBelumDiproses({
  order,
  lokasiDifilter,
  status,
}: {
  order: EntriOrderBelumDiproses;
  lokasiDifilter: boolean;
  status: StatusArsip;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-700">
            {formatTanggalSingkat(order.tanggal)} &middot; {order.jam.slice(0, 5)} &middot; {order.platform}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {order.items.length} menu &middot; {order.totalQty} porsi
            {lokasiDifilter ? " · lokasi belum ditentukan" : ""}
          </p>
          <p className="mt-1 break-all text-xs text-slate-400">No. pesanan: {order.orderId}</p>
        </div>
        {status ? (
          <StatusArsipBadge status={status} />
        ) : (
          // Bukan <Badge>: bentuknya sengaja beda (garis putus-putus, tanpa latar penuh) supaya
          // sekilas lihat langsung kelihatan ini bukan transaksi resmi seperti kartu di atasnya.
          <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-slate-400 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600">
            Belum diproses ke stok
          </span>
        )}
      </div>

      {/* Rincian item TIDAK disembunyikan: satu order isinya sedikit, jadi lebih berguna langsung
          terlihat daripada dikunci di balik ketukan. */}
      <ul className="mt-2 space-y-1 border-t border-dashed border-slate-300 pt-2 text-xs">
        {order.items.map((item, idx) => (
          <li key={`${item.menuId ?? "tanpa-kode"}-${idx}`} className="flex items-start justify-between gap-2">
            <span className="min-w-0 text-slate-600">
              {item.itemName}
              {item.menuId ? <span className="text-slate-400"> &middot; {item.menuId}</span> : null}
              {item.itemType === "refund" ? <span className="text-amber-600"> &middot; retur</span> : null}
            </span>
            <span className="shrink-0 text-slate-600">{item.quantity} porsi</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-slate-500">
        {status === "refund"
          ? "Order ini tidak akan pernah otomatis mengurangi stok karena ada retur/refund -- perlu ditinjau manual."
          : status === "tertahan"
            ? "Order ini akan otomatis diproses begitu semua itemnya dipetakan ke menu Samsara."
            : status === "menunggu_tanggal_mulai"
              ? "Order ini sebelum tanggal mulai pemrosesan otomatis, jadi tidak akan ikut terpotong otomatis."
              : "Penjualan ini sudah tercatat dari file yang diupload, tapi stoknya belum dikurangi."}
      </p>
    </div>
  );
}
