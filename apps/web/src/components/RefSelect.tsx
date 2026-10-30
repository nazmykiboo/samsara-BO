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
  onRename,
  placeholder = "Pilih...",
  required,
}: {
  label: string;
  options: RefItem[];
  value: string;
  onChange: (name: string) => void;
  onCreate: (name: string) => Promise<RefItem>;
  /** Opsional -- kalau diberikan, muncul tombol "Ubah nama" untuk opsi yang SEDANG
   * terpilih (2026-10-30, dipakai kategori item -- SENGAJA tidak dipasang untuk
   * satuan, di luar cakupan rename). Dipanggil dengan id opsi terpilih + nama baru. */
  onRename?: (id: string | number, newName: string) => Promise<void>;
  placeholder?: string;
  required?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const visibleOptions = options.some((o) => o.name === value)
    ? options
    : value
      ? [...options, { id: "current", name: value, isActive: true }]
      : options;

  const selectedOption = visibleOptions.find((o) => o.name === value);

  async function handleRename() {
    if (!selectedOption) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Nama tidak boleh kosong.");
      return;
    }
    setSavingRename(true);
    setRenameError(null);
    try {
      await onRename?.(selectedOption.id, trimmed);
      onChange(trimmed);
      setRenaming(false);
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : "Gagal mengubah nama.");
    } finally {
      setSavingRename(false);
    }
  }

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

  if (renaming && selectedOption) {
    return (
      <Field label={label}>
        <div className="flex gap-2">
          <Input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Nama baru..."
            className="flex-1"
          />
          <Button type="button" onClick={handleRename} disabled={savingRename}>
            {savingRename ? "..." : "Simpan"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setRenaming(false);
              setRenameError(null);
            }}
          >
            Batal
          </Button>
        </div>
        {renameError ? <span className="mt-1 block text-sm text-red-600">{renameError}</span> : null}
      </Field>
    );
  }

  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Select
          value={value}
          required={required}
          className="flex-1"
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
        {onRename && selectedOption ? (
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 px-2 text-xs"
            onClick={() => {
              setRenameValue(selectedOption.name);
              setRenameError(null);
              setRenaming(true);
            }}
          >
            Ubah nama
          </Button>
        ) : null}
      </div>
    </Field>
  );
}
