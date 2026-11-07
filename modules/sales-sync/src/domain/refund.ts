import type { PoolClient } from "pg";

/**
 * Satu "sinyal" refund dari salah satu dari DUA sumber yang TIDAK SIMETRIS
 * (lihat `listRefundRange` untuk alasan lengkap):
 * - `salessync_log_penjualan` (item_type='refund', SEMUA platform): PUNYA
 *   item/qty, TIDAK PERNAH punya nominal Rupiah (kolom itu tidak ada di
 *   tabel ini sama sekali).
 * - `salessync_majoo_refund` (KHUSUS Majoo, migrasi 0004): PUNYA nominal
 *   Rupiah, TIDAK PUNYA breakdown item/qty (levelnya transaksi, bukan baris).
 *
 * Konsumen (Riwayat Transaksi, Laporan Harian, Analitik) HARUS menangani
 * `itemName`/`qty` dan `refundAmount` sebagai dua hal yang independen bisa
 * null -- JANGAN asumsikan satu baris selalu punya keduanya.
 */
export interface RefundEntry {
  /** = order_id (log_penjualan) atau transaction_no (majoo refund) -- dipakai menghubungkan ke transaksi asal (inventory_transaksi_penjualan.no_referensi), BUKAN FK. */
  orderId: string;
  platform: string;
  itemName: string | null;
  /** Qty refund -- APA ADANYA dari sumber (log_penjualan menyimpannya NEGATIF). null kalau sumbernya salessync_majoo_refund (tidak ada breakdown item). */
  qty: number | null;
  /** null kalau sumbernya salessync_log_penjualan (platform selain Majoo TIDAK PERNAH punya nominal refund di arsip manapun saat ini -- batasan data, bukan bug). */
  refundAmount: number | null;
  refundDate: string;
  refundReason: string | null;
}

/**
 * Gabungan (UNION, bukan JOIN -- dua sumber independen, tidak dipetakan
 * baris-ke-baris) sinyal refund dalam rentang tanggal [tanggalMulai,
 * tanggalSelesai] INKLUSIF, WIB. Dipakai Riwayat Transaksi (cocokkan ke
 * `inventory_transaksi_penjualan.no_referensi` via HTTP cross-module) dan
 * kartu "Refund hari ini" di Laporan Harian/Analitik (tanggalMulai =
 * tanggalSelesai = hari ini).
 */
export async function listRefundRange(
  client: PoolClient,
  tanggalMulai: string,
  tanggalSelesai: string,
): Promise<RefundEntry[]> {
  const { rows: dariLog } = await client.query<{
    order_id: string;
    platform: string;
    item_name: string;
    quantity: number;
    transaction_date: string;
    transaction_time: string;
  }>(
    `SELECT order_id, platform, item_name, quantity,
            to_char(transaction_date, 'YYYY-MM-DD') AS transaction_date, transaction_time::text AS transaction_time
     FROM salessync_log_penjualan
     WHERE item_type = 'refund' AND transaction_date BETWEEN $1 AND $2
     ORDER BY transaction_date, transaction_time`,
    [tanggalMulai, tanggalSelesai],
  );

  // Batas hari WIB untuk kolom TIMESTAMPTZ -- pola `AT TIME ZONE 'Asia/Jakarta'`
  // (konversi ke jam dinding WIB dulu, baru dibandingkan ke tanggal kalender)
  // supaya refund jam 00:xx-06:xx WIB tidak kepotong ke hari sebelumnya.
  const { rows: dariMajoo } = await client.query<{
    transaction_no: string;
    refund_amount: string;
    refund_date: string;
    refund_reason: string | null;
  }>(
    `SELECT transaction_no, refund_amount, refund_date::text AS refund_date, refund_reason
     FROM salessync_majoo_refund
     WHERE (refund_date AT TIME ZONE 'Asia/Jakarta') >= $1::date
       AND (refund_date AT TIME ZONE 'Asia/Jakarta') < ($2::date + 1)
     ORDER BY refund_date`,
    [tanggalMulai, tanggalSelesai],
  );

  const hasil: RefundEntry[] = [];
  for (const r of dariLog) {
    hasil.push({
      orderId: r.order_id,
      platform: r.platform,
      itemName: r.item_name,
      qty: Number(r.quantity),
      refundAmount: null,
      refundDate: `${r.transaction_date}T${r.transaction_time}`,
      refundReason: null,
    });
  }
  for (const r of dariMajoo) {
    hasil.push({
      orderId: r.transaction_no,
      platform: "Majoo",
      itemName: null,
      qty: null,
      refundAmount: Number(r.refund_amount),
      refundDate: r.refund_date,
      refundReason: r.refund_reason,
    });
  }
  return hasil;
}
