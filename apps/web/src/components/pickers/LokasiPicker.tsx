import { useMemo } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useLokasiContext } from "../../data/LokasiContext";
import { Field } from "../ui/Input";
import { Select } from "../ui/Select";

/** Bentuk yang dipakai SELURUH app lewat `useLokasiOptions()` -- `id: number`
 * (BUKAN string seperti `LokasiPublik.id` dari API/BIGINT) supaya konsumen
 * lama (perbandingan `l.id === locationFilter`, key berbasis angka, dst,
 * mis. di StokPage.tsx) tidak perlu diubah sama sekali -- ini PERSIS bentuk
 * `MockLokasi` lama sebelum Tahap 1 "Outlet & Kitchen", cuma sumbernya
 * sekarang live API bukan snapshot statis. */
export interface LokasiOption {
  id: number;
  name: string;
  entitas: string;
}

/** Lokasi AKTIF yang boleh dipilih user ini -- dibatasi locationIds kalau bukan
 * allLocations. Sumbernya `LokasiContext` (GET /api/core/lokasi, live) sejak
 * Tahap 1 "Outlet & Kitchen" -- SEBELUMNYA snapshot statis `MOCK_LOKASI` (2
 * baris hardcode), lihat docs/architecture-decisions.md.
 *
 * Di-memo-kan (bukan `.filter()` polos tiap render): untuk role non-allLocations
 * (supervisor/staf), `.filter()` tanpa memo mengembalikan array BARU tiap render,
 * yang bikin `visibleLocations`/efek fetch qty di StokPage.tsx yang bergantung ke
 * hasil hook ini re-run tiap render -- infinite loop fetch (dikonfirmasi lewat
 * network tab: ratusan ribu request GET /stok berulang, kolom qty macet "Memuat..."
 * selamanya). */
export function useLokasiOptions(): LokasiOption[] {
  const { user } = useAuth();
  const { lokasi } = useLokasiContext();
  return useMemo(() => {
    if (!user) return [];
    const aktif = lokasi.filter((l) => l.isActive).map((l) => ({ id: Number(l.id), name: l.name, entitas: l.entitas }));
    if (user.allLocations) return aktif;
    return aktif.filter((l) => user.locationIds.includes(l.id));
  }, [user, lokasi]);
}

export function LokasiPicker({
  value,
  onChange,
  label = "Lokasi",
}: {
  value: number | null;
  onChange: (locationId: number) => void;
  label?: string;
}) {
  const options = useLokasiOptions();

  return (
    <Field label={label}>
      <Select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))}>
        <option value="" disabled>
          Pilih lokasi...
        </option>
        {options.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
