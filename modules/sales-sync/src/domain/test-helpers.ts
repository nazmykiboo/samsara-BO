import type { PoolClient } from "pg";
import { pool } from "@samsara/core";

/**
 * Jalankan `fn` dalam transaksi yang SELALU di-ROLLBACK di akhir -- dipakai
 * test supaya bisa menjalankan import/pemetaan SUNGGUHAN lewat domain layer
 * yang sama dengan API, tanpa pernah mengubah data di database dev.
 *
 * Pola ini sengaja DIDUPLIKASI dari `modules/inventory/src/domain/test-helpers.ts`
 * dan `modules/hr/src/domain/test-helpers.ts`, bukan di-import lintas modul:
 * isolasi antar modul berlaku juga untuk kode test, bukan cuma kode produksi
 * (lihat komentar yang sama di helper modul HR).
 *
 * CATATAN khusus modul ini: arsip `salessync_log_penjualan` berisi data Burnas
 * ASLI (docs/architecture-decisions.md § 19.1) yang tidak boleh disentuh test.
 * Karena itu SELURUH test domain sales-sync wajib lewat helper ini, dan semua
 * baris fixture-nya memakai prefix `TEST-...` pada platform/kunci uniknya
 * supaya tidak pernah bisa bertabrakan dengan baris arsip asli -- walau
 * ROLLBACK sudah menjamin tidak ada yang tersimpan.
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
