import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { listDetailTransaksiPenjualan } from "../../api/laporan";
import { listBelumDiproses } from "../../api/sales-sync";
import type {
  BarisBelumDiproses,
  DetailTransaksiPenjualanBaris,
  SumberPencatatan,
} from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { usePermission } from "../../auth/usePermission";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { ErrorBox, WarningBox } from "../../components/ResultBox";
import { HppSumberBadge, SumberPencatatanBadge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { MOCK_CHANNEL } from "../../mock/referenceData";
import { MenuKodeCombobox, useMenuOptions, type MenuOption } from "../sales-sync/MenuKodeCombobox";
import { formatRupiah, formatTanggalSingkat } from "../../utils/format";

/** Sama dengan LIMIT tetap di backend (DEFAULT_LIMIT_DETAIL_PENJUALAN di
 * modules/inventory/src/domain/laporan.ts). Dipakai HANYA untuk menjelaskan ke user kalau
 * daftarnya memang dipotong, bukan untuk membuat halaman berikutnya -- belum ada pola pagination
 * di repo ini dan itu bukan keputusan yang boleh diambil di sisi tampilan. */
const BATAS_BARIS = 200;

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
  platform: string;
  orderId: string;
  items: Array<{ itemName: string; menuId: string | null; quantity: number }>;
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
        platform: row.platform,
        orderId: row.orderId,
        items: [],
        totalQty: 0,
      };
      peta.set(key, entri);
    }
    entri.items.push({ itemName: row.itemName, menuId: row.menuId, quantity: row.quantity });
    entri.totalQty += row.quantity;
  }
  return [...peta.values()];
}

/**
 * Riwayat penjualan per TRANSAKSI (satu entri = satu order, rincian menunya di dalam), menggabung
 * DUA sumber yang statusnya beda terhadap stok:
 * 1. Transaksi Penjualan asli di modul Inventory -- SUDAH memotong stok. Bisa diketuk untuk melihat
 *    rincian menu.
 * 2. Baris arsip sinkronisasi yang BELUM diproses -- penjualannya sudah tercatat tapi BELUM
 *    memotong stok. Ditandai beda (garis putus-putus + label "Belum diproses ke stok") dan
 *    rinciannya langsung terlihat, tanpa bisa diketuk.
 *
 * Read-only -- tab ini tidak pernah mengubah stok, termasuk untuk sumber kedua (endpoint
 * /belum-diproses murni baca; yang memotong stok cuma tombol di halaman Sinkronisasi Penjualan).
 *
 * Rentang tanggal SENGAJA dibiarkan kosong saat dibuka: backend otomatis mengambil 30 hari
 * terakhir, jadi user langsung melihat data tanpa perlu mengisi apa pun dulu.
 */
