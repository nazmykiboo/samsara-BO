import type { PoolClient } from "pg";

const MAX_CONSECUTIVE_FAILURES = 5;
const WINDOW_MINUTES = 15;

export type LoginMethod = "password" | "pin";

export async function recordLoginAttempt(
  client: PoolClient,
  input: { userId: number | null; username: string; method: LoginMethod; success: boolean },
): Promise<void> {
  await client.query(`INSERT INTO core_login_attempts (user_id, username, method, success) VALUES ($1, $2, $3, $4)`, [
    input.userId,
    input.username,
    input.method,
    input.success,
  ]);
}

/**
 * Terkunci kalau 5 percobaan TERAKHIR user ini (gabungan metode password
 * dan PIN -- lihat core_login_attempts.method) dalam 15 menit terakhir
 * SEMUANYA gagal. Sliding window murni dari query, sengaja tidak perlu
 * mekanisme "buka kunci" eksplisit: begitu ada satu percobaan sukses di
 * antara 5 terakhir, atau begitu lebih dari 15 menit berlalu, otomatis
 * tidak terkunci lagi tanpa ada state terpisah yang perlu direset.
 */
export async function isLockedOut(client: PoolClient, userId: number): Promise<boolean> {
  const { rows } = await client.query<{ success: boolean }>(
    `SELECT success FROM core_login_attempts
     WHERE user_id = $1 AND attempted_at > now() - make_interval(mins => $2::int)
     ORDER BY attempted_at DESC
     LIMIT $3`,
    [userId, WINDOW_MINUTES, MAX_CONSECUTIVE_FAILURES],
  );
  if (rows.length < MAX_CONSECUTIVE_FAILURES) return false;
  return rows.every((r) => r.success === false);
}
