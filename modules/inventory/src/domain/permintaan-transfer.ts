import type { PoolClient } from "pg";

/**
 * Permintaan transfer: tahap SEBELUM transfer kirim yang sudah ada (lihat
 * `createTransferKirim` di `stok.ts`). Outlet mengajukan ("butuh X qty item Y
 * dari CK"), CK melihat daftar permintaan masuk, lalu CK MEMENUHI lewat
 * transfer kirim yang sudah ada -- transfer itu merujuk balik ke baris
 * permintaan ini lewat `inventory_transaksi_transfer.permintaan_id` (lihat
 * `createTransferKirim`, yang mengubah status 'diminta' -> 'dipenuhi').
 *
 * Penamaan location_asal_id/location_tujuan_id sengaja sama dengan
 * `inventory_transaksi_transfer` -- lihat komentar migrasi 0022.
 */

async function findItemByKode(client: PoolClient, kode: string): Promise<{ id: number }> {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM inventory_items WHERE kode = $1`, [kode]);
  if (!rows[0]) throw new Error(`Item dengan kode "${kode}" tidak ditemukan`);
  return rows[0];
}

export interface CreatePermintaanTransferInput {
  locationAsalId: number;
  locationTujuanId: number;
  itemKode: string;
  qtyDiminta: number;
  tanggalDiminta: string;
  catatan?: string;
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  createdByUserId?: number;
}

export interface CreatePermintaanTransferResult {
  headerId: number;
  kode: string;
  status: "diminta";
}

/**
 * Buat permintaan transfer baru. `kode` digenerate SESUDAH insert (butuh
 * `id`) lewat UPDATE dalam transaksi DB yang sama -- pola baru, tidak ada
 * contoh existing untuk "generate kode dari id sendiri" di modul ini (item/
 * menu/resep kode-nya disuplai manual oleh user, lihat 0001/0002).
 */
export async function createPermintaanTransfer(
  client: PoolClient,
  input: CreatePermintaanTransferInput,
): Promise<CreatePermintaanTransferResult> {
  if (!(input.qtyDiminta > 0)) {
    throw new Error("qtyDiminta wajib lebih besar dari 0");
  }
  if (input.locationAsalId === input.locationTujuanId) {
    throw new Error("locationAsalId dan locationTujuanId tidak boleh sama (tidak bisa meminta transfer ke lokasi sendiri)");
  }

  const item = await findItemByKode(client, input.itemKode);

  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_permintaan_transfer
      (kode, location_asal_id, location_tujuan_id, item_id, qty_diminta, status, diminta_oleh, tanggal_diminta, catatan)
     VALUES ($1, $2, $3, $4, $5, 'diminta', $6, $7, $8)
     RETURNING id`,
    [
      // kode sementara, diganti sesudah tahu id -- lihat UPDATE di bawah.
      `PT-PENDING-${Date.now()}`,
      input.locationAsalId,
      input.locationTujuanId,
      item.id,
      input.qtyDiminta,
      input.createdByUserId ?? null,
      input.tanggalDiminta,
      input.catatan ?? null,
    ],
  );
  const headerId = rows[0].id;

  const kode = `PT-${String(headerId).padStart(6, "0")}`;
  await client.query(`UPDATE inventory_permintaan_transfer SET kode = $1 WHERE id = $2`, [kode, headerId]);

  return { headerId, kode, status: "diminta" };
}

export type PermintaanTransferStatus = "diminta" | "dipenuhi" | "dibatalkan";

export interface PermintaanTransferListItem {
  id: number;
  kode: string;
  locationAsalId: number;
  locationAsalNama: string;
  locationTujuanId: number;
  locationTujuanNama: string;
  itemKode: string;
  itemNama: string;
  qtyDiminta: number;
  status: PermintaanTransferStatus;
  tanggalDiminta: string;
  catatan: string | null;
  dimintaOlehUsername: string | null;
  createdAt: string;
}

export interface ListPermintaanTransferFilter {
  /** Kalau diisi: baris di mana lokasi ini adalah asal ATAU tujuan permintaan. */
  locationId?: number;
  status?: PermintaanTransferStatus;
}