export function RiwayatTransaksiTab() {
  const { user } = useAuth();
  const lokasiOptions = useLokasiOptions();
  const menuOptions = useMenuOptions();

  const [tanggalMulai, setTanggalMulai] = useState("");
  const [tanggalSelesai, setTanggalSelesai] = useState("");
  const [channel, setChannel] = useState("");
  const [menuTerpilih, setMenuTerpilih] = useState<MenuOption | null>(null);
  // "" = semua lokasi. Filter ini hanya ditampilkan untuk role yang boleh lihat semua lokasi;
  // untuk supervisor backend sudah memaksa lingkupnya ke lokasi sendiri, jadi tidak perlu dikirim.
  const [lokasiId, setLokasiId] = useState<number | "">("");

  const [rows, setRows] = useState<DetailTransaksiPenjualanBaris[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sumber kedua: arsip sinkronisasi yang belum memotong stok. Gagal/kosongnya sumber ini TIDAK
  // boleh menjatuhkan daftar utama -- karena itu state-nya terpisah dan error-nya ditampilkan
  // sebagai keterangan, bukan menggantikan isi halaman.
  const [barisBelum, setBarisBelum] = useState<BarisBelumDiproses[]>([]);
  const [loadingBelum, setLoadingBelum] = useState(false);
  const [errorBelum, setErrorBelum] = useState<string | null>(null);

  const bisaPilihLokasi = user?.allLocations ?? false;
  const kodeMenu = menuTerpilih?.kode ?? "";
  // Endpoint /sales-sync/belum-diproses butuh permission `sales_sync.manage` (owner/manajer_ops),
  // sedangkan tab ini juga boleh dibuka supervisor. Untuk supervisor sumber kedua TIDAK diminta
  // sama sekali supaya tidak memunculkan error 403 untuk sesuatu yang bukan salah user --
  // halamannya tetap berfungsi, cuma menampilkan transaksi resmi saja.
  const bisaLihatBelumDiproses = usePermission("sales_sync.manage");
  // Dicek di sisi tampilan supaya user dapat penjelasan, bukan daftar kosong tanpa sebab.
  const rentangTerbalik = tanggalMulai !== "" && tanggalSelesai !== "" && tanggalMulai > tanggalSelesai;

  useEffect(() => {
    if (rentangTerbalik) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    listDetailTransaksiPenjualan({
      tanggalMulai: tanggalMulai || undefined,
      tanggalSelesai: tanggalSelesai || undefined,
      channel: channel || undefined,
      kodeMenu: kodeMenu || undefined,
      lokasiId: lokasiId === "" ? undefined : lokasiId,
    })
      .then((res) => {
        if (active) setRows(res);
      })
      .catch((err) => {
        if (active) {
          setRows([]);
          setError(err instanceof ApiError ? err.message : "Gagal memuat riwayat penjualan. Coba lagi.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tanggalMulai, tanggalSelesai, channel, kodeMenu, lokasiId, rentangTerbalik]);

  // Sumber kedua hanya bergantung ke rentang tanggal: endpoint-nya tidak punya parameter channel,
  // lokasi, maupun menu (lihat listBelumDiproses). Penyaringan tiga filter itu dikerjakan di bawah,
  // di sisi tampilan, dengan batasan yang dijelaskan ke user.
  useEffect(() => {
    if (!bisaLihatBelumDiproses || rentangTerbalik) {
      setBarisBelum([]);
      setLoadingBelum(false);
      setErrorBelum(null);
      return;
    }
    let active = true;
    setLoadingBelum(true);
    setErrorBelum(null);
    listBelumDiproses({
      tanggalMulai: tanggalMulai || undefined,
      tanggalSelesai: tanggalSelesai || undefined,
    })
      .then((res) => {
        if (active) setBarisBelum(res);
      })
      .catch((err) => {
        if (active) {
          setBarisBelum([]);
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
  }, [tanggalMulai, tanggalSelesai, rentangTerbalik, bisaLihatBelumDiproses]);

  const adaFilterAktif =
    tanggalMulai !== "" || tanggalSelesai !== "" || channel !== "" || kodeMenu !== "" || lokasiId !== "";

  // Filter menu tidak bisa diterapkan ke arsip yang belum diproses: baris arsip belum punya kode
  // menu Samsara (`menuId` di sana masih kode item dari aplikasi pesan-antar). Daripada menampilkan
  // baris yang mungkin bukan menu yang dicari, seluruh sumber itu disembunyikan selama filter menu
  // aktif -- dan user diberi tahu alasannya di dekat filternya.
  const belumDiprosesDisembunyikanMenu = kodeMenu !== "";
  const { entri, jumlahBelumTotal, jumlahBelumDitampilkan } = useMemo(() => {
    const asli = kelompokkanAsli(rows);
    const belumSemua = belumDiprosesDisembunyikanMenu
      ? []
      : kelompokkanBelumDiproses(barisBelum).filter(
          // Filter channel untuk sumber ini dibandingkan APA ADANYA (exact match) dengan nama
          // platform di arsip. Penulisan platform di file aplikasi pesan-antar bisa beda dari nama
          // channel di Inventory (mis. "Shopee" vs "ShopeeFood") -- itu tidak dicocok-cocokkan
          // otomatis di sini, keputusan penyeragaman nama bukan urusan tampilan.
          (o) => channel === "" || o.platform === channel,
        );
    // Dipotong di sisi tampilan: endpoint /belum-diproses TIDAK punya batas jumlah (tanpa rentang
    // tanggal, arsipnya ribuan baris / seribuan order), dan merender semuanya sekaligus bikin
    // halaman berat di HP. Jumlah seluruhnya tetap diberitahukan ke user, lengkap dengan cara
    // melihat sisanya (persempit tanggal) -- bukan dipotong diam-diam.
    const belum = belumSemua.slice(0, BATAS_BARIS);
    // Filter LOKASI sengaja TIDAK diterapkan ke `belum`: arsip sinkronisasi belum punya lokasi
    // (lokasi baru ditentukan saat diproses jadi transaksi). Menyembunyikannya hanya karena filter
    // lokasi aktif akan membuat penjualan yang belum terhitung jadi tidak terlihat sama sekali.
    // Tiap entri diberi keterangan "lokasi belum ditentukan" supaya tidak disalahartikan.
    //
    // Array#sort di JS stabil, jadi untuk tanggal yang sama transaksi resmi tetap muncul lebih dulu
    // daripada baris arsip (urutan concat di bawah) -- dan urutan dalam tiap sumber tetap seperti
    // yang dikirim backend.
    const gabungan: EntriRiwayat[] = [...asli, ...belum].sort((a, b) =>
      a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0,
    );
    return {
      entri: gabungan,
      jumlahBelumTotal: belumSemua.length,
      jumlahBelumDitampilkan: belum.length,
    };
  }, [rows, barisBelum, channel, belumDiprosesDisembunyikanMenu]);

  // Dicek dari data MENTAH yang sudah di-fetch untuk filter saat ini (bukan request tambahan):
  // kalau ADA baris dengan hppSumber 'snapshot_estimasi' yang tampil, HPP-nya adalah perkiraan dari
  // harga sekarang, bukan harga historis asli saat transaksi itu terjadi -- user perlu tahu ini
  // sebelum membaca angka HPP per baris di bawah.
  const adaEstimasiTampil = useMemo(() => rows.some((r) => r.hppSumber === "snapshot_estimasi"), [rows]);

  function resetFilter() {
    setTanggalMulai("");
    setTanggalSelesai("");
    setChannel("");
    setMenuTerpilih(null);
    setLokasiId("");
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Filter</h2>
        <p className="mb-3 text-xs text-slate-500">
          Kosongkan tanggal untuk melihat 30 hari terakhir. Isi hanya bagian yang perlu dipersempit.
          {bisaLihatBelumDiproses
            ? " Penjualan yang belum diproses ke stok ikut tampil tanpa batas 30 hari, jadi isi rentang tanggal kalau daftarnya terasa terlalu panjang."
            : ""}
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Tanggal mulai">
              <Input type="date" value={tanggalMulai} onChange={(e) => setTanggalMulai(e.target.value)} max={tanggalSelesai || undefined} />
            </Field>
            <Field label="Tanggal selesai">
              <Input type="date" value={tanggalSelesai} onChange={(e) => setTanggalSelesai(e.target.value)} min={tanggalMulai || undefined} />
            </Field>
          </div>

          {/* Keterangan tambahan ditaruh SEBAGAI SAUDARA <Field>, bukan di dalamnya: <Field>
              merender <label>, dan paragraf di dalam label bikin struktur HTML-nya tidak valid. */}
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
          jumlahBarisAsli={rows.length}
          jumlahBelumTotal={jumlahBelumTotal}
          jumlahBelumDitampilkan={jumlahBelumDitampilkan}
          belumDiprosesIkut={bisaLihatBelumDiproses && !belumDiprosesDisembunyikanMenu && errorBelum === null}
          lokasiDifilter={lokasiId !== ""}
        />
      ) : null}
    </div>
  );
}

function HasilRiwayat({
  entri,
  jumlahBarisAsli,
  jumlahBelumTotal,
  jumlahBelumDitampilkan,
  belumDiprosesIkut,
  lokasiDifilter,
}: {
  entri: EntriRiwayat[];
  /** Jumlah BARIS menu mentah dari sumber "asli" -- dipakai hanya untuk mendeteksi batas 200 baris
   * dari backend, bukan untuk ditampilkan sebagai jumlah transaksi. */
  jumlahBarisAsli: number;
  /** Jumlah order "belum diproses" setelah disaring, SEBELUM dipotong untuk ditampilkan. */
  jumlahBelumTotal: number;
  jumlahBelumDitampilkan: number;
  belumDiprosesIkut: boolean;
  lokasiDifilter: boolean;
}) {
  const jumlahAsli = entri.length - jumlahBelumDitampilkan;

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
          mengurangi stok setelah dijalankan di halaman Sinkronisasi Penjualan.
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
                <KartuBelumDiproses key={e.key} order={e} lokasiDifilter={lokasiDifilter} />
              ),
            )}
          </div>

          <p className="mt-3 text-xs text-slate-400">
            Menampilkan {jumlahAsli} transaksi yang sudah mengurangi stok
            {belumDiprosesIkut ? ` dan ${jumlahBelumDitampilkan} penjualan yang belum diproses ke stok` : ""},
            diurutkan dari yang terbaru.
          </p>
          {jumlahBarisAsli >= BATAS_BARIS ? (
            <p className="mt-1 text-xs text-slate-400">
              Transaksi yang sudah mengurangi stok sudah mencapai batas maksimal sekali tampil. Persempit
              rentang tanggal, channel, atau menu kalau yang Anda cari belum kelihatan.
            </p>
          ) : null}
          {jumlahBelumTotal > jumlahBelumDitampilkan ? (
            <p className="mt-1 text-xs text-slate-400">
              Penjualan yang belum diproses ke stok sebenarnya ada {jumlahBelumTotal} — yang tampil dibatasi{" "}
              {jumlahBelumDitampilkan} teratas supaya halaman tetap ringan di HP. Persempit rentang tanggalnya
              untuk melihat sisanya.
            </p>
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
            {formatTanggalSingkat(order.tanggal)} &middot; {order.sumber}
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
 * putus-putus + latar pudar, dan WARNANYA NETRAL (kelabu, bukan merah/kuning): belum diproses
 * adalah kondisi normal, bukan kesalahan yang perlu ditakuti. */
function KartuBelumDiproses({
  order,
  lokasiDifilter,
}: {
  order: EntriOrderBelumDiproses;
  lokasiDifilter: boolean;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-slate-700">
            {formatTanggalSingkat(order.tanggal)} &middot; {order.platform}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {order.items.length} menu &middot; {order.totalQty} porsi
            {lokasiDifilter ? " · lokasi belum ditentukan" : ""}
          </p>
          <p className="mt-1 break-all text-xs text-slate-400">No. pesanan: {order.orderId}</p>
        </div>
        {/* Bukan <Badge>: bentuknya sengaja beda (garis putus-putus, tanpa latar penuh) supaya
            sekilas lihat langsung kelihatan ini bukan transaksi resmi seperti kartu di atasnya. */}
        <span className="inline-flex shrink-0 items-center rounded-full border border-dashed border-slate-400 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600">
          Belum diproses ke stok
        </span>
      </div>

      {/* Rincian item TIDAK disembunyikan: satu order isinya sedikit, jadi lebih berguna langsung
          terlihat daripada dikunci di balik ketukan. */}
      <ul className="mt-2 space-y-1 border-t border-dashed border-slate-300 pt-2 text-xs">
        {order.items.map((item, idx) => (
          <li key={`${item.menuId ?? "tanpa-kode"}-${idx}`} className="flex items-start justify-between gap-2">
            <span className="min-w-0 text-slate-600">
              {item.itemName}
              {item.menuId ? <span className="text-slate-400"> &middot; {item.menuId}</span> : null}
            </span>
            <span className="shrink-0 text-slate-600">{item.quantity} porsi</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-slate-500">
        Penjualan ini sudah tercatat dari file yang diupload, tapi stoknya belum dikurangi.
      </p>
    </div>
  );
}

