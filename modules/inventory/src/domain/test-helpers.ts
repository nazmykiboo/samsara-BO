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

/** Lokasi "outlet mana saja selain Central Kitchen" -- SENGAJA TIDAK hardcode
 * entitas spesifik (dulu "samsara_outlet"): entitas/nama outlet dev bisa
 * berubah kapan saja lewat fitur Outlet & Kitchen (mis. diganti jadi nama
 * outlet sungguhan), dan test yang hardcode entitas lama langsung gagal
 * begitu lokasinya di-rename. Dipakai test yang cuma butuh "lokasi outlet
 * APAPUN" (beda dari lokasi CK), bukan test yang sengaja menguji entitas
 * tertentu. */
export async function outletLocationId(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM core_locations WHERE entitas != 'samsara_ck' AND is_active = true ORDER BY id LIMIT 1`,
  );
  if (!rows[0]) {
    throw new Error(`Tidak ada lokasi outlet (selain samsara_ck) di database -- jalankan migrasi & seed dulu`);
  }
  // Number(...) WAJIB: driver pg mengembalikan kolom BIGINT sebagai STRING JS
  // walau tipe TS query di atas bilang `number` -- tanpa ini, perbandingan
  // `===`/`assert.equal` ke angka yang sudah di-Number() di tempat lain
  // (mis. lokasiId hasil getDetailTransaksiPenjualan) diam-diam selalu false.
  return Number(rows[0].id);
}

/** Vendor seed "Pembelian Umum (pasar/warung)" dari migrasi 0031 -- dipakai
 * test yang butuh `vendorId` valid tapi TIDAK sedang menguji apa pun soal
 * vendor itu sendiri (mis. test konversi satuan pembelian), supaya tidak
 * perlu bikin vendor baru cuma untuk memenuhi syarat wajib. */
export async function vendorIdPembelianUmum(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM inventory_vendor WHERE name = 'Pembelian Umum (pasar/warung)'`,
  );
  if (!rows[0]) throw new Error(`Vendor seed "Pembelian Umum (pasar/warung)" tidak ditemukan (jalankan migrasi 0031 dulu)`);
  return rows[0].id;
}
