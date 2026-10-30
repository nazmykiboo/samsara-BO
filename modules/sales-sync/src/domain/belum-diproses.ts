import type { PoolClient } from "pg";

/**
 * Daftar baris arsip log penjualan yang BELUM diproses jadi transaksi
 * Penjualan modul Inventory -- untuk ditampilkan sebagai histori "belum
 * pengaruh stok" di halaman Riwayat Transaksi.
 *
 * SENGAJA file terpisah dari `proses.ts`, bukan fungsi tambahan di sana:
 * `proses.ts` mengelola transaksinya sendiri dan memanggil API Inventory lewat
 * HTTP, sedangkan fungsi di sini MURNI BACA -- satu SELECT di satu
 * `PoolClient` milik router, tanpa menyentuh HTTP, modul lain, maupun
 * `processed_at` apa pun (pola domain read-only sederhana seperti
 * `listItemMapping` di item-mapping.ts).
 */

export interface BarisBelumDiproses {
  platform: string;
  orderId: string;
  tanggal: string; // YYYY-MM-DD
  /** "HH:MM:SS" -- kolom TIME, selalu terisi untuk baris sales-sync (beda dari `jam` transaksi Inventory yang bisa null). */
  jam: string;
  menuId: string | null;
  itemName: string;
  quantity: number;
  /** 'menu' | 'addon' | 'refund' -- dipakai frontend menandai order "Perlu ditinjau" kalau ada baris refund (konsisten dengan proses.ts). */
  itemType: string;
  /** `true` kalau `menuId` punya pemetaan BERSTATUS 'dipetakan' di salessync_item_mapping -- dipakai frontend menandai order "Tertahan" kalau ADA baris yang false. */
  sudahTerpetakan: boolean;
}

export interface FilterBelumDiproses {
  tanggalMulai?: string; // YYYY-MM-DD
  tanggalSelesai?: string;
  /** Jumlah ORDER (bukan baris) per halaman -- lihat `DEFAULT_LIMIT_BELUM_DIPROSES`. */
  limit?: number;
  /** Jumlah ORDER yang dilewati dari awal (paginasi). */
  offset?: number;
}

export interface HasilBelumDiproses {
  rows: BarisBelumDiproses[];
  /** Jumlah TOTAL order (bukan baris) yang cocok filter, TANPA limit/offset. */
  totalOrder: number;
}

/** Pola sama dengan `DEFAULT_LIMIT_DETAIL_PENJUALAN` di modules/inventory -- paginasi per ORDER, bukan per baris, supaya satu order tidak terpotong di tengah antar halaman. */
export const DEFAULT_LIMIT_BELUM_DIPROSES = 200;

/**
 * Baris log berstatus `inv_status = 'OK'` yang `processed_at`-nya masih NULL --
 * kriteria IDENTIK dengan yang dibaca `bacaDataProses` di proses.ts, supaya
 * yang terlihat di layar persis himpunan yang akan ikut kalau POST /proses
 * dijalankan.
 *
 * KEDUA filter tanggal OPSIONAL, BEDA dari `POST /sales-sync/proses` yang
 * MEWAJIBKAN `tanggalMulai`. Pengaman wajib-tanggal di sana ada karena /proses
 * MENULIS (bisa memicu pengurangan stok untuk seluruh riwayat sekaligus);
 * fungsi ini tidak menulis apa pun, jadi tidak ada risiko yang perlu dijaga.
 * Tanpa filter tanggal sama sekali -> SELURUH order belum-diproses yang cocok
 * tetap ikut DIHITUNG di `totalOrder`, tapi baris yang DIKEMBALIKAN tetap
 * dibatasi `limit`/`offset` (2026-10-30: beda dari versi sebelumnya yang
 * mengembalikan SEMUA baris tanpa batas sama sekali dan dipotong di
 * FRONTEND -- lihat paginasi di `getDetailTransaksiPenjualan` modul
 * Inventory untuk pola yang sama).
 */
