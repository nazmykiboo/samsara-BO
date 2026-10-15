import { api } from "./client";
import type {
  BatchHapusHasil,
  BatchJadwalHasil,
  BatchJadwalInput,
  CreateJadwalShiftInput,
  CreatePengajuanLiburInput,
  CreatePengajuanLiburResult,
  CreateShiftTemplateInput,
  JadwalGridResponse,
  JadwalShiftListItem,
  JadwalShiftMutasiResult,
  KeputusanPengajuanLibur,
  OverridePengajuanLiburInput,
  OverridePengajuanLiburResult,
  PengajuanLiburKuota,
  PengajuanLiburListItem,
  SalinMingguJadwalInput,
  SalinMingguJadwalResult,
  ShiftTemplateListItem,
  UpdateJadwalShiftInput,
  UpdateShiftTemplateInput,
} from "./types";

export interface ListJadwalShiftParams {
  dari: string;
  sampai: string;
  /** Jangan dikirim untuk role supervisor/staf -- lihat catatan JadwalShiftListItem. */
  lokasiId?: number;
  /** Jangan dikirim untuk role supervisor/staf -- lihat catatan JadwalShiftListItem. */
  userId?: number;
}

export function listJadwalShift(params: ListJadwalShiftParams): Promise<JadwalShiftListItem[]> {
  const qs = new URLSearchParams();
  qs.set("dari", params.dari);
  qs.set("sampai", params.sampai);
  if (params.lokasiId !== undefined) qs.set("lokasiId", String(params.lokasiId));
  if (params.userId !== undefined) qs.set("userId", String(params.userId));
  return api.get<JadwalShiftListItem[]>(`/api/hr/jadwal-shift?${qs.toString()}`);
}

export function createJadwalShift(input: CreateJadwalShiftInput): Promise<JadwalShiftMutasiResult> {
  return api.post<JadwalShiftMutasiResult>("/api/hr/jadwal-shift", input);
}

export function updateJadwalShift(id: string, input: UpdateJadwalShiftInput): Promise<JadwalShiftMutasiResult> {
  return api.patch<JadwalShiftMutasiResult>(`/api/hr/jadwal-shift/${encodeURIComponent(id)}`, input);
}

export function deleteJadwalShift(id: string): Promise<{ id: string }> {
  return api.delete<{ id: string }>(`/api/hr/jadwal-shift/${encodeURIComponent(id)}`);
}

export interface GetJadwalGridParams {
  /** Wajib untuk owner/manajer_ops. Untuk supervisor/staf: boleh dikirim (lokasi sendiri) atau
   * dikosongkan -- backend otomatis memaksa ke lokasi mereka kalau beda/kosong. */
  lokasi?: number;
  /** Tanggal mana pun dalam minggu target (YYYY-MM-DD) -- backend menghitung Senin-Minggu dari ini. */
  minggu: string;
}

/** GET /api/hr/jadwal -- jadwal terstruktur grid (hari x shift) untuk 1 lokasi 1 minggu, dipakai
 * tampilan "siapa teman se-shift". Lihat catatan JadwalGridResponse. */
export function getJadwalGrid(params: GetJadwalGridParams): Promise<JadwalGridResponse> {
  const qs = new URLSearchParams();
  qs.set("minggu", params.minggu);
  if (params.lokasi !== undefined) qs.set("lokasi", String(params.lokasi));
  return api.get<JadwalGridResponse>(`/api/hr/jadwal?${qs.toString()}`);
}

/** POST /api/hr/jadwal/salin-minggu -- permission jadwal.manage (owner/manajer_ops). Idempoten:
 * baris yang sudah identik di minggu tujuan masuk hitungan `dilewati`, bukan error. */
export function salinMingguJadwal(input: SalinMingguJadwalInput): Promise<SalinMingguJadwalResult> {
  return api.post<SalinMingguJadwalResult>("/api/hr/jadwal/salin-minggu", input);
}

