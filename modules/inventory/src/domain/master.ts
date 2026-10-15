import type { PoolClient } from "pg";
import { logFieldChanges, writeAuditLog } from "@samsara/core";
import { kategoriExists, kategoriMenuAktifExists, satuanExists } from "./referensi.js";
import { computeBaseMenuHppById, computePaketHppById, isPaketMenu } from "./hpp.js";

/**
 * CRUD master item, resep produksi, dan resep menu. Tanpa hapus permanen
 * (soft-delete lewat `is_active`). Perubahan field sensitif (harga beli,
 * konversi, resep) ditulis ke `core_audit_log` otomatis dari sini -- bukan
 * tanggung jawab caller/router. Trigger 1-level resep produksi (bahan cuma
 * boleh bahan_baku/packaging) tetap dijaga di level database (tidak
 * disentuh), jadi tetap berlaku otomatis untuk insert lewat modul ini.
 */

async function itemIdByKode(client: PoolClient, kode: string): Promise<{ id: number }> {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM inventory_items WHERE kode = $1`, [kode]);
  if (!rows[0]) throw new Error(`Item dengan kode "${kode}" tidak ditemukan`);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

export interface CreateItemInput {
  kode: string;
  name: string;
  type: "bahan_baku" | "packaging" | "operasional" | "setengah_jadi";
  category?: string;
  recipeUnit: string;
  purchaseUnit?: string;
  purchaseToRecipeFactor?: number;
  hargaMaster?: number;
  minStok?: number;
  shelfLifeHari?: number;
  catatan?: string;
}

export async function createItem(client: PoolClient, input: CreateItemInput, userId?: number): Promise<{ id: number }> {
  if (input.category !== undefined && !(await kategoriExists(client, input.category))) {
    throw new Error(`Kategori "${input.category}" tidak ada di master kategori. Tambahkan dulu lewat Master Kategori.`);
  }
  if (!(await satuanExists(client, input.recipeUnit))) {
    throw new Error(`Satuan "${input.recipeUnit}" tidak ada di master satuan. Tambahkan dulu lewat Master Satuan.`);
  }
  if (input.purchaseUnit !== undefined && !(await satuanExists(client, input.purchaseUnit))) {
    throw new Error(`Satuan "${input.purchaseUnit}" tidak ada di master satuan. Tambahkan dulu lewat Master Satuan.`);
  }

  const isPurchasable = input.type !== "setengah_jadi";
  const complete = !isPurchasable
    ? false // setengah_jadi selalu pending sampai resepnya dibuat dengan yield terisi
    : input.purchaseUnit != null && input.hargaMaster != null && input.purchaseToRecipeFactor != null;
  const status = complete ? "active" : "pending_data";

  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_items
      (kode, name, type, status, category, recipe_unit, purchase_unit, purchase_to_recipe_factor, harga_master, min_stok, shelf_life_hari, catatan)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      input.kode,
      input.name,
      input.type,
      status,
      input.category ?? null,
      input.recipeUnit,
      input.purchaseUnit ?? null,
      input.purchaseToRecipeFactor ?? null,
      input.hargaMaster ?? null,
      input.minStok ?? null,
      input.shelfLifeHari ?? null,
      input.catatan ?? null,
    ],
  );
  const id = rows[0].id;
  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "inventory_items",
    recordId: id,
    fieldName: "created",
    oldValue: null,
    newValue: input,
  });
  return { id };
}

export interface ItemListRow {
  kode: string | null;
  name: string;
  category: string | null;
  type: "bahan_baku" | "packaging" | "operasional" | "setengah_jadi";
  status: "active" | "pending_data";
  recipeUnit: string;
  purchaseUnit: string | null;
  purchaseToRecipeFactor: number | null;
  /** `null` di sini TIDAK HANYA berarti "belum diisi" -- lihat strip di router (hpp.lihat_harga). */
  hargaMaster: number | null;
  isActive: boolean;
  minStok: number | null;
}

/**
 * Daftar SEMUA item (aktif maupun nonaktif -- caller/UI yang memutuskan mau
 * ditampilkan dengan badge "Nonaktif" atau difilter). Tidak ada endpoint
 * ini sebelumnya -- halaman Master Item & ItemPicker sempat pakai data
 * contoh statis (MOCK_ITEMS di frontend), jadi item yang baru dibuat lewat
 * createItem() tersimpan benar di database tapi tidak pernah muncul di
 * UI manapun sampai endpoint ini ada (lihat docs/architecture-decisions.md).
 */
export async function listItems(client: PoolClient): Promise<ItemListRow[]> {
  const { rows } = await client.query<{
    kode: string | null;
    name: string;
    category: string | null;
    type: "bahan_baku" | "packaging" | "operasional" | "setengah_jadi";
    status: "active" | "pending_data";
    recipe_unit: string;
    purchase_unit: string | null;
    purchase_to_recipe_factor: string | null;
    harga_master: string | null;
    is_active: boolean;
    min_stok: string | null;
  }>(
    `SELECT kode, name, category, type, status, recipe_unit, purchase_unit,
            purchase_to_recipe_factor, harga_master, is_active, min_stok
     FROM inventory_items
     ORDER BY kode NULLS LAST, name`,
  );

  return rows.map((row) => ({
    kode: row.kode,
    name: row.name,
    category: row.category,
    type: row.type,
    status: row.status,
    recipeUnit: row.recipe_unit,
    purchaseUnit: row.purchase_unit,
    purchaseToRecipeFactor: row.purchase_to_recipe_factor === null ? null : Number(row.purchase_to_recipe_factor),
    hargaMaster: row.harga_master === null ? null : Number(row.harga_master),
    isActive: row.is_active,
    minStok: row.min_stok === null ? null : Number(row.min_stok),
  }));
}

export interface UpdateItemInput {
  category?: string;
  recipeUnit?: string;
  purchaseUnit?: string;
  purchaseToRecipeFactor?: number;
  hargaMaster?: number;
  minStok?: number;
  shelfLifeHari?: number;
  catatan?: string;
  status?: "active" | "pending_data";
}

const ITEM_AUDITED_FIELDS = ["harga_master", "purchase_to_recipe_factor"];

export async function updateItem(client: PoolClient, kode: string, input: UpdateItemInput, userId?: number): Promise<void> {
  if (input.category !== undefined && !(await kategoriExists(client, input.category))) {
    throw new Error(`Kategori "${input.category}" tidak ada di master kategori. Tambahkan dulu lewat Master Kategori.`);
  }
  if (input.recipeUnit !== undefined && !(await satuanExists(client, input.recipeUnit))) {
    throw new Error(`Satuan "${input.recipeUnit}" tidak ada di master satuan. Tambahkan dulu lewat Master Satuan.`);
  }
  if (input.purchaseUnit !== undefined && !(await satuanExists(client, input.purchaseUnit))) {
    throw new Error(`Satuan "${input.purchaseUnit}" tidak ada di master satuan. Tambahkan dulu lewat Master Satuan.`);
  }

  const { rows } = await client.query<Record<string, unknown> & { id: number }>(
    `SELECT * FROM inventory_items WHERE kode = $1`,
    [kode],
  );
  const old = rows[0];
  if (!old) throw new Error(`Item dengan kode "${kode}" tidak ditemukan`);

  const newRow = {
    category: input.category ?? old.category,
    recipe_unit: input.recipeUnit ?? old.recipe_unit,
    purchase_unit: input.purchaseUnit ?? old.purchase_unit,
    purchase_to_recipe_factor: input.purchaseToRecipeFactor ?? old.purchase_to_recipe_factor,
    harga_master: input.hargaMaster ?? old.harga_master,
    min_stok: input.minStok ?? old.min_stok,
    shelf_life_hari: input.shelfLifeHari ?? old.shelf_life_hari,
    catatan: input.catatan ?? old.catatan,
    status: input.status ?? old.status,
  };

  await client.query(
    `UPDATE inventory_items
     SET category = $1, recipe_unit = $2, purchase_unit = $3, purchase_to_recipe_factor = $4, harga_master = $5,
         min_stok = $6, shelf_life_hari = $7, catatan = $8, status = $9, updated_at = now()
     WHERE id = $10`,
    [
      newRow.category,
      newRow.recipe_unit,
      newRow.purchase_unit,
      newRow.purchase_to_recipe_factor,
      newRow.harga_master,
      newRow.min_stok,
      newRow.shelf_life_hari,
      newRow.catatan,
      newRow.status,
      old.id,
    ],
  );

  await logFieldChanges(client, {
    userId: userId ?? null,
    tableName: "inventory_items",
    recordId: old.id,
    oldRow: old,
    newRow,
    fields: ITEM_AUDITED_FIELDS,
  });
}

export interface ItemUsage {
  resepProduksiKode: string[];
  menuKode: string[];
}

async function findActiveUsage(client: PoolClient, itemId: number): Promise<ItemUsage> {
  const { rows: resepRows } = await client.query<{ kode: string | null }>(
    `SELECT DISTINCT rp.kode
     FROM inventory_resep_produksi_baris b
     JOIN inventory_resep_produksi rp ON rp.id = b.resep_id
     WHERE b.bahan_item_id = $1 AND rp.is_active = true`,
    [itemId],
  );
  const { rows: menuRows } = await client.query<{ kode: string | null }>(
    `SELECT DISTINCT m.kode
     FROM inventory_menu_resep_baris b
     JOIN inventory_menu m ON m.id = b.menu_id
     WHERE b.item_id = $1 AND m.is_active = true`,
    [itemId],
  );
  return {
    resepProduksiKode: resepRows.map((r) => r.kode).filter((k): k is string => k !== null),
    menuKode: menuRows.map((r) => r.kode).filter((k): k is string => k !== null),
  };
}

/** Nonaktifkan item (is_active=false). Ditolak kalau masih dipakai resep produksi atau resep menu yang AKTIF. */
export async function deactivateItem(client: PoolClient, kode: string, userId?: number): Promise<void> {
  const item = await itemIdByKode(client, kode);
  const usage = await findActiveUsage(client, item.id);

  if (usage.resepProduksiKode.length > 0 || usage.menuKode.length > 0) {
    const daftar = [
      ...usage.resepProduksiKode.map((k) => `resep produksi ${k}`),
      ...usage.menuKode.map((k) => `menu ${k}`),
    ].join(", ");
    throw new Error(
      `Item "${kode}" masih dipakai di resep aktif: ${daftar}. Nonaktifkan/ubah resep itu dulu sebelum menonaktifkan item ini.`,
    );
  }

  await client.query(`UPDATE inventory_items SET is_active = false, updated_at = now() WHERE id = $1`, [item.id]);
  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "inventory_items",
    recordId: item.id,
    fieldName: "is_active",
    oldValue: true,
    newValue: false,
  });
}

// ---------------------------------------------------------------------------
// Resep produksi
// ---------------------------------------------------------------------------

export interface ResepProduksiBarisInput {
  bahanItemKode: string;
  qty: number;
  unit: string;
}

export interface CreateResepProduksiInput {
  kode: string;
  outputItemKode: string;
  yieldQty?: number;
  yieldUnit?: string;
  catatan?: string;
  baris: ResepProduksiBarisInput[];
}

/** Trigger DB (1 level: bahan cuma boleh bahan_baku/packaging) tetap berlaku otomatis lewat INSERT baris di bawah. */
export async function createResepProduksi(
  client: PoolClient,
  input: CreateResepProduksiInput,
  userId?: number,
): Promise<{ id: number }> {
  if (input.baris.length === 0) throw new Error("Resep produksi harus punya minimal 1 baris bahan");

  const output = await itemIdByKode(client, input.outputItemKode);

  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_resep_produksi (kode, output_item_id, yield_qty, yield_unit, catatan)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.kode, output.id, input.yieldQty ?? null, input.yieldUnit ?? null, input.catatan ?? null],
  );
  const resepId = rows[0].id;

  for (const baris of input.baris) {
    const bahan = await itemIdByKode(client, baris.bahanItemKode);
    await client.query(
      `INSERT INTO inventory_resep_produksi_baris (resep_id, bahan_item_id, qty, unit) VALUES ($1, $2, $3, $4)`,
      [resepId, bahan.id, baris.qty, baris.unit],
    );
  }

  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "inventory_resep_produksi",
    recordId: resepId,
    fieldName: "created",
    oldValue: null,
    newValue: input,
  });

  return { id: resepId };
}

export interface UpdateResepProduksiInput {
  yieldQty?: number;
  yieldUnit?: string;
  catatan?: string;
  /** Kalau diisi, MENGGANTI SELURUH baris bahan lama (bukan menambah/patch sebagian). */
  baris?: ResepProduksiBarisInput[];
}

export async function updateResepProduksi(
  client: PoolClient,
  kode: string,
  input: UpdateResepProduksiInput,
  userId?: number,
): Promise<void> {
  const { rows } = await client.query<Record<string, unknown> & { id: number }>(
    `SELECT * FROM inventory_resep_produksi WHERE kode = $1`,
    [kode],
  );
  const old = rows[0];
  if (!old) throw new Error(`Resep produksi dengan kode "${kode}" tidak ditemukan`);

  const newRow = {
    yield_qty: input.yieldQty ?? old.yield_qty,
    yield_unit: input.yieldUnit ?? old.yield_unit,
    catatan: input.catatan ?? old.catatan,
  };

  await client.query(
    `UPDATE inventory_resep_produksi SET yield_qty = $1, yield_unit = $2, catatan = $3, updated_at = now() WHERE id = $4`,
    [newRow.yield_qty, newRow.yield_unit, newRow.catatan, old.id],
  );

  await logFieldChanges(client, {
    userId: userId ?? null,
    tableName: "inventory_resep_produksi",
    recordId: old.id,
    oldRow: old,
    newRow,
    fields: ["yield_qty"],
  });

  if (input.baris) {
    const { rows: oldBaris } = await client.query(
      `SELECT bi.kode, b.qty, b.unit
       FROM inventory_resep_produksi_baris b
       JOIN inventory_items bi ON bi.id = b.bahan_item_id
       WHERE b.resep_id = $1`,
      [old.id],
    );

    await client.query(`DELETE FROM inventory_resep_produksi_baris WHERE resep_id = $1`, [old.id]);
    for (const baris of input.baris) {
      const bahan = await itemIdByKode(client, baris.bahanItemKode);
      await client.query(
        `INSERT INTO inventory_resep_produksi_baris (resep_id, bahan_item_id, qty, unit) VALUES ($1, $2, $3, $4)`,
        [old.id, bahan.id, baris.qty, baris.unit],
      );
    }

    await writeAuditLog(client, {
      userId: userId ?? null,
      tableName: "inventory_resep_produksi",
      recordId: old.id,
      fieldName: "baris",
      oldValue: oldBaris,
      newValue: input.baris,
    });
  }
}

export interface ResepProduksiListRow {
  kode: string | null;
  outputItemKode: string | null;
  outputItemName: string;
  yieldQty: number | null;
  yieldUnit: string | null;
  isActive: boolean;
}

/** Daftar SEMUA resep produksi (aktif & nonaktif -- caller/UI yang memutuskan ditampilkan bagaimana). */
export async function listResepProduksi(client: PoolClient): Promise<ResepProduksiListRow[]> {
  const { rows } = await client.query<{
    kode: string | null;
    output_kode: string | null;
    output_name: string;
    yield_qty: string | null;
    yield_unit: string | null;
    is_active: boolean;
  }>(
    `SELECT rp.kode, i.kode AS output_kode, i.name AS output_name, rp.yield_qty, rp.yield_unit, rp.is_active
     FROM inventory_resep_produksi rp
     JOIN inventory_items i ON i.id = rp.output_item_id
     ORDER BY rp.kode NULLS LAST, i.name`,
  );
  return rows.map((row) => ({
    kode: row.kode,
    outputItemKode: row.output_kode,
    outputItemName: row.output_name,
    yieldQty: row.yield_qty === null ? null : Number(row.yield_qty),
    yieldUnit: row.yield_unit,
    isActive: row.is_active,
  }));
}

export interface ResepProduksiBarisRow {
  bahanItemKode: string | null;
  bahanItemName: string;
  qty: number;
  unit: string;
}

/** Baris bahan resep produksi untuk satu kode resep (mis. RP-008). */
export async function getResepProduksiBaris(client: PoolClient, kode: string): Promise<ResepProduksiBarisRow[]> {
  const { rows: resepRows } = await client.query<{ id: number }>(
    `SELECT id FROM inventory_resep_produksi WHERE kode = $1`,
    [kode],
  );
  const resep = resepRows[0];
  if (!resep) throw new Error(`Resep produksi dengan kode "${kode}" tidak ditemukan`);

  const { rows } = await client.query<{ kode: string | null; name: string; qty: string; unit: string }>(
    `SELECT i.kode, i.name, b.qty, b.unit
     FROM inventory_resep_produksi_baris b
     JOIN inventory_items i ON i.id = b.bahan_item_id
     WHERE b.resep_id = $1
     ORDER BY i.name`,
    [resep.id],
  );
  return rows.map((row) => ({
    bahanItemKode: row.kode,
    bahanItemName: row.name,
    qty: Number(row.qty),
    unit: row.unit,
  }));
}

export async function deactivateResepProduksi(client: PoolClient, kode: string, userId?: number): Promise<void> {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM inventory_resep_produksi WHERE kode = $1`, [
    kode,
  ]);
  if (!rows[0]) throw new Error(`Resep produksi dengan kode "${kode}" tidak ditemukan`);

  await client.query(`UPDATE inventory_resep_produksi SET is_active = false, updated_at = now() WHERE id = $1`, [
    rows[0].id,
  ]);
  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "inventory_resep_produksi",
    recordId: rows[0].id,
    fieldName: "is_active",
    oldValue: true,
    newValue: false,
  });
}