/**
 * Daftar permintaan transfer. `locationId` difilter dengan OR (asal ATAU
 * tujuan) supaya satu query yang sama dipakai baik oleh CK yang melihat
 * "permintaan masuk" (location_asal_id = lokasi CK) maupun outlet yang
 * melihat "permintaan yang saya ajukan" (location_tujuan_id = lokasi outlet).
 */
export async function listPermintaanTransfer(
  client: PoolClient,
  filter: ListPermintaanTransferFilter = {},
): Promise<PermintaanTransferListItem[]> {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (filter.locationId !== undefined) {
    params.push(filter.locationId);
    conditions.push(`(p.location_asal_id = $${params.length} OR p.location_tujuan_id = $${params.length})`);
  }
  if (filter.status !== undefined) {
    params.push(filter.status);
    conditions.push(`p.status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await client.query<{
    id: number;
    kode: string;
    location_asal_id: number;
    location_asal_nama: string;
    location_tujuan_id: number;
    location_tujuan_nama: string;
    item_kode: string;
    item_nama: string;
    qty_diminta: string;
    status: PermintaanTransferStatus;
    tanggal_diminta: string;
    catatan: string | null;
    diminta_oleh_username: string | null;
    created_at: string;
  }>(
    `SELECT p.id, p.kode,
            p.location_asal_id, la.name AS location_asal_nama,
            p.location_tujuan_id, lt.name AS location_tujuan_nama,
            i.kode AS item_kode, i.name AS item_nama,
            p.qty_diminta, p.status,
            to_char(p.tanggal_diminta, 'YYYY-MM-DD') AS tanggal_diminta,
            p.catatan, u.username AS diminta_oleh_username,
            p.created_at
     FROM inventory_permintaan_transfer p
     JOIN core_locations la ON la.id = p.location_asal_id
     JOIN core_locations lt ON lt.id = p.location_tujuan_id
     JOIN inventory_items i ON i.id = p.item_id
     LEFT JOIN core_users u ON u.id = p.diminta_oleh
     ${where}
     ORDER BY p.created_at DESC`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    kode: r.kode,
    locationAsalId: r.location_asal_id,
    locationAsalNama: r.location_asal_nama,
    locationTujuanId: r.location_tujuan_id,
    locationTujuanNama: r.location_tujuan_nama,
    itemKode: r.item_kode,
    itemNama: r.item_nama,
    qtyDiminta: Number(r.qty_diminta),
    status: r.status,
    tanggalDiminta: r.tanggal_diminta,
    catatan: r.catatan,
    dimintaOlehUsername: r.diminta_oleh_username,
    createdAt: r.created_at,
  }));
}

export interface BatalkanPermintaanInput {
  id: number;
  /** Diisi otomatis dari user yang login (lihat api/router.ts) -- saat ini tidak ditulis ke kolom manapun, disediakan untuk konsistensi pola & kemungkinan audit log di masa depan. */
  userId?: number;
}

export interface BatalkanPermintaanResult {
  id: number;
  kode: string;
  status: "dibatalkan";
}

/**
 * Batalkan permintaan yang masih berstatus 'diminta'. Permintaan yang sudah
 * 'dipenuhi' (ada transfer kirim yang merujuknya) atau sudah 'dibatalkan'
 * tidak bisa dibatalkan lagi -- pesan error menyebutkan status saat ini
 * supaya jelas kenapa ditolak.
 */
export async function batalkanPermintaan(
  client: PoolClient,
  input: BatalkanPermintaanInput,
): Promise<BatalkanPermintaanResult> {
  const { rows } = await client.query<{ id: number; kode: string; status: PermintaanTransferStatus }>(
    `SELECT id, kode, status FROM inventory_permintaan_transfer WHERE id = $1`,
    [input.id],
  );
  const row = rows[0];
  if (!row) throw new Error(`Permintaan transfer id ${input.id} tidak ditemukan`);
  if (row.status !== "diminta") {
    throw new Error(`Permintaan transfer "${row.kode}" sudah ${row.status}, tidak bisa dibatalkan lagi`);
  }

  await client.query(`UPDATE inventory_permintaan_transfer SET status = 'dibatalkan' WHERE id = $1`, [row.id]);

  return { id: row.id, kode: row.kode, status: "dibatalkan" };
}