/** POST /api/hr/jadwal/batch -- jadwalkan BANYAK staf sekaligus ke satu tanggal + satu shift.
 * Permission jadwal.manage (sama seperti create/update/delete/salin-minggu).
 *
 * JANGAN andalkan try/catch untuk tahu item mana yang gagal: response SELALU HTTP 200 (lihat catatan
 * lengkap di BatchJadwalHasil), jadi promise ini TIDAK reject kalau sebagian item gagal. Baca array
 * hasilnya dan cek `success` tiap entri. */
export function batchCreateJadwalShift(input: BatchJadwalInput): Promise<BatchJadwalHasil[]> {
  return api.post<BatchJadwalHasil[]>("/api/hr/jadwal/batch", input);
}

/** POST /api/hr/jadwal/batch-hapus -- hapus banyak baris jadwal sekaligus. Permission jadwal.manage.
 * Pola response sama dengan batchCreateJadwalShift (selalu 200, cek `success` per entri). */
export function batchDeleteJadwalShift(ids: number[]): Promise<BatchHapusHasil[]> {
  return api.post<BatchHapusHasil[]>("/api/hr/jadwal/batch-hapus", { ids });
}

export interface ListPengajuanLiburParams {
  status?: string;
  /** Jangan dikirim untuk role supervisor/staf -- lihat catatan PengajuanLiburListItem. */
  userId?: number;
}

export function listPengajuanLibur(params: ListPengajuanLiburParams = {}): Promise<PengajuanLiburListItem[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.userId !== undefined) qs.set("userId", String(params.userId));
  const query = qs.toString();
  return api.get<PengajuanLiburListItem[]>(`/api/hr/pengajuan-libur${query ? `?${query}` : ""}`);
}

export function createPengajuanLibur(input: CreatePengajuanLiburInput): Promise<CreatePengajuanLiburResult> {
  return api.post<CreatePengajuanLiburResult>("/api/hr/pengajuan-libur", input);
}

/** POST /api/hr/pengajuan-libur/override -- permission pengajuan_libur.approve (owner/manajer_ops).
 * Jalur darurat: cuti untuk staf LAIN, langsung DISETUJUI dan menembus H-2. Lihat catatan
 * OverridePengajuanLiburInput untuk kondisi yang tetap DITOLAK backend (tampilkan err.message apa adanya). */
export function overridePengajuanLibur(input: OverridePengajuanLiburInput): Promise<OverridePengajuanLiburResult> {
  return api.post<OverridePengajuanLiburResult>("/api/hr/pengajuan-libur/override", input);
}

export function putuskanPengajuanLibur(id: string, keputusan: KeputusanPengajuanLibur): Promise<{ id: string }> {
  return api.patch<{ id: string }>(`/api/hr/pengajuan-libur/${encodeURIComponent(id)}/keputusan`, { keputusan });
}

/** GET /api/hr/pengajuan-libur/kuota -- sisa kuota cuti bulan ini untuk user yang login (semua role,
 * tidak ada parameter, selalu untuk diri sendiri). */
export function getPengajuanLiburKuota(): Promise<PengajuanLiburKuota> {
  return api.get<PengajuanLiburKuota>("/api/hr/pengajuan-libur/kuota");
}

/** GET /api/hr/shift-template -- owner/manajer_ops saja. SEMUA shift template (aktif & nonaktif) --
 * filter di sisi UI kalau cuma butuh yang aktif. */
export function listShiftTemplate(): Promise<ShiftTemplateListItem[]> {
  return api.get<ShiftTemplateListItem[]>("/api/hr/shift-template");
}

export function createShiftTemplate(input: CreateShiftTemplateInput): Promise<{ id: string }> {
  return api.post<{ id: string }>("/api/hr/shift-template", input);
}

export function updateShiftTemplate(id: string, input: UpdateShiftTemplateInput): Promise<{ id: string }> {
  return api.patch<{ id: string }>(`/api/hr/shift-template/${encodeURIComponent(id)}`, input);
}
