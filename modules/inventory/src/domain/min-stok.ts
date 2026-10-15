import type { PoolClient } from "pg";
import { writeAuditLog } from "@samsara/core";

/**
 * Ambang batas minimum stok PER ITEM PER LOKASI (`inventory_min_stok_lokasi`,
 * migrasi 0020) -- menggantikan `inventory_items.min_stok` yang cuma satu
 * nilai per item (tidak bisa beda antara Central Kitchen dan outlet).
 * `inventory_items.min_stok` (deprecated) TIDAK ditulis lagi dari sini atau
 * dari kode baru manapun.
 *
 * Tabel ini punya UNIQUE (item_id, location_id) justru supaya "set atau
 * update" bisa jadi satu aksi (modal sederhana di frontend, satu tombol
 * simpan) -- makanya upsertMinStok pakai INSERT ... ON CONFLICT DO UPDATE,
 * bukan create/update terpisah.
 */

async function itemIdByKode(client: PoolClient, kode: string): Promise<number> {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM inventory_items WHERE kode = $1`, [kode]);
  if (!rows[0]) throw new Error(`Item dengan kode "${kode}" tidak ditemukan`);
  return rows[0].id;
}

export interface UpsertMinStokInput {
  itemKode: string;
  locationId: number;
  minStok: number;
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  userId?: number;
}

export interface UpsertMinStokResult {
  id: number;
  itemKode: string;
  locationId: number;
  minStok: number;
}

/**
 * Set atau ubah ambang batas minimum stok untuk satu item di satu lokasi.
 * `min_stok` harus >= 0. Menulis `diubah_oleh`/`diubah_at` setiap kali
 * (insert baru maupun update baris yang sudah ada), dan mencatat perubahan
 * ke `core_audit_log` (old value = null kalau baris baru, atau nilai lama
 * kalau update).
 */
export async function upsertMinStok(client: PoolClient, input: UpsertMinStokInput): Promise<UpsertMinStokResult> {
  if (!Number.isFinite(input.minStok) || input.minStok < 0) {
    throw new Error("min_stok wajib angka >= 0");
  }

  const itemId = await itemIdByKode(client, input.itemKode);

  const { rows: existingRows } = await client.query<{ id: number; min_stok: string }>(
    `SELECT id, min_stok FROM inventory_min_stok_lokasi WHERE item_id = $1 AND location_id = $2`,
    [itemId, input.locationId],
  );
  const existing = existingRows[0];

  const { rows } = await client.query<{ id: number; min_stok: string }>(
    `INSERT INTO inventory_min_stok_lokasi (item_id, location_id, min_stok, diubah_oleh, diubah_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (item_id, location_id)
     DO UPDATE SET min_stok = EXCLUDED.min_stok, diubah_oleh = EXCLUDED.diubah_oleh, diubah_at = now()
     RETURNING id, min_stok`,
    [itemId, input.locationId, input.minStok, input.userId ?? null],
  );
  const row = rows[0];

  await writeAuditLog(client, {
    userId: input.userId ?? null,
    tableName: "inventory_min_stok_lokasi",
    recordId: row.id,
    fieldName: "min_stok",
    oldValue: existing ? Number(existing.min_stok) : null,
    newValue: input.minStok,
  });

  return { id: row.id, itemKode: input.itemKode, locationId: input.locationId, minStok: Number(row.min_stok) };
}

export interface MinStokListItem {
  itemKode: string;
  minStok: number;
}

/**
 * Daftar semua ambang batas minimum stok yang sudah di-set untuk SATU
 * lokasi. Bulk by-design: halaman Stok butuh status HABIS/MENIPIS/AMAN
 * untuk ~92 item sekaligus per lokasi terpilih, jadi satu request per
 * lokasi (bukan satu request per item x lokasi).
 */
export async function listMinStokByLocation(client: PoolClient, locationId: number): Promise<MinStokListItem[]> {
  const { rows } = await client.query<{ kode: string; min_stok: string }>(
    `SELECT i.kode, m.min_stok
     FROM inventory_min_stok_lokasi m
     JOIN inventory_items i ON i.id = m.item_id
     WHERE m.location_id = $1
     ORDER BY i.kode`,
    [locationId],
  );
  return rows.map((r) => ({ itemKode: r.kode, minStok: Number(r.min_stok) }));
}
