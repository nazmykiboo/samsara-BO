import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LokasiPicker, useLokasiOptions } from "../components/pickers/LokasiPicker";
import { getDalamPerjalanan, getStok } from "../api/stok";
import { getMinStok, setMinStok } from "../api/minStok";
import { listItems } from "../api/master";
import { ApiError } from "../api/client";
import type { DalamPerjalananRow, ItemListItem } from "../api/types";
import { type MockLokasi } from "../mock/referenceData";
import { Card } from "../components/ui/Card";
import { Spinner } from "../components/ui/Spinner";
import { Badge } from "../components/ui/Badge";
import { Input, Field } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Button } from "../components/ui/Button";
import { ErrorBox } from "../components/ResultBox";
import { formatRupiah } from "../utils/format";
import { useAuth } from "../auth/AuthContext";
import { bisaKelolaMaster } from "../auth/permissions";

/** Item dari GET /items yang kodenya terisi -- baris tanpa kode disaring karena
 * halaman Stok butuh kode sebagai kunci qty/min-stok per lokasi. */
type StokItem = ItemListItem & { kode: string };

interface QtyState {
  qty: number | null;
  loading: boolean;
  error: string | null;
}

/** Ambang stok minimum per item, HANYA untuk satu lokasi yang sedang dipilih di
 * filter (map-nya di-refresh tiap kali `locationFilter` berubah ke lokasi lain).
 * Kalau filter lokasi = "Semua lokasi", map ini sengaja dikosongkan -- lihat
 * catatan di computeStatus/minStokFor soal kenapa highlight HABIS/MENIPIS
 * tidak ditampilkan untuk agregat lintas lokasi. */
interface MinStokState {
  map: Record<string, number>;
  loading: boolean;
  error: string | null;
}

type StatusFilter = "semua" | "habis" | "menipis" | "aman";

/** Urutan tampil: HABIS dulu, lalu MENIPIS, baru AMAN. Baris yang qty-nya
 * belum selesai dimuat (atau gagal) sengaja diberi rank yang sama dengan
 * AMAN -- supaya tabel tidak "kelihatan gawat" dulu buat semua baris saat
 * baru dibuka, baru meloncat ke atas begitu benar-benar dikonfirmasi
 * HABIS/MENIPIS setelah datanya sampai. */
function statusRank(status: "habis" | "menipis" | "aman" | "belum_dimuat"): number {
  switch (status) {
    case "habis":
      return 0;
    case "menipis":
      return 1;
    default:
      return 2;
  }
}

function computeStatus(qty: number | null, minStok: number | null): "habis" | "menipis" | "aman" | "belum_dimuat" {
  if (qty === null) return "belum_dimuat";
  if (qty <= 0) return "habis";
  if (minStok !== null && qty <= minStok) return "menipis";
  return "aman";
}

function rowKey(kode: string, locationId: number): string {
  return `${kode}::${locationId}`;
}

/** Jalankan `worker` untuk tiap item di `items`, maksimal `limit` yang jalan
 * bersamaan -- supaya tidak menembak API lokal dengan ratusan request
 * sekaligus kalau jumlah item x lokasi yang ditampilkan besar. */
async function runWithLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