// ---------------------------------------------------------------------------
// Menu (header). Sebelum ini satu-satunya cara menu masuk ke inventory_menu
// adalah SQL mentah di migrasi seed -- belum ada jalur API/domain sama sekali.
// `listMenu`/`deactivateMenu` ada di section "Resep menu" di bawah (mengikuti
// pengelompokan yang sudah ada, tidak dipindah). Kolom `harga_jual` (legacy)
// TIDAK disentuh di sini -- diisi lewat setMenuHargaJual/harga per channel.
// ---------------------------------------------------------------------------

export interface CreateMenuInput {
  kode: string;
  name: string;
  /**
   * Referensi ke `inventory_kategori_menu.id` (migrasi 0024). MENGGANTIKAN
   * field `kategoriMenu` (teks bebas) yang dipakai versi sebelumnya: kolom
   * `inventory_menu.kategori_menu` sekarang DEPRECATED dan TIDAK PERNAH lagi
   * ditulis dari sini (lihat COMMENT ON COLUMN di migrasi 0024).
   * Opsional: menu boleh dibuat dulu, dikategorikan belakangan.
   */
  kategoriId?: number;
  isActive?: boolean;
  /**
   * Lokasi mana saja menu ini ditayangkan. SEMANTIK PENTING (tabel
   * `inventory_menu_lokasi` itu tabel PENGECUALIAN, bukan keanggotaan):
   *   - tidak dikirim / array kosong -> menu aktif di SEMUA lokasi, dan
   *     TIDAK ADA baris apa pun yang ditulis ke `inventory_menu_lokasi`;
   *   - berisi SEBAGIAN lokasi -> untuk setiap lokasi di `core_locations`
   *     yang TIDAK disebut, ditulis baris pengecualian `aktif = false`;
   *   - berisi SEMUA lokasi yang ada -> tidak ada baris yang ditulis
   *     (hasilnya identik dengan tidak mengirim `lokasiIds`).
   */
  lokasiIds?: number[];
}

