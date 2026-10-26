import type { PoolClient } from "pg";

/**
 * Vendor & katalog harga per item -- Tahap 3. SENGAJA SEMPIT: vendor,
 * katalog (harga terakhir per vendor+item), riwayat harga, dan integrasi
 * satu arah dari Pembelian (vendor_id opsional -> auto-update katalog).
 * TIDAK ADA PO, hutang, retur, atau QC -- di luar scope tahap ini.
 */

// ---------------------------------------------------------------------------
// Vendor (CRUD)
// ---------------------------------------------------------------------------

export interface VendorRow {
  id: number;
  name: string;
  kontakNama: string | null;
  telepon: string | null;
  alamat: string | null;
  /** Syarat pembayaran, teks bebas -- opsional, informasional saja (migrasi 0031). */
  termin: string | null;
  isActive: boolean;
}

function toVendorRow(row: {
  id: number;
  name: string;
  kontak_nama: string | null;
  telepon: string | null;
  alamat: string | null;
  termin: string | null;
  is_active: boolean;
}): VendorRow {
  return {
    id: row.id,
    name: row.name,
    kontakNama: row.kontak_nama,
    telepon: row.telepon,
    alamat: row.alamat,
    termin: row.termin,
    isActive: row.is_active,
  };
}

/** @param search Opsional -- filter ILIKE ke nama vendor (pencarian, case-insensitive, tanpa perlu cocok persis). */
export async function listVendor(client: PoolClient, search?: string): Promise<VendorRow[]> {
  const params: unknown[] = [];
  let where = "";
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    where = `WHERE name ILIKE $1`;
  }
  const { rows } = await client.query(
    `SELECT id, name, kontak_nama, telepon, alamat, termin, is_active FROM inventory_vendor ${where} ORDER BY name`,
    params,
  );
  return rows.map(toVendorRow);
}

export interface VendorInput {
  name: string;
  kontakNama?: string | null;
  telepon?: string | null;
  alamat?: string | null;
  termin?: string | null;
}

export async function createVendor(client: PoolClient, input: VendorInput): Promise<{ id: number }> {
  if (!input.name.trim()) throw new Error("Nama vendor wajib diisi");
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_vendor (name, kontak_nama, telepon, alamat, termin) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.name.trim(), input.kontakNama ?? null, input.telepon ?? null, input.alamat ?? null, input.termin ?? null],
  );
  return { id: rows[0].id };
}

export interface UpdateVendorInput {
  name?: string;
  kontakNama?: string | null;
  telepon?: string | null;
  alamat?: string | null;
  termin?: string | null;
  isActive?: boolean;
}

export async function updateVendor(client: PoolClient, id: number, input: UpdateVendorInput): Promise<void> {
  const { rows } = await client.query<{
    name: string;
    kontak_nama: string | null;
    telepon: string | null;
    alamat: string | null;
    termin: string | null;
    is_active: boolean;
  }>(`SELECT name, kontak_nama, telepon, alamat, termin, is_active FROM inventory_vendor WHERE id = $1`, [id]);
  const old = rows[0];
  if (!old) throw new Error(`Vendor id ${id} tidak ditemukan`);
  if (input.name !== undefined && !input.name.trim()) throw new Error("Nama vendor tidak boleh kosong");

  await client.query(
    `UPDATE inventory_vendor SET name = $1, kontak_nama = $2, telepon = $3, alamat = $4, termin = $5, is_active = $6 WHERE id = $7`,
    [
      input.name?.trim() ?? old.name,
      input.kontakNama === undefined ? old.kontak_nama : input.kontakNama,
      input.telepon === undefined ? old.telepon : input.telepon,
      input.alamat === undefined ? old.alamat : input.alamat,
      input.termin === undefined ? old.termin : input.termin,
      input.isActive ?? old.is_active,
      id,
    ],
  );
}

// ---------------------------------------------------------------------------
// Katalog (harga terakhir per vendor+item) + riwayat harga
// ---------------------------------------------------------------------------

export interface KatalogRow {
  itemId: number;
  itemKode: string | null;
  itemName: string;
  /** Di-strip di router untuk role tanpa permission hpp.lihat_harga -- lihat pola sama di GET /items. */
  hargaTerakhir: number;
  updatedAt: string;
}

