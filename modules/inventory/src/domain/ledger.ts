import type { PoolClient } from "pg";
import type { AuthUser } from "@samsara/core";

/**
 * Lapisan "ledger lengkap" lintas-jenis (Tahap 1D, 2026-11-14) -- union 7
 * jenis transaksi yang memosting ke `inventory_stock_ledger` (lihat enum
 * `inventory_transaction_type` migrasi 0003), masing-masing dilengkapi
 * `referensi` (teks ringkas ke transaksi asal) dan `dibuatOlehUsername`
 * (join balik ke header transaksi lewat reference_table/reference_id --
 * join BERBEDA per jenis karena reference_table kadang tabel baris,
 * kadang tabel header LANGSUNG -- lihat masing-masing cabang UNION ALL).
 *
 * `waktu` diambil dari `tanggal` (DATE) tabel HEADER masing-masing jenis,
 * BUKAN `inventory_stock_ledger.created_at` -- sengaja, konsisten dengan
 * `getDetailTransaksiPenjualan` (laporan.ts) yang juga memfilter/mengurutkan
 * lewat `h.tanggal`. `created_at` cuma waktu INSERT baris (bisa beda dari
 * tanggal efektif transaksi kalau user input data yang di-backdate, mis.
 * mencatat pembelian kemarin baru hari ini) -- `ledger_id` dipakai sebagai
 * tie-breaker urutan dalam tanggal yang sama (lebih kecil = lebih dulu
 * di-posting, berkorelasi dengan waktu insert sebenarnya).
 *
 * Dipakai DUA fitur: Kartu Stok (per item+lokasi, dengan saldo berjalan,
 * `getKartuStok`) dan Riwayat Transaksi semua jenis (lintas item, filter
 * jenis, TANPA saldo -- saldo cuma masuk akal di-scope ke satu item,
 * `getRiwayatSemuaJenis`).
 *
 * Nilai Rupiah (`hargaPerSatuan`) HANYA ada untuk 2 jenis yang punya kolom
 * harga di GRAIN BARIS ledger itu sendiri: pembelian (harga_satuan) dan
 * transfer (harga_transfer_per_satuan). Jenis lain (penjualan/produksi/
 * mutasi_lain/opname) SENGAJA null -- penjualan misalnya memposting
 * PEMAKAIAN BAHAN yang diagregasi lintas baris menu (lihat createPenjualan
 * di stok.ts), tidak ada satu angka HPP yang valid per baris ledger,
 * jadi tidak ditebak/dipaksakan di sini.
 */
const LEDGER_LENGKAP_SQL = `
  SELECT sl.id AS ledger_id, sl.item_id, sl.location_id, sl.transaction_type::text AS jenis, h.tanggal, sl.qty_change,
         ('Pembelian' || COALESCE(' ' || h.no_referensi, '') || ' #' || h.id) AS referensi,
         h.dibuat_oleh AS dibuat_oleh, b.harga_satuan AS harga_per_satuan
  FROM inventory_stock_ledger sl
  JOIN inventory_transaksi_pembelian_baris b ON sl.reference_table = 'inventory_transaksi_pembelian_baris' AND b.id = sl.reference_id
  JOIN inventory_transaksi_pembelian h ON h.id = b.header_id

  UNION ALL

  SELECT sl.id, sl.item_id, sl.location_id, sl.transaction_type::text, h.tanggal, sl.qty_change,
         ('Produksi ' || rp.kode || ' #' || h.id),
         h.dibuat_oleh, NULL::numeric
  FROM inventory_stock_ledger sl
  JOIN inventory_transaksi_produksi h ON sl.reference_table = 'inventory_transaksi_produksi' AND h.id = sl.reference_id
  JOIN inventory_resep_produksi rp ON rp.id = h.resep_id

  UNION ALL

  SELECT sl.id, sl.item_id, sl.location_id, sl.transaction_type::text, h.tanggal, sl.qty_change,
         ('Penjualan (' || h.sumber || ')' || COALESCE(' ' || h.no_referensi, '') || ' #' || h.id),
         h.dibuat_oleh, NULL::numeric
  FROM inventory_stock_ledger sl
  JOIN inventory_transaksi_penjualan h ON sl.reference_table = 'inventory_transaksi_penjualan' AND h.id = sl.reference_id

  UNION ALL

  SELECT sl.id, sl.item_id, sl.location_id, sl.transaction_type::text, h.tanggal, sl.qty_change,
         ('Transfer #' || h.id),
         h.dibuat_oleh, b.harga_transfer_per_satuan
  FROM inventory_stock_ledger sl
  JOIN inventory_transaksi_transfer_baris b ON sl.reference_table = 'inventory_transaksi_transfer_baris' AND b.id = sl.reference_id
  JOIN inventory_transaksi_transfer h ON h.id = b.header_id

  UNION ALL

  SELECT sl.id, sl.item_id, sl.location_id, sl.transaction_type::text, h.tanggal, sl.qty_change,
         ('Mutasi lain (' || h.jenis || ') #' || h.id),
         h.dibuat_oleh, NULL::numeric
  FROM inventory_stock_ledger sl
  JOIN inventory_transaksi_mutasi_lain_baris b ON sl.reference_table = 'inventory_transaksi_mutasi_lain_baris' AND b.id = sl.reference_id
  JOIN inventory_transaksi_mutasi_lain h ON h.id = b.header_id

  UNION ALL

  SELECT sl.id, sl.item_id, sl.location_id, sl.transaction_type::text, h.tanggal, sl.qty_change,
         ('Opname #' || h.id),
         h.dibuat_oleh, NULL::numeric
  FROM inventory_stock_ledger sl
  JOIN inventory_transaksi_opname_baris b ON sl.reference_table = 'inventory_transaksi_opname_baris' AND b.id = sl.reference_id
  JOIN inventory_transaksi_opname h ON h.id = b.header_id
`;