/**
 * Terjemahkan "menu ini cuma tayang di lokasi X" jadi baris PENGECUALIAN
 * (`aktif = false`) untuk setiap lokasi LAIN -- lihat COMMENT ON TABLE
 * `inventory_menu_lokasi` di migrasi 0024: absennya baris = menu tayang,
 * jadi yang disimpan justru lokasi yang TIDAK disebut pemanggil.
 */
async function setMenuLokasiPengecualian(
  client: PoolClient,
  menuId: number,
  lokasiIds: number[] | undefined,
): Promise<void> {
  if (!lokasiIds || lokasiIds.length === 0) return; // default: tayang di semua lokasi

  // Number() di KEDUA sisi, wajib: `core_locations.id` BIGINT dan driver pg
  // mengembalikannya sebagai STRING, sedangkan `lokasiIds` datang dari JSON
  // body sebagai angka -- membandingkan apa adanya ("1" vs 1) bikin SEMUA
  // lokasi dianggap "tidak disebut" dan menu jadi tersembunyi di mana-mana.
  const diminta = new Set(lokasiIds.map(Number));
  const { rows: semuaLokasi } = await client.query<{ id: string }>(`SELECT id FROM core_locations`);
  const dikecualikan = semuaLokasi.map((r) => Number(r.id)).filter((id) => !diminta.has(id));

  for (const lokasiId of dikecualikan) {
    await client.query(`INSERT INTO inventory_menu_lokasi (menu_id, lokasi_id, aktif) VALUES ($1, $2, false)`, [
      menuId,
      lokasiId,
    ]);
  }
}

