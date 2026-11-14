import { api } from "./client";
import type { JenisTransaksiLedger, KartuStokBaris, LedgerBaris } from "./types";

/** GET /kartu-stok -- permission kartu_stok.lihat (owner/manajer_ops/supervisor; staf 403).
 * `item`/`lokasi`/`tanggalMulai`/`tanggalSelesai` WAJIB -- backend menolak 400 kalau kosong. */
export function getKartuStok(filter: {
  itemKode: string;
  locationId: number;
  tanggalMulai: string;
  tanggalSelesai: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: KartuStokBaris[]; total: number }> {
  const params = new URLSearchParams({
    item: filter.itemKode,
    lokasi: String(filter.locationId),
    tanggal_mulai: filter.tanggalMulai,
    tanggal_selesai: filter.tanggalSelesai,
  });
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter.offset !== undefined) params.set("offset", String(filter.offset));
  return api.get(`/api/inventory/kartu-stok?${params.toString()}`);
}

/** GET /riwayat-transaksi -- generalisasi GET /transaksi/penjualan ke SEMUA jenis, permission
 * sama dengan getKartuStok. `lokasi`/`jenis` opsional (kosong = tanpa filter tambahan, lokasi
 * tetap dibatasi ke lokasi user kalau bukan owner/manajer_ops, ditegakkan di domain layer). */
export function listRiwayatSemuaJenis(filter: {
  tanggalMulai: string;
  tanggalSelesai: string;
  locationId?: number;
  jenis?: JenisTransaksiLedger;
  limit?: number;
  offset?: number;
}): Promise<{ rows: LedgerBaris[]; total: number }> {
  const params = new URLSearchParams({ tanggal_mulai: filter.tanggalMulai, tanggal_selesai: filter.tanggalSelesai });
  if (filter.locationId !== undefined) params.set("lokasi", String(filter.locationId));
  if (filter.jenis !== undefined) params.set("jenis", filter.jenis);
  if (filter.limit !== undefined) params.set("limit", String(filter.limit));
  if (filter.offset !== undefined) params.set("offset", String(filter.offset));
  return api.get(`/api/inventory/riwayat-transaksi?${params.toString()}`);
}
