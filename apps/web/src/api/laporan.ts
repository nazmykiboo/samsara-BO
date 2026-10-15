import { api } from "./client";
import type { DetailTransaksiPenjualanBaris, DetailTransaksiPenjualanFilter, LaporanHarian } from "./types";

/** GET /laporan/harian?lokasi=&tanggal= -- permission owner/manajer_ops/supervisor saja (staf
 * tidak bisa akses, lihat module.json). `perluDibeli` di hasil SELALU kondisi Central Kitchen
 * saat ini, independen dari `lokasi`/`tanggal` yang dikirim di sini -- lihat domain/laporan.ts. */
export function getLaporanHarian(input: { lokasi: number; tanggal: string }): Promise<LaporanHarian> {
  const params = new URLSearchParams({ lokasi: String(input.lokasi), tanggal: input.tanggal });
  return api.get<LaporanHarian>(`/api/inventory/laporan/harian?${params.toString()}`);
}

/** GET /transaksi/penjualan -- riwayat penjualan per BARIS menu, permission sama dengan
 * getLaporanHarian (owner/manajer_ops/supervisor; staf tidak boleh).
 *
 * Filter yang kosong SENGAJA tidak dikirim sama sekali (bukan dikirim sebagai string kosong),
 * supaya backend memakai default-nya sendiri: rentang 30 hari terakhir, dan lingkup lokasi
 * otomatis untuk role yang terbatas lokasi. */
export function listDetailTransaksiPenjualan(
  filter: DetailTransaksiPenjualanFilter = {},
): Promise<DetailTransaksiPenjualanBaris[]> {
  const params = new URLSearchParams();
  if (filter.tanggalMulai) params.set("tanggal_mulai", filter.tanggalMulai);
  if (filter.tanggalSelesai) params.set("tanggal_selesai", filter.tanggalSelesai);
  if (filter.channel) params.set("channel", filter.channel);
  if (filter.kodeMenu) params.set("kode_menu", filter.kodeMenu);
  if (filter.lokasiId !== undefined) params.set("lokasi", String(filter.lokasiId));
  const query = params.toString();
  return api.get<DetailTransaksiPenjualanBaris[]>(
    `/api/inventory/transaksi/penjualan${query ? `?${query}` : ""}`,
  );
}
