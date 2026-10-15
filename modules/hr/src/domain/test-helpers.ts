import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import type { AuthUser } from "@samsara/core";

/**
 * Jalankan `fn` dalam transaksi yang SELALU di-ROLLBACK di akhir -- pola
 * sama persis seperti `modules/inventory/src/domain/test-helpers.ts`,
 * sengaja tidak di-share lintas modul (isolasi antar modul tetap berlaku
 * untuk kode test, bukan cuma kode produksi).
 */
export async function withRollback<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

/** Fixture AuthUser untuk test domain layer -- cuma field yang dibaca `jadwal.ts`/`pengajuan-libur.ts` (id, role) yang perlu akurat. */
export function fakeUser(partial: Partial<AuthUser> & Pick<AuthUser, "id" | "role">): AuthUser {
  return {
    username: `test-${partial.id}`,
    allLocations: partial.role === "owner" || partial.role === "manajer_ops",
    locationIds: [],
    ...partial,
  };
}
