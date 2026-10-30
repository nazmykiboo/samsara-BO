import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { StatusPendingBadge, Badge } from "../../components/ui/Badge";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Spinner } from "../../components/ui/Spinner";
import { RefSelect } from "../../components/RefSelect";
import { usePermission } from "../../auth/usePermission";
import { createItem, updateItem, deactivateItem, listItems, type CreateItemInput } from "../../api/master";
import { createKategori, createSatuan, listKategori, listSatuan, updateKategori } from "../../api/referensi";
import { ApiError } from "../../api/client";
import type { ItemListItem, ItemType, RefItem } from "../../api/types";

const ITEM_TYPES: ItemType[] = ["bahan_baku", "packaging", "operasional", "setengah_jadi"];

/** Dipakai sebagai tooltip tombol yang dinonaktifkan -- supaya user paham ini soal wewenang,
 * bukan tombol rusak. Backend `master_item.edit` = owner/manajer_ops. */
const ALASAN_TIDAK_BOLEH_EDIT = "Hanya Owner dan Manajer Ops yang bisa mengubah data master item.";

interface RefListProps {
  kategoriList: RefItem[];
  satuanList: RefItem[];
  onCreateKategori: (name: string) => Promise<RefItem>;
  onCreateSatuan: (name: string) => Promise<RefItem>;
  /** Rename kategori item (2026-10-30) -- SENGAJA tidak ada setara untuk satuan, di luar cakupan. */
  onRenameKategori: (id: string | number, newName: string) => Promise<void>;
}

