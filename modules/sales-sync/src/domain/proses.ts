import type { PoolClient } from "pg";
import { pool, writeAuditLog } from "@samsara/core";
import { createPenjualanViaApi } from "../lib/internal-api.js";
import { getDefaultLocationId } from "./settings.js";

/**
 * Sinkronisasi arsip log penjualan -> transaksi Penjualan modul Inventory.
 *
 * PENGECUALIAN KONVENSI yang disengaja: berbeda dari domain function lain di
 * repo ini (yang menerima `client: PoolClient` dan dibungkus
 * `withTransaction()` oleh router), fungsi `prosesSinkronisasi` MENGELOLA
 * transaksinya sendiri. Alasannya: prosesnya terdiri dari satu fase BACA lalu
 * BANYAK transaksi tulis TERPISAH (satu per order), dengan panggilan HTTP ke
 * modul Inventory di antaranya -- tidak mungkin dijalankan dalam satu
 * `PoolClient` tunggal milik router tanpa memegang satu transaksi panjang yang
 * membekukan koneksi selama seluruh panggilan HTTP berlangsung.
 *
 * Satu order gagal TIDAK menghentikan order lain (pola sama seperti
 * POST /jadwal/batch di modul HR): kegagalan masuk array `gagal` di response,
 * `processed_at`-nya TIDAK ditandai, jadi order itu otomatis ikut lagi di
 * proses berikutnya setelah penyebabnya dibereskan.
 */

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

interface BarisLog {
  id: string;
  platform: string;
  transactionDate: string;
  /** Jam order asli dari sumber, "HH:MM:SS" (lihat catatan di `bacaDataProses`). */
  jam: string;
  orderId: string;
  menuId: string | null;
  quantity: number;
  /** 'menu' | 'addon' | 'refund' -- dipakai loop utama untuk menyisihkan order ber-refund ke `perluDitinjau`, lihat `HasilProses.perluDitinjau`. */
  itemType: string;
}

export interface GrupOrder {
  platform: string;
  tanggal: string;
  orderId: string;
  /** Dari baris PERTAMA grup, sama seperti `jam` -- satu order = satu outlet, lihat `resolveLocationId`. Null kalau sumber tidak menyertakan (CSV lama). */
  outletRef: string | null;
  baris: BarisLog[];
}

/**
 * Lokasi tujuan transaksi Penjualan untuk satu order: pakai pemetaan
 * `salessync_outlet_location_map` kalau outlet_ref order ini ADA dan
 * terpetakan, kalau tidak (outlet_ref kosong ATAU tidak ada baris
 * pemetaan yang cocok) jatuh ke lokasi default -- TIDAK PERNAH jadi
 * alasan men-skip/meng-gagalkan order (beda dari item belum terpetakan,
 * yang memang di-skip, lihat `dilewatiBelumTerpetakan`).
 */
function resolveLocationId(data: DataBaca, grup: GrupOrder): number {
  if (!grup.outletRef) return data.defaultLocationId;
  const dipetakan = data.outletLocation.get(kunciOutlet(grup.platform, grup.outletRef));
  return dipetakan ?? data.defaultLocationId;
}

function kunciOutlet(platform: string, outletRef: string): string {
  return `${platform}|${outletRef}`;
}

export interface IdentitasGrup {
  platform: string;
  orderId: string;
  tanggal: string;
}

export interface HasilProses {
  transaksiDibuat: number;
  barisDiproses: number;
  /** Order yang transaction_date-nya < tanggalMulai -- sengaja dilewati dari pengurangan stok, processed_at TIDAK ditandai (tetap NULL, bisa ditangkap lagi nanti -- lihat alasan di loop utama). */
  dilewatiSebelumTanggalMulai: IdentitasGrup[];
  /** Order yang punya minimal 1 item belum terpetakan (atau tanpa kode eksternal). */
  dilewatiBelumTerpetakan: IdentitasGrup[];
  /**
   * Order yang punya minimal 1 baris `item_type = 'refund'` -- TIDAK PERNAH
   * memotong stok lewat jalur mana pun (tombol manual maupun pemrosesan
   * otomatis), `processed_at` TIDAK ditandai. Sebelum 2026-10-30 baris
   * refund yang kebetulan `inv_status='OK'` dan sudah terpetakan ikut
   * terproses seperti penjualan biasa (keterbatasan yang sudah
   * terdokumentasi) -- perilaku itu DIUBAH di sini, bukan lagi "dibiarkan
   * apa adanya": modul Inventory tetap tidak punya konsep refund, tapi
   * sekarang order seperti ini disisihkan untuk ditinjau manual alih-alih
   * ikut memotong stok secara salah.
   */
  perluDitinjau: IdentitasGrup[];
  /** Order yang platform-nya belum ada di salessync_platform_channel_map. */
  channelTidakDikenal: IdentitasGrup[];
  /** Order yang ditolak modul Inventory (pesannya diteruskan apa adanya). */
  gagal: Array<IdentitasGrup & { pesan: string }>;
}

