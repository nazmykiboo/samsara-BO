import jwt from "jsonwebtoken";
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

const TOKEN_TTL = "12h";

export function signAuthToken(user: AuthUser): string {
  return jwt.sign(user, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

export function verifyAuthToken(token: string): AuthUser {
  return jwt.verify(token, getJwtSecret()) as AuthUser;
}
