import type { ApiErrorBody } from "./types";

const TOKEN_STORAGE_KEY = "samsara_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const message = (data as ApiErrorBody | null)?.error ?? `Permintaan gagal (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

/**
 * POST dengan body TEKS CSV MENTAH (`Content-Type: text/csv`) -- BUKAN JSON, BUKAN
 * multipart/FormData.
 *
 * `request()` di atas TIDAK bisa dipakai untuk ini: dia selalu `JSON.stringify(body)` dan
 * selalu memasang `Content-Type: application/json`. Endpoint import modul sales-sync
 * memasang `express.text({ type: "text/csv" })` khusus per-route di backend dan akan
 * menolak (400) kalau Content-Type-nya bukan `text/csv` -- lihat
 * `modules/sales-sync/module.json` § api.endpoints.
 *
 * Cara ambil token dan penanganan error-nya disamakan dengan `request()` supaya seluruh
 * app tetap menangkap `ApiError` yang sama (pesan dari field `error` response).
 */
export async function postCsv<T>(path: string, csvText: string): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "text/csv",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: csvText,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const message = (data as ApiErrorBody | null)?.error ?? `Permintaan gagal (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