export interface DataBaca {
  defaultLocationId: number;
  /** Key: `${platform}|${kode_eksternal}` -> kode_menu internal. Hanya yang status 'dipetakan'. */
  pemetaan: Map<string, string>;
  /** Key: platform_raw -> channel_internal. */
  channel: Map<string, string>;
  /** Key: `${platform}|${outlet_ref}` -> location_id Samsara. Lihat `resolveLocationId`. */
  outletLocation: Map<string, number>;
  grup: GrupOrder[];
}

export function kunciPemetaan(platform: string, kodeEksternal: string): string {
  return `${platform}|${kodeEksternal}`;
}

/** Fase BACA: satu transaksi read-only, semua data yang dibutuhkan loop diambil sekaligus. */
export async function bacaDataProses(client: PoolClient): Promise<DataBaca> {
  const defaultLocationId = await getDefaultLocationId(client);

  const { rows: pemetaanRows } = await client.query<{ platform: string; kode_eksternal: string; kode_menu: string }>(
    `SELECT platform, kode_eksternal, kode_menu
     FROM salessync_item_mapping
     WHERE status = 'dipetakan' AND kode_menu IS NOT NULL AND kode_menu <> ''`,
  );
  const pemetaan = new Map<string, string>();
  for (const row of pemetaanRows) pemetaan.set(kunciPemetaan(row.platform, row.kode_eksternal), row.kode_menu);

  const { rows: channelRows } = await client.query<{ platform_raw: string; channel_internal: string }>(
    `SELECT platform_raw, channel_internal FROM salessync_platform_channel_map`,
  );
  const channel = new Map<string, string>();
  for (const row of channelRows) channel.set(row.platform_raw, row.channel_internal);

  const { rows: outletRows } = await client.query<{ platform: string; outlet_ref: string; location_id: number }>(
    `SELECT platform, outlet_ref, location_id FROM salessync_outlet_location_map`,
  );
  const outletLocation = new Map<string, number>();
  for (const row of outletRows) outletLocation.set(kunciOutlet(row.platform, row.outlet_ref), row.location_id);

  // to_char, BUKAN kolom DATE mentah: driver `pg` mengubah tipe DATE jadi objek
  // Date (tengah malam waktu LOKAL proses), yang bisa menggeser tanggal
  // kalender saat dikirim balik ke API Inventory. Tanggal kalender murni
  // diperlakukan sebagai string sepanjang alur ini (pola sama seperti
  // inventory/permintaan-transfer.ts dan hr/pengajuan-libur.ts).
  //
  // `transaction_time` SENGAJA diambil mentah (TANPA to_char), beda perlakuan
  // dari `transaction_date` di atas: kolom bertipe `TIME` dikembalikan driver
  // `pg` sudah sebagai STRING "HH:MM:SS" (bukan objek Date), dan jam murni
  // tanpa komponen tanggal TIDAK punya isu geser timezone sama sekali -- jadi
  // aman dipakai langsung sebagai nilai `jam` yang dikirim ke Inventory.
  const { rows: logRows } = await client.query<{
    id: string;
    platform: string;
    transaction_date: string;
    transaction_time: string;
    order_id: string;
    menu_id: string | null;
    quantity: number;
    outlet_ref: string | null;
    item_type: string;
  }>(
    `SELECT id, platform, to_char(transaction_date, 'YYYY-MM-DD') AS transaction_date,
            transaction_time, order_id, menu_id, quantity, outlet_ref, item_type
     FROM salessync_log_penjualan
     WHERE inv_status = 'OK' AND processed_at IS NULL
     ORDER BY transaction_date, platform, order_id, id`,
  );

  const peta = new Map<string, GrupOrder>();
  for (const row of logRows) {
    const key = `${row.platform}|${row.transaction_date}|${row.order_id}`;
    let grup = peta.get(key);
    if (!grup) {
      grup = {
        platform: row.platform,
        tanggal: row.transaction_date,
        orderId: row.order_id,
        outletRef: row.outlet_ref,
        baris: [],
      };
      peta.set(key, grup);
    }
    grup.baris.push({
      id: row.id,
      platform: row.platform,
      transactionDate: row.transaction_date,
      jam: row.transaction_time,
      orderId: row.order_id,
      menuId: row.menu_id,
      quantity: row.quantity,
      itemType: row.item_type,
    });
  }

  return { defaultLocationId, pemetaan, channel, outletLocation, grup: [...peta.values()] };
}