export type JenisTransaksiLedger =
  | "pembelian"
  | "produksi"
  | "penjualan"
  | "transfer_keluar"
  | "transfer_masuk"
  | "mutasi_lain"
  | "opname";

export interface LedgerBaris {
  /** Tanggal efektif transaksi (YYYY-MM-DD), BUKAN waktu insert -- lihat komentar LEDGER_LENGKAP_SQL. */
  waktu: string;
  jenis: JenisTransaksiLedger;
  referensi: string;
  itemKode: string;
  itemNama: string;
  locationId: number;
  qtyChange: number;
  /** HANYA untuk pembelian/transfer -- lihat komentar LEDGER_LENGKAP_SQL. */
  hargaPerSatuan?: number | null;
  olehUsername: string | null;
}

export interface KartuStokBaris extends LedgerBaris {
  saldo: number;
}

/** Baris kosong (`1=0`) untuk role location-scoped tanpa lokasi yang ditugaskan --
 * pola sama `getDetailTransaksiPenjualan` di laporan.ts. */
function cekLingkupLokasi(user: AuthUser, locationId: number): boolean {
  if (user.allLocations) return true;
  return user.locationIds.includes(locationId);
}

export interface KartuStokFilter {
  itemKode: string;
  locationId: number;
  tanggalMulai: string;
  tanggalSelesai: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT_LEDGER = 200;

export async function getKartuStok(
  client: PoolClient,
  user: AuthUser,
  filter: KartuStokFilter,
): Promise<{ rows: KartuStokBaris[]; total: number }> {
  if (!cekLingkupLokasi(user, filter.locationId)) {
    return { rows: [], total: 0 };
  }
  const { rows: itemRows } = await client.query<{ id: number; kode: string; name: string }>(
    `SELECT id, kode, name FROM inventory_items WHERE kode = $1`,
    [filter.itemKode],
  );
  const item = itemRows[0];
  if (!item) throw new Error(`Item dengan kode "${filter.itemKode}" tidak ditemukan`);

  const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, DEFAULT_LIMIT_LEDGER) : DEFAULT_LIMIT_LEDGER;
  const offset = filter.offset && filter.offset > 0 ? filter.offset : 0;

  const { rows } = await client.query<{
    jenis: string;
    tanggal: string;
    qty_change: string;
    referensi: string;
    harga_per_satuan: string | null;
    oleh_username: string | null;
    saldo: string;
    total: string;
  }>(
    `WITH ledger_lengkap AS (${LEDGER_LENGKAP_SQL}),
     dengan_saldo AS (
       SELECT l.*, u.username AS oleh_username,
              SUM(l.qty_change) OVER (ORDER BY l.tanggal, l.ledger_id) AS saldo
       FROM ledger_lengkap l
       LEFT JOIN core_users u ON u.id = l.dibuat_oleh
       WHERE l.item_id = $1 AND l.location_id = $2
     )
     SELECT jenis, to_char(tanggal, 'YYYY-MM-DD') AS tanggal, qty_change, referensi, harga_per_satuan, oleh_username, saldo,
            count(*) OVER() AS total
     FROM dengan_saldo
     WHERE tanggal BETWEEN $3::date AND $4::date
     ORDER BY tanggal DESC, ledger_id DESC
     LIMIT $5 OFFSET $6`,
    [item.id, filter.locationId, filter.tanggalMulai, filter.tanggalSelesai, limit, offset],
  );

