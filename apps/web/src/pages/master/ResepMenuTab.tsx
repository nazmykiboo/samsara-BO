import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MenuPicker } from "../../components/pickers/MenuPicker";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Spinner } from "../../components/ui/Spinner";
import { BarisEditor, type BarisRow } from "../../components/BarisEditor";
import {
  createKategoriMenu,
  createMenu,
  duplicateMenu,
  getMenuResep,
  listKategoriMenu,
  listMenu,
  updateMenuResep,
  deactivateMenu,
} from "../../api/master";
import { ApiError } from "../../api/client";
import { usePermission } from "../../auth/usePermission";
import type { KategoriMenu, MenuListItem, MenuResepBarisItem } from "../../api/types";
import { type MockMenuRef } from "../../mock/referenceData";

/** Tooltip tombol yang dinonaktifkan -- backend `resep.edit` = owner/manajer_ops. */
const ALASAN_TIDAK_BOLEH_EDIT = "Hanya Owner dan Manajer Ops yang bisa mengubah resep menu.";

/** Nilai sentinel opsi terakhir dropdown kategori ("+ Tambah kategori baru") -- bukan id
 * kategori sungguhan, jadi dibuat string yang mustahil bentrok dengan id angka. */
const OPSI_TAMBAH_KATEGORI = "__tambah_kategori_baru__";

/** Keunikan kode/nama menu dijaga constraint UNIQUE database, jadi benturannya sampai ke
 * frontend sebagai pesan Postgres mentah berbahasa Inggris ("duplicate key value violates
 * unique constraint ..."). Itu tidak boleh ditampilkan apa adanya ke staf outlet -- diganti
 * penjelasan yang bisa ditindaklanjuti. Pesan error lain (mis. "Kode menu wajib diisi" dari
 * domain layer) sudah berbahasa Indonesia dan dipakai apa adanya. */
function pesanGagalBuatMenu(err: unknown): string {
  if (err instanceof ApiError) {
    if (/duplicate key|unique/i.test(err.message)) {
      return "Kode atau nama menu ini sudah dipakai menu lain. Ganti kode/namanya, lalu simpan ulang.";
    }
    // Kategori yang dipilih sudah dinonaktifkan/dihapus orang lain SETELAH dropdown ini dimuat.
    // Backend membalas 404 (bukan 400) dengan pesan yang menyebut id angkanya -- angka itu tidak
    // berarti apa-apa untuk staf, jadi diganti instruksi yang bisa ditindaklanjuti.
    if (err.status === 404 && /kategori/i.test(err.message)) {
      return "Kategori yang dipilih sudah tidak aktif lagi. Tutup form ini, buka ulang, lalu pilih kategori lain.";
    }
    return err.message;
  }
  return "Gagal membuat menu.";
}

/** Pesan gagal untuk penambahan kategori inline -- benturan kode/nama kategori juga dijaga
 * constraint UNIQUE database, jadi perlu diterjemahkan seperti kasus menu di atas. */
function pesanGagalBuatKategori(err: unknown): string {
  if (err instanceof ApiError) {
    if (/duplicate key|unique/i.test(err.message)) {
      return "Kode atau nama kategori ini sudah ada. Pakai kategori yang sudah ada, atau ganti kode/namanya.";
    }
    return err.message;
  }
  return "Gagal menambah kategori.";
}

/**
 * SARAN kode menu: `{kodeKategori}-{nomor 3 digit}`, nomornya = jumlah menu yang kategorinya
 * sama di daftar GET /menu + 1 (mis. kategori BURJO sudah dipakai 6 menu -> "BURJO-007").
 *
 * Dihitung di sisi tampilan dengan sengaja -- backend tidak membuat kode otomatis (lihat
 * module.json § GET /menu). Konsekuensinya saran ini bisa bentrok kalau ada kode yang pernah
 * dipakai lalu menunya dihapus/diganti kode: isian ini TETAP bisa diedit manual, dan kalau
 * sampai bentrok, backend menolaknya dan user cuma perlu mengganti kodenya.
 */
function sarankanKodeMenu(kategori: KategoriMenu, daftarMenu: MenuListItem[]): string {
  const jumlah = daftarMenu.filter((m) => m.kategoriId === kategori.id).length;
  return `${kategori.kode.trim().toUpperCase()}-${String(jumlah + 1).padStart(3, "0")}`;
}

