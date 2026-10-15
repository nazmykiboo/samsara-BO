import type { PoolClient } from "pg";
import { pool } from "@samsara/core";

/**
 * Jalankan `fn` dalam transaksi yang SELALU di-ROLLBACK di akhir -- dipakai
 * test supaya bisa insert/update transaksi sungguhan (lewat domain layer
 * yang sama dengan API) tanpa pernah mengubah data di database dev.
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

export async function locationId(client: PoolClient, entitas: string): Promise<number> {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM core_locations WHERE entitas = $1`, [
    entitas,
  ]);
  if (!rows[0]) throw new Error(`Lokasi dengan entitas "${entitas}" tidak ditemukan (jalankan migrasi & seed dulu)`);
  return rows[0].id;
}