/**
 * Tambah menu baru (header saja -- baris resepnya diisi terpisah lewat
 * `updateMenuResep`, jadi menu baru otomatis berstatus `pending_data` di
 * `listMenu` sampai resepnya ada). Keunikan `kode`/`name` TIDAK dicek manual
 * di sini -- mengandalkan constraint UNIQUE di database, sama seperti
 * `createItem`. `kategoriId` DIVALIDASI dulu (harus ada & aktif), pola sama
 * seperti validasi channel aktif di `upsertHargaChannel`.
 */
export async function createMenu(client: PoolClient, input: CreateMenuInput, userId?: number): Promise<{ id: number }> {
  const kode = typeof input?.kode === "string" ? input.kode.trim() : "";
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!kode) throw new Error("Kode menu wajib diisi");
  if (!name) throw new Error("Nama menu wajib diisi");

  if (input.kategoriId != null && !(await kategoriMenuAktifExists(client, input.kategoriId))) {
    throw new Error(`Kategori menu "${input.kategoriId}" tidak ditemukan atau nonaktif`);
  }

  // kategori_menu (teks bebas) SENGAJA tidak ikut di-INSERT -- kolom itu
  // DEPRECATED sejak migrasi 0024 dan dibiarkan NULL untuk menu baru.
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_menu (kode, name, kategori_id, is_active)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [kode, name, input.kategoriId ?? null, input.isActive ?? true],
  );
  const id = rows[0].id;

  await setMenuLokasiPengecualian(client, id, input.lokasiIds);

  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "inventory_menu",
    recordId: id,
    fieldName: "created",
    oldValue: null,
    newValue: input,
  });
  return { id };
}

