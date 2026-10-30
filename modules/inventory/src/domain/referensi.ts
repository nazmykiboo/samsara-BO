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

/**
 * Cek keunikan nama TANPA membedakan huruf besar/kecil dan TANPA terpengaruh
 * spasi di ujung (2026-10-30, fitur rename item/menu/kategori) -- lebih
 * ketat dari constraint `UNIQUE` mentah yang sudah ada di database. Dipakai
 * SEBAGAI PRE-CHECK aplikasi (bukan mengandalkan pesan error Postgres
 * mentah dari index `..._ci_key` di migrasi 0032 -- repo ini tidak punya
 * mekanisme menerjemahkan error 23505 ke Bahasa Indonesia, index itu
 * murni jaring pengaman race-condition).
 *
 * `table`/`column` SELALU literal hardcode dari pemanggil di file ini
 * sendiri (tidak pernah dari input user) -- aman diselipkan langsung ke
 * SQL tanpa parameterisasi.
 */
export async function namaSudahDipakai(
  client: PoolClient,
  table: string,
  column: string,
  name: string,
  excludeId?: number,
): Promise<boolean> {
  const params: unknown[] = [name];
  let sql = `SELECT 1 FROM ${table} WHERE lower(trim(${column})) = lower(trim($1))`;
  if (excludeId !== undefined) {
    params.push(excludeId);
    sql += ` AND id != $${params.length}`;
  }
  const { rows } = await client.query(sql, params);
  return rows.length > 0;
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

  const namaBaru = input.name !== undefined ? input.name.trim() : old.name;
  if (input.name !== undefined) {
    if (!namaBaru) throw new Error("Nama kategori tidak boleh kosong");
    if (namaBaru.toLowerCase() !== old.name.trim().toLowerCase()) {
      if (await namaSudahDipakai(client, "inventory_kategori_item", "name", namaBaru, id)) {
        throw new Error(`Nama "${namaBaru}" sudah dipakai kategori item lain -- pilih nama lain.`);
      }
    }
  }

  const newRow = { name: namaBaru, is_active: input.isActive ?? old.is_active };

  // Rename kategori (2026-10-30): `inventory_items.category` menyimpan nama
  // kategori sebagai TEKS BEBAS tanpa foreign key (keputusan desain lama,
  // lihat migrasi 0019) -- tanpa cascade ini, item yang sudah dikategorikan
  // akan jadi orphan diam-diam begitu kategorinya di-rename. Dijalankan
  // SEBELUM UPDATE kategorinya sendiri, dalam transaksi yang sama (caller
  // membungkus lewat withTransaction).
  let jumlahItemTerdampak = 0;
  if (newRow.name !== old.name) {
    const cascade = await client.query(`UPDATE inventory_items SET category = $1 WHERE category = $2`, [
      newRow.name,
      old.name,
    ]);
    jumlahItemTerdampak = cascade.rowCount ?? 0;
  }

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
  if (jumlahItemTerdampak > 0) {
    // Entri PENANDA terpisah (bukan ikut `logFieldChanges` di atas) supaya
    // riwayat audit kategori ini juga menjelaskan SKALA dampak cascade-nya,
    // bukan cuma nama lama/baru.
    await writeAuditLog(client, {
      userId: userId ?? null,
      tableName: "inventory_kategori_item",
      recordId: id,
      fieldName: "item_terdampak",
      oldValue: null,
      newValue: `${jumlahItemTerdampak} item ikut diperbarui kategorinya dari "${old.name}" ke "${newRow.name}"`,
    });
  }
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

  const namaBaru = input.nama !== undefined ? input.nama.trim() : old.nama;
  if (input.nama !== undefined) {
    if (!namaBaru) throw new Error("Nama kategori menu tidak boleh kosong");
    if (namaBaru.toLowerCase() !== old.nama.trim().toLowerCase()) {
      if (await namaSudahDipakai(client, "inventory_kategori_menu", "nama", namaBaru, id)) {
        throw new Error(`Nama "${namaBaru}" sudah dipakai kategori menu lain -- pilih nama lain.`);
      }
    }
  }

  // TIDAK perlu cascade seperti kategori item: `inventory_menu.kategori_id`
  // sudah foreign key proper ke tabel ini, bukan teks bebas -- rename aman
  // otomatis.
  const newRow = {
    kode: input.kode ?? old.kode,
    nama: namaBaru,
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
