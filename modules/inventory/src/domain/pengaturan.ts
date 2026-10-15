import type { PoolClient } from "pg";
import type { AuthUser } from "@samsara/core";
import type { HppMethod } from "./hpp.js";

// ---------------------------------------------------------------------------
// Metode HPP default (pengaturan global, owner-only untuk mengubah)
// ---------------------------------------------------------------------------

export async function getHppDefaultMethod(client: PoolClient): Promise<HppMethod> {
  const { rows } = await client.query<{ value: string }>(
    `SELECT value FROM inventory_settings WHERE key = 'hpp_default_method'`,
  );
  return rows[0]?.value === "harga_beli_terakhir" ? "harga_beli_terakhir" : "harga_master";
}

export async function setHppDefaultMethod(client: PoolClient, method: HppMethod): Promise<void> {
  await client.query(
    `INSERT INTO inventory_settings (key, value, updated_at) VALUES ('hpp_default_method', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [method],
  );
}

/**
 * Resolusi metode HPP yang benar-benar dipakai untuk satu request: query
 * param `?metode=` cuma jadi OVERRIDE untuk owner/manajer_ops -- role lain
 * (supervisor/staf) selalu pakai default global, walau mereka mengirim
 * `?metode=` (diabaikan, bukan ditolak, supaya tidak memblokir akses baca).
 */
export async function resolveHppMethod(
  client: PoolClient,
  user: AuthUser,
  queryMetode: unknown,
): Promise<HppMethod> {
  const defaultMethod = await getHppDefaultMethod(client);
  const canOverride = user.role === "owner" || user.role === "manajer_ops";
  if (!canOverride) return defaultMethod;
  return queryMetode === "harga_beli_terakhir" || queryMetode === "harga_master" ? queryMetode : defaultMethod;
}

// ---------------------------------------------------------------------------
// Target food cost % (pengaturan global, owner-only untuk mengubah) --
// dipakai domain/harga-channel.ts (getRekomendasiHarga) sebagai default
// kalau request tidak mengirim target eksplisit.
// ---------------------------------------------------------------------------

const TARGET_FOOD_COST_FALLBACK = 30;

export async function getTargetFoodCostPersen(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ value: string }>(
    `SELECT value FROM inventory_settings WHERE key = 'target_food_cost_persen'`,
  );
  const value = rows[0] === undefined ? NaN : Number(rows[0].value);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : TARGET_FOOD_COST_FALLBACK;
}

/** Validasi (>0 dan <=100) di sini, bukan di router -- lihat pola validasi domain lain (mis. master.ts). */
export async function setTargetFoodCostPersen(client: PoolClient, value: number): Promise<void> {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error("'targetFoodCostPersen' wajib angka > 0 dan <= 100");
  }
  await client.query(
    `INSERT INTO inventory_settings (key, value, updated_at) VALUES ('target_food_cost_persen', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [String(value)],
  );
}

// ---------------------------------------------------------------------------
// Lokasi
// ---------------------------------------------------------------------------

export interface CreateLokasiInput {
  name: string;
  entitas: string;
}

export async function createLokasi(client: PoolClient, input: CreateLokasiInput): Promise<{ id: number }> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO core_locations (name, entitas) VALUES ($1, $2) RETURNING id`,
    [input.name, input.entitas],
  );
  return { id: rows[0].id };
}

export interface UpdateLokasiInput {
  name?: string;
  entitas?: string;
  isActive?: boolean;
}

export async function updateLokasi(client: PoolClient, id: number, input: UpdateLokasiInput): Promise<void> {
  const { rows } = await client.query<{ id: number; name: string; entitas: string; is_active: boolean }>(
    `SELECT id, name, entitas, is_active FROM core_locations WHERE id = $1`,
    [id],
  );
  const old = rows[0];
  if (!old) throw new Error(`Lokasi id ${id} tidak ditemukan`);

  await client.query(`UPDATE core_locations SET name = $1, entitas = $2, is_active = $3 WHERE id = $4`, [
    input.name ?? old.name,
    input.entitas ?? old.entitas,
    input.isActive ?? old.is_active,
    id,
  ]);
}

// ---------------------------------------------------------------------------
// Channel penjualan
// ---------------------------------------------------------------------------

export async function createChannel(client: PoolClient, name: string): Promise<{ id: number }> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_sales_channel (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return { id: rows[0].id };
}

export interface UpdateChannelInput {
  name?: string;
  isActive?: boolean;
}

export async function updateChannel(client: PoolClient, id: number, input: UpdateChannelInput): Promise<void> {
  const { rows } = await client.query<{ id: number; name: string; is_active: boolean }>(
    `SELECT id, name, is_active FROM inventory_sales_channel WHERE id = $1`,
    [id],
  );
  const old = rows[0];
  if (!old) throw new Error(`Channel id ${id} tidak ditemukan`);

  await client.query(`UPDATE inventory_sales_channel SET name = $1, is_active = $2 WHERE id = $3`, [
    input.name ?? old.name,
    input.isActive ?? old.is_active,
    id,
  ]);
}
