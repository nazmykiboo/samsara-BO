import jwt from "jsonwebtoken";
import type { StringValue } from "ms";
import type { AuthUser } from "./types.js";

function getJwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_JWT_SECRET belum diset di .env -- wajib diisi, tidak ada nilai default di kode (lihat .env.example).",
    );
  }
  return secret;
}

const TOKEN_TTL: StringValue = "12h";

/**
 * @param ttlOverride Dipakai HANYA oleh pemanggil internal (identitas
 *   `sistem_otomatis`, lihat `core/src/auth/types.ts` dan
 *   `modules/sales-sync/src/domain/otomatis.ts`) untuk token umur sangat
 *   pendek (~60 detik) -- token login manusia biasa SELALU pakai
 *   `TOKEN_TTL` default, jangan diubah di pemanggil lain.
 */
export function signAuthToken(user: AuthUser, ttlOverride?: StringValue): string {
  return jwt.sign(user, getJwtSecret(), { expiresIn: ttlOverride ?? TOKEN_TTL });
}

export function verifyAuthToken(token: string): AuthUser {
  return jwt.verify(token, getJwtSecret()) as AuthUser;
}