  return {
    total: rows[0] ? Number(rows[0].total) : 0,
    rows: rows.map((r) => ({
      waktu: r.tanggal,
      jenis: r.jenis as JenisTransaksiLedger,
      referensi: r.referensi,
      itemKode: item.kode,
      itemNama: item.name,
      locationId: filter.locationId,
      qtyChange: Number(r.qty_change),
      hargaPerSatuan: r.harga_per_satuan === null ? null : Number(r.harga_per_satuan),
      olehUsername: r.oleh_username,
      saldo: Number(r.saldo),
    })),
  };
}

export interface RiwayatSemuaJenisFilter {
  tanggalMulai: string;
  tanggalSelesai: string;
  locationId?: number;
  jenis?: JenisTransaksiLedger;
  limit?: number;
  offset?: number;
}

/**
 * Riwayat lintas SEMUA jenis transaksi, filter opsional per jenis -- generalisasi
 * dari `getDetailTransaksiPenjualan` (yang cuma penjualan) ke 7 jenis sekaligus.
 * Lingkup lokasi SAMA seperti itu: owner/manajer_ops bebas (boleh persempit lewat
 * `locationId`), role lain SELALU dibatasi ke `user.locationIds` walau `locationId`
 * tidak dikirim.
 */
export async function getRiwayatSemuaJenis(
  client: PoolClient,
  user: AuthUser,
  filter: RiwayatSemuaJenisFilter,
): Promise<{ rows: LedgerBaris[]; total: number }> {
  const params: unknown[] = [filter.tanggalMulai, filter.tanggalSelesai];
  const conditions: string[] = ["l.tanggal BETWEEN $1::date AND $2::date"];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (user.allLocations) {
    if (filter.locationId !== undefined) conditions.push(`l.location_id = ${bind(filter.locationId)}`);
  } else if (user.locationIds.length === 0) {
    conditions.push("1 = 0");
  } else {
    conditions.push(`l.location_id = ANY(${bind(user.locationIds)}::bigint[])`);
    if (filter.locationId !== undefined && user.locationIds.includes(filter.locationId)) {
      conditions.push(`l.location_id = ${bind(filter.locationId)}`);
    }
  }

  if (filter.jenis !== undefined) conditions.push(`l.jenis = ${bind(filter.jenis)}`);

  const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, DEFAULT_LIMIT_LEDGER) : DEFAULT_LIMIT_LEDGER;
  const offset = filter.offset && filter.offset > 0 ? filter.offset : 0;

  const { rows } = await client.query<{
    jenis: string;
    tanggal: string;
    qty_change: string;
    referensi: string;
    harga_per_satuan: string | null;
    oleh_username: string | null;
    item_kode: string;
    item_nama: string;
    location_id: string;
    total: string;
  }>(
    `WITH ledger_lengkap AS (${LEDGER_LENGKAP_SQL})
     SELECT l.jenis, to_char(l.tanggal, 'YYYY-MM-DD') AS tanggal, l.qty_change, l.referensi, l.harga_per_satuan,
            u.username AS oleh_username, i.kode AS item_kode, i.name AS item_nama, l.location_id,
            count(*) OVER() AS total
     FROM ledger_lengkap l
     JOIN inventory_items i ON i.id = l.item_id
     LEFT JOIN core_users u ON u.id = l.dibuat_oleh
     WHERE ${conditions.join(" AND ")}
     ORDER BY l.tanggal DESC, l.ledger_id DESC
     LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
    params,
  );

  return {
    total: rows[0] ? Number(rows[0].total) : 0,
    rows: rows.map((r) => ({
      waktu: r.tanggal,
      jenis: r.jenis as JenisTransaksiLedger,
      referensi: r.referensi,
      itemKode: r.item_kode,
      itemNama: r.item_nama,
      locationId: Number(r.location_id),
      qtyChange: Number(r.qty_change),
      hargaPerSatuan: r.harga_per_satuan === null ? null : Number(r.harga_per_satuan),
      olehUsername: r.oleh_username,
    })),
  };
}
