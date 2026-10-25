import { api } from "./client";
import type {
  KatalogItem,
  RiwayatHargaItem,
  SupplierLamaItem,
  Vendor,
  VendorInput,
  VendorUntukItem,
} from "./types";

export function listVendor(cari?: string): Promise<Vendor[]> {
  return api.get(`/api/inventory/vendor${cari ? `?cari=${encodeURIComponent(cari)}` : ""}`);
}

export function createVendor(input: VendorInput): Promise<{ id: number }> {
  return api.post("/api/inventory/vendor", input);
}

export function updateVendor(
  id: number,
  input: Partial<VendorInput> & { isActive?: boolean },
): Promise<{ id: number }> {
  return api.patch(`/api/inventory/vendor/${id}`, input);
}

export function listKatalogByVendor(vendorId: number): Promise<KatalogItem[]> {
  return api.get(`/api/inventory/vendor/${vendorId}/katalog`);
}

export function catatHargaKatalog(vendorId: number, itemKode: string, harga: number): Promise<{ vendorId: number; itemKode: string }> {
  return api.post(`/api/inventory/vendor/${vendorId}/katalog`, { itemKode, harga });
}

export function listVendorUntukItem(itemKode: string): Promise<VendorUntukItem[]> {
  return api.get(`/api/inventory/vendor/untuk-item/${encodeURIComponent(itemKode)}`);
}

export function getHargaTerakhir(vendorId: number, itemKode: string): Promise<{ hargaTerakhir: number | null }> {
  return api.get(`/api/inventory/vendor/${vendorId}/item/${encodeURIComponent(itemKode)}/harga-terakhir`);
}

export function listRiwayatHarga(vendorId: number, itemKode: string): Promise<RiwayatHargaItem[]> {
  return api.get(`/api/inventory/vendor/${vendorId}/item/${encodeURIComponent(itemKode)}/riwayat-harga`);
}

export function laporkanSupplierLama(): Promise<SupplierLamaItem[]> {
  return api.get("/api/inventory/vendor/laporan-supplier-lama");
}

export function getAmbangKenaikanHarga(): Promise<{ persen: number }> {
  return api.get("/api/inventory/vendor/ambang-kenaikan-harga");
}