export interface DuplicateMenuInput {
  kodeBaru: string;
  nameBaru: string;
  kategoriId?: number;
  isActive?: boolean;
  lokasiIds?: number[];
}

/**
 * Duplikat satu menu: bikin header baru lewat `createMenu` (jadi validasi
 * kategori + semantik `lokasiIds` persis sama) lalu salin baris resep menu
 * sumber apa adanya lewat `updateMenuResep`. TIDAK menyalin: harga jual
 * (legacy maupun per-channel), visibilitas channel, dan komposisi paket --
 * itu semua diset terpisah untuk menu baru.
 *
 * Menu sumber yang belum punya baris resep tetap bisa diduplikat (menu baru
 * dibuat kosong, bukan error) -- sama statusnya dengan menu yang baru dibuat
 * lewat `createMenu`.
 */
export async function duplicateMenu(
  client: PoolClient,
  kodeSumber: string,
  input: DuplicateMenuInput,
  userId?: number,
): Promise<{ id: number }> {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM inventory_menu WHERE kode = $1`, [kodeSumber]);
  if (!rows[0]) throw new Error(`Menu sumber "${kodeSumber}" tidak ditemukan`);

  const created = await createMenu(
    client,
    {
      kode: input.kodeBaru,
      name: input.nameBaru,
      kategoriId: input.kategoriId,
      isActive: input.isActive,
      lokasiIds: input.lokasiIds,
    },
    userId,
  );

  const barisSumber = await getMenuResep(client, kodeSumber);
  if (barisSumber.length > 0) {
    const baris: MenuResepBarisInput[] = barisSumber.map((b) => {
      // `inventory_items.kode` nullable (lihat ItemListRow), dan
      // updateMenuResep mencari item lewat kode -- baris seperti itu tidak
      // bisa disalin, jadi dilaporkan jelas daripada gagal dengan pesan
      // "Item dengan kode "null" tidak ditemukan".
      if (b.itemKode === null) {
        throw new Error(
          `Resep menu "${kodeSumber}" punya bahan tanpa kode item ("${b.itemName}") -- lengkapi kode item itu dulu sebelum menduplikat menu`,
        );
      }
      return { itemKode: b.itemKode, qty: b.qty, unit: b.unit };
    });
    await updateMenuResep(client, input.kodeBaru.trim(), baris, userId);
  }

  return created;
}

// ---------------------------------------------------------------------------
// Resep menu (pola sama seperti resep produksi -- lihat di atas -- tapi
// "header"-nya adalah inventory_menu itu sendiri, jadi tidak ada
// create/nonaktifkan resep terpisah dari menunya: "tambah" dan "ubah" baris
// digabung jadi satu operasi ganti-seluruh-baris (sama seperti
// updateResepProduksi), dan "nonaktifkan" menonaktifkan menunya. TIDAK ADA
// pembatasan tipe bahan di sini -- diverifikasi Tahap 2/3, resep menu boleh
// pakai item operasional (mis. kertas struk); trigger 1-level yang menjaga
// resep PRODUKSI (di atas) tidak disentuh sama sekali.
// ---------------------------------------------------------------------------

export interface MenuResepBarisInput {
  itemKode: string;
  qty: number;
  unit: string;
}

async function menuIdByKode(client: PoolClient, kode: string): Promise<{ id: number }> {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM inventory_menu WHERE kode = $1`, [kode]);
  if (!rows[0]) throw new Error(`Menu dengan kode "${kode}" tidak ditemukan`);
  return rows[0];
}

