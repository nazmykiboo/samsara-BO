import type { PoolClient } from "pg";

/**
 * Pemetaan item/kode eksternal platform -> kode_menu internal Samsara.
 *
 * Antrian pemetaan ini TIDAK diisi manual: `syncItemMappingFromLog` menurunkan
 * kandidatnya langsung dari arsip `salessync_log_penjualan` (dipanggil di akhir
 * import log penjualan, dalam transaksi yang sama), supaya kode eksternal baru
 * dari platform langsung muncul sebagai "belum_dipetakan" tanpa langkah
 * tambahan.
 */

export interface ItemMapping {
  id: string;
  platform: string;
  kodeEksternal: string;
  namaEksternal: string;
  kodeMenu: string | null;
  status: string;
  dipetakanOleh: string | null;
  dipetakanPada: Date | null;
  createdAt: Date;
}

interface ItemMappingRow {
  id: string;
  platform: string;
  kode_eksternal: string;
  nama_eksternal: string;
  kode_menu: string | null;
  status: string;
  dipetakan_oleh: string | null;
  dipetakan_pada: Date | null;
  created_at: Date;
}

function mapRow(row: ItemMappingRow): ItemMapping {
  return {
    id: row.id,
    platform: row.platform,
    kodeEksternal: row.kode_eksternal,
    namaEksternal: row.nama_eksternal,
    kodeMenu: row.kode_menu,
    status: row.status,
    dipetakanOleh: row.dipetakan_oleh,
    dipetakanPada: row.dipetakan_pada,
    createdAt: row.created_at,
  };
}

/**
 * Turunkan kombinasi (platform, menu_id) yang DISTINCT dari arsip log
 * penjualan jadi baris antrian pemetaan berstatus `belum_dipetakan`.
 *
 * - Baris log dengan `menu_id` NULL/kosong DILEWATI: tanpa kode eksternal
 *   tidak ada yang bisa dipetakan (baris seperti itu nanti juga membuat
 *   seluruh order-nya dilewati di `/sales-sync/proses`).
 * - `DISTINCT ON (platform, menu_id) ... ORDER BY ... created_at DESC` memilih
 *   `item_name` yang PALING BARU muncul untuk kombinasi itu -- nama item di
 *   platform kadang berubah, yang relevan untuk orang yang memetakan adalah
 *   nama terbaru.
 * - `ON CONFLICT DO NOTHING` membuat fungsi ini IDEMPOTEN dan tidak pernah
 *   menimpa pemetaan yang sudah dikerjakan manusia (kode_menu/status/
 *   dipetakan_oleh baris yang sudah ada tidak disentuh).
 *
 * @returns jumlah baris antrian baru yang ditambahkan.
 */
export async function syncItemMappingFromLog(client: PoolClient): Promise<number> {
  const result = await client.query(
    `INSERT INTO salessync_item_mapping (platform, kode_eksternal, nama_eksternal, status)
     SELECT DISTINCT ON (platform, menu_id)
       platform, menu_id, item_name, 'belum_dipetakan'
     FROM salessync_log_penjualan
     WHERE menu_id IS NOT NULL AND menu_id <> ''
     ORDER BY platform, menu_id, created_at DESC, id DESC
     ON CONFLICT (platform, kode_eksternal) DO NOTHING`,
  );
  return result.rowCount ?? 0;
}

/**
 * Daftar pemetaan item. `status` opsional -- tanpa filter = semua baris.
 *
 * Khusus `status = 'belum_dipetakan'`: hanya kode eksternal yang punya minimal
 * SATU baris log dengan `inv_status = 'OK'` yang dimunculkan. Antrian pemetaan
 * diturunkan dari SELURUH arsip log (termasuk baris `SKIP-HISTORIS`), padahal
 * `/sales-sync/proses` cuma pernah memproses baris `inv_status = 'OK'` -- kode
 * eksternal yang cuma muncul di baris historis/SKIP tidak perlu dipetakan
 * karena tidak akan pernah diproses ke transaksi Penjualan, jadi
 * memunculkannya di daftar "belum dipetakan" cuma membuat pekerjaan palsu.
 */
export async function listItemMapping(client: PoolClient, status?: string): Promise<ItemMapping[]> {
  if (status === "belum_dipetakan") {
    const { rows } = await client.query<ItemMappingRow>(
      `SELECT m.id, m.platform, m.kode_eksternal, m.nama_eksternal, m.kode_menu, m.status, m.dipetakan_oleh, m.dipetakan_pada, m.created_at
       FROM salessync_item_mapping m
       WHERE m.status = 'belum_dipetakan'
         AND EXISTS (
           SELECT 1 FROM salessync_log_penjualan l
           WHERE l.platform = m.platform AND l.menu_id = m.kode_eksternal AND l.inv_status = 'OK'
         )
       ORDER BY m.created_at DESC`,
    );
    return rows.map(mapRow);
  }

  const { rows } = status
    ? await client.query<ItemMappingRow>(
        `SELECT id, platform, kode_eksternal, nama_eksternal, kode_menu, status, dipetakan_oleh, dipetakan_pada, created_at
         FROM salessync_item_mapping WHERE status = $1 ORDER BY created_at DESC`,
        [status],
      )
    : await client.query<ItemMappingRow>(
        `SELECT id, platform, kode_eksternal, nama_eksternal, kode_menu, status, dipetakan_oleh, dipetakan_pada, created_at
         FROM salessync_item_mapping ORDER BY created_at DESC`,
      );
  return rows.map(mapRow);
}

/**
 * Tetapkan `kode_menu` internal untuk satu baris pemetaan dan tandai
 * `dipetakan`.
 *
 * SENGAJA TIDAK memvalidasi bahwa `kodeMenu` benar-benar ada di modul
 * Inventory: validasi itu terjadi secara implisit saat `/sales-sync/proses`
 * memanggil API Inventory (kode salah -> order itu dilaporkan sebagai `gagal`
 * di response proses, tidak menandai processed_at, bisa dicoba lagi setelah
 * pemetaannya dikoreksi). Menambah panggilan HTTP ke Inventory di sini cuma
 * memperlambat jalur edit tanpa memberi jaminan baru (menu bisa dinonaktifkan
 * kapan pun setelah dipetakan).
 */
export async function setItemMapping(
  client: PoolClient,
  id: number,
  kodeMenu: string,
  userId: number,
): Promise<ItemMapping> {
  const { rows, rowCount } = await client.query<ItemMappingRow>(
    `UPDATE salessync_item_mapping
     SET kode_menu = $1, status = 'dipetakan', dipetakan_oleh = $2, dipetakan_pada = now()
     WHERE id = $3
     RETURNING id, platform, kode_eksternal, nama_eksternal, kode_menu, status, dipetakan_oleh, dipetakan_pada, created_at`,
    [kodeMenu, userId, id],
  );
  if (rowCount === 0 || !rows[0]) throw new Error("Pemetaan item tidak ditemukan");
  return mapRow(rows[0]);
}
