import { api } from "./client";

/** GET/PUT /api/sales-sync/otomatis/pengaturan -- `tanggalMulai: null` berarti belum pernah diisi owner. */
export interface PengaturanOtomatis {
  aktif: boolean;
  tanggalMulai: string | null;
}

export function getPengaturanOtomatis(): Promise<PengaturanOtomatis> {
  return api.get<PengaturanOtomatis>("/api/sales-sync/otomatis/pengaturan");
}

/** Kirim HANYA field yang mau diubah -- field yang tidak disertakan TIDAK disentuh backend. */
export function setPengaturanOtomatis(input: { aktif?: boolean; tanggalMulai?: string | null }): Promise<PengaturanOtomatis> {
  return api.put<PengaturanOtomatis>("/api/sales-sync/otomatis/pengaturan", input);
}

export interface IdentitasOrder {
  platform: string;
  orderId: string;
  tanggal: string;
}

/** GET /api/sales-sync/otomatis/pratinjau?tanggal_mulai=... -- READ-ONLY, pola kategorisasi SAMA dengan POST /proses tapi tanpa efek samping. */
export interface HasilPratinjau {
  siapDiproses: IdentitasOrder[];
  dilewatiSebelumTanggalMulai: IdentitasOrder[];
  dilewatiBelumTerpetakan: IdentitasOrder[];
  perluDitinjau: IdentitasOrder[];
  channelTidakDikenal: IdentitasOrder[];
}

export function pratinjauProses(tanggalMulai: string): Promise<HasilPratinjau> {
  const params = new URLSearchParams({ tanggal_mulai: tanggalMulai });
  return api.get<HasilPratinjau>(`/api/sales-sync/otomatis/pratinjau?${params.toString()}`);
}

export interface OtomatisLogTerakhir {
  dipicuOleh: string;
  transaksiDibuat: number;
  barisDiproses: number;
  tertahan: number;
  perluDitinjau: number;
  gagal: number;
  pesanErrorTerakhir: string | null;
  dijalankanPada: string;
}

export interface ImporLogTerakhir {
  jenisImpor: string;
  dibuat: number;
  diperbarui: number;
  dilewati: number;
  jumlahError: number;
  contohPesanError: string | null;
  dijalankanPada: string;
}

/** GET /api/sales-sync/otomatis/status -- ringkasan dashboard halaman Sinkronisasi. `tertahan`/`perluDitinjau` null kalau tanggalMulai belum pernah diisi (beda makna dari 0). */
export interface StatusOtomatis {
  pengaturan: PengaturanOtomatis;
  otomatisTerakhir: OtomatisLogTerakhir | null;
  imporTerakhir: ImporLogTerakhir[];
  tertahan: number | null;
  perluDitinjau: number | null;
}

export function getStatusOtomatis(): Promise<StatusOtomatis> {
  return api.get<StatusOtomatis>("/api/sales-sync/otomatis/status");
}