/**
 * Tambah/ubah baris resep untuk satu menu -- MENGGANTI SELURUH baris lama
 * (sama seperti `updateResepProduksi`), bukan patch/tambah sebagian.
 * Dicatat ke `core_audit_log` sebagai satu entri field `baris`.
 */
export async function updateMenuResep(
  client: PoolClient,
  menuKode: string,
  baris: MenuResepBarisInput[],
  userId?: number,
): Promise<void> {
  const menu = await menuIdByKode(client, menuKode);

  const { rows: oldBaris } = await client.query<{ kode: string | null; qty: string; unit: string }>(
    `SELECT i.kode, b.qty, b.unit
     FROM inventory_menu_resep_baris b
     JOIN inventory_items i ON i.id = b.item_id
     WHERE b.menu_id = $1`,
    [menu.id],
  );

  await client.query(`DELETE FROM inventory_menu_resep_baris WHERE menu_id = $1`, [menu.id]);
  for (const line of baris) {
    const item = await itemIdByKode(client, line.itemKode);
    await client.query(`INSERT INTO inventory_menu_resep_baris (menu_id, item_id, qty, unit) VALUES ($1, $2, $3, $4)`, [
      menu.id,
      item.id,
      line.qty,
      line.unit,
    ]);
  }

  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "inventory_menu",
    recordId: menu.id,
    fieldName: "baris",
    oldValue: oldBaris,
    newValue: baris,
  });
}

