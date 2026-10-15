import { api } from "./client";
import type { HppMethod } from "./types";

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

export function createLokasi(input: { name: string; entitas: string }): Promise<{ id: string }> {
  return api.post("/api/inventory/lokasi", input);
}

export function updateLokasi(
  id: number,
  input: { name?: string; entitas?: string; isActive?: boolean },
): Promise<{ id: number }> {
  return api.patch(`/api/inventory/lokasi/${id}`, input);
}

export function createChannel(name: string): Promise<{ id: string }> {
  return api.post("/api/inventory/channel", { name });
}

export function updateChannel(id: number, input: { name?: string; isActive?: boolean }): Promise<{ id: number }> {
  return api.patch(`/api/inventory/channel/${id}`, input);
}