/** Katalog SATU vendor -- daftar item yang pernah dicatat harganya dari vendor ini. */
export async function listKatalogByVendor(client: PoolClient, vendorId: number): Promise<KatalogRow[]> {
  const { rows } = await client.query<{
    item_id: number;
    kode: string | null;
    name: string;
    harga_terakhir: string;
    updated_at: string;
  }>(
    `SELECT k.item_id, i.kode, i.name, k.harga_terakhir::text AS harga_terakhir, k.updated_at
     FROM inventory_vendor_katalog k
     JOIN inventory_items i ON i.id = k.item_id
     WHERE k.vendor_id = $1
     ORDER BY i.name`,
    [vendorId],
  );
  return rows.map((r) => ({
    itemId: r.item_id,
    itemKode: r.kode,
    itemName: r.name,
    hargaTerakhir: Number(r.harga_terakhir),
    updatedAt: r.updated_at,
  }));
}

export interface VendorUntukItemRow {
  vendorId: number;
  vendorName: string;
  hargaTerakhir: number;
  updatedAt: string;
}

/** "Pencarian barang ke vendor": untuk SATU item, vendor mana saja yang pernah mencatatkan harganya, dan berapa. */
export async function listVendorUntukItem(client: PoolClient, itemKode: string): Promise<VendorUntukItemRow[]> {
  const { rows } = await client.query<{
    vendor_id: number;
    vendor_name: string;
    harga_terakhir: string;
    updated_at: string;
  }>(
    `SELECT k.vendor_id, v.name AS vendor_name, k.harga_terakhir::text AS harga_terakhir, k.updated_at
     FROM inventory_vendor_katalog k
     JOIN inventory_vendor v ON v.id = k.vendor_id
     JOIN inventory_items i ON i.id = k.item_id
     WHERE i.kode = $1
     ORDER BY k.harga_terakhir ASC`,
    [itemKode],
  );
  return rows.map((r) => ({
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    hargaTerakhir: Number(r.harga_terakhir),
    updatedAt: r.updated_at,
  }));
}

/** Harga terakhir SATU kombinasi vendor+item -- dipakai form Pembelian untuk isi-otomatis. Null kalau belum pernah dicatat. */
export async function getHargaTerakhir(
  client: PoolClient,
  vendorId: number,
  itemKode: string,
): Promise<number | null> {
  const { rows } = await client.query<{ harga_terakhir: string }>(
    `SELECT k.harga_terakhir::text AS harga_terakhir
     FROM inventory_vendor_katalog k JOIN inventory_items i ON i.id = k.item_id
     WHERE k.vendor_id = $1 AND i.kode = $2`,
    [vendorId, itemKode],
  );
  return rows[0] ? Number(rows[0].harga_terakhir) : null;
}

/** Ambang kenaikan harga (persen) dari inventory_insight_rules -- fallback 10 kalau baris belum ada/nonaktif (seharusnya selalu ada sejak migrasi 0030). */
export async function getAmbangKenaikanHargaPersen(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ ambang_batas: string }>(
    `SELECT ambang_batas::text AS ambang_batas FROM inventory_insight_rules
     WHERE kode = 'kenaikan_harga_vendor_persen' AND aktif = true`,
  );
  return rows[0] ? Number(rows[0].ambang_batas) : 10;
}

/**
 * Catat SATU titik harga (manual, lewat halaman katalog -- BUKAN dari
 * pembelian, lihat `catatHargaDariPembelian` untuk jalur itu). Upsert
 * katalog (harga_terakhir) + selalu INSERT baris riwayat baru.
 */
export async function catatHargaManual(
  client: PoolClient,
  vendorId: number,
  itemKode: string,
  harga: number,
): Promise<void> {
  if (!Number.isFinite(harga) || harga < 0) throw new Error("Harga wajib angka >= 0");
  const { rows: itemRows } = await client.query<{ id: number }>(`SELECT id FROM inventory_items WHERE kode = $1`, [
    itemKode,
  ]);
  const item = itemRows[0];
  if (!item) throw new Error(`Item dengan kode "${itemKode}" tidak ditemukan`);

  await client.query(
    `INSERT INTO inventory_vendor_katalog (vendor_id, item_id, harga_terakhir, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (vendor_id, item_id) DO UPDATE SET harga_terakhir = EXCLUDED.harga_terakhir, updated_at = now()`,
    [vendorId, item.id, harga],
  );
  await client.query(
    `INSERT INTO inventory_vendor_harga_riwayat (vendor_id, item_id, harga, sumber) VALUES ($1, $2, $3, 'manual')`,
    [vendorId, item.id, harga],
  );
}

export interface RiwayatHargaRow {
  harga: number;
  sumber: string;
  dicatatPada: string;
}