/**
 * Proses semua baris log berstatus `inv_status = 'OK'` yang belum pernah
 * diproses (`processed_at IS NULL`), dikelompokkan per order
 * (platform + tanggal + order_id).
 *
 * @param authHeader Header `Authorization` dari request pemicu, diteruskan ke API Inventory.
 * @param userId User yang memicu proses -- dicatat di core_audit_log.
 * @param tanggalMulai WAJIB, format `YYYY-MM-DD`. Pengaman cutover/go-live:
 *   arsip `salessync_log_penjualan` berisi ribuan baris penjualan historis,
 *   jadi tanpa batas tanggal satu klik "Proses Sinkronisasi" bisa memicu
 *   transaksi Penjualan (dan pengurangan stok) untuk seluruh riwayat sekaligus.
 *   Kosong/format salah -> `Error` dilempar SEBELUM query apa pun dijalankan.
 *   Order dengan tanggal lebih awal dari ini dilewati dari pengurangan stok dan
 *   `processed_at`-nya TIDAK ditandai (tetap NULL) -- bisa "ditangkap lagi" di
 *   panggilan /proses berikutnya kalau tanggalMulai dipilih lebih awal (lihat
 *   loop utama).
 */
export async function prosesSinkronisasi(
  authHeader: string,
  userId: number,
  tanggalMulai: string | undefined,
): Promise<HasilProses> {
  if (!tanggalMulai || !/^\d{4}-\d{2}-\d{2}$/.test(tanggalMulai)) {
    throw new Error("Isi tanggal mulai untuk menghindari memproses seluruh data historis ke stok sekaligus.");
  }

  const data = await withTransaction(bacaDataProses);

  const hasil: HasilProses = {
    transaksiDibuat: 0,
    barisDiproses: 0,
    dilewatiSebelumTanggalMulai: [],
    dilewatiBelumTerpetakan: [],
    perluDitinjau: [],
    channelTidakDikenal: [],
    gagal: [],
  };

  // Sekuensial, BUKAN Promise.all: tiap order = satu transaksi database + satu
  // panggilan HTTP sendiri, dan urutan hasil harus deterministik.
  for (const grup of data.grup) {
    const identitas: IdentitasGrup = { platform: grup.platform, orderId: grup.orderId, tanggal: grup.tanggal };

    // (0) Order sebelum tanggalMulai: SENGAJA dilewati dari pengurangan stok (ini
    // cutover/go-live guard, bukan "belum sempat diproses") -- `processed_at`
    // SENGAJA TIDAK ditandai (dibiarkan NULL), beda dari rancangan awal. Alasan
    // perubahan: membiarkan NULL berarti kalau owner salah pilih tanggalMulai
    // (terlalu maju), order ini masih bisa "ditangkap lagi" di panggilan /proses
    // berikutnya dengan tanggalMulai yang lebih awal -- keputusan BISA dikoreksi,
    // bukan satu arah permanen. Konsekuensinya: order sebelum tanggalMulai akan
    // terus dibaca ulang di tiap panggilan /proses (overhead kecil, arsip ini
    // terbatas & historis, bukan tumbuh terus setelah go-live) -- trade-off yang
    // diterima demi keamanan koreksi kesalahan.
    // Perbandingan string aman: kedua sisi format `YYYY-MM-DD`, jadi urutan
    // leksikografis = urutan tanggal kalender (tidak perlu `new Date(...)`).
    // Dicek PALING AWAL: lebih murah, dan tidak perlu membuang kerja mengecek
    // pemetaan/channel untuk order yang memang mau dilewati karena tanggal.
    if (grup.tanggal < tanggalMulai) {
      hasil.dilewatiSebelumTanggalMulai.push(identitas);
      continue;
    }

    // (a) Order dengan minimal 1 baris item_type='refund' TIDAK PERNAH
    // memotong stok -- modul Inventory tidak punya konsep refund/retur sama
    // sekali (`createPenjualan` cuma pernah mengurangi stok, tidak pernah
    // menambah), jadi memproses baris ini seperti penjualan biasa akan
    // mengurangi stok yang SALAH ARAH. Dicek SEBELUM pemetaan (b) supaya
    // order ber-refund konsisten masuk `perluDitinjau` terlepas status
    // pemetaan item-nya -- ini kategori yang perlu ditinjau manusia, bukan
    // "akan otomatis beres begitu dipetakan" seperti `dilewatiBelumTerpetakan`.
    if (grup.baris.some((row) => row.itemType === "refund")) {
      hasil.perluDitinjau.push(identitas);
      continue;
    }

    // (b) SEMUA baris order ini wajib punya kode eksternal DAN sudah terpetakan.
    // Satu baris belum terpetakan -> SELURUH order dilewati, tidak ada baris
    // yang diproses dan tidak ada processed_at yang ditandai, supaya order itu
    // utuh lagi di proses berikutnya setelah itemnya dipetakan (memproses
    // sebagian akan membuat transaksi Penjualan yang isinya tidak lengkap dan
    // sisa barisnya tidak bisa disusulkan ke header yang sama).
    const baris: Array<{ menuKode: string; qty: number }> = [];
    let adaYangBelumTerpetakan = false;
    for (const row of grup.baris) {
      const kodeMenu = row.menuId ? data.pemetaan.get(kunciPemetaan(row.platform, row.menuId)) : undefined;
      if (!kodeMenu) {
        adaYangBelumTerpetakan = true;
        break;
      }
      baris.push({ menuKode: kodeMenu, qty: row.quantity });
    }
    if (adaYangBelumTerpetakan) {
      hasil.dilewatiBelumTerpetakan.push(identitas);
      continue;
    }

    // (c) Platform mentah wajib ada di salessync_platform_channel_map.
    const channelInternal = data.channel.get(grup.platform);
    if (!channelInternal) {
      hasil.channelTidakDikenal.push(identitas);
      continue;
    }

    // (d+e+f) Satu transaksi database per order, panggilan Inventory di dalamnya.
    try {
      const idBaris = grup.baris.map((row) => row.id);
      // Transaksi database sales-sync dibuka SETELAH niat jelas, dan panggilan
      // HTTP ke Inventory terjadi di dalamnya. Konsekuensi yang diketahui dari
      // isolasi lewat HTTP: transaksi Inventory COMMIT sendiri, jadi kalau
      // UPDATE processed_at di bawah gagal, transaksi Penjualan di Inventory
      // sudah jadi tapi barisnya tetap "belum diproses" -- proses berikutnya
      // akan membuat transaksi kembar untuk order itu. Tidak ada two-phase
      // commit antar modul di sistem ini; jendela risikonya sengaja dibuat
      // sekecil mungkin (UPDATE sederhana tepat setelah panggilan sukses).
      await withTransaction(async (client) => {
        const dibuat = await createPenjualanViaApi(authHeader, {
          locationId: resolveLocationId(data, grup),
          sumber: channelInternal,
          noReferensi: grup.orderId,
          tanggal: grup.tanggal,
          // Jam order ASLI dari platform (bukan jam proses sinkronisasi).
          // Diambil dari BARIS PERTAMA grup: satu order = satu momen transaksi,
          // jadi semua barisnya punya `transaction_time` yang sama. SENGAJA
          // tidak divalidasi/dirata-rata antar baris -- kalau sumber ternyata
          // mengirim jam berbeda dalam satu order, baris pertama sudah cukup
          // mewakili dan itu bukan kondisi yang perlu ditangani di sini.
          jam: grup.baris[0]?.jam,
          baris,
        });

        await client.query(`UPDATE salessync_log_penjualan SET processed_at = now() WHERE id = ANY($1::bigint[])`, [
          idBaris,
        ]);

        // Jejak audit "transaksi ini lahir dari sales-sync, bukan input manual
        // kasir" -- meniru precedent endpoint override di modul HR
        // (field_name 'created_via_override').
        await writeAuditLog(client, {
          userId,
          tableName: "inventory_transaksi_penjualan",
          recordId: dibuat.headerId,
          fieldName: "created_via",
          oldValue: null,
          newValue: "sales-sync",
        });
      });

      hasil.transaksiDibuat += 1;
      hasil.barisDiproses += grup.baris.length;
    } catch (err) {
      // Inventory menolak (mis. kode menu sudah dihapus/nonaktif) atau update
      // gagal -> processed_at TIDAK ditandai (transaksi di-rollback), order
      // dilaporkan dan loop LANJUT ke order berikutnya.
      hasil.gagal.push({
        ...identitas,
        pesan: err instanceof Error ? err.message : "Gagal memproses order",
      });
    }
  }

  return hasil;
}
