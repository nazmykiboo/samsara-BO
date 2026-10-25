import { api, putFile } from "./client";
import type { IdentitasBisnis } from "./types";

/** GET /api/core/identitas-bisnis -- publik, tanpa login (dipakai sidebar/judul tab/halaman login). */
export function getIdentitasBisnis(): Promise<IdentitasBisnis> {
  return api.get<IdentitasBisnis>("/api/core/identitas-bisnis");
}

/** URL logo -- GET publik, 404 kalau belum pernah diunggah (lihat `hasLogo` di getIdentitasBisnis). */
export const LOGO_URL = "/api/core/identitas-bisnis/logo";

export function setIdentitasBisnisNama(displayName: string): Promise<IdentitasBisnis> {
  return api.put<IdentitasBisnis>("/api/core/identitas-bisnis", { displayName });
}

/** PNG/JPG/WebP, maksimal 500KB -- validasi ulang juga di backend, lihat core/src/business-identity/identity.ts. */
export function setIdentitasBisnisLogo(file: File): Promise<{ ok: true }> {
  return putFile<{ ok: true }>(`${LOGO_URL}`, file);
}