function toBarisRows(baris: MenuResepBarisItem[]): BarisRow[] {
  return baris
    .filter((b): b is MenuResepBarisItem & { itemKode: string } => b.itemKode !== null)
    .map((b) => ({
      itemKode: b.itemKode,
      itemName: b.itemName,
      qty: String(b.qty),
      unit: b.unit,
    }));
}

/**
 * Editor baris resep untuk SATU menu (GET /menu/:kode/resep + PATCH /menu/:kode/resep).
 * Ini kode yang sebelumnya ditulis inline di dalam ResepMenuTab -- dipindah jadi komponen
 * sendiri TANPA mengubah perilakunya (tetap refetch dari server setelah simpan, tetap
 * menolak simpan kalau belum ada bahan), supaya alur "buat menu baru" dan "duplikat menu"
 * bisa langsung memakainya di layar yang sama, bukan punya editor resep sendiri yang
 * perilakunya bisa menyimpang.
 */
function MenuResepEditor({ kode }: { kode: string }) {
  const bisaEditResep = usePermission("resep.edit");
  const [rows, setRows] = useState<BarisRow[]>([]);
  const [loadingBaris, setLoadingBaris] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function loadBaris() {
    setLoadingBaris(true);
    setLoadError(null);
    getMenuResep(kode)
      .then((res) => setRows(toBarisRows(res)))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Gagal memuat resep menu."))
      .finally(() => setLoadingBaris(false));
  }

  useEffect(() => {
    setRows([]);
    setError(null);
    setSuccess(false);
    loadBaris();
    // Dipanggil ulang hanya kalau menu yang sedang dibuka berganti -- bukan setiap render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kode]);

  async function handleSubmit() {
    setError(null);
    setSuccess(false);
    if (rows.length === 0 || rows.some((r) => !r.qty || !r.unit)) {
      setError("Tambahkan minimal 1 bahan dan lengkapi qty/satuannya.");
      return;
    }
    setSaving(true);
    try {
      await updateMenuResep(
        kode,
        rows.map((r) => ({ itemKode: r.itemKode, qty: Number(r.qty), unit: r.unit })),
      );
      // Refetch dari server supaya tampilan konsisten dengan apa yang SUNGGUHAN
      // tersimpan -- bukan menyimpan nilai yang baru dikirim sebagai sumber kebenaran.
      loadBaris();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan resep menu.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingBaris) return <Spinner label="Memuat resep menu..." />;
  if (loadError) return <ErrorBox>{loadError}</ErrorBox>;

  return (
    <div className="space-y-4">
      <BarisEditor rows={rows} onChange={setRows} itemLabel="Tambah bahan/item" />

      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {success ? <ResultBox>Resep menu tersimpan.</ResultBox> : null}

      <Button
        onClick={handleSubmit}
        disabled={saving || !bisaEditResep}
        title={bisaEditResep ? undefined : ALASAN_TIDAK_BOLEH_EDIT}
        className="w-full"
      >
        {saving ? "Menyimpan..." : "Simpan resep menu"}
      </Button>
      {!bisaEditResep ? <p className="text-xs text-slate-500">{ALASAN_TIDAK_BOLEH_EDIT}</p> : null}
    </div>
  );
}

export function ResepMenuTab() {
  // Form resep menu ini sebelumnya TIDAK punya pengecekan permission sama sekali (cuma mengandalkan
  // gate route halaman Master) -- sekarang digate eksplisit ke `resep.edit`.
  const bisaEditResep = usePermission("resep.edit");
  // Tambah/duplikat menu pakai permission SENDIRI (POST /menu = `master_menu.edit`), bukan numpang
  // `resep.edit` -- walaupun rolenya kebetulan sama.
  const bisaBuatMenu = usePermission("master_menu.edit");
  const [selectedMenu, setSelectedMenu] = useState<MockMenuRef | null>(null);
  const [deactivatedMenus, setDeactivatedMenus] = useState<Set<string>>(new Set());
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  /** null = form menu baru tertutup. `{ sumber: null }` = menu baru dari nol,
   * `{ sumber: menu }` = duplikat dari menu itu. */
  const [formMenuBaru, setFormMenuBaru] = useState<{ sumber: MockMenuRef | null } | null>(null);
  /** MenuPicker mengambil daftar menu sekali saat dipasang; diganti key-nya supaya menu yang
   * baru dibuat ikut muncul di pencarian tanpa perlu reload halaman. */
  const [pickerKey, setPickerKey] = useState(0);

  function handleSelectMenu(menu: MockMenuRef) {
    setSelectedMenu(menu);
    setDeactivateError(null);
  }

  async function handleDeactivate() {
    if (!selectedMenu) return;
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await deactivateMenu(selectedMenu.kode);
      setDeactivatedMenus((prev) => new Set(prev).add(selectedMenu.kode));
      setConfirmingDeactivate(false);
    } catch (err) {
      setDeactivateError(err instanceof ApiError ? err.message : "Gagal menonaktifkan menu.");
    } finally {
      setDeactivating(false);
    }
  }

  const isDeactivated = selectedMenu ? deactivatedMenus.has(selectedMenu.kode) : false;

  return (
    <div className="space-y-4">
      {bisaBuatMenu ? (
        <Button onClick={() => setFormMenuBaru({ sumber: null })} className="w-full">
          + Menu
        </Button>
      ) : null}

      <MenuPicker key={pickerKey} label="Pilih menu" value={selectedMenu?.kode ?? null} onSelect={handleSelectMenu} />

      {selectedMenu ? (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-slate-900">
                {selectedMenu.name} ({selectedMenu.kode})
              </p>
              {isDeactivated ? <Badge tone="neutral">Nonaktif</Badge> : null}
            </div>
            {bisaBuatMenu ? (
              <Button
                variant="secondary"
                className="shrink-0 px-3 py-1.5 text-xs"
                onClick={() => setFormMenuBaru({ sumber: selectedMenu })}
              >
                Duplikat
              </Button>
            ) : null}
          </div>

          <MenuResepEditor kode={selectedMenu.kode} />

          {!isDeactivated && bisaEditResep ? (
            <div className="border-t border-slate-200 pt-4">
              {deactivateError ? (
                <div className="mb-3">
                  <ErrorBox>{deactivateError}</ErrorBox>
                </div>
              ) : null}
              <Button variant="danger" className="w-full" onClick={() => setConfirmingDeactivate(true)}>
                Nonaktifkan menu
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Pilih menu di atas untuk melihat/ubah resepnya. Untuk membuat menu mirip menu yang sudah ada, buka menunya
          dulu lalu tekan "Duplikat".
        </p>
      )}

      {confirmingDeactivate && selectedMenu ? (
        <ConfirmDialog
          title="Nonaktifkan menu?"
          message={`Menu "${selectedMenu.name}" tidak akan bisa dijual lagi. Ditolak otomatis kalau masih ada di paket aktif.`}
          danger
          loading={deactivating}
          onConfirm={handleDeactivate}
          onCancel={() => setConfirmingDeactivate(false)}
        />
      ) : null}

      {formMenuBaru && bisaBuatMenu ? (
        <MenuBaruSheet
          sumber={formMenuBaru.sumber}
          onClose={() => setFormMenuBaru(null)}
          onCreated={() => setPickerKey((n) => n + 1)}
        />
      ) : null}
    </div>
  );
}

/**
 * Form "menu baru" DAN "duplikat menu" -- satu komponen, bedanya cuma ada/tidaknya `sumber`.
 *
 * Setelah menu berhasil dibuat, lembar ini TIDAK ditutup: isinya berganti jadi konfirmasi +
 * editor resep (komponen MenuResepEditor yang sama dengan yang dipakai di tab) untuk menu yang
 * baru dibuat, supaya user bisa langsung mengisi bahannya tanpa klik/navigasi tambahan.
 *
 * Duplikat sekarang CUKUP SATU panggilan (POST /menu/:kode/duplikat): penyalinan baris resep
 * dikerjakan backend di dalam satu transaksi. Orkestrasi lama di sini (POST /menu -> GET resep
 * sumber -> PATCH resep menu baru) SUDAH DIHAPUS -- dulu hasilnya bisa "setengah jadi" (menu
 * terbuat, resep gagal disalin, user harus mengisi manual); sekarang kalau penyalinan gagal,
 * menu barunya ikut dibatalkan server, jadi tidak ada lagi keadaan setengah jadi untuk
 * dijelaskan ke user.
 */
function MenuBaruSheet({
  sumber,
  onClose,
  onCreated,
}: {
  sumber: MockMenuRef | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  // Hook lokasi yang SUDAH ADA dipakai ulang (jangan bikin daftar lokasi sendiri) -- hook itu
  // sudah di-memo-kan untuk menghindari bug render-loop yang pernah terjadi di halaman Stok.
  // Form ini cuma terbuka untuk owner/manajer_ops (permission `master_menu.edit`), dan dua role
  // itu allLocations, jadi daftarnya memang seluruh lokasi -- itu penting karena semantik
  // `lokasiIds` di backend adalah "lokasi yang TIDAK disebut jadi nonaktif".
  const lokasiOptions = useLokasiOptions();

  const [kode, setKode] = useState("");
  /** true setelah user mengetik sendiri di field kode -- sejak itu saran otomatis tidak pernah
   * menimpa isiannya lagi. */
  const [kodeDiisiManual, setKodeDiisiManual] = useState(false);
  const [name, setName] = useState("");
  /** null = tanpa kategori (field ini opsional di backend). */
  const [kategoriId, setKategoriId] = useState<number | null>(null);
  /** Kosong = menu aktif di SEMUA lokasi (default backend) -- bukan "tidak ada lokasi". */
  const [lokasiIds, setLokasiIds] = useState<number[]>([]);

  const [kategoriList, setKategoriList] = useState<KategoriMenu[]>([]);
  const [daftarMenu, setDaftarMenu] = useState<MenuListItem[]>([]);
  const [loadingRef, setLoadingRef] = useState(true);
  const [refError, setRefError] = useState<string | null>(null);

  const [modeKategoriBaru, setModeKategoriBaru] = useState(false);
  const [kodeKategoriBaru, setKodeKategoriBaru] = useState("");
  const [namaKategoriBaru, setNamaKategoriBaru] = useState("");
  const [savingKategori, setSavingKategori] = useState(false);
  const [errorKategori, setErrorKategori] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuBaru, setMenuBaru] = useState<{ kode: string; name: string } | null>(null);
  const [catatanSalin, setCatatanSalin] = useState<string | null>(null);

  // Daftar kategori + daftar menu diambil SEKALI saat lembar ini dibuka. Daftar menu dipakai
  // cuma untuk MENGHITUNG nomor urut saran kode (jumlah menu per kategori), bukan ditampilkan.
  useEffect(() => {
    let active = true;
    setLoadingRef(true);
    setRefError(null);
    Promise.all([listKategoriMenu(), listMenu()])
      .then(([kategori, menu]) => {
        if (!active) return;
        setKategoriList(kategori);
        setDaftarMenu(menu);
        // Duplikat: kategori menu sumber ikut diprefill -- sekarang lewat `kategoriId` dari
        // GET /menu, bukan teks bebas seperti versi lama. Kategori sumber yang sudah nonaktif
        // sengaja TIDAK diprefill, karena backend menolak kategori nonaktif.
        if (sumber) {
          const barisSumber = menu.find((m) => m.kode === sumber.kode);
          const kategoriSumber =
            barisSumber && barisSumber.kategoriId !== null
              ? kategori.find((k) => k.id === barisSumber.kategoriId && k.aktif)
              : undefined;
          if (kategoriSumber) {
            setKategoriId(kategoriSumber.id);
            setKode((prev) => (prev ? prev : sarankanKodeMenu(kategoriSumber, menu)));
          }
        }
      })
      .catch((err) => {
        if (!active) return;
        setRefError(err instanceof ApiError ? err.message : "Gagal memuat daftar kategori menu.");
      })
      .finally(() => {
        if (active) setLoadingRef(false);
      });
    return () => {
      active = false;
    };
  }, [sumber]);

  /** Kategori nonaktif tidak ditawarkan di dropdown -- backend menolaknya saat menu disimpan. */
  const kategoriAktif = useMemo(() => kategoriList.filter((k) => k.aktif), [kategoriList]);

  /** Boleh mengisi field kode dengan saran otomatis? Boleh kalau user belum pernah mengetik
   * kode sendiri (isinya masih saran, jadi aman diperbarui kalau kategorinya diganti), ATAU
   * kalau field kodenya memang sedang kosong. Isian manual yang masih ada JANGAN ditimpa. */
  function bolehIsiSaranKode(): boolean {
    return !kodeDiisiManual || kode.trim() === "";
  }

  function pilihKategori(nilai: string) {
    setError(null);
    if (nilai === OPSI_TAMBAH_KATEGORI) {
      setModeKategoriBaru(true);
      setErrorKategori(null);
      return;
    }
    setModeKategoriBaru(false);
    if (!nilai) {
      setKategoriId(null);
      return;
    }
    const id = Number(nilai);
    setKategoriId(id);
    const kategori = kategoriList.find((k) => k.id === id);
    // Saran kode cuma MENGISI field (tidak menyimpan/mengirim apa pun) dan tidak pernah
    // menimpa kode yang sudah diketik user sendiri.
    if (kategori && bolehIsiSaranKode()) setKode(sarankanKodeMenu(kategori, daftarMenu));
  }

  async function handleSimpanKategoriBaru() {
    setErrorKategori(null);
    const kodeKat = kodeKategoriBaru.trim().toUpperCase();
    const namaKat = namaKategoriBaru.trim();
    if (!kodeKat || !namaKat) {
      setErrorKategori("Kode dan nama kategori wajib diisi.");
      return;
    }
    setSavingKategori(true);
    try {
      const { id } = await createKategoriMenu({ kode: kodeKat, nama: namaKat });
      // Daftar diambil ulang dari server (bukan ditambahkan ke state secara lokal) supaya isi
      // dan urutan tampilnya persis seperti yang tersimpan.
      const kategoriTerbaru = await listKategoriMenu();
      setKategoriList(kategoriTerbaru);
      setKategoriId(id);
      const dibuat = kategoriTerbaru.find((k) => k.id === id);
      if (dibuat && bolehIsiSaranKode()) setKode(sarankanKodeMenu(dibuat, daftarMenu));
      setModeKategoriBaru(false);
      setKodeKategoriBaru("");
      setNamaKategoriBaru("");
    } catch (err) {
      setErrorKategori(pesanGagalBuatKategori(err));
    } finally {
      setSavingKategori(false);
    }
  }

  function toggleLokasi(id: number) {
    setLokasiIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Penjaga kalau user menekan Enter saat masih mengisi kategori baru (dua input itu ada di
    // dalam form yang sama) -- supaya menunya tidak tersimpan tanpa kategori yang dia maksud.
    if (modeKategoriBaru) {
      setError('Selesaikan dulu kategori barunya (tekan "Simpan kategori") atau batalkan, baru simpan menunya.');
      return;
    }
    const kodeBaru = kode.trim();
    const namaBaru = name.trim();
    if (!kodeBaru || !namaBaru) {
      setError("Kode dan nama menu wajib diisi.");
      return;
    }

    // lokasiIds TIDAK dikirim kalau tidak ada yang dicentang -- di backend "tidak dikirim"
    // berarti aktif di semua lokasi. Array kosong bukan pilihan yang sah di sini.
    const opsi = {
      kategoriId: kategoriId ?? undefined,
      lokasiIds: lokasiIds.length > 0 ? lokasiIds : undefined,
    };

    setSaving(true);
    try {
      if (sumber) {
        await duplicateMenu(sumber.kode, { kodeBaru, nameBaru: namaBaru, ...opsi });
        setCatatanSalin(
          `Bahan resep dari menu "${sumber.name}" sudah ikut disalin oleh sistem. Ubah di bawah kalau perlu disesuaikan. Kalau menu sumbernya memang belum punya bahan, daftar di bawah masih kosong — itu normal.`,
        );
      } else {
        // `isActive` tidak dikirim -- backend sudah default aktif.
        await createMenu({ kode: kodeBaru, name: namaBaru, ...opsi });
      }
    } catch (err) {
      // Form tetap terbuka dengan isian apa adanya supaya user cuma perlu mengoreksi
      // kode/nama, tidak mengetik ulang semuanya.
      setError(pesanGagalBuatMenu(err));
      setSaving(false);
      return;
    }

    onCreated();
    setMenuBaru({ kode: kodeBaru, name: namaBaru });
    setSaving(false);
  }

  const judul = sumber ? `Duplikat menu "${sumber.name}"` : "Menu baru";
  const nilaiDropdownKategori = modeKategoriBaru
    ? OPSI_TAMBAH_KATEGORI
    : kategoriId === null
      ? ""
      : String(kategoriId);

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">{judul}</h2>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {menuBaru ? (
          <div className="space-y-4">
            <ResultBox>
              Menu "{menuBaru.name}" ({menuBaru.kode}) berhasil dibuat. Lanjut isi bahan resepnya di bawah.
            </ResultBox>
            {catatanSalin ? <p className="text-sm text-slate-600">{catatanSalin}</p> : null}

            <MenuResepEditor kode={menuBaru.kode} />

            <Button variant="secondary" className="w-full" onClick={onClose}>
              Selesai
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="Kategori menu (opsional)">
              <Select value={nilaiDropdownKategori} onChange={(e) => pilihKategori(e.target.value)} disabled={loadingRef}>
                <option value="">{loadingRef ? "Memuat kategori..." : "Tanpa kategori"}</option>
                {kategoriAktif.map((k) => (
                  <option key={k.id} value={String(k.id)}>
                    {k.nama} ({k.kode})
                  </option>
                ))}
                <option value={OPSI_TAMBAH_KATEGORI}>+ Tambah kategori baru</option>
              </Select>
            </Field>

            {modeKategoriBaru ? (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-600">
                  Kategori baru ini dipakai bersama untuk semua menu. Kode singkatnya jadi awalan kode menu — kode
                  "BURJO" menghasilkan saran "BURJO-001".
                </p>
                <Field label="Kode kategori (huruf besar, tanpa spasi)">
                  <Input
                    autoFocus
                    value={kodeKategoriBaru}
                    onChange={(e) => setKodeKategoriBaru(e.target.value)}
                    placeholder="Misal: BURJO"
                  />
                </Field>
                <Field label="Nama kategori">
                  <Input
                    value={namaKategoriBaru}
                    onChange={(e) => setNamaKategoriBaru(e.target.value)}
                    placeholder="Misal: Burjo"
                  />
                </Field>
                {errorKategori ? <p className="text-sm text-red-600">{errorKategori}</p> : null}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    className="flex-1 px-3 py-2 text-sm"
                    disabled={savingKategori}
                    onClick={handleSimpanKategoriBaru}
                  >
                    {savingKategori ? "Menyimpan..." : "Simpan kategori"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1 px-3 py-2 text-sm"
                    onClick={() => {
                      setModeKategoriBaru(false);
                      setKodeKategoriBaru("");
                      setNamaKategoriBaru("");
                      setErrorKategori(null);
                    }}
                  >
                    Batal
                  </Button>
                </div>
              </div>
            ) : null}

            {refError ? (
              <p className="text-xs text-amber-700">
                Daftar kategori gagal dimuat ({refError}). Menu masih bisa dibuat tanpa kategori, atau tutup form ini
                dan coba lagi.
              </p>
            ) : null}

            <Field label="Kode menu (harus unik)">
              <Input
                value={kode}
                onChange={(e) => {
                  setKode(e.target.value);
                  setKodeDiisiManual(true);
                }}
                placeholder={sumber ? `Misal: ${sumber.kode}-2` : "Misal: BURJO-007"}
                required
              />
            </Field>
            <p className="text-xs text-slate-500">
              Kode terisi otomatis begitu kategori dipilih — tetap bisa diganti manual sebelum disimpan.
            </p>

            <Field label="Nama menu (harus unik)">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={sumber ? `Misal: ${sumber.name} Spesial` : "Misal: Bubur Ayam Komplit"}
                required
              />
            </Field>

            <Field label="Dijual di lokasi tertentu saja?">
              <div className="space-y-2">
                {lokasiOptions.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={lokasiIds.includes(l.id)}
                      onChange={() => toggleLokasi(l.id)}
                    />
                    <span className="text-sm text-slate-800">{l.name}</span>
                  </label>
                ))}
              </div>
            </Field>
            <p className="text-xs text-slate-500">
              Kosongkan semua centang kalau menu ini dijual di semua lokasi (ini yang paling umum). Centang hanya kalau
              menu ini khusus untuk lokasi tertentu.
            </p>

            {sumber ? (
              <p className="text-xs text-slate-500">
                Bahan resep dari "{sumber.name}" disalin otomatis ke menu baru ini. Kode dan nama harus diisi baru
                karena tidak boleh sama dengan menu lain. Harga jual dan pengaturan tampil/sembunyi per channel TIDAK
                ikut disalin — isi lagi di halaman Menu &amp; HPP.
              </p>
            ) : null}
            <p className="text-xs text-slate-500">
              Menu baru langsung aktif, dan ditandai "menunggu data" sampai bahan resepnya diisi — itu normal, bukan
              error.
            </p>

            {error ? <ErrorBox>{error}</ErrorBox> : null}

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? "Menyimpan..." : sumber ? "Duplikat menu" : "Buat menu"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
