import type { PoolClient } from "pg";
import type { Role } from "../auth/types.js";
import { KANAL_VALID, KEJADIAN_VALID, type KanalNotifikasi, type KejadianNotifikasi } from "./types.js";

export interface AturanNotifikasiRow {
  id: number;
  kejadian: KejadianNotifikasi;
  penerimaRole: Role | null;
  penerimaUserId: number | null;
  penerimaUserNama: string | null;
  penerimaLokasiId: number | null;
  penerimaLokasiNama: string | null;
  kanal: KanalNotifikasi;
  aktif: boolean;
  ambangJam: number | null;
  createdAt: string;
}

export async function listAturanNotifikasi(client: PoolClient): Promise<AturanNotifikasiRow[]> {
  const { rows } = await client.query<{
    id: string;
    kejadian: KejadianNotifikasi;
    penerima_role: Role | null;
    penerima_user_id: string | null;
    penerima_user_nama: string | null;
    penerima_lokasi_id: string | null;
    penerima_lokasi_nama: string | null;
    kanal: KanalNotifikasi;
    aktif: boolean;
    ambang_jam: string | null;
    created_at: string;
  }>(
    `SELECT a.id, a.kejadian, a.penerima_role,
            a.penerima_user_id, u.name AS penerima_user_nama,
            a.penerima_lokasi_id, l.name AS penerima_lokasi_nama,
            a.kanal, a.aktif, a.ambang_jam, a.created_at
     FROM core_notifikasi_aturan a
     LEFT JOIN core_users u ON u.id = a.penerima_user_id
     LEFT JOIN core_locations l ON l.id = a.penerima_lokasi_id
     ORDER BY a.kejadian, a.id`,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kejadian: r.kejadian,
    penerimaRole: r.penerima_role,
    penerimaUserId: r.penerima_user_id === null ? null : Number(r.penerima_user_id),
    penerimaUserNama: r.penerima_user_nama,
    penerimaLokasiId: r.penerima_lokasi_id === null ? null : Number(r.penerima_lokasi_id),
    penerimaLokasiNama: r.penerima_lokasi_nama,
    kanal: r.kanal,
    aktif: r.aktif,
    ambangJam: r.ambang_jam === null ? null : Number(r.ambang_jam),
    createdAt: r.created_at,
  }));
}

export interface CreateAturanInput {
  kejadian: KejadianNotifikasi;
  penerimaRole?: Role;
  penerimaUserId?: number;
  penerimaLokasiId?: number;
  kanal: KanalNotifikasi;
  aktif?: boolean;
  ambangJam?: number;
  dibuatOleh?: number;
}

export async function createAturanNotifikasi(client: PoolClient, input: CreateAturanInput): Promise<{ id: number }> {
  if (!KEJADIAN_VALID.includes(input.kejadian)) {
    throw new Error(`Kejadian wajib salah satu dari: ${KEJADIAN_VALID.join(", ")}`);
  }
  if (!KANAL_VALID.includes(input.kanal)) {
    throw new Error(`Kanal wajib salah satu dari: ${KANAL_VALID.join(", ")}`);
  }
  if (!input.penerimaRole && !input.penerimaUserId) {
    throw new Error("Penerima wajib diisi: pilih role ATAU user spesifik");
  }

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core_notifikasi_aturan
      (kejadian, penerima_role, penerima_user_id, penerima_lokasi_id, kanal, aktif, ambang_jam, dibuat_oleh)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.kejadian,
      input.penerimaRole ?? null,
      input.penerimaUserId ?? null,
      input.penerimaLokasiId ?? null,
      input.kanal,
      input.aktif ?? true,
      input.ambangJam ?? null,
      input.dibuatOleh ?? null,
    ],
  );
  return { id: Number(rows[0].id) };
}

export interface UpdateAturanInput {
  aktif?: boolean;
  ambangJam?: number | null;
}

export async function updateAturanNotifikasi(client: PoolClient, id: number, input: UpdateAturanInput): Promise<void> {
  const { rows } = await client.query<{ id: string; aktif: boolean; ambang_jam: string | null }>(
    `SELECT id, aktif, ambang_jam FROM core_notifikasi_aturan WHERE id = $1`,
    [id],
  );
  const old = rows[0];
  if (!old) throw new Error(`Aturan notifikasi id ${id} tidak ditemukan`);

  const aktifBaru = input.aktif ?? old.aktif;
  const ambangBaru = input.ambangJam !== undefined ? input.ambangJam : old.ambang_jam;

  await client.query(`UPDATE core_notifikasi_aturan SET aktif = $1, ambang_jam = $2, updated_at = now() WHERE id = $3`, [
    aktifBaru,
    ambangBaru,
    id,
  ]);
}

export async function deleteAturanNotifikasi(client: PoolClient, id: number): Promise<void> {
  const { rowCount } = await client.query(`DELETE FROM core_notifikasi_aturan WHERE id = $1`, [id]);
  if (rowCount === 0) throw new Error(`Aturan notifikasi id ${id} tidak ditemukan`);
}
