import type { PoolClient } from "pg";
import { writeAuditLog } from "@samsara/core";

/**
 * Mesin HPP. Semua fungsi menerima `client` yang transaksinya (BEGIN/COMMIT)
 * dikendalikan pemanggil (route handler atau test) -- domain layer ini tidak
 * pernah membuka/menutup transaksi sendiri.
 */

export type HppMethod = "harga_master" | "harga_beli_terakhir";

export interface CostResult {
  /** Biaya per satuan resep (Rp). `null` kalau tidak bisa dihitung. */
  cost: number | null;
  /** `true` kalau ada data yang belum lengkap di rantai biayanya. */
  pending: boolean;
}

const MAX_RESEP_DEPTH = 5;

async function latestPurchaseCostPerUnit(client: PoolClient, itemId: number): Promise<number | null> {
  const { rows } = await client.query<{ harga_satuan: string; qty_beli: string; qty_recipe_unit: string }>(
    `SELECT b.harga_satuan, b.qty_beli, b.qty_recipe_unit
     FROM inventory_transaksi_pembelian_baris b
     JOIN inventory_transaksi_pembelian h ON h.id = b.header_id
     WHERE b.item_id = $1
     ORDER BY h.tanggal DESC, b.id DESC
     LIMIT 1`,
    [itemId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  const qtyRecipe = Number(row.qty_recipe_unit);
  if (qtyRecipe === 0) return null;
  return (Number(row.harga_satuan) * Number(row.qty_beli)) / qtyRecipe;
}

async function resolveSetengahJadiCost(
  client: PoolClient,
  itemId: number,
  method: HppMethod,
  depth: number,
): Promise<CostResult> {
  const { rows: recipeRows } = await client.query<{ id: number; yield_qty: string | null }>(
    `SELECT id, yield_qty FROM inventory_resep_produksi WHERE output_item_id = $1`,
    [itemId],
  );
  const recipe = recipeRows[0];
  if (!recipe || recipe.yield_qty === null) {
    return { cost: null, pending: true };
  }

  const { rows: lines } = await client.query<{ bahan_item_id: number; qty: string }>(
    `SELECT bahan_item_id, qty FROM inventory_resep_produksi_baris WHERE resep_id = $1`,
    [recipe.id],
  );

  let total = 0;
  for (const line of lines) {
    const bahanCost = await resolveItemCost(client, line.bahan_item_id, method, depth + 1);
    if (bahanCost.pending || bahanCost.cost === null) {
      return { cost: null, pending: true };
    }
    total += bahanCost.cost * Number(line.qty);
  }

  const yieldQty = Number(recipe.yield_qty);
  if (yieldQty === 0) return { cost: null, pending: true };
  return { cost: total / yieldQty, pending: false };
}

/**
 * Biaya per satuan resep untuk satu item. `setengah_jadi` diresolusi
 * rekursif dari resep produksinya (1 level, dijaga trigger DB); tipe lain
 * baca `harga_master` langsung atau harga beli terakhir, sesuai `method`.
 */
export async function resolveItemCost(
  client: PoolClient,
  itemId: number,
  method: HppMethod = "harga_master",
  depth = 0,
): Promise<CostResult> {
  if (depth > MAX_RESEP_DEPTH) {
    throw new Error(`Resolusi biaya item id ${itemId} melebihi kedalaman wajar (kemungkinan siklus resep)`);
  }

  const { rows } = await client.query<{ id: number; type: string; harga_master: string | null }>(
    `SELECT id, type, harga_master FROM inventory_items WHERE id = $1`,
    [itemId],
  );
  const item = rows[0];
  if (!item) throw new Error(`Item id ${itemId} tidak ditemukan`);

  if (item.type === "setengah_jadi") {
    return resolveSetengahJadiCost(client, itemId, method, depth);
  }

  if (method === "harga_beli_terakhir") {
    const cost = await latestPurchaseCostPerUnit(client, itemId);
    return { cost, pending: cost === null };
  }

  const cost = item.harga_master === null ? null : Number(item.harga_master);
  return { cost, pending: cost === null };
}

export async function computeBaseMenuHppById(client: PoolClient, menuId: number, method: HppMethod): Promise<CostResult> {
  const { rows } = await client.query<{ item_id: number; qty: string }>(
    `SELECT item_id, qty FROM inventory_menu_resep_baris WHERE menu_id = $1`,
    [menuId],
  );
  if (rows.length === 0) return { cost: null, pending: true };

  let total = 0;
  for (const line of rows) {
    const itemCost = await resolveItemCost(client, line.item_id, method);
    if (itemCost.pending || itemCost.cost === null) return { cost: null, pending: true };
    total += itemCost.cost * Number(line.qty);
  }
  return { cost: total, pending: false };
}

/**
 * HPP paket = rollup dari HPP komponen (menu dasar) x qty, TANPA baris
 * resep milik paket itu sendiri (mis. kemasan luar paket) -- ini metodologi
 * yang sama dipakai kolom HPP di Master_Menu sumber (diverifikasi Tahap 2,
 * lihat docs/architecture-decisions.md § 9). Baris resep milik paket
 * sendiri TETAP dipakai untuk pengurangan stok (lihat domain/stok.ts),
 * cuma tidak dihitung sebagai bagian HPP/harga.
 */
export async function computePaketHppById(client: PoolClient, paketMenuId: number, method: HppMethod): Promise<CostResult> {
  const { rows } = await client.query<{ item_menu_id: number; qty: string }>(
    `SELECT item_menu_id, qty FROM inventory_paket_menu_baris WHERE paket_menu_id = $1`,
    [paketMenuId],
  );
  if (rows.length === 0) return { cost: null, pending: true };

  let total = 0;
  for (const row of rows) {
    const componentHpp = await computeBaseMenuHppById(client, row.item_menu_id, method);
    if (componentHpp.pending || componentHpp.cost === null) return { cost: null, pending: true };
    total += componentHpp.cost * Number(row.qty);
  }
  return { cost: total, pending: false };
}

export async function isPaketMenu(client: PoolClient, menuId: number): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM inventory_paket_menu_baris WHERE paket_menu_id = $1 LIMIT 1`, [
    menuId,
  ]);
  return rows.length > 0;
}

export interface MenuChannelInfo {
  channel: string;
  /** `null` kalau belum ada baris harga untuk menu+channel ini. */
  hargaJual: number | null;
  /** `null` kalau HPP pending ATAU `hargaJual` belum diisi. */
  foodCostPct: number | null;
  /** `null` kalau HPP pending ATAU `hargaJual` belum diisi. */
  markupPct: number | null;
  /** `null` kalau HPP pending ATAU `hargaJual` belum diisi. */
  marginPct: number | null;
  /** `belum_diisi` cuma berarti belum ada baris harga -- TIDAK dipengaruhi status HPP pending. */
  status: "ok" | "belum_diisi";
  /**
   * Apakah menu ini DITAYANGKAN di channel ini
   * (`inventory_menu_channel_visibilitas`, migrasi 0024). Semantik tabel itu
   * "pengecualian": tidak ada baris = tayang, jadi field ini `true` kecuali
   * ada baris eksplisit `aktif = false`. INDEPENDEN dari `hargaJual`/`status`
   * -- menu bisa punya harga tapi disembunyikan, atau tayang tapi harganya
   * belum diisi.
   */
  isVisible: boolean;
}

/**
 * Breakdown harga per channel penjualan AKTIF untuk satu menu -- SEMUA
 * channel aktif ditampilkan, termasuk yang belum punya baris di
 * `inventory_menu_harga_channel` (tampil `hargaJual: null`,
 * `status: "belum_diisi"`, bukan error/baris hilang). Sekalian membawa
 * `isVisible` (tayang/tidak di channel itu) -- lihat `MenuChannelInfo`.
 */
async function getMenuChannelBreakdown(
  client: PoolClient,
  menuKode: string,
  hpp: CostResult,
): Promise<MenuChannelInfo[]> {
  // LEFT JOIN kedua (v) ke tabel visibilitas: `v.aktif IS NOT FALSE` -> tidak
  // ada baris ATAU barisnya aktif=true dua-duanya berarti TAYANG, sesuai
  // semantik tabel pengecualian di migrasi 0024 (jangan diubah jadi
  // INNER JOIN/EXISTS -- tabel itu nyaris selalu kosong).
  const { rows } = await client.query<{ channel: string; harga_jual: string | null; is_visible: boolean }>(
    `SELECT c.name AS channel, h.harga_jual, (v.aktif IS NOT FALSE) AS is_visible
     FROM inventory_sales_channel c
     LEFT JOIN inventory_menu_harga_channel h ON h.channel = c.name AND h.kode_menu = $1
     LEFT JOIN inventory_menu_channel_visibilitas v ON v.channel = c.name AND v.kode_menu = $1
     WHERE c.is_active = true
     ORDER BY c.name`,
    [menuKode],
  );
  const pending = hpp.pending || hpp.cost === null;

  return rows.map((row) => {
    const isVisible = row.is_visible;
    const hargaJual = row.harga_jual === null ? null : Number(row.harga_jual);
    if (hargaJual === null) {
      return {
        channel: row.channel,
        hargaJual: null,
        foodCostPct: null,
        markupPct: null,
        marginPct: null,
        status: "belum_diisi",
        isVisible,
      };
    }
    if (pending) {
      return {
        channel: row.channel,
        hargaJual,
        foodCostPct: null,
        markupPct: null,
        marginPct: null,
        status: "ok",
        isVisible,
      };
    }
    const cost = hpp.cost as number;
    const foodCostPct = hargaJual === 0 ? null : (cost / hargaJual) * 100;
    const markupPct = cost === 0 ? null : ((hargaJual - cost) / cost) * 100;
    const marginPct = foodCostPct === null ? null : 100 - foodCostPct;
    return { channel: row.channel, hargaJual, foodCostPct, markupPct, marginPct, status: "ok", isVisible };
  });
}

export interface MenuHppReport {
  kode: string;
  name: string;
  /** `null` kalau status `pending_data`. */
  hpp_per_porsi: number | null;
  status: "ok" | "pending_data";
  /**
   * LEGACY, dipertahankan untuk backward-compat konsumen yang belum pindah
   * ke `channels` -- diisi dari baris channel "Offline" (fallback `null`
   * kalau belum ada baris Offline). BUKAN lagi sumber kebenaran harga jual
   * (itu `inventory_menu_harga_channel`, lihat domain/harga-channel.ts).
   */
  harga_jual: number | null;
  /** LEGACY, lihat `harga_jual` di atas -- `null` kalau HPP pending ATAU harga Offline belum diisi. */
  food_cost_pct: number | null;
  /** LEGACY, lihat `harga_jual` di atas -- `null` kalau HPP pending ATAU harga Offline belum diisi. */
  margin: number | null;
  /** Breakdown harga per channel penjualan aktif -- sumber kebenaran harga jual per channel. */
  channels: MenuChannelInfo[];
}

function buildHppReport(kode: string, name: string, hpp: CostResult, channels: MenuChannelInfo[]): MenuHppReport {
  const pending = hpp.pending || hpp.cost === null;
  const offline = channels.find((c) => c.channel === "Offline");
  const hargaJual = offline?.hargaJual ?? null;

  let foodCostPct: number | null = null;
  let margin: number | null = null;
  if (!pending && hargaJual !== null) {
    margin = hargaJual - (hpp.cost as number);
    foodCostPct = hargaJual === 0 ? null : ((hpp.cost as number) / hargaJual) * 100;
  }

  return {
    kode,
    name,
    hpp_per_porsi: pending ? null : hpp.cost,
    status: pending ? "pending_data" : "ok",
    harga_jual: hargaJual,
    food_cost_pct: foodCostPct,
    margin,
    channels,
  };
}

/**
 * HPP + food cost % + margin untuk satu menu (kode M-xxx), baik menu dasar
 * maupun paket, PLUS breakdown harga per channel penjualan aktif
 * (`channels`). Field legacy top-level (`harga_jual`/`food_cost_pct`/
 * `margin`) diisi dari channel "Offline" untuk backward-compat -- lihat
 * `MenuHppReport`.
 */
export async function getMenuHppReport(
  client: PoolClient,
  menuKode: string,
  method: HppMethod = "harga_master",
): Promise<MenuHppReport> {
  const { rows } = await client.query<{ id: number; name: string }>(
    `SELECT id, name FROM inventory_menu WHERE kode = $1`,
    [menuKode],
  );
  const menu = rows[0];
  if (!menu) throw new Error(`Menu dengan kode "${menuKode}" tidak ditemukan`);

  const paket = await isPaketMenu(client, menu.id);
  const hpp = paket
    ? await computePaketHppById(client, menu.id, method)
    : await computeBaseMenuHppById(client, menu.id, method);

  const channels = await getMenuChannelBreakdown(client, menuKode, hpp);
  return buildHppReport(menuKode, menu.name, hpp, channels);
}

/** Ubah harga jual satu menu. Akses dibatasi lewat permission `harga_jual.edit` di router, bukan di sini. */
export async function setMenuHargaJual(
  client: PoolClient,
  menuKode: string,
  hargaJual: number,
  userId?: number,
): Promise<void> {
  const { rows } = await client.query<{ id: number; harga_jual: string | null }>(
    `SELECT id, harga_jual FROM inventory_menu WHERE kode = $1`,
    [menuKode],
  );
  const menu = rows[0];
  if (!menu) throw new Error(`Menu dengan kode "${menuKode}" tidak ditemukan`);

  await client.query(`UPDATE inventory_menu SET harga_jual = $1, updated_at = now() WHERE id = $2`, [
    hargaJual,
    menu.id,
  ]);

  const oldValue = menu.harga_jual === null ? null : Number(menu.harga_jual);
  if (oldValue !== hargaJual) {
    await writeAuditLog(client, {
      userId: userId ?? null,
      tableName: "inventory_menu",
      recordId: menu.id,
      fieldName: "harga_jual",
      oldValue,
      newValue: hargaJual,
    });
  }
}

export interface ItemCostReport {
  kode: string | null;
  name: string;
  cost_per_recipe_unit: number | null;
  status: "ok" | "pending_data";
}

/** Biaya per satuan resep untuk satu item, dicari lewat kode item (mis. SJ-003). */
export async function getItemCostReport(
  client: PoolClient,
  itemKode: string,
  method: HppMethod = "harga_master",
): Promise<ItemCostReport> {
  const { rows } = await client.query<{ id: number; kode: string | null; name: string }>(
    `SELECT id, kode, name FROM inventory_items WHERE kode = $1`,
    [itemKode],
  );
  const item = rows[0];
  if (!item) throw new Error(`Item dengan kode "${itemKode}" tidak ditemukan`);

  const result = await resolveItemCost(client, item.id, method);
  return {
    kode: item.kode,
    name: item.name,
    cost_per_recipe_unit: result.pending ? null : result.cost,
    status: result.pending ? "pending_data" : "ok",
  };
}
