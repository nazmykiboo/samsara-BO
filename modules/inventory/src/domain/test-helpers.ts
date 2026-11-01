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

/** Lokasi "outlet mana saja" -- berbasis `tipe` (BUKAN `entitas`, sejak
 * migrasi core 0013 "Tipe lokasi jadi sumber kebenaran CK") -- SENGAJA
 * TIDAK hardcode nama/id spesifik: nama outlet dev bisa berubah kapan saja
 * lewat fitur Outlet & Kitchen, dan `tipe` TIDAK PERNAH berubah lewat
 * rename nama (beda dari `entitas` versi lama). Dipakai test yang cuma
 * butuh "lokasi outlet APAPUN" (beda dari lokasi Kitchen), bukan test yang
 * sengaja menguji lokasi tertentu. */
export async function outletLocationId(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM core_locations WHERE tipe = 'outlet' AND is_active = true ORDER BY id LIMIT 1`,
  );
  if (!rows[0]) {
    throw new Error(`Tidak ada lokasi outlet (tipe='outlet') di database -- jalankan migrasi & seed dulu`);
  }
  // Number(...) WAJIB: driver pg mengembalikan kolom BIGINT sebagai STRING JS
  // walau tipe TS query di atas bilang `number` -- tanpa ini, perbandingan
  // `===`/`assert.equal` ke angka yang sudah di-Number() di tempat lain
  // (mis. lokasiId hasil getDetailTransaksiPenjualan) diam-diam selalu false.
  return Number(rows[0].id);
}

/** Lokasi Kitchen (Central Kitchen) PERTAMA yang aktif -- berbasis `tipe`,
 * BUKAN `entitas` (lihat migrasi core 0013: `entitas` sekarang derived dari
 * `tipe`, bukan sumber kebenaran lagi). Dipakai test yang butuh "lokasi
 * Kitchen" tanpa hardcode nama/entitas tertentu -- pengganti
 * `locationId(client, "samsara_ck")` yang sudah tidak valid lagi sejak
 * `entitas` baris CK berubah jadi literal `"kitchen"`. */
export async function kitchenLocationId(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM core_locations WHERE tipe = 'kitchen' AND is_active = true ORDER BY id LIMIT 1`,
  );
  if (!rows[0]) {
    throw new Error(`Tidak ada lokasi kitchen (tipe='kitchen') di database -- jalankan migrasi & seed dulu`);
  }
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
