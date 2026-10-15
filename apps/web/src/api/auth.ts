import { api } from "./client";
import type {
  CreateUserInput,
  CreateUserResult,
  LoginResponse,
  ResetCredentialResult,
  StafOption,
  UpdateUserInput,
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

export function updateUser(id: string, input: UpdateUserInput): Promise<{ id: string }> {
  return api.patch<{ id: string }>(`/api/auth/users/${id}`, input);
}

/** Ganti kredensial user total (PIN baru untuk staf, password baru untuk role lain) -- lama langsung tidak berlaku. */
export function resetUserCredential(id: string): Promise<ResetCredentialResult> {
  return api.post<ResetCredentialResult>(`/api/auth/users/${id}/reset`);
}
