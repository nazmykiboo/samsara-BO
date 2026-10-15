import { api } from "./client";
import type { DalamPerjalananRow, StokResponse } from "./types";

export function getStok(itemKode: string, locationId: number): Promise<StokResponse> {
  return api.get<StokResponse>(`/api/inventory/stok?item=${encodeURIComponent(itemKode)}&location=${locationId}`);
}

export function getDalamPerjalanan(filter: { locationAsal?: number; locationTujuan?: number } = {}): Promise<
  DalamPerjalananRow[]
> {
  const params = new URLSearchParams();
  if (filter.locationAsal !== undefined) params.set("locationAsal", String(filter.locationAsal));
  if (filter.locationTujuan !== undefined) params.set("locationTujuan", String(filter.locationTujuan));
  const qs = params.toString();
  return api.get<DalamPerjalananRow[]>(`/api/inventory/transaksi/transfer/dalam-perjalanan${qs ? `?${qs}` : ""}`);
}