export async function listRiwayatHarga(
  client: PoolClient,
  vendorId: number,
  itemKode: string,
): Promise<RiwayatHargaRow[]> {
  // `id DESC` sebagai tiebreaker WAJIB, bukan kosmetik: `now()` Postgres
  // mengembalikan nilai yang SAMA PERSIS untuk SEMUA pemanggilan di dalam
  // satu transaksi yang sama (waktu AWAL transaksi, bukan waktu statement
  // berjalan) -- dua baris riwayat yang ditulis dalam satu transaksi (mis.
  // satu pembelian dengan beberapa baris item yang sama, atau test yang
  // mencatat dua harga berurutan) akan punya `dicatat_pada` identik, jadi
  // `ORDER BY dicatat_pada DESC` sendirian TIDAK menjamin urutan
  // insersi -- dikonfirmasi lewat test yang gagal sampai tiebreaker ini
  // ditambahkan (lihat vendor.test.ts).
  const { rows } = await client.query<{ harga: string; sumber: string; dicatat_pada: string }>(
    `SELECT r.harga::text AS harga, r.sumber, r.dicatat_pada
     FROM inventory_vendor_harga_riwayat r
     JOIN inventory_items i ON i.id = r.item_id
     WHERE r.vendor_id = $1 AND i.kode = $2
     ORDER BY r.dicatat_pada DESC, r.id DESC`,
    [vendorId, itemKode],
  );
  return rows.map((r) => ({ harga: Number(r.harga), sumber: r.sumber, dicatatPada: r.dicatat_pada }));
}

/**
 * Dipanggil dari `createPembelian` (stok.ts) untuk TIAP baris pembelian
 * yang header-nya punya `vendorId`. Mengembalikan info kenaikan harga
 * (kalau ADA harga lama DAN kenaikannya melewati ambang) supaya pemanggil
 * bisa mengumpulkan jadi satu daftar peringatan di response.
 */
export interface HasilCatatHargaPembelian {
  peringatanKenaikan: { persenKenaikan: number; hargaLama: number; hargaBaru: number } | null;
}

export async function catatHargaDariPembelian(
  client: PoolClient,
  params: { vendorId: number; itemId: number; hargaBaru: number; pembelianHeaderId: number },
): Promise<HasilCatatHargaPembelian> {
  const { rows: existing } = await client.query<{ harga_terakhir: string }>(
    `SELECT harga_terakhir::text AS harga_terakhir FROM inventory_vendor_katalog WHERE vendor_id = $1 AND item_id = $2`,
    [params.vendorId, params.itemId],
  );
  const hargaLama = existing[0] ? Number(existing[0].harga_terakhir) : null;

  await client.query(
    `INSERT INTO inventory_vendor_katalog (vendor_id, item_id, harga_terakhir, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (vendor_id, item_id) DO UPDATE SET harga_terakhir = EXCLUDED.harga_terakhir, updated_at = now()`,
    [params.vendorId, params.itemId, params.hargaBaru],
  );
  await client.query(
    `INSERT INTO inventory_vendor_harga_riwayat (vendor_id, item_id, harga, sumber, reference_id)
     VALUES ($1, $2, $3, 'pembelian', $4)`,
    [params.vendorId, params.itemId, params.hargaBaru, params.pembelianHeaderId],
  );

  if (hargaLama === null || hargaLama <= 0) return { peringatanKenaikan: null };
  const persenKenaikan = ((params.hargaBaru - hargaLama) / hargaLama) * 100;
  const ambang = await getAmbangKenaikanHargaPersen(client);
  if (persenKenaikan <= ambang) return { peringatanKenaikan: null };
  return { peringatanKenaikan: { persenKenaikan, hargaLama, hargaBaru: params.hargaBaru } };
}

// ---------------------------------------------------------------------------
// Laporan teks supplier lama (TIDAK digabung otomatis ke vendor -- lihat
// COMMENT ON COLUMN inventory_transaksi_pembelian.supplier di migrasi 0030)
// ---------------------------------------------------------------------------

export interface SupplierLamaRow {
  supplier: string;
  jumlahPembelian: number;
  pembelianTerakhir: string;
}

export async function laporkanSupplierLama(client: PoolClient): Promise<SupplierLamaRow[]> {
  const { rows } = await client.query<{ supplier: string; jumlah: string; terakhir: string }>(
    `SELECT supplier, count(*)::text AS jumlah, max(tanggal)::text AS terakhir
     FROM inventory_transaksi_pembelian
     WHERE supplier IS NOT NULL AND supplier <> '' AND vendor_id IS NULL
     GROUP BY supplier
     ORDER BY count(*) DESC, supplier`,
  );
  return rows.map((r) => ({ supplier: r.supplier, jumlahPembelian: Number(r.jumlah), pembelianTerakhir: r.terakhir }));
}
