import type { PoolClient } from "pg";
import { writeAuditLog, logFieldChanges } from "@samsara/core";

/**
 * Master kategori item & satuan (dipakai untuk satuan resep MAUPUN satuan
 * beli -- satu daftar, lihat migrasi 0019). Tujuan: jadi sumber dropdown di
 * frontend dan sumber validasi di createItem/updateItem (master.ts) supaya
 * kategori/satuan tidak bisa diisi bebas lagi -- mengurangi typo/variasi
 * penulisan. Validasi di sini SOFT (dicek exist lewat query, bukan foreign
 * key database) -- pola yang sama seperti core_user_lokasi, supaya kolom
 * `inventory_items.category`/`recipe_unit`/`purchase_unit` tidak perlu
 * diubah jadi FK (lihat catatan lengkap di migrasi 0019).
 */

export interface RefItem {
  id: number;
  name: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Kategori item
// ---------------------------------------------------------------------------

export async function listKategori(client: PoolClient): Promise<RefItem[]> {
  const { rows } = await client.query<{ id: number; name: string; is_active: boolean }>(
    `SELECT id, name, is_active FROM inventory_kategori_item ORDER BY name`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active }));
}

export async function createKategori(client: PoolClient, name: string, userId?: number): Promise<{ id: number }> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_kategori_item (name) VALUES ($1) RETURNING id`,
    [name],
  );
  const id = rows[0].id;
  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "inventory_kategori_item",
    recordId: id,
    fieldName: "created",
    oldValue: null,
    newValue: { name },
  });
  return { id };
}

export async function updateKategori(
  client: PoolClient,
  id: number,
  input: { name?: string; isActive?: boolean },
  userId?: number,
): Promise<void> {
  const { rows } = await client.query<{ id: number; name: string; is_active: boolean }>(
    `SELECT id, name, is_active FROM inventory_kategori_item WHERE id = $1`,
    [id],
  );
  const old = rows[0];
  if (!old) throw new Error(`Kategori id ${id} tidak ditemukan`);

  const newRow = { name: input.name ?? old.name, is_active: input.isActive ?? old.is_active };
  await client.query(`UPDATE inventory_kategori_item SET name = $1, is_active = $2 WHERE id = $3`, [
    newRow.name,
    newRow.is_active,
    id,
  ]);
  await logFieldChanges(client, {
    userId: userId ?? null,
    tableName: "inventory_kategori_item",
    recordId: id,
    oldRow: old,
    newRow,
    fields: ["name", "is_active"],
  });
}

export async function kategoriExists(client: PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM inventory_kategori_item WHERE name = $1 AND is_active = true`, [name]);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Satuan (resep & beli, satu daftar)
// ---------------------------------------------------------------------------

export async function listSatuan(client: PoolClient): Promise<RefItem[]> {
  const { rows } = await client.query<{ id: number; name: string; is_active: boolean }>(
    `SELECT id, name, is_active FROM inventory_satuan ORDER BY name`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active }));
}

export async function createSatuan(client: PoolClient, name: string, userId?: number): Promise<{ id: number }> {
  const { rows } = await client.query<{ id: number }>(`INSERT INTO inventory_satuan (name) VALUES ($1) RETURNING id`, [
    name,
  ]);
  const id = rows[0].id;
  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "inventory_satuan",
    recordId: id,
    fieldName: "created",
    oldValue: null,
    newValue: { name },
  });
  return { id };
}

export async function updateSatuan(
  client: PoolClient,
  id: number,
  input: { name?: string; isActive?: boolean },
  userId?: number,
): Promise<void> {
  const { rows } = await client.query<{ id: number; name: string; is_active: boolean }>(
    `SELECT id, name, is_active FROM inventory_satuan WHERE id = $1`,
    [id],
  );
  const old = rows[0];
  if (!old) throw new Error(`Satuan id ${id} tidak ditemukan`);

  const newRow = { name: input.name ?? old.name, is_active: input.isActive ?? old.is_active };
  await client.query(`UPDATE inventory_satuan SET name = $1, is_active = $2 WHERE id = $3`, [
    newRow.name,
    newRow.is_active,
    id,
  ]);
  await logFieldChanges(client, {
    userId: userId ?? null,
    tableName: "inventory_satuan",
    recordId: id,
    oldRow: old,
    newRow,
    fields: ["name", "is_active"],
  });
}

