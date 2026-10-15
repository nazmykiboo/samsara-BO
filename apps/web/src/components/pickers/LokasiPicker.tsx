import { useMemo } from "react";
import { useAuth } from "../../auth/AuthContext";
import { MOCK_LOKASI } from "../../mock/referenceData";
import { Field } from "../ui/Input";
import { Select } from "../ui/Select";

/** Lokasi yang boleh dipilih user ini -- dibatasi locationIds kalau bukan allLocations.
 * Di-memo-kan (bukan `.filter()` polos tiap render): untuk role non-allLocations
 * (supervisor/staf), `.filter()` tanpa memo mengembalikan array BARU tiap render,
 * yang bikin `visibleLocations`/efek fetch qty di StokPage.tsx yang bergantung ke
 * hasil hook ini re-run tiap render -- infinite loop fetch (dikonfirmasi lewat
 * network tab: ratusan ribu request GET /stok berulang, kolom qty macet "Memuat..."
 * selamanya). Role allLocations (owner/manajer_ops) tidak kena karena cabang itu
 * mengembalikan `MOCK_LOKASI` langsung, referensi konstanta modul yang stabil. */
export function useLokasiOptions() {
  const { user } = useAuth();
  return useMemo(() => {
    if (!user) return [];
    if (user.allLocations) return MOCK_LOKASI;
    return MOCK_LOKASI.filter((l) => user.locationIds.includes(l.id));
  }, [user]);
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
            {l.name} ({l.entitas})
          </option>
        ))}
      </Select>
    </Field>
  );
}
