import { api } from "./client";
import type { MinStokEntry, MinStokResult, SetMinStokInput } from "./types";

/** Ambang stok minimum per item x lokasi (bukan lagi kolom min_stok level-item lama). */
export function getMinStok(locationId: number): Promise<MinStokEntry[]> {
  return api.get<MinStokEntry[]>(`/api/inventory/min-stok?location=${locationId}`);
}

export function setMinStok(input: SetMinStokInput): Promise<MinStokResult> {
  return api.put<MinStokResult>("/api/inventory/min-stok", input);
}