export interface MenuListRow {
  kode: string | null;
  name: string;
  /**
   * NAMA kategori untuk tampilan. Dibaca dari `inventory_kategori_menu`
   * lewat `kategori_id`; fallback ke kolom teks bebas `kategori_menu` yang
   * sudah DEPRECATED cuma untuk baris historis yang `kategori_id`-nya masih
   * NULL (migrasi 0024 sudah memetakan 57 menu existing, jadi praktisnya
   * fallback ini tidak kepakai).
   */
  kategori: string | null;
  /**
   * `inventory_menu.kategori_id` -- dipakai frontend untuk menyusun SARAN
   * kode menu otomatis (prefix kode kategori + nomor urut, dihitung dengan
   * menghitung menu lain di kategori yang sama dari daftar ini). Tidak ada
   * logika generate di backend, sengaja.
   */
  kategoriId: number | null;
  isActive: boolean;
  status: "ok" | "pending_data";
}

/**
 * Daftar SEMUA menu (aktif maupun nonaktif -- caller/UI yang memutuskan mau
 * ditampilkan dengan badge "Nonaktif" atau difilter, SAMA seperti
 * `listItems`). Status `ok`/`pending_data` dihitung ulang per menu
 * (N+1 query, ~57 baris saat ini -- acceptable, lihat catatan di tempat
 * endpoint ini didaftarkan) lewat logika HPP yang sama dengan
 * `getMenuHppReport` (`isPaketMenu` + `computeBaseMenuHppById`/
 * `computePaketHppById`, metode `harga_master`) -- TIDAK menghitung ulang
 * angka HPP-nya dari nol, cuma butuh status pending/tidaknya. Tidak ada
 * endpoint ini sebelumnya -- halaman Master Menu & HPP sempat pakai data
 * contoh statis (MOCK_MENU di frontend).
 */
