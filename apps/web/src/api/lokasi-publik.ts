import { api } from "./client";
import type { LokasiPublik } from "./types";

/** GET /api/core/lokasi -- publik, tanpa login. Dipakai LokasiContext (lihat ../data/LokasiContext.tsx). */
export function listLokasiPublik(): Promise<LokasiPublik[]> {
  return api.get<LokasiPublik[]>("/api/core/lokasi");
}
