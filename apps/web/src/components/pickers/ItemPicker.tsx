import { useEffect, useMemo, useState } from "react";
import { listItems } from "../../api/master";
import type { MockItemRef } from "../../mock/referenceData";
import { Field, Input } from "../ui/Input";

/** Item aktif dengan kode terisi, dipetakan dari GET /items (API asli) ke bentuk
 * `MockItemRef` supaya pemanggil ItemPicker yang sudah ada (BarisEditor, form
 * transaksi) tidak perlu ikut berubah -- cuma sumber datanya yang diganti dari
 * data contoh statis ke data sungguhan. Item nonaktif/tanpa kode disaring di sini.
 * Diambil ulang setiap ItemPicker dipasang (tidak di-cache) supaya item yang baru
 * saja ditambahkan di Master Item langsung muncul tanpa perlu reload halaman. */
async function loadItemPool(): Promise<MockItemRef[]> {
  const items = await listItems();
  return items
    .filter((i): i is typeof i & { kode: string } => i.kode !== null && i.isActive)
    .map((i) => ({
      kode: i.kode,
      name: i.name,
      category: i.category ?? "",
      type: i.type,
      status: i.status,
      recipeUnit: i.recipeUnit,
      purchaseUnit: i.purchaseUnit,
      purchaseToRecipeFactor: i.purchaseToRecipeFactor,
      hargaMaster: i.hargaMaster ?? null,
      isActive: i.isActive,
      minStok: i.minStok,
    }));
}

export function ItemPicker({
  label = "Item",
  value,
  onSelect,
  allowedTypes,
  excludeKodes,
}: {
  label?: string;
  value: string | null;
  onSelect: (item: MockItemRef) => void;
  allowedTypes?: MockItemRef["type"][];
  excludeKodes?: string[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pool, setPool] = useState<MockItemRef[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadItemPool()
      .then((items) => {
        if (active) setPool(items);
      })
      .catch(() => {
        if (active) setLoadError("Gagal memuat daftar item.");
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = useMemo(() => pool.find((i) => i.kode === value) ?? null, [pool, value]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    let filteredPool = pool;
    if (allowedTypes) filteredPool = filteredPool.filter((i) => allowedTypes.includes(i.type));
    if (excludeKodes) filteredPool = filteredPool.filter((i) => !excludeKodes.includes(i.kode));
    if (!q) return filteredPool.slice(0, 20);
    return filteredPool.filter((i) => i.name.toLowerCase().includes(q) || i.kode.toLowerCase().includes(q)).slice(0, 20);
  }, [pool, query, allowedTypes, excludeKodes]);

  return (
    <Field label={label}>
      <div className="relative">
        <Input
          placeholder="Cari nama atau kode item..."
          value={open ? query : (selected ? `${selected.name} (${selected.kode})` : "")}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open ? (
          <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {loadError ? <p className="px-3 py-2 text-sm text-red-600">{loadError}</p> : null}
            {!loadError && results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-500">Tidak ada item yang cocok.</p>
            ) : (
              results.map((item) => (
                <button
                  key={item.kode}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(item);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-900">{item.name}</span>
                  <span className="text-xs text-slate-500">
                    {item.kode} &middot; {item.category} &middot; {item.recipeUnit}
                    {item.status === "pending_data" ? " · menunggu data" : ""}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </Field>
  );
}
