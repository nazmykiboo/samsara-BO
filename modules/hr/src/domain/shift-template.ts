import type { PoolClient } from "pg";
import { writeAuditLog, logFieldChanges } from "@samsara/core";

/**
 * Master shift template (mis. "Pagi" 06:00-14:00, "Siang" 14:00-21:00) --
 * dipakai sebagai sumber dropdown saat buat jadwal shift (lihat
 * `jadwal.ts`/`createJadwalShift`), menggantikan input jam manual. Pola
 * CRUD-nya sama persis seperti master kategori/satuan di modul Inventory
 * (`modules/inventory/src/domain/referensi.ts`) -- list selalu kembalikan
 * SEMUA baris (aktif & nonaktif, caller/UI yang filter), update lewat 1
 * fungsi generik dengan field `aktif` dua arah (bukan endpoint nonaktifkan
 * terpisah), bukan hard delete.
 */

export interface ShiftTemplate {
  id: string;
  kode: string;
  nama: string;
  jamMulai: string;
  jamSelesai: string;
  aktif: boolean;
  urutanTampil: number;
}

function mapRow(row: {
  id: string;
  kode: string;
  nama: string;
  jam_mulai: string;
  jam_selesai: string;
  aktif: boolean;
  urutan_tampil: number;
}): ShiftTemplate {
  return {
    id: row.id,
    kode: row.kode,
    nama: row.nama,
    jamMulai: row.jam_mulai,
    jamSelesai: row.jam_selesai,
    aktif: row.aktif,
    urutanTampil: row.urutan_tampil,
  };
}

export async function listShiftTemplate(client: PoolClient): Promise<ShiftTemplate[]> {
  const { rows } = await client.query<{
    id: string;
    kode: string;
    nama: string;
    jam_mulai: string;
    jam_selesai: string;
    aktif: boolean;
    urutan_tampil: number;
  }>(`SELECT id, kode, nama, jam_mulai, jam_selesai, aktif, urutan_tampil FROM hr_shift_template ORDER BY urutan_tampil, nama`);
  return rows.map(mapRow);
}

export interface CreateShiftTemplateInput {
  kode: string;
  nama: string;
  jamMulai: string;
  jamSelesai: string;
  urutanTampil?: number;
}

export async function createShiftTemplate(
  client: PoolClient,
  input: CreateShiftTemplateInput,
  userId?: number,
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO hr_shift_template (kode, nama, jam_mulai, jam_selesai, urutan_tampil)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.kode, input.nama, input.jamMulai, input.jamSelesai, input.urutanTampil ?? 0],
  );
  const id = rows[0].id;
  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "hr_shift_template",
    recordId: Number(id),
    fieldName: "created",
    oldValue: null,
    newValue: input,
  });
  return { id };
}

export interface UpdateShiftTemplateInput {
  nama?: string;
  jamMulai?: string;
  jamSelesai?: string;
  aktif?: boolean;
  urutanTampil?: number;
}

export async function updateShiftTemplate(
  client: PoolClient,
  id: number,
  input: UpdateShiftTemplateInput,
  userId?: number,
): Promise<void> {
  const { rows } = await client.query<Record<string, unknown> & { id: number }>(
    `SELECT * FROM hr_shift_template WHERE id = $1`,
    [id],
  );
  const old = rows[0];
  if (!old) throw new Error(`Shift template id ${id} tidak ditemukan`);

  const newRow = {
    nama: input.nama ?? old.nama,
    jam_mulai: input.jamMulai ?? old.jam_mulai,
    jam_selesai: input.jamSelesai ?? old.jam_selesai,
    aktif: input.aktif ?? old.aktif,
    urutan_tampil: input.urutanTampil ?? old.urutan_tampil,
  };

  await client.query(
    `UPDATE hr_shift_template SET nama = $1, jam_mulai = $2, jam_selesai = $3, aktif = $4, urutan_tampil = $5 WHERE id = $6`,
    [newRow.nama, newRow.jam_mulai, newRow.jam_selesai, newRow.aktif, newRow.urutan_tampil, id],
  );

  await logFieldChanges(client, {
    userId: userId ?? null,
    tableName: "hr_shift_template",
    recordId: id,
    oldRow: old,
    newRow,
    fields: ["nama", "jam_mulai", "jam_selesai", "aktif", "urutan_tampil"],
  });
}
