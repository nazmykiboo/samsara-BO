import type { PoolClient } from "pg";
import type { Role } from "../auth/types.js";

export interface PenerimaResolved {
  userId: number;
  username: string;
  role: Role;
  telegramChatId: string | null;
}

/**
 * Resolusi penerima SATU baris aturan menjadi daftar user nyata.
 * - `penerimaUserId` diisi -> SATU user itu saja (kalau aktif).
 * - Selain itu, `penerimaRole` dicocokkan ke semua user AKTIF dengan role
 *   itu; kalau `penerimaLokasiId` (aturan) DAN `eventLokasiId` (kejadian)
 *   dua-duanya terisi, user juga HARUS ditugaskan ke lokasi itu (`core_user_lokasi`)
 *   DAN kejadian harus terjadi di lokasi yang sama (dicek oleh notify.ts,
 *   bukan di sini) -- fungsi ini murni resolusi SET USER untuk satu aturan,
 *   pencocokan lokasi kejadian vs aturan tetap tanggung jawab pemanggil.
 */
export async function resolveNotifikasiPenerima(
  client: PoolClient,
  aturan: { penerimaRole: Role | null; penerimaUserId: number | null; penerimaLokasiId: number | null },
): Promise<PenerimaResolved[]> {
  if (aturan.penerimaUserId !== null) {
    const { rows } = await client.query<{ id: string; username: string; role: Role; telegram_chat_id: string | null }>(
      `SELECT u.id, u.username, r.name AS role, u.telegram_chat_id
       FROM core_users u JOIN core_roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.is_active = true`,
      [aturan.penerimaUserId],
    );
    return rows.map((r) => ({ userId: Number(r.id), username: r.username, role: r.role, telegramChatId: r.telegram_chat_id }));
  }

  if (aturan.penerimaRole === null) return [];

  const params: unknown[] = [aturan.penerimaRole];
  let join = "";
  let where = "";
  if (aturan.penerimaLokasiId !== null) {
    params.push(aturan.penerimaLokasiId);
    join = "JOIN core_user_lokasi cul ON cul.user_id = u.id";
    where = `AND cul.location_id = $${params.length}`;
  }

  const { rows } = await client.query<{ id: string; username: string; role: Role; telegram_chat_id: string | null }>(
    `SELECT DISTINCT u.id, u.username, r.name AS role, u.telegram_chat_id
     FROM core_users u
     JOIN core_roles r ON r.id = u.role_id
     ${join}
     WHERE r.name = $1 AND u.is_active = true ${where}
     ORDER BY u.username`,
    params,
  );
  return rows.map((r) => ({ userId: Number(r.id), username: r.username, role: r.role, telegramChatId: r.telegram_chat_id }));
}