export async function satuanExists(client: PoolClient, name: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM inventory_satuan WHERE name = $1 AND is_active = true`, [name]);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Kategori menu (inventory_kategori_menu, migrasi 0024)
// ---------------------------------------------------------------------------
// Ditaruh di file ini -- BUKAN di master.ts -- karena perannya identik dengan
// kategori item/satuan di atas: tabel referensi yang jadi sumber dropdown di
// frontend DAN sumber validasi untuk entitas master lain (createMenu di
// master.ts memvalidasi lewat `kategoriMenuAktifExists`, pola yang sama
// seperti createItem memvalidasi lewat `kategoriExists`). master.ts tetap
// berisi CRUD entitas master (item/resep/menu), bukan CRUD tabel referensi.
//
// Beda dari `RefItem` di atas: tabel ini punya `kode` (prefix kode menu
// otomatis -- lihat COMMENT ON COLUMN di migrasi 0024) dan `urutan_tampil`
// (urutan kategori di daftar menu/kasir itu keputusan bisnis, bukan
// alfabetis), jadi tipenya sendiri, bukan `RefItem`.

export interface KategoriMenu {
  id: number;
  kode: string;
  nama: string;
  urutanTampil: number;
  aktif: boolean;
}

/** Semua kategori menu (aktif & nonaktif), urut `urutan_tampil` -- BUKAN alfabetis. */
export async function listKategoriMenu(client: PoolClient): Promise<KategoriMenu[]> {
  const { rows } = await client.query<{
    id: string;
    kode: string;
    nama: string;
    urutan_tampil: number;
    aktif: boolean;
  }>(`SELECT id, kode, nama, urutan_tampil, aktif FROM inventory_kategori_menu ORDER BY urutan_tampil, nama`);
  // `id` di-Number()-kan (kolomnya BIGINT -> driver pg mengembalikan STRING)
  // supaya tipenya SAMA dengan `kategoriId` di GET /menu (listMenu, master.ts)
  // -- frontend mencocokkan dua daftar ini untuk menyusun saran kode menu,
  // dan "39" !== 39 akan bikin pencocokan itu gagal diam-diam.
  return rows.map((r) => ({
    id: Number(r.id),
    kode: r.kode,
    nama: r.nama,
    urutanTampil: Number(r.urutan_tampil),
    aktif: r.aktif,
  }));
}

export interface CreateKategoriMenuInput {
  kode: string;
  nama: string;
  urutanTampil?: number;
}

/**
 * Tambah kategori menu baru. Keunikan `kode`/`nama` TIDAK dicek manual --
 * mengandalkan constraint UNIQUE database, sama seperti `createItem`/
 * `createMenu`.
 */
export async function createKategoriMenu(
  client: PoolClient,
  input: CreateKategoriMenuInput,
  userId?: number,
): Promise<{ id: number }> {
  const kode = typeof input?.kode === "string" ? input.kode.trim() : "";
  const nama = typeof input?.nama === "string" ? input.nama.trim() : "";
  if (!kode) throw new Error("Kode kategori menu wajib diisi");
  if (!nama) throw new Error("Nama kategori menu wajib diisi");

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO inventory_kategori_menu (kode, nama, urutan_tampil) VALUES ($1, $2, $3) RETURNING id`,
    [kode, nama, input.urutanTampil ?? 0],
  );
  const id = Number(rows[0].id); // BIGINT -> string dari driver pg, lihat catatan di listKategoriMenu
  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "inventory_kategori_menu",
    recordId: id,
    fieldName: "created",
    oldValue: null,
    newValue: { kode, nama, urutan_tampil: input.urutanTampil ?? 0 },
  });
  return { id };
}

export interface UpdateKategoriMenuInput {
  kode?: string;
  nama?: string;
  urutanTampil?: number;
  aktif?: boolean;
}

export async function updateKategoriMenu(
  client: PoolClient,
  id: number,
  input: UpdateKategoriMenuInput,
  userId?: number,
): Promise<void> {
  const { rows } = await client.query<{
    id: number;
    kode: string;
    nama: string;
    urutan_tampil: number;
    aktif: boolean;
  }>(`SELECT id, kode, nama, urutan_tampil, aktif FROM inventory_kategori_menu WHERE id = $1`, [id]);
  const old = rows[0];
  if (!old) throw new Error(`Kategori menu id ${id} tidak ditemukan`);

  const newRow = {
    kode: input.kode ?? old.kode,
    nama: input.nama ?? old.nama,
    urutan_tampil: input.urutanTampil ?? old.urutan_tampil,
    aktif: input.aktif ?? old.aktif,
  };
  await client.query(
    `UPDATE inventory_kategori_menu SET kode = $1, nama = $2, urutan_tampil = $3, aktif = $4 WHERE id = $5`,
    [newRow.kode, newRow.nama, newRow.urutan_tampil, newRow.aktif, id],
  );
  await logFieldChanges(client, {
    userId: userId ?? null,
    tableName: "inventory_kategori_menu",
    recordId: id,
    oldRow: old,
    newRow,
    fields: ["kode", "nama", "urutan_tampil", "aktif"],
  });
}

/**
 * Apakah kategori menu `id` ada DAN masih aktif. Dipakai `createMenu`/
 * `duplicateMenu` di master.ts -- pola yang sama dengan `kategoriExists`
 * untuk item (validasi SOFT lewat query; FK database tetap ada tapi tidak
 * bisa mengecek `aktif`).
 */
export async function kategoriMenuAktifExists(client: PoolClient, id: number): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM inventory_kategori_menu WHERE id = $1 AND aktif = true`, [id]);
  return rows.length > 0;
}
