import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Spinner } from "../../components/ui/Spinner";
import { BarisEditor, type BarisRow } from "../../components/BarisEditor";
import { ItemPicker } from "../../components/pickers/ItemPicker";
import {
  createResepProduksi,
  deactivateResepProduksi,
  getResepProduksiBaris,
  listResepProduksi,
  updateResepProduksi,
} from "../../api/master";
import { ApiError } from "../../api/client";
import { usePermission } from "../../auth/usePermission";
import type { ResepProduksiBarisItem, ResepProduksiListItem } from "../../api/types";

const BAHAN_TYPES: Array<"bahan_baku" | "packaging"> = ["bahan_baku", "packaging"];

/** Tooltip tombol yang dinonaktifkan -- backend `resep.edit` = owner/manajer_ops. */
const ALASAN_TIDAK_BOLEH_EDIT = "Hanya Owner dan Manajer Ops yang bisa mengubah resep.";

function toBarisRows(baris: ResepProduksiBarisItem[]): BarisRow[] {
  return baris
    .filter((b): b is ResepProduksiBarisItem & { bahanItemKode: string } => b.bahanItemKode !== null)
    .map((b) => ({
      itemKode: b.bahanItemKode,
      itemName: b.bahanItemName,
      qty: String(b.qty),
      unit: b.unit,
    }));
}