export function ItemTab() {
  // Halaman Master sendiri sudah dibatasi di level route (owner/manajer_ops), TAPI kontrol tulis di
  // sini sebelumnya tidak punya pengecekan permission sendiri sama sekali -- kalau nanti halaman ini
  // dibuka untuk role lain (mis. supervisor boleh LIHAT master), tombolnya ikut tampil dan pasti
  // ditolak API. Sekarang digate eksplisit ke `master_item.edit`.
  const bisaEditItem = usePermission("master_item.edit");
  const [items, setItems] = useState<ItemListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedKode, setSelectedKode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [kategoriList, setKategoriList] = useState<RefItem[]>([]);
  const [satuanList, setSatuanList] = useState<RefItem[]>([]);
  const [refError, setRefError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    listItems()
      .then((res) => {
        if (active) setItems(res);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : "Gagal memuat daftar item.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadCounter]);

  useEffect(() => {
    let active = true;
    Promise.all([listKategori(), listSatuan()])
      .then(([kategori, satuan]) => {
        if (!active) return;
        setKategoriList(kategori);
        setSatuanList(satuan);
      })
      .catch((err) => {
        if (active) setRefError(err instanceof ApiError ? err.message : "Gagal memuat master kategori/satuan.");
      });
    return () => {
      active = false;
    };
  }, []);

  function reload() {
    setReloadCounter((n) => n + 1);
  }

  async function handleCreateKategori(name: string): Promise<RefItem> {
    const res = await createKategori(name);
    const item: RefItem = { id: res.id, name, isActive: true };
    setKategoriList((prev) => [...prev, item]);
    return item;
  }

  async function handleCreateSatuan(name: string): Promise<RefItem> {
    const res = await createSatuan(name);
    const item: RefItem = { id: res.id, name, isActive: true };
    setSatuanList((prev) => [...prev, item]);
    return item;
  }

  async function handleRenameKategori(id: string | number, newName: string): Promise<void> {
    await updateKategori(String(id), { name: newName });
    setKategoriList((prev) => prev.map((k) => (k.id === id ? { ...k, name: newName } : k)));
    // Rename kategori bisa cascade ke `category` item lain (lihat updateKategori di backend) --
    // daftar item disegarkan supaya kartu/baris yang menampilkan kategori ikut sinkron.
    reload();
  }

  const refProps: RefListProps = {
    kategoriList,
    satuanList,
    onCreateKategori: handleCreateKategori,
    onCreateSatuan: handleCreateSatuan,
    onRenameKategori: handleRenameKategori,
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.kode ?? "").toLowerCase().includes(q) ||
        (i.category ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  const selected = items.find((i) => i.kode === selectedKode) ?? null;

  return (
    <div className="space-y-4">
      {loadError ? <ErrorBox>{loadError}</ErrorBox> : null}
      {refError ? <ErrorBox>{refError}</ErrorBox> : null}

      <div className="flex gap-2">
        <Input placeholder="Cari nama, kode, atau kategori..." value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1" />
        {bisaEditItem ? <Button onClick={() => setCreating(true)}>+ Item</Button> : null}
      </div>

      {loading ? <Spinner label="Memuat daftar item..." /> : null}

      <div className="space-y-2">
        {filtered.map((item) => (
          <button
            key={item.kode ?? item.name}
            onClick={() => setSelectedKode(item.kode)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-blue-300"
          >
            <div>
              <p className="text-sm font-medium text-slate-900">
                {item.name} {!item.isActive ? <Badge tone="neutral">Nonaktif</Badge> : null}
              </p>
              <p className="text-xs text-slate-500">
                {item.kode} &middot; {item.category ?? "-"} &middot; {item.type}
              </p>
            </div>
            {item.status === "pending_data" ? <StatusPendingBadge status="pending_data" /> : null}
          </button>
        ))}
        {!loading && filtered.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Tidak ada item yang cocok.</p> : null}
      </div>

      {selected ? <ItemDetailSheet item={selected} onClose={() => setSelectedKode(null)} onSaved={reload} {...refProps} /> : null}
      {creating && bisaEditItem ? (
        <ItemCreateSheet
          onClose={() => setCreating(false)}
          onCreated={() => {
            reload();
            setCreating(false);
          }}
          {...refProps}
        />
      ) : null}
    </div>
  );
}

function ItemDetailSheet({
  item,
  onClose,
  onSaved,
  kategoriList,
  satuanList,
  onCreateKategori,
  onRenameKategori,
  onCreateSatuan,
}: {
  item: ItemListItem;
  onClose: () => void;
  onSaved: () => void;
} & RefListProps) {
  // Detail item boleh DILIHAT (struktur datanya penting dipahami), tapi tombol simpan dinonaktifkan
  // dengan penjelasan kalau rolenya tidak berwenang. Nonaktifkan item (destruktif) disembunyikan total.
  const bisaEditItem = usePermission("master_item.edit");
  const kode = item.kode ?? "";
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? "");
  const [recipeUnit, setRecipeUnit] = useState(item.recipeUnit);
  const [purchaseUnit, setPurchaseUnit] = useState(item.purchaseUnit ?? "");
  const [purchaseToRecipeFactor, setPurchaseToRecipeFactor] = useState(item.purchaseToRecipeFactor?.toString() ?? "");
  const [hargaMaster, setHargaMaster] = useState(item.hargaMaster?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      await updateItem(kode, {
        name,
        category,
        recipeUnit,
        purchaseUnit: purchaseUnit || undefined,
        purchaseToRecipeFactor: purchaseToRecipeFactor ? Number(purchaseToRecipeFactor) : undefined,
        hargaMaster: hargaMaster ? Number(hargaMaster) : undefined,
      });
      onSaved();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan perubahan.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await deactivateItem(kode);
      onSaved();
      setConfirmingDeactivate(false);
      onClose();
    } catch (err) {
      setDeactivateError(err instanceof ApiError ? err.message : "Gagal menonaktifkan item.");
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
            <h2 className="text-base font-semibold text-slate-900">{item.name}</h2>
            <p className="text-xs text-slate-500">
              {item.kode} &middot; {item.type}
            </p>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Nama">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <RefSelect label="Kategori" options={kategoriList} value={category} onChange={setCategory} onCreate={onCreateKategori} onRename={onRenameKategori} />
          <div className="grid grid-cols-2 gap-2">
            <RefSelect label="Satuan resep" options={satuanList} value={recipeUnit} onChange={setRecipeUnit} onCreate={onCreateSatuan} required />
            <RefSelect label="Satuan beli" options={satuanList} value={purchaseUnit} onChange={setPurchaseUnit} onCreate={onCreateSatuan} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Konversi beli->resep">
              <Input type="number" min={0} step="any" value={purchaseToRecipeFactor} onChange={(e) => setPurchaseToRecipeFactor(e.target.value)} />
            </Field>
            <Field label="Harga master">
              <Input type="number" min={0} step="any" value={hargaMaster} onChange={(e) => setHargaMaster(e.target.value)} />
            </Field>
          </div>

          {error ? <ErrorBox>{error}</ErrorBox> : null}
          {success ? <ResultBox>Tersimpan.</ResultBox> : null}

          <Button
            type="submit"
            disabled={saving || !bisaEditItem}
            title={bisaEditItem ? undefined : ALASAN_TIDAK_BOLEH_EDIT}
            className="w-full"
          >
            {saving ? "Menyimpan..." : "Simpan perubahan"}
          </Button>
          {!bisaEditItem ? <p className="text-xs text-slate-500">{ALASAN_TIDAK_BOLEH_EDIT}</p> : null}
        </form>

        {!item.isActive ? (
          <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-500">Item ini sudah nonaktif.</p>
        ) : bisaEditItem ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            {deactivateError ? (
              <div className="mb-3">
                <ErrorBox>{deactivateError}</ErrorBox>
              </div>
            ) : null}
            <Button variant="danger" className="w-full" onClick={() => setConfirmingDeactivate(true)}>
              Nonaktifkan item
            </Button>
          </div>
        ) : null}
      </div>

      {confirmingDeactivate ? (
        <ConfirmDialog
          title="Nonaktifkan item?"
          message={`"${item.name}" tidak akan bisa dipakai di resep/transaksi baru. Ditolak otomatis kalau masih dipakai resep aktif.`}
          danger
          loading={deactivating}
          onConfirm={handleDeactivate}
          onCancel={() => setConfirmingDeactivate(false)}
        />
      ) : null}
    </div>
  );
}

function ItemCreateSheet({
  onClose,
  onCreated,
  kategoriList,
  satuanList,
  onCreateKategori,
  onRenameKategori,
  onCreateSatuan,
}: {
  onClose: () => void;
  onCreated: () => void;
} & RefListProps) {
  const [kode, setKode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<ItemType>("bahan_baku");
  const [category, setCategory] = useState("");
  const [recipeUnit, setRecipeUnit] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState("");
  const [purchaseToRecipeFactor, setPurchaseToRecipeFactor] = useState("");
  const [hargaMaster, setHargaMaster] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!kode.trim() || !name.trim() || !recipeUnit.trim()) {
      setError("Kode, nama, dan satuan resep wajib diisi.");
      return;
    }
    setSaving(true);
    const input: CreateItemInput = {
      kode: kode.trim(),
      name: name.trim(),
      type,
      recipeUnit: recipeUnit.trim(),
      category: category || undefined,
      purchaseUnit: purchaseUnit || undefined,
      purchaseToRecipeFactor: purchaseToRecipeFactor ? Number(purchaseToRecipeFactor) : undefined,
      hargaMaster: hargaMaster ? Number(hargaMaster) : undefined,
    };
    try {
      await createItem(input);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal membuat item.");
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
          <h2 className="text-base font-semibold text-slate-900">Tambah item baru</h2>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kode">
              <Input value={kode} onChange={(e) => setKode(e.target.value)} placeholder="Misal: BB-058" required />
            </Field>
            <Field label="Tipe">
              <Select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Nama (harus unik)">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <RefSelect label="Kategori" options={kategoriList} value={category} onChange={setCategory} onCreate={onCreateKategori} onRename={onRenameKategori} />
          <div className="grid grid-cols-2 gap-2">
            <RefSelect label="Satuan resep" options={satuanList} value={recipeUnit} onChange={setRecipeUnit} onCreate={onCreateSatuan} required />
            <RefSelect label="Satuan beli (opsional)" options={satuanList} value={purchaseUnit} onChange={setPurchaseUnit} onCreate={onCreateSatuan} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Konversi beli->resep">
              <Input type="number" min={0} step="any" value={purchaseToRecipeFactor} onChange={(e) => setPurchaseToRecipeFactor(e.target.value)} />
            </Field>
            <Field label="Harga master">
              <Input type="number" min={0} step="any" value={hargaMaster} onChange={(e) => setHargaMaster(e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            Kosongkan satuan beli/konversi/harga kalau datanya belum ada -- item akan berstatus "menunggu data" dan tidak memblokir modul lain.
          </p>

          {error ? <ErrorBox>{error}</ErrorBox> : null}

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Menyimpan..." : "Buat item"}
          </Button>
        </form>
      </div>
    </div>
  );
}
