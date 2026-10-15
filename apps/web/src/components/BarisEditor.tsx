import { ItemPicker } from "./pickers/ItemPicker";
import { Field, Input } from "./ui/Input";
import type { MockItemRef } from "../mock/referenceData";

export interface BarisRow {
  itemKode: string;
  itemName: string;
  qty: string;
  unit: string;
}

/** Editor baris {item, qty, unit} generik -- dipakai untuk resep produksi maupun resep menu. */
export function BarisEditor({
  rows,
  onChange,
  allowedTypes,
  itemLabel = "Tambah bahan",
}: {
  rows: BarisRow[];
  onChange: (rows: BarisRow[]) => void;
  allowedTypes?: MockItemRef["type"][];
  itemLabel?: string;
}) {
  function addItem(item: MockItemRef) {
    if (rows.some((r) => r.itemKode === item.kode)) return;
    onChange([...rows, { itemKode: item.kode, itemName: item.name, qty: "", unit: item.recipeUnit }]);
  }

  function updateRow(kode: string, patch: Partial<BarisRow>) {
    onChange(rows.map((r) => (r.itemKode === kode ? { ...r, ...patch } : r)));
  }

  function removeRow(kode: string) {
    onChange(rows.filter((r) => r.itemKode !== kode));
  }

  return (
    <div>
      <ItemPicker label={itemLabel} value={null} onSelect={addItem} allowedTypes={allowedTypes} excludeKodes={rows.map((r) => r.itemKode)} />

      <div className="mt-3 space-y-3">
        {rows.map((r) => (
          <div key={r.itemKode} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-slate-900">{r.itemName}</p>
              <button type="button" onClick={() => removeRow(r.itemKode)} className="text-slate-400 hover:text-red-600">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Qty">
                <Input type="number" min={0} step="any" value={r.qty} onChange={(e) => updateRow(r.itemKode, { qty: e.target.value })} />
              </Field>
              <Field label="Satuan">
                <Input value={r.unit} onChange={(e) => updateRow(r.itemKode, { unit: e.target.value })} />
              </Field>
            </div>
          </div>
        ))}
        {rows.length === 0 ? <p className="mt-2 text-sm text-slate-500">Belum ada bahan ditambahkan.</p> : null}
      </div>
    </div>
  );
}