export function StokPage() {
  const options = useLokasiOptions();
  const { user } = useAuth();
  const bisaAturMinStok = user !== null && bisaKelolaMaster(user.role);

  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<"all" | number>(options[0]?.id ?? "all");
  const [entitasFilter, setEntitasFilter] = useState<"all" | string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("semua");
  const [qtyState, setQtyState] = useState<Record<string, QtyState>>({});
  const [minStokState, setMinStokState] = useState<MinStokState>({ map: {}, loading: false, error: null });
  const [editingMinStok, setEditingMinStok] = useState<{ kode: string; name: string } | null>(null);

  const [items, setItems] = useState<StokItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // Daftar item (nama/kategori/satuan resep) diambil sekali saat halaman dibuka --
  // halaman ini cuma MEMBACA daftar item (penambahan/ubah item dilakukan di Master
  // Item), jadi tidak perlu reloadCounter. Item NONAKTIF tetap ditampilkan (lihat
  // badge "Nonaktif" di StokRow) karena outlet bisa saja masih punya sisa stok
  // item yang baru dinonaktifkan dan perlu dihabiskan/di-opname, bukan disembunyikan.
  useEffect(() => {
    let active = true;
    setLoadingItems(true);
    setItemsError(null);
    listItems()
      .then((res) => {
        if (!active) return;
        setItems(res.filter((i): i is StokItem => i.kode !== null));
      })
      .catch((err) => {
        if (active) setItemsError(err instanceof ApiError ? err.message : "Gagal memuat daftar item.");
      })
      .finally(() => {
        if (active) setLoadingItems(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const entitasOptions = useMemo(() => {
    const set = new Set(options.map((l) => l.entitas));
    return Array.from(set);
  }, [options]);

  const visibleLocations = useMemo(
    () =>
      options.filter(
        (l) => (locationFilter === "all" || l.id === locationFilter) && (entitasFilter === "all" || l.entitas === entitasFilter),
      ),
    [options, locationFilter, entitasFilter],
  );

  // Ambil qty live untuk semua item x lokasi yang sedang terlihat. Metadata
  // item (nama/kategori) sudah dimuat lewat effect listItems() di atas --
  // tabel tetap tampil seketika begitu daftar item masuk, kolom stok tiap
  // baris menunggu sendiri-sendiri (lihat QtyState.loading), tidak memblokir
  // seluruh tabel.
  useEffect(() => {
    // Sengaja TIDAK pakai ref dedup ("sudah pernah di-fetch key mana saja")
    // di sini. Kombinasi ref (persist lintas re-invoke) + flag `active` yang
    // di-set-false oleh cleanup sinkron StrictMode (mount->cleanup->mount
    // lagi di dev) bikin invocation kedua yang hidup melihat semua key
    // "sudah ditandai" oleh invocation pertama yang sudah mati -- padahal
    // hasil fetch invocation pertama nanti dibuang karena `active` sudah
    // false. Baris jadi macet "Memuat..." selamanya walau request-nya
    // sendiri sukses (dikonfirmasi lewat network tab). Solusinya: ikuti
    // pola standar React (cleanup effect harus bisa membatalkan efeknya
    // sendiri secara utuh) -- tiap invocation effect fetch SEMUA key yang
    // sedang terlihat dari awal, dan cuma `active` (var lokal closure ini,
    // bukan ref bersama) yang menentukan boleh tidaknya commit hasil.
    // Konsekuensinya di dev: StrictMode bikin 1 batch fetch tambahan yang
    // langsung dibuang -- boros jaringan sekali per mount, tapi TIDAK ADA
    // di production build (StrictMode tidak double-invoke di sana) dan
    // tidak akan pernah bikin baris macet.
    let active = true;
    const pending = visibleLocations.flatMap((loc) => items.map((item) => ({ kode: item.kode, locationId: loc.id })));
    if (pending.length === 0) return;

    setQtyState((s) => {
      const next = { ...s };
      for (const p of pending) next[rowKey(p.kode, p.locationId)] = { qty: null, loading: true, error: null };
      return next;
    });

    void runWithLimit(pending, 8, async ({ kode, locationId }) => {
      const key = rowKey(kode, locationId);
      try {
        const res = await getStok(kode, locationId);
        if (!active) return;
        setQtyState((s) => ({ ...s, [key]: { qty: res.qty, loading: false, error: null } }));
      } catch (err) {
        if (!active) return;
        setQtyState((s) => ({
          ...s,
          [key]: { qty: null, loading: false, error: err instanceof ApiError ? err.message : "Gagal memuat." },
        }));
      }
    });

    return () => {
      active = false;
    };
  }, [visibleLocations, items]);

  // Ambang stok minimum sekarang per item X lokasi (bukan lagi kolom
  // `min_stok` level-item yang lama -- itu kolom deprecated).
  // Cukup SATU panggilan API per lokasi terpilih (endpoint-nya sudah
  // mengembalikan seluruh daftar item untuk satu lokasi), bukan per-item
  // seperti qty. Kalau filter = "Semua lokasi" sengaja tidak fetch apa-apa
  // -- satu item bisa punya ambang berbeda di tiap lokasi, jadi status
  // HABIS/MENIPIS agregat lintas lokasi tidak punya satu arti yang jelas
  // (lihat computeStatus dipanggil di rows/StokRow: minStok dikirim null
  // untuk kasus ini, sehingga baris tampil netral/AMAN sampai user memilih
  // satu lokasi spesifik).
  useEffect(() => {
    if (locationFilter === "all") {
      setMinStokState({ map: {}, loading: false, error: null });
      return;
    }
    let active = true;
    setMinStokState({ map: {}, loading: true, error: null });
    getMinStok(locationFilter)
      .then((entries) => {
        if (!active) return;
        const map: Record<string, number> = {};
        for (const e of entries) map[e.itemKode] = e.minStok;
        setMinStokState({ map, loading: false, error: null });
      })
      .catch((err) => {
        if (!active) return;
        setMinStokState({
          map: {},
          loading: false,
          error: err instanceof ApiError ? err.message : "Gagal memuat ambang stok minimum.",
        });
      });
    return () => {
      active = false;
    };
  }, [locationFilter]);

  function minStokFor(kode: string): number | null {
    if (locationFilter === "all") return null;
    return minStokState.map[kode] ?? null;
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filteredItems = q
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.kode.toLowerCase().includes(q) ||
            (i.category ?? "").toLowerCase().includes(q),
        )
      : items;

    const built: { key: string; item: StokItem; location: MockLokasi; state: QtyState | undefined; minStok: number | null }[] = [];
    for (const item of filteredItems) {
      for (const loc of visibleLocations) {
        const key = rowKey(item.kode, loc.id);
        built.push({ key, item, location: loc, state: qtyState[key], minStok: minStokFor(item.kode) });
      }
    }

    const withStatusFilter =
      statusFilter === "semua"
        ? built
        : built.filter((r) => computeStatus(r.state?.qty ?? null, r.minStok) === statusFilter);

    return withStatusFilter.sort((a, b) => {
      const rankA = statusRank(computeStatus(a.state?.qty ?? null, a.minStok));
      const rankB = statusRank(computeStatus(b.state?.qty ?? null, b.minStok));
      if (rankA !== rankB) return rankA - rankB;
      return a.item.name.localeCompare(b.item.name);
    });
  }, [search, visibleLocations, qtyState, statusFilter, locationFilter, minStokState, items]);

  if (options.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold text-slate-900">Stok</h1>
        <Card>
          <p className="text-sm text-slate-500">Akun ini belum ditetapkan ke lokasi manapun. Hubungi owner.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Stok</h1>
        <p className="text-sm text-slate-500">Lihat stok semua item, saring per lokasi/entitas/status, dan pantau transfer yang masih dalam perjalanan.</p>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Daftar stok</h2>
        {itemsError ? <ErrorBox>{itemsError}</ErrorBox> : null}
        {locationFilter === "all" ? (
          <p className="mt-2 text-xs text-slate-500">
            Pilih satu lokasi di filter "Lokasi" untuk melihat/atur ambang stok minimum dan status Habis/Menipis per item -- satu item
            bisa punya ambang berbeda di tiap lokasi, jadi status itu belum ditampilkan saat "Semua lokasi" dipilih.
          </p>
        ) : null}
        {minStokState.error ? (
          <div className="mt-2">
            <ErrorBox>{minStokState.error}</ErrorBox>
          </div>
        ) : null}

        <div className="mt-3 space-y-3">
          <Input placeholder="Cari nama, kode, atau kategori item..." value={search} onChange={(e) => setSearch(e.target.value)} />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Lokasi">
              <Select
                value={locationFilter === "all" ? "all" : String(locationFilter)}
                onChange={(e) => setLocationFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
              >
                <option value="all">Semua lokasi</option>
                {options.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Entitas">
              <Select value={entitasFilter} onChange={(e) => setEntitasFilter(e.target.value)}>
                <option value="all">Semua entitas</option>
                {entitasOptions.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
              <option value="semua">Semua status</option>
              <option value="habis">Habis saja</option>
              <option value="menipis">Menipis saja</option>
              <option value="aman">Aman saja</option>
            </Select>
          </Field>
        </div>

        <div className="mt-4 space-y-2">
          {loadingItems ? (
            <Spinner label="Memuat daftar item..." />
          ) : visibleLocations.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Tidak ada lokasi yang cocok dengan filter lokasi/entitas di atas.</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Tidak ada item yang cocok dengan pencarian/filter.</p>
          ) : (
            rows.map((row) => (
              <StokRow
                key={row.key}
                item={row.item}
                location={row.location}
                state={row.state}
                minStok={row.minStok}
                canEditMinStok={bisaAturMinStok && locationFilter !== "all"}
                onEditMinStok={() => setEditingMinStok({ kode: row.item.kode, name: row.item.name })}
              />
            ))
          )}
        </div>
      </Card>

      <DalamPerjalananSection allowedLocations={options} items={items} />

      {editingMinStok && locationFilter !== "all" ? (
        <MinStokModal
          itemKode={editingMinStok.kode}
          itemName={editingMinStok.name}
          locationId={locationFilter}
          currentMinStok={minStokState.map[editingMinStok.kode] ?? null}
          onClose={() => setEditingMinStok(null)}
          onSaved={(kode, value) => {
            setMinStokState((s) => ({ ...s, map: { ...s.map, [kode]: value } }));
          }}
        />
      ) : null}
    </div>
  );
}

const STATUS_LABEL: Record<"habis" | "menipis" | "aman", string> = {
  habis: "Habis",
  menipis: "Menipis",
  aman: "Aman",
};

const ROW_TONE: Record<"habis" | "menipis" | "aman" | "belum_dimuat", string> = {
  habis: "border-red-300 bg-red-50",
  menipis: "border-amber-300 bg-amber-50",
  aman: "border-slate-200 bg-white",
  belum_dimuat: "border-slate-200 bg-white",
};

function StokRow({
  item,
  location,
  state,
  minStok,
  canEditMinStok,
  onEditMinStok,
}: {
  item: StokItem;
  location: MockLokasi;
  state: QtyState | undefined;
  minStok: number | null;
  canEditMinStok: boolean;
  onEditMinStok: () => void;
}) {
  const status = computeStatus(state?.qty ?? null, minStok);

  return (
    <div className={`rounded-lg border px-3 py-2 ${ROW_TONE[status]}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {item.name} {!item.isActive ? <Badge tone="neutral">Nonaktif</Badge> : null}
          </p>
          <p className="text-xs text-slate-500">
            {item.kode} &middot; {item.category ?? "-"} &middot; {location.name}
          </p>
        </div>
        {status !== "belum_dimuat" ? (
          <Badge tone={status === "habis" ? "danger" : status === "menipis" ? "warning" : "success"}>{STATUS_LABEL[status]}</Badge>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-sm">
        <span className="text-slate-500">
          Min. stok: {minStok !== null ? `${minStok} ${item.recipeUnit}` : "belum diatur"}
          {canEditMinStok ? (
            <button type="button" onClick={onEditMinStok} className="ml-2 text-xs font-medium text-blue-600 underline">
              {minStok !== null ? "Ubah" : "Atur"}
            </button>
          ) : null}
        </span>
        {state?.loading ? (
          <span className="text-xs text-slate-400">Memuat...</span>
        ) : state?.error ? (
          <span className="text-xs text-red-600">{state.error}</span>
        ) : (
          <span className="font-semibold text-slate-900">
            {state?.qty ?? 0} {item.recipeUnit}
          </span>
        )}
      </div>
    </div>
  );
}

function MinStokModal({
  itemKode,
  itemName,
  locationId,
  currentMinStok,
  onClose,
  onSaved,
}: {
  itemKode: string;
  itemName: string;
  locationId: number;
  currentMinStok: number | null;
  onClose: () => void;
  onSaved: (itemKode: string, minStok: number) => void;
}) {
  const [value, setValue] = useState(currentMinStok !== null ? String(currentMinStok) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const num = Number(value);
    if (value.trim() === "" || Number.isNaN(num) || num < 0) {
      setError("Isi angka stok minimum (0 atau lebih).");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await setMinStok({ itemKode, locationId, minStok: num });
      onSaved(res.itemKode, res.minStok);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan stok minimum.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Atur stok minimum</h2>
            <p className="text-xs text-slate-500">{itemName}</p>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Stok minimum (ambang status &quot;Menipis&quot;)">
            <Input type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </Field>
          <p className="text-xs text-slate-500">
            Kalau stok item ini di lokasi yang sedang dipilih turun sampai angka ini atau di bawahnya, statusnya berubah jadi "Menipis"
            di halaman Stok. Ambang ini khusus untuk lokasi ini saja -- lokasi lain bisa punya angka berbeda.
          </p>

          {error ? <ErrorBox>{error}</ErrorBox> : null}

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Menyimpan..." : "Simpan"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function DalamPerjalananSection({ allowedLocations, items }: { allowedLocations: MockLokasi[]; items: StokItem[] }) {
  const [locationId, setLocationId] = useState<number | null>(allowedLocations[0]?.id ?? null);
  const [keluar, setKeluar] = useState<DalamPerjalananRow[] | null>(null);
  const [masuk, setMasuk] = useState<DalamPerjalananRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (locationId === null) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([getDalamPerjalanan({ locationAsal: locationId }), getDalamPerjalanan({ locationTujuan: locationId })])
      .then(([keluarRows, masukRows]) => {
        if (!active) return;
        setKeluar(keluarRows);
        setMasuk(masukRows);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat transfer dalam perjalanan.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locationId]);

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Transfer dalam perjalanan</h2>
      <p className="mb-3 text-xs text-slate-500">
        Barang di sini sudah keluar dari lokasi asal tapi belum masuk stok lokasi manapun -- menunggu diterima. Filter lokasi di
        bawah terpisah dari filter tabel stok di atas.
      </p>

      <div className="mb-3">
        <LokasiPicker value={locationId} onChange={setLocationId} />
      </div>

      {loading ? <Spinner label="Memuat transfer..." /> : null}
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {!loading && !error ? (
        <div className="space-y-4">
          <DalamPerjalananTable title="Keluar dari lokasi ini" rows={keluar ?? []} items={items} />
          <DalamPerjalananTable title="Masuk ke lokasi ini" rows={masuk ?? []} items={items} />
        </div>
      ) : null}
    </Card>
  );
}

function DalamPerjalananTable({ title, rows, items }: { title: string; rows: DalamPerjalananRow[]; items: StokItem[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Tidak ada.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const item = items.find((i) => i.kode === row.itemKode);
            return (
              <div key={`${row.transferId}-${row.itemKode}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium text-slate-900">{item?.name ?? row.itemKode ?? "-"}</span>
                  <span className="text-slate-700">
                    {row.qtyKirim} {row.unit}
                  </span>
                </div>
                <div className="mt-0.5 flex justify-between text-xs text-slate-500">
                  <span>Transfer #{row.transferId}</span>
                  {row.nilai !== null ? <span>{formatRupiah(row.nilai)}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