export async function listMenu(client: PoolClient): Promise<MenuListRow[]> {
  const { rows } = await client.query<{
    id: number;
    kode: string | null;
    name: string;
    kategori_id: number | null;
    kategori_nama: string | null;
    is_active: boolean;
  }>(
    `SELECT m.id, m.kode, m.name, m.kategori_id,
            COALESCE(k.nama, m.kategori_menu) AS kategori_nama, m.is_active
     FROM inventory_menu m
     LEFT JOIN inventory_kategori_menu k ON k.id = m.kategori_id
     ORDER BY m.kode NULLS LAST, m.name`,
  );

  const result: MenuListRow[] = [];
  for (const row of rows) {
    const paket = await isPaketMenu(client, row.id);
    const hpp = paket
      ? await computePaketHppById(client, row.id, "harga_master")
      : await computeBaseMenuHppById(client, row.id, "harga_master");
    const status = hpp.pending || hpp.cost === null ? "pending_data" : "ok";
    result.push({
      kode: row.kode,
      name: row.name,
      kategori: row.kategori_nama,
      kategoriId: row.kategori_id === null ? null : Number(row.kategori_id),
      isActive: row.is_active,
      status,
    });
  }
  return result;
}

export interface MenuResepBarisRow {
  itemKode: string | null;
  itemName: string;
  qty: number;
  unit: string;
}

/** Baris resep menu saat ini untuk satu menu (kode M-xxx). */
export async function getMenuResep(client: PoolClient, kode: string): Promise<MenuResepBarisRow[]> {
  const menu = await menuIdByKode(client, kode);
  const { rows } = await client.query<{ kode: string | null; name: string; qty: string; unit: string }>(
    `SELECT i.kode, i.name, b.qty, b.unit
     FROM inventory_menu_resep_baris b
     JOIN inventory_items i ON i.id = b.item_id
     WHERE b.menu_id = $1
     ORDER BY i.name`,
    [menu.id],
  );
  return rows.map((row) => ({
    itemKode: row.kode,
    itemName: row.name,
    qty: Number(row.qty),
    unit: row.unit,
  }));
}

export interface MenuUsage {
  paketKode: string[];
}

async function findActiveMenuUsage(client: PoolClient, menuId: number): Promise<MenuUsage> {
  const { rows } = await client.query<{ kode: string | null }>(
    `SELECT DISTINCT pm.kode
     FROM inventory_paket_menu_baris pb
     JOIN inventory_menu pm ON pm.id = pb.paket_menu_id
     WHERE pb.item_menu_id = $1 AND pm.is_active = true`,
    [menuId],
  );
  return { paketKode: rows.map((r) => r.kode).filter((k): k is string => k !== null) };
}

/** Nonaktifkan menu (is_active=false). Ditolak kalau masih jadi komponen paket yang AKTIF. */
export async function deactivateMenu(client: PoolClient, menuKode: string, userId?: number): Promise<void> {
  const menu = await menuIdByKode(client, menuKode);
  const usage = await findActiveMenuUsage(client, menu.id);

  if (usage.paketKode.length > 0) {
    throw new Error(
      `Menu "${menuKode}" masih dipakai di paket aktif: ${usage.paketKode.join(", ")}. Nonaktifkan paket itu dulu sebelum menonaktifkan menu ini.`,
    );
  }

  await client.query(`UPDATE inventory_menu SET is_active = false, updated_at = now() WHERE id = $1`, [menu.id]);
  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "inventory_menu",
    recordId: menu.id,
    fieldName: "is_active",
    oldValue: true,
    newValue: false,
  });
}
