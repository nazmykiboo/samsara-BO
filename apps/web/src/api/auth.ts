import { api } from "./client";
import type {
  CreateUserInput,
  CreateUserResult,
  LoginResponse,
  ResetCredentialResult,
  StafOption,
  UpdateUserInput,
  UpdateUserResult,
  UserListItem,
} from "./types";

export function login(username: string, password: string): Promise<LoginResponse> {
  return api.post<LoginResponse>("/api/auth/login", { username, password });
}

/** POST /api/auth/login-pin -- publik, dipanggil SEBELUM login (tidak butuh Authorization).
 * userId string (lihat catatan StafOption.id) -- dikirim apa adanya, backend terima string/number. */
export function loginPin(userId: string, pin: string): Promise<LoginResponse> {
  return api.post<LoginResponse>("/api/auth/login-pin", { userId, pin });
}

/** GET /api/auth/staf?lokasi=<id> -- publik, untuk langkah "pilih nama" di Login Tim. */
export function listStafAtLocation(locationId: number): Promise<StafOption[]> {
  return api.get<StafOption[]>(`/api/auth/staf?lokasi=${locationId}`);
}

export function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  return api.post<CreateUserResult>("/api/auth/users", input);
}

export function listUsers(): Promise<UserListItem[]> {
  return api.get<UserListItem[]>("/api/auth/users");
}

export function updateUser(id: string, input: UpdateUserInput): Promise<UpdateUserResult> {
  return api.patch<UpdateUserResult>(`/api/auth/users/${id}`, input);
}

/** Ganti kredensial user total (PIN baru untuk staf, password baru untuk role lain) -- lama langsung tidak
 * berlaku. Kosongkan `input` (atau field di dalamnya) untuk auto-generate CSPRNG seperti sebelumnya, ATAU
 * isi `pinManual`/`passwordManual` untuk ketik sendiri (2026-10-30) -- validasi pola lemah/panjang di backend,
 * pesan error `ApiError.message` sudah rapi Bahasa Indonesia. Kredensial hasil reset (manual MAUPUN otomatis)
 * SELALU memaksa user itu ganti sendiri lewat layar "Buat kredensial baru" di percobaan akses berikutnya. */
export function resetUserCredential(
  id: string,
  input?: { pinManual?: string; passwordManual?: string },
): Promise<ResetCredentialResult> {
  return api.post<ResetCredentialResult>(`/api/auth/users/${id}/reset`, input);
}

/** Ganti kredensial MILIK SENDIRI (2026-10-30) -- wajib tahu kredensial lama (beda dari resetUserCredential
 * yang dipanggil OWNER tanpa perlu tahu kredensial korban). Balas token+user BARU langsung (tidak perlu
 * login ulang manual). Rate-limit 5x/15menit sama seperti login -- percobaan gagal dihitung di sini juga. */
export function gantiKredensialSendiri(kredensialLama: string, kredensialBaru: string): Promise<LoginResponse> {
  return api.post<LoginResponse>("/api/auth/ganti-kredensial", { kredensialLama, kredensialBaru });
}
