import { api } from "./client";
import type {
  AturanNotifikasi,
  CreateAturanNotifikasiInput,
  MulaiTautanTelegramResult,
  TautanTelegramStatus,
  UpdateAturanNotifikasiInput,
} from "./types";

/** Self-service, SEMUA role login -- "Hubungkan Telegram" di Akun Saya. */
export function mulaiTautanTelegram(): Promise<MulaiTautanTelegramResult> {
  return api.post<MulaiTautanTelegramResult>("/api/notifikasi/telegram/tautkan");
}

export function statusTautanTelegram(): Promise<TautanTelegramStatus> {
  return api.get<TautanTelegramStatus>("/api/notifikasi/telegram/status");
}

/** Owner saja (backend: permission `notifikasi.manage`) -- Pengaturan > Notifikasi. */
export function listAturanNotifikasi(): Promise<AturanNotifikasi[]> {
  return api.get<AturanNotifikasi[]>("/api/notifikasi/aturan");
}

export function createAturanNotifikasi(input: CreateAturanNotifikasiInput): Promise<{ id: number }> {
  return api.post<{ id: number }>("/api/notifikasi/aturan", input);
}

export function updateAturanNotifikasi(id: number, input: UpdateAturanNotifikasiInput): Promise<{ ok: true }> {
  return api.patch<{ ok: true }>(`/api/notifikasi/aturan/${id}`, input);
}

export function deleteAturanNotifikasi(id: number): Promise<{ ok: true }> {
  return api.delete<{ ok: true }>(`/api/notifikasi/aturan/${id}`);
}
