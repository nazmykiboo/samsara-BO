import { api } from "./client";
import type { RefItem } from "./types";

export function listKategori(): Promise<RefItem[]> {
  return api.get("/api/inventory/kategori");
}

export function createKategori(name: string): Promise<{ id: string }> {
  return api.post("/api/inventory/kategori", { name });
}

export function updateKategori(id: string, input: { name?: string; isActive?: boolean }): Promise<{ id: string }> {
  return api.patch(`/api/inventory/kategori/${id}`, input);
}

export function listSatuan(): Promise<RefItem[]> {
  return api.get("/api/inventory/satuan");
}

export function createSatuan(name: string): Promise<{ id: string }> {
  return api.post("/api/inventory/satuan", { name });
}

export function updateSatuan(id: string, input: { name?: string; isActive?: boolean }): Promise<{ id: string }> {
  return api.patch(`/api/inventory/satuan/${id}`, input);
}
