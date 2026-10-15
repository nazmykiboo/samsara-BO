import { useState } from "react";
import { Field, Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Button } from "./ui/Button";
import { ApiError } from "../api/client";
import type { RefItem } from "../api/types";

const ADD_NEW_VALUE = "__tambah_baru__";

/**
 * Dropdown untuk field yang sekarang divalidasi ke master (kategori/satuan)
 * -- lihat modules/inventory/src/domain/referensi.ts. Selalu menyertakan
 * `value` saat ini di daftar opsi (walau kebetulan nonaktif) supaya form
 * edit item lama tidak "kehilangan" nilainya. Punya opsi "+ Tambah baru"
 * bawaan supaya owner/manajer_ops tidak buntu kalau butuh kategori/satuan
 * yang belum ada di master -- tanpa ini, validasi server-side yang baru
 * malah bikin mereka tidak bisa nambah nilai baru sama sekali.
 */
export function RefSelect({
  label,
  options,
  value,
  onChange,
  onCreate,
  placeholder = "Pilih...",
  required,
}: {
  label: string;
  options: RefItem[];
  value: string;
  onChange: (name: string) => void;
  onCreate: (name: string) => Promise<RefItem>;
  placeholder?: string;
  required?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleOptions = options.some((o) => o.name === value)
    ? options
    : value
      ? [...options, { id: "current", name: value, isActive: true }]
      : options;

  async function handleCreate() {
    setError(null);
    const trimmed = newName.trim();
    if (!trimmed) {
      setError("Nama wajib diisi.");
      return;
    }
    setCreating(true);
    try {
      const created = await onCreate(trimmed);
      onChange(created.name);
      setAdding(false);
      setNewName("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menambah.");
    } finally {
      setCreating(false);
    }
  }

  if (adding) {
    return (
      <Field label={label}>
        <div className="flex gap-2">
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nama baru..."
            className="flex-1"
          />
          <Button type="button" onClick={handleCreate} disabled={creating}>
            {creating ? "..." : "Tambah"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setAdding(false);
              setNewName("");
              setError(null);
            }}
          >
            Batal
          </Button>
        </div>
        {error ? <span className="mt-1 block text-sm text-red-600">{error}</span> : null}
      </Field>
    );
  }

  return (
    <Field label={label}>
      <Select
        value={value}
        required={required}
        onChange={(e) => {
          if (e.target.value === ADD_NEW_VALUE) {
            setAdding(true);
            return;
          }
          onChange(e.target.value);
        }}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {visibleOptions
          .filter((o) => o.isActive || o.name === value)
          .map((o) => (
            <option key={o.id} value={o.name}>
              {o.name}
            </option>
          ))}
        <option value={ADD_NEW_VALUE}>+ Tambah baru...</option>
      </Select>
    </Field>
  );
}