export function ResepProduksiTab() {
  // Digate eksplisit ke `resep.edit` (sebelumnya cuma mengandalkan gate route halaman Master).
  const bisaEditResep = usePermission("resep.edit");
  const [resepList, setResepList] = useState<ResepProduksiListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [selectedKode, setSelectedKode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    listResepProduksi()
      .then((res) => {
        if (active) setResepList(res);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : "Gagal memuat daftar resep produksi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadCounter]);

  function reload() {
    setReloadCounter((n) => n + 1);
  }

  const selected = resepList.find((r) => r.kode !== null && r.kode === selectedKode) ?? null;

  return (
    <div className="space-y-4">
      {loadError ? <ErrorBox>{loadError}</ErrorBox> : null}

      {bisaEditResep ? (
        <Button onClick={() => setCreating(true)} className="w-full">
          + Resep produksi baru
        </Button>
      ) : null}

      {loading ? <Spinner label="Memuat daftar resep produksi..." /> : null}

      <div className="space-y-2">
        {resepList.map((r) => (
          <button
            key={r.kode ?? r.outputItemName}
            onClick={() => (r.kode ? setSelectedKode(r.kode) : undefined)}
            disabled={!r.kode}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div>
              <p className="text-sm font-medium text-slate-900">
                {r.kode ?? "-"} -- {r.outputItemName} {!r.isActive ? <Badge tone="neutral">Nonaktif</Badge> : null}
              </p>
              <p className="text-xs text-slate-500">
                Yield: {r.yieldQty ?? "?"} {r.yieldUnit ?? ""}
              </p>
            </div>
            <span aria-hidden className="text-slate-400">
              ›
            </span>
          </button>
        ))}
        {!loading && resepList.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Belum ada resep produksi.</p>
        ) : null}
      </div>

      {selected && selected.kode ? (
        <ResepDetailSheet
          resep={{ ...selected, kode: selected.kode }}
          onClose={() => setSelectedKode(null)}
          onSaved={reload}
        />
      ) : null}
      {creating && bisaEditResep ? (
        <ResepCreateSheet
          onClose={() => setCreating(false)}
          onCreated={() => {
            reload();
            setCreating(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ResepDetailSheet({
  resep,
  onClose,
  onSaved,
}: {
  resep: ResepProduksiListItem & { kode: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  // Isi resep tetap boleh DILIHAT semua role yang bisa membuka halaman ini (penting untuk memahami
  // HPP), tapi tombol simpan dinonaktifkan + dijelaskan, dan "Nonaktifkan resep" disembunyikan.
  const bisaEditResep = usePermission("resep.edit");
  const [yieldQty, setYieldQty] = useState(resep.yieldQty?.toString() ?? "");
  const [yieldUnit, setYieldUnit] = useState(resep.yieldUnit ?? "");
  const [rows, setRows] = useState<BarisRow[]>([]);
  const [loadingBaris, setLoadingBaris] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  function loadBaris() {
    setLoadingBaris(true);
    setLoadError(null);
    getResepProduksiBaris(resep.kode)
      .then((res) => setRows(toBarisRows(res)))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "Gagal memuat bahan resep produksi."))
      .finally(() => setLoadingBaris(false));
  }

  useEffect(() => {
    loadBaris();
    // Hanya dipanggil ulang kalau resep yang dipilih berganti -- bukan setiap render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resep.kode]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (rows.some((r) => !r.qty || !r.unit)) {
      setError("Lengkapi qty dan satuan setiap bahan.");
      return;
    }
    setSaving(true);
    try {
      await updateResepProduksi(resep.kode, {
        yieldQty: yieldQty ? Number(yieldQty) : undefined,
        yieldUnit: yieldUnit || undefined,
        baris: rows.map((r) => ({ bahanItemKode: r.itemKode, qty: Number(r.qty), unit: r.unit })),
      });
      // Refetch dari server (bukan simpan `rows` yang baru dikirim) supaya tampilan
      // konsisten dengan apa yang SUNGGUHAN tersimpan.
      loadBaris();
      onSaved();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan perubahan resep.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await deactivateResepProduksi(resep.kode);
      onSaved();
      setConfirmingDeactivate(false);
      onClose();
    } catch (err) {
      setDeactivateError(err instanceof ApiError ? err.message : "Gagal menonaktifkan resep.");
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{resep.kode}</h2>
            <p className="text-xs text-slate-500">Output: {resep.outputItemName}</p>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Yield qty">
              <Input type="number" min={0} step="any" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
            </Field>
            <Field label="Yield unit">
              <Input value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">Bahan (harus bahan baku/packaging)</p>
            {loadingBaris ? <Spinner label="Memuat bahan resep..." /> : null}
            {loadError ? <ErrorBox>{loadError}</ErrorBox> : null}
            {!loadingBaris && !loadError ? (
              <BarisEditor rows={rows} onChange={setRows} allowedTypes={BAHAN_TYPES} />
            ) : null}
          </div>

          {error ? <ErrorBox>{error}</ErrorBox> : null}
          {success ? <ResultBox>Tersimpan.</ResultBox> : null}

          <Button
            type="submit"
            disabled={saving || loadingBaris || !bisaEditResep}
            title={bisaEditResep ? undefined : ALASAN_TIDAK_BOLEH_EDIT}
            className="w-full"
          >
            {saving ? "Menyimpan..." : "Simpan perubahan"}
          </Button>
          {!bisaEditResep ? <p className="text-xs text-slate-500">{ALASAN_TIDAK_BOLEH_EDIT}</p> : null}
        </form>

        {!resep.isActive ? (
          <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">Resep ini sudah nonaktif.</p>
        ) : bisaEditResep ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            {deactivateError ? (
              <div className="mb-3">
                <ErrorBox>{deactivateError}</ErrorBox>
              </div>
            ) : null}
            <Button variant="danger" className="w-full" onClick={() => setConfirmingDeactivate(true)}>
              Nonaktifkan resep
            </Button>
          </div>
        ) : null}
      </div>

      {confirmingDeactivate ? (
        <ConfirmDialog
          title="Nonaktifkan resep produksi?"
          message={`Resep "${resep.kode}" tidak akan bisa dipakai untuk produksi baru.`}
          danger
          loading={deactivating}
          onConfirm={handleDeactivate}
          onCancel={() => setConfirmingDeactivate(false)}
        />
      ) : null}
    </div>
  );
}

function ResepCreateSheet({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [kode, setKode] = useState("");
  const [outputItemKode, setOutputItemKode] = useState<string | null>(null);
  const [yieldQty, setYieldQty] = useState("");
  const [yieldUnit, setYieldUnit] = useState("");
  const [rows, setRows] = useState<BarisRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outputTypes = useMemo<Array<"setengah_jadi">>(() => ["setengah_jadi"], []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!kode.trim() || !outputItemKode) {
      setError("Kode resep dan item output wajib diisi.");
      return;
    }
    if (rows.length === 0 || rows.some((r) => !r.qty || !r.unit)) {
      setError("Tambahkan minimal 1 bahan dan lengkapi qty/satuannya.");
      return;
    }
    setSaving(true);
    try {
      await createResepProduksi({
        kode: kode.trim(),
        outputItemKode,
        yieldQty: yieldQty ? Number(yieldQty) : undefined,
        yieldUnit: yieldUnit || undefined,
        baris: rows.map((r) => ({ bahanItemKode: r.itemKode, qty: Number(r.qty), unit: r.unit })),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal membuat resep produksi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">Resep produksi baru</h2>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Kode resep">
            <Input value={kode} onChange={(e) => setKode(e.target.value)} placeholder="Misal: RP-013" required />
          </Field>

          <ItemPicker
            label="Item output (hasil produksi)"
            value={outputItemKode}
            allowedTypes={outputTypes}
            onSelect={(item) => setOutputItemKode(item.kode)}
          />

          <div className="grid grid-cols-2 gap-2">
            <Field label="Yield qty">
              <Input type="number" min={0} step="any" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
            </Field>
            <Field label="Yield unit">
              <Input value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} />
            </Field>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">Bahan (harus bahan baku/packaging)</p>
            <BarisEditor rows={rows} onChange={setRows} allowedTypes={BAHAN_TYPES} />
          </div>

          {error ? <ErrorBox>{error}</ErrorBox> : null}

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Menyimpan..." : "Buat resep"}
          </Button>
        </form>
      </div>
    </div>
  );
}
