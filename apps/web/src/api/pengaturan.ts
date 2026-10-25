import { ApiError, api } from "./client";
import type { HppMethod, LokasiDetailInput, LokasiLengkap, LokasiPenolakanNonaktif } from "./types";

export class LokasiTidakBisaNonaktifError extends Error {
  constructor(public readonly penghalang: string[]) {
    super(`Lokasi tidak bisa dinonaktifkan: ${penghalang.join("; ")}`);
  }
}

export function getHppMetodeDefault(): Promise<{ metode: HppMethod }> {
  return api.get("/api/inventory/pengaturan/hpp-metode");
}

export function setHppMetodeDefault(metode: HppMethod): Promise<{ metode: HppMethod }> {
  return api.patch("/api/inventory/pengaturan/hpp-metode", { metode });
}

export function getTargetFoodCostPersen(): Promise<{ targetFoodCostPersen: number }> {
  return api.get("/api/inventory/pengaturan/target-food-cost");
}

export function setTargetFoodCostPersen(targetFoodCostPersen: number): Promise<{ targetFoodCostPersen: number }> {
  return api.patch("/api/inventory/pengaturan/target-food-cost", { targetFoodCostPersen });
}

export function listLokasiLengkap(): Promise<LokasiLengkap[]> {
  return api.get("/api/inventory/lokasi");
}

export function createLokasi(
  input: { name: string; entitas: string } & LokasiDetailInput,
): Promise<{ id: string }> {
  return api.post("/api/inventory/lokasi", input);
}

/**
 * Lempar `LokasiTidakBisaNonaktifError` (bukan `ApiError` mentah) kalau
 * backend menolak nonaktifkan karena masih ada penghalang -- pemanggil cuma
 * perlu `catch (err) { if (err instanceof LokasiTidakBisaNonaktifError) ... }`
 * tanpa perlu tahu bentuk body error mentahnya.
 */
export async function updateLokasi(
  id: number,
  input: { name?: string; entitas?: string; isActive?: boolean } & LokasiDetailInput,
): Promise<{ id: number }> {
  try {
    return await api.patch(`/api/inventory/lokasi/${id}`, input);
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      const body = err.body as Partial<LokasiPenolakanNonaktif> | null;
      if (body?.penghalang) throw new LokasiTidakBisaNonaktifError(body.penghalang);
    }
    throw err;
  }
}

export function salinKonfigurasiLokasi(dariLocationId: number, keLocationId: number): Promise<void> {
  return api.post("/api/inventory/lokasi/salin-konfigurasi", { dariLocationId, keLocationId });
}

export function createChannel(name: string): Promise<{ id: string }> {
  return api.post("/api/inventory/channel", { name });
}

export function updateChannel(id: number, input: { name?: string; isActive?: boolean }): Promise<{ id: number }> {
  return api.patch(`/api/inventory/channel/${id}`, input);
}
