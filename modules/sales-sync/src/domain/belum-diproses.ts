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
  menuId: string | null;
  itemName: string;
  quantity: number;
}

export interface FilterBelumDiproses {
  tanggalMulai?: string; // YYYY-MM-DD
  tanggalSelesai?: string;
}

interface BarisRow {
  platform: string;
  order_id: string;
  tanggal: string;
  menu_id: string | null;
  item_name: string;
  quantity: number;
}

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
 * Tanpa filter sama sekali -> SELURUH baris belum-diproses dikembalikan tanpa
 * batas tanggal. Ini juga BEDA dari `GET /transaksi/penjualan` di modul
 * Inventory yang default 30 hari terakhir: endpoint itu untuk operasional
 * harian, yang ini untuk visibilitas arsip yang mungkin sengaja ditahan lama
 * (mis. order sebelum tanggal go-live) -- justru baris tua itulah yang perlu
 * terlihat.
 *
 * Hasilnya FLAT PER BARIS log, TIDAK dikelompokkan per order seperti
 * `bacaDataProses`: pengelompokan di sana melayani pembuatan satu transaksi
 * Penjualan per order, sedangkan di sini frontend yang mengelompokkan kalau
 * tampilannya perlu.
 */
export async function listBelumDiproses(
  client: PoolClient,
  filter: FilterBelumDiproses,
): Promise<BarisBelumDiproses[]> {
  const kondisi: string[] = [`inv_status = 'OK'`, `processed_at IS NULL`];
  const params: string[] = [];

  if (filter.tanggalMulai) {
    params.push(filter.tanggalMulai);
    kondisi.push(`transaction_date >= $${params.length}::date`);
  }
  if (filter.tanggalSelesai) {
    params.push(filter.tanggalSelesai);
    kondisi.push(`transaction_date <= $${params.length}::date`);
  }

  // to_char, BUKAN kolom DATE mentah -- alasan sama persis seperti di
  // `bacaDataProses` (proses.ts): driver `pg` mengubah tipe DATE jadi objek
  // Date (tengah malam waktu LOKAL proses) yang bisa menggeser tanggal
  // kalender kalau dikirim balik tanpa hati-hati. Tanggal kalender murni
  // diperlakukan sebagai string sepanjang alur ini.
  const { rows } = await client.query<BarisRow>(
    `SELECT platform, order_id, to_char(transaction_date, 'YYYY-MM-DD') AS tanggal,
            menu_id, item_name, quantity
     FROM salessync_log_penjualan
     WHERE ${kondisi.join(" AND ")}
     ORDER BY transaction_date DESC, platform, order_id`,
    params,
  );

  return rows.map((row) => ({
    platform: row.platform,
    orderId: row.order_id,
    tanggal: row.tanggal,
    menuId: row.menu_id,
    itemName: row.item_name,
    quantity: row.quantity,
  }));
}
