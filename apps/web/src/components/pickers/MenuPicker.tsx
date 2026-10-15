import { useEffect, useMemo, useState } from "react";
import { listMenu } from "../../api/master";
import type { MockMenuRef } from "../../mock/referenceData";
import { Field, Input } from "../ui/Input";

/** Menu aktif dengan kode terisi, dipetakan dari GET /menu (API asli) ke bentuk `MockMenuRef`
 * supaya pemanggil MenuPicker yang sudah ada (ResepMenuTab, PenjualanForm) tidak perlu ikut
 * berubah -- cuma sumber datanya yang diganti dari data contoh statis ke data sungguhan. Menu
 * nonaktif/tanpa kode disaring di sini (sama seperti pola ItemPicker). Diambil ulang setiap
 * MenuPicker dipasang (tidak di-cache) supaya menu baru langsung muncul tanpa reload halaman. */
async function loadMenuPool(): Promise<MockMenuRef[]> {
  const menu = await listMenu();
  return menu
    .filter((m): m is typeof m & { kode: string } => m.kode !== null && m.isActive)
    .map((m) => ({
      kode: m.kode,
      name: m.name,
      kategori: m.kategori ?? "",
      isActive: m.isActive,
    }));
}

export function MenuPicker({
  label = "Menu",
  value,
  onSelect,
  excludeKodes,
}: {
  label?: string;
  value: string | null;
  onSelect: (menu: MockMenuRef) => void;
  excludeKodes?: string[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pool, setPool] = useState<MockMenuRef[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadMenuPool()
      .then((menu) => {
        if (active) setPool(menu);
      })
      .catch(() => {
        if (active) setLoadError("Gagal memuat daftar menu.");
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = useMemo(() => pool.find((m) => m.kode === value) ?? null, [pool, value]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    let pool_ = pool;
    if (excludeKodes) pool_ = pool_.filter((m) => !excludeKodes.includes(m.kode));
    if (!q) return pool_.slice(0, 20);
    return pool_.filter((m) => m.name.toLowerCase().includes(q) || m.kode.toLowerCase().includes(q)).slice(0, 20);
  }, [pool, query, excludeKodes]);

  return (
    <Field label={label}>
      <div className="relative">
        <Input
          placeholder="Cari nama atau kode menu..."
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
              <p className="px-3 py-2 text-sm text-slate-500">Tidak ada menu yang cocok.</p>
            ) : (
              results.map((menu) => (
                <button
                  key={menu.kode}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect(menu);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="font-medium text-slate-900">{menu.name}</span>
                  <span className="text-xs text-slate-500">
                    {menu.kode} &middot; {menu.kategori}
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