export async function listBelumDiproses(
  client: PoolClient,
  filter: FilterBelumDiproses,
): Promise<HasilBelumDiproses> {
  const kondisi: string[] = [`inv_status = 'OK'`, `processed_at IS NULL`];
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filter.tanggalMulai) {
    kondisi.push(`transaction_date >= ${bind(filter.tanggalMulai)}::date`);
  }
  if (filter.tanggalSelesai) {
    kondisi.push(`transaction_date <= ${bind(filter.tanggalSelesai)}::date`);
  }

  const limit =
    Number.isFinite(filter.limit) && (filter.limit as number) > 0
      ? Math.min(filter.limit as number, DEFAULT_LIMIT_BELUM_DIPROSES)
      : DEFAULT_LIMIT_BELUM_DIPROSES;
  const offset = Number.isFinite(filter.offset) && (filter.offset as number) > 0 ? (filter.offset as number) : 0;

  // Langkah 1: paginasi di level ORDER (platform + tanggal + order_id, kunci
  // yang SAMA dipakai proses.ts mengelompokkan) -- pola sama dengan
  // getDetailTransaksiPenjualan di modul Inventory, supaya satu order tidak
  // terpotong di tengah kalau jatuh di batas halaman.
  const { rows: orderRows } = await client.query<{
    platform: string;
    order_id: string;
    tanggal: string;
    total: string;
  }>(
    `SELECT platform, order_id, to_char(transaction_date, 'YYYY-MM-DD') AS tanggal, count(*) OVER() AS total
     FROM (
       SELECT DISTINCT platform, order_id, transaction_date
       FROM salessync_log_penjualan
       WHERE ${kondisi.join(" AND ")}
     ) o
     ORDER BY transaction_date DESC, platform, order_id
     LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
    params,
  );

  const totalOrder = orderRows[0] ? Number(orderRows[0].total) : 0;
  if (orderRows.length === 0) {
    return { rows: [], totalOrder };
  }

  // Langkah 2: semua baris untuk order-order di halaman ini, SEKALIGUS
  // dengan status pemetaan (LEFT JOIN, bukan N+1 query per baris -- pola
  // sama dengan SUMBER_PENCATATAN_SQL di modul Inventory). Dicocokkan lewat
  // KUNCI TEKS gabungan (bukan tuple IN/unnest 3-kolom yang lebih rawan
  // salah tulis) -- separator '|' aman karena platform/order_id dari sumber
  // ini tidak pernah mengandung karakter itu (lihat unique_key di
  // import-csv.ts yang sudah memakai pola pemisah sama).
  const kunciOrder = orderRows.map((r) => `${r.platform}|${r.order_id}|${r.tanggal}`);
  const { rows } = await client.query<{
    platform: string;
    order_id: string;
    tanggal: string;
    jam: string;
    menu_id: string | null;
    item_name: string;
    quantity: number;
    item_type: string;
    sudah_terpetakan: boolean;
  }>(
    `SELECT l.platform, l.order_id, to_char(l.transaction_date, 'YYYY-MM-DD') AS tanggal,
            l.transaction_time::text AS jam, l.menu_id, l.item_name, l.quantity, l.item_type,
            (m.status = 'dipetakan') AS sudah_terpetakan
     FROM salessync_log_penjualan l
     LEFT JOIN salessync_item_mapping m ON m.platform = l.platform AND m.kode_eksternal = l.menu_id
     WHERE l.inv_status = 'OK' AND l.processed_at IS NULL
       AND (l.platform || '|' || l.order_id || '|' || to_char(l.transaction_date, 'YYYY-MM-DD')) = ANY($1::text[])
     ORDER BY l.transaction_date DESC, l.platform, l.order_id, l.id`,
    [kunciOrder],
  );

  return {
    rows: rows.map((row) => ({
      platform: row.platform,
      orderId: row.order_id,
      tanggal: row.tanggal,
      jam: row.jam,
      menuId: row.menu_id,
      itemName: row.item_name,
      quantity: row.quantity,
      itemType: row.item_type,
      sudahTerpetakan: row.sudah_terpetakan === true,
    })),
    totalOrder,
  };
}
