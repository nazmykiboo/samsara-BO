import { api } from "./client";
import type { AnalitikFilter, AnalitikOperasional, AnalitikPenjualan } from "./types";

/** Filter yang kosong SENGAJA tidak dikirim sama sekali (bukan dikirim sebagai string kosong),
 * supaya backend memakai default-nya sendiri: `periode` kosong = minggu hari ini menurut
 * CURRENT_DATE database (timezone Asia/Jakarta, jangan dihitung ulang di browser), `lokasi`
 * kosong = agregat semua lokasi. Pola sama dengan listDetailTransaksiPenjualan di ./laporan.ts. */
function buatQuery(filter: AnalitikFilter): string {
  const params = new URLSearchParams();
  if (filter.periode) params.set("periode", filter.periode);
  if (filter.lokasi !== null && filter.lokasi !== undefined) params.set("lokasi", String(filter.lokasi));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** GET /analitik/penjualan -- permission `analitik.lihat` (owner/manajer_ops saja). */
export function getAnalitikPenjualan(filter: AnalitikFilter = {}): Promise<AnalitikPenjualan> {
  return api.get<AnalitikPenjualan>(`/api/inventory/analitik/penjualan${buatQuery(filter)}`);
}

/** GET /analitik/operasional -- permission sama dengan getAnalitikPenjualan.
 *
 * Catatan: `lokasi` di filter TIDAK berlaku untuk `transferSusutTren` di response (lihat
 * AnalitikOperasional di ./types.ts) -- itu perilaku backend yang disengaja, bukan bug. */
export function getAnalitikOperasional(filter: AnalitikFilter = {}): Promise<AnalitikOperasional> {
  return api.get<AnalitikOperasional>(`/api/inventory/analitik/operasional${buatQuery(filter)}`);
}
