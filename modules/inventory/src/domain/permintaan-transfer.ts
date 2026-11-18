import type { PoolClient } from "pg";
import { getCurrentStock } from "./stok.js";

/**
 * Permintaan transfer: tahap SEBELUM transfer kirim yang sudah ada (lihat
 * `createTransferKirim` di `stok.ts`). Outlet mengajukan ("butuh X qty item Y
 * dari CK"), CK melihat daftar permintaan masuk, lalu CK MEMENUHI lewat
 * transfer kirim yang sudah ada -- transfer itu merujuk balik ke baris
 * permintaan ini lewat `inventory_transaksi_transfer.permintaan_id` (lihat
 * `createTransferKirim`, yang mengubah status 'diminta' -> 'dipenuhi'/
 * 'dipenuhi_sebagian'), ATAU CK menolak lewat `tolakPermintaan` (Tahap 1B,
 * TANPA transfer sama sekali).
 *
 * Penamaan location_asal_id/location_tujuan_id sengaja sama dengan
 * `inventory_transaksi_transfer` -- lihat komentar migrasi 0022.
 *
 * Tabel TETAP 1 baris = 1 item (migrasi 0022/0034 TIDAK mengubah ini) --
 * `kelompok_id` (Tahap 1B) cuma penanda TAMPILAN supaya baris-baris dari
 * SATU pengajuan multi-item dikelompokkan jadi satu kartu di UI, granularitas
 * pemenuhan/penolakan TETAP per-item (lihat Layar CK: aksi penuhi/sebagian/
 * tolak selalu terhadap SATU baris permintaan, bukan satu kelompok sekaligus
 * -- item lain di kelompok yang sama bisa punya nasib berbeda).
 */

async function findItemByKode(client: PoolClient, kode: string): Promise<{ id: number; type: string }> {
  const { rows } = await client.query<{ id: number; type: string }>(
    `SELECT id, type FROM inventory_items WHERE kode = $1`,
    [kode],
  );
  if (!rows[0]) throw new Error(`Item dengan kode "${kode}" tidak ditemukan`);
  return rows[0];
}

export type ShiftDibutuhkan = "pagi" | "siang" | "sore" | "malam";
const SHIFT_VALID: readonly ShiftDibutuhkan[] = ["pagi", "siang", "sore", "malam"];

export interface PermintaanTransferBarisInput {
  itemKode: string;
  qtyDiminta: number;
}

export interface CreatePermintaanTransferInput {
  locationAsalId: number;
  locationTujuanId: number;
  tanggalDiminta: string;
  catatan?: string;
  /** Opsional -- kapan outlet butuh barang ini sudah sampai. */
  dibutuhkanSebelumTanggal?: string;
  dibutuhkanSebelumShift?: ShiftDibutuhkan;
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  createdByUserId?: number;
  /** Satu ATAU lebih item dalam SATU pengajuan -- semuanya berbagi `kelompok_id` yang sama
   * (Tahap 1B, 2026-11-14). Minimal 1 baris. */
  baris: PermintaanTransferBarisInput[];
}

export interface CreatePermintaanTransferResult {
  kelompokId: number;
  baris: Array<{ headerId: number; kode: string; itemKode: string; status: "diminta" }>;
}

/**
 * Buat SATU ATAU LEBIH permintaan transfer sekaligus (satu pengajuan
 * multi-item), berbagi `kelompok_id` yang sama supaya bisa dikelompokkan di
 * UI. `kode` tiap baris digenerate SESUDAH insert (butuh `id`) lewat UPDATE
 * dalam transaksi DB yang sama -- pola existing, lihat komentar lama.
 * `kelompok_id` = id baris PERTAMA yang di-insert (bukan sequence/id
 * terpisah -- tidak perlu tabel kelompok baru).
 */
export async function createPermintaanTransfer(
  client: PoolClient,
  input: CreatePermintaanTransferInput,
): Promise<CreatePermintaanTransferResult> {
  if (input.baris.length === 0) throw new Error("Permintaan transfer harus punya minimal 1 item");
  if (input.locationAsalId === input.locationTujuanId) {
    throw new Error("locationAsalId dan locationTujuanId tidak boleh sama (tidak bisa meminta transfer ke lokasi sendiri)");
  }
  for (const b of input.baris) {
    if (!(b.qtyDiminta > 0)) throw new Error(`qtyDiminta untuk item "${b.itemKode}" wajib lebih besar dari 0`);
  }
  if (input.dibutuhkanSebelumShift !== undefined && !SHIFT_VALID.includes(input.dibutuhkanSebelumShift)) {
    throw new Error(`dibutuhkanSebelumShift harus salah satu dari: ${SHIFT_VALID.join(", ")}`);
  }

  const hasil: CreatePermintaanTransferResult["baris"] = [];
  let kelompokId: number | null = null;

  for (const b of input.baris) {
    const item = await findItemByKode(client, b.itemKode);

    const insertResult: { rows: { id: number }[] } = await client.query(
      `INSERT INTO inventory_permintaan_transfer
        (kode, location_asal_id, location_tujuan_id, item_id, qty_diminta, status, diminta_oleh, tanggal_diminta,
         catatan, kelompok_id, dibutuhkan_sebelum_tanggal, dibutuhkan_sebelum_shift)
       VALUES ($1, $2, $3, $4, $5, 'diminta', $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        `PT-PENDING-${Date.now()}-${hasil.length}`,
        input.locationAsalId,
        input.locationTujuanId,
        item.id,
        b.qtyDiminta,
        input.createdByUserId ?? null,
        input.tanggalDiminta,
        input.catatan ?? null,
        kelompokId ?? 0, // 0 = sentinel sementara untuk baris pertama (kolom NOT NULL) -- diisi balik ke id-nya sendiri di bawah
        input.dibutuhkanSebelumTanggal ?? null,
        input.dibutuhkanSebelumShift ?? null,
      ],
    );
    // Number(...) WAJIB: driver pg mengembalikan kolom BIGINT sebagai STRING
    // JS walau tipe TS bilang `number` -- tanpa ini, perbandingan `===` ke id
    // numerik lain (lihat getLayarCk) diam-diam selalu false.
    const headerId: number = Number(insertResult.rows[0].id);
    if (kelompokId === null) kelompokId = headerId;

    const kode = `PT-${String(headerId).padStart(6, "0")}`;
    await client.query(`UPDATE inventory_permintaan_transfer SET kode = $1, kelompok_id = $2 WHERE id = $3`, [
      kode,
      kelompokId,
      headerId,
    ]);

    hasil.push({ headerId, kode, itemKode: b.itemKode, status: "diminta" });
  }

  return { kelompokId: kelompokId!, baris: hasil };
}

export type PermintaanTransferStatus = "diminta" | "dipenuhi" | "dipenuhi_sebagian" | "dibatalkan" | "ditolak";

export interface PermintaanTransferListItem {
  id: number;
  kelompokId: number;
  kode: string;
  locationAsalId: number;
  locationAsalNama: string;
  locationTujuanId: number;
  locationTujuanNama: string;
  itemKode: string;
  itemNama: string;
  qtyDiminta: number;
  status: PermintaanTransferStatus;
  tanggalDiminta: string;
  catatan: string | null;
  dimintaOlehUsername: string | null;
  /** Timeline lengkap (Tahap 1B) -- null = belum terjadi ATAU baris lama sebelum kolom ini ada ("-" di UI). */
  dibutuhkanSebelumTanggal: string | null;
  dibutuhkanSebelumShift: ShiftDibutuhkan | null;
  dijawabPada: string | null;
  dijawabOlehUsername: string | null;
  dikirimPada: string | null;
  diterimaPada: string | null;
  alasanTolak: string | null;
  /** Penanda "sudah dilihat/diakui" (2026-11-18, cuma diisi lewat tombol Terima Telegram role owner) -- TIDAK berarti dipenuhi, lihat akuiPermintaan. */
  diakuiPada: string | null;
  diakuiOlehUsername: string | null;
  createdAt: string;
}

export interface ListPermintaanTransferFilter {
  /** Kalau diisi: baris di mana lokasi ini adalah asal ATAU tujuan permintaan. */
  locationId?: number;
  status?: PermintaanTransferStatus;
}

/**
 * Daftar permintaan transfer. `locationId` difilter dengan OR (asal ATAU
 * tujuan) supaya satu query yang sama dipakai baik oleh CK yang melihat
 * "permintaan masuk" (location_asal_id = lokasi CK) maupun outlet yang
 * melihat "permintaan yang saya ajukan" (location_tujuan_id = lokasi outlet).
 *
 * `dikirimPada`/`diterimaPada` di-JOIN dari `inventory_transaksi_transfer`
 * yang merujuk balik lewat `permintaan_id` (Tahap 1B) -- TIDAK ADA kolom baru
 * untuk ini, sumbernya sudah ada (created_at/diterima_at transfer, migrasi
 * 0017/0022). LEFT JOIN: 0 baris kalau belum ada transfer yang memenuhinya.
 */
export async function listPermintaanTransfer(
  client: PoolClient,
  filter: ListPermintaanTransferFilter = {},
): Promise<PermintaanTransferListItem[]> {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (filter.locationId !== undefined) {
    params.push(filter.locationId);
    conditions.push(`(p.location_asal_id = $${params.length} OR p.location_tujuan_id = $${params.length})`);
  }
  if (filter.status !== undefined) {
    params.push(filter.status);
    conditions.push(`p.status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await client.query<{
    id: number;
    kelompok_id: number;
    kode: string;
    location_asal_id: number;
    location_asal_nama: string;
    location_tujuan_id: number;
    location_tujuan_nama: string;
    item_kode: string;
    item_nama: string;
    qty_diminta: string;
    status: PermintaanTransferStatus;
    tanggal_diminta: string;
    catatan: string | null;
    diminta_oleh_username: string | null;
    dibutuhkan_sebelum_tanggal: string | null;
    dibutuhkan_sebelum_shift: ShiftDibutuhkan | null;
    dijawab_pada: string | null;
    dijawab_oleh_username: string | null;
    dikirim_pada: string | null;
    diterima_pada: string | null;
    alasan_tolak: string | null;
    diakui_pada: string | null;
    diakui_oleh_username: string | null;
    created_at: string;
  }>(
    `SELECT p.id, p.kelompok_id, p.kode,
            p.location_asal_id, la.name AS location_asal_nama,
            p.location_tujuan_id, lt.name AS location_tujuan_nama,
            i.kode AS item_kode, i.name AS item_nama,
            p.qty_diminta, p.status,
            to_char(p.tanggal_diminta, 'YYYY-MM-DD') AS tanggal_diminta,
            p.catatan, u.username AS diminta_oleh_username,
            to_char(p.dibutuhkan_sebelum_tanggal, 'YYYY-MM-DD') AS dibutuhkan_sebelum_tanggal,
            p.dibutuhkan_sebelum_shift,
            p.dijawab_pada, dj.username AS dijawab_oleh_username,
            t.created_at AS dikirim_pada, t.diterima_at AS diterima_pada,
            p.alasan_tolak,
            p.diakui_pada, dak.username AS diakui_oleh_username,
            p.created_at
     FROM inventory_permintaan_transfer p
     JOIN core_locations la ON la.id = p.location_asal_id
     JOIN core_locations lt ON lt.id = p.location_tujuan_id
     JOIN inventory_items i ON i.id = p.item_id
     LEFT JOIN core_users u ON u.id = p.diminta_oleh
     LEFT JOIN core_users dj ON dj.id = p.dijawab_oleh
     LEFT JOIN core_users dak ON dak.id = p.diakui_oleh
     LEFT JOIN inventory_transaksi_transfer t ON t.permintaan_id = p.id
     ${where}
     ORDER BY p.created_at DESC`,
    params,
  );

  // Number(...) WAJIB untuk id/kelompok_id/location_*_id: driver pg
  // mengembalikan kolom BIGINT sebagai STRING JS walau tipe query di atas
  // bilang `number` -- tanpa ini, perbandingan `===` ke id numerik lain
  // (mis. getLayarCk membandingkan locationAsalId ke parameter number)
  // diam-diam selalu false. Pola sama seperti outletLocationId/
  // kitchenLocationId di test-helpers.ts.
  return rows.map((r) => ({
    id: Number(r.id),
    kelompokId: Number(r.kelompok_id),
    kode: r.kode,
    locationAsalId: Number(r.location_asal_id),
    locationAsalNama: r.location_asal_nama,
    locationTujuanId: Number(r.location_tujuan_id),
    locationTujuanNama: r.location_tujuan_nama,
    itemKode: r.item_kode,
    itemNama: r.item_nama,
    qtyDiminta: Number(r.qty_diminta),
    status: r.status,
    tanggalDiminta: r.tanggal_diminta,
    catatan: r.catatan,
    dimintaOlehUsername: r.diminta_oleh_username,
    dibutuhkanSebelumTanggal: r.dibutuhkan_sebelum_tanggal,
    dibutuhkanSebelumShift: r.dibutuhkan_sebelum_shift,
    dijawabPada: r.dijawab_pada,
    dijawabOlehUsername: r.dijawab_oleh_username,
    dikirimPada: r.dikirim_pada,
    diterimaPada: r.diterima_pada,
    alasanTolak: r.alasan_tolak,
    diakuiPada: r.diakui_pada,
    diakuiOlehUsername: r.diakui_oleh_username,
    createdAt: r.created_at,
  }));
}

export interface BatalkanPermintaanInput {
  id: number;
  /** Diisi otomatis dari user yang login (lihat api/router.ts) -- saat ini tidak ditulis ke kolom manapun, disediakan untuk konsistensi pola & kemungkinan audit log di masa depan. */
  userId?: number;
}

export interface BatalkanPermintaanResult {
  id: number;
  kode: string;
  status: "dibatalkan";
}

/**
 * Batalkan permintaan yang masih berstatus 'diminta'. Permintaan yang sudah
 * 'dipenuhi'/'dipenuhi_sebagian' (ada transfer kirim yang merujuknya),
 * 'ditolak', atau sudah 'dibatalkan' tidak bisa dibatalkan lagi -- pesan
 * error menyebutkan status saat ini supaya jelas kenapa ditolak.
 */
export async function batalkanPermintaan(
  client: PoolClient,
  input: BatalkanPermintaanInput,
): Promise<BatalkanPermintaanResult> {
  const { rows } = await client.query<{ id: number; kode: string; status: PermintaanTransferStatus }>(
    `SELECT id, kode, status FROM inventory_permintaan_transfer WHERE id = $1`,
    [input.id],
  );
  const row = rows[0];
  if (!row) throw new Error(`Permintaan transfer id ${input.id} tidak ditemukan`);
  if (row.status !== "diminta") {
    throw new Error(`Permintaan transfer "${row.kode}" sudah ${row.status}, tidak bisa dibatalkan lagi`);
  }

  await client.query(`UPDATE inventory_permintaan_transfer SET status = 'dibatalkan' WHERE id = $1`, [row.id]);

  return { id: row.id, kode: row.kode, status: "dibatalkan" };
}

export interface TolakPermintaanInput {
  id: number;
  alasanTolak: string;
  /** Diisi otomatis dari user yang login (lihat api/router.ts). */
  userId?: number;
}

export interface TolakPermintaanResult {
  id: number;
  kode: string;
  status: "ditolak";
}

/**
 * CK menolak permintaan yang masih 'diminta' (Tahap 1B, 2026-11-14 -- BARU,
 * sebelumnya CK cuma bisa "penuhi" lewat transfer kirim, tidak ada jalur
 * tolak sama sekali). `alasanTolak` WAJIB diisi (bukan opsional seperti
 * `catatan` permintaan) -- CK harus menjelaskan kenapa, konsisten dengan
 * pola `alasan` di `inventory_transaksi_mutasi_lain`.
 */
export async function tolakPermintaan(client: PoolClient, input: TolakPermintaanInput): Promise<TolakPermintaanResult> {
  if (!input.alasanTolak.trim()) throw new Error("Alasan tolak wajib diisi");

  const { rows } = await client.query<{ id: number; kode: string; status: PermintaanTransferStatus }>(
    `SELECT id, kode, status FROM inventory_permintaan_transfer WHERE id = $1`,
    [input.id],
  );
  const row = rows[0];
  if (!row) throw new Error(`Permintaan transfer id ${input.id} tidak ditemukan`);
  if (row.status !== "diminta") {
    throw new Error(`Permintaan transfer "${row.kode}" sudah ${row.status}, tidak bisa ditolak lagi`);
  }

  await client.query(
    `UPDATE inventory_permintaan_transfer
     SET status = 'ditolak', alasan_tolak = $1, dijawab_pada = now(), dijawab_oleh = $2
     WHERE id = $3`,
    [input.alasanTolak.trim(), input.userId ?? null, row.id],
  );

  return { id: row.id, kode: row.kode, status: "ditolak" };
}

export interface AkuiPermintaanInput {
  id: number;
  userId: number;
}

export interface AkuiPermintaanResult {
  id: number;
  kode: string;
}

/**
 * Tandai permintaan "diakui/dilihat" (2026-11-18, Tahap 2 notifikasi) --
 * KHUSUS dipanggil dari tombol "Terima" Telegram oleh role owner (lihat
 * `core/src/notifikasi/router.ts` + `notifikasi/register.ts`). SENGAJA
 * TIDAK mengubah `status` -- permintaan TETAP 'diminta' dan tetap muncul
 * di Layar CK sampai benar-benar dipenuhi/ditolak lewat jalur yang sudah
 * ada (qty pengiriman cuma bisa diisi lewat Transfer Kirim sungguhan di
 * app). Boleh dipanggil berkali-kali (idempoten -- menimpa `diakui_pada`
 * dengan waktu terbaru), TIDAK ada validasi status seperti `tolakPermintaan`.
 */
export async function akuiPermintaan(client: PoolClient, input: AkuiPermintaanInput): Promise<AkuiPermintaanResult> {
  const { rows } = await client.query<{ id: number; kode: string }>(
    `UPDATE inventory_permintaan_transfer SET diakui_pada = now(), diakui_oleh = $1 WHERE id = $2 RETURNING id, kode`,
    [input.userId, input.id],
  );
  const row = rows[0];
  if (!row) throw new Error(`Permintaan transfer id ${input.id} tidak ditemukan`);
  return { id: row.id, kode: row.kode };
}

export type StatusStokPermintaan = "cukup" | "kurang" | "habis";
export type SaranPemenuhan = "produksi" | "beli";

export interface LayarCkItem extends PermintaanTransferListItem {
  stokSaatIni: number;
  statusStok: StatusStokPermintaan;
  saran: SaranPemenuhan;
}

/**
 * Layar CK (Tahap 1B, 2026-11-14): permintaan masuk yang MASIH 'diminta' ke
 * lokasi `locationAsalId` (CK), dilengkapi status stok item itu DI LOKASI CK
 * ITU SENDIRI (BUKAN stok outlet yang meminta -- CK perlu tahu stoknya sendiri
 * untuk memutuskan bisa penuhi berapa) dibandingkan `qtyDiminta`, dan saran
 * kasar produksi/beli berdasar `inventory_items.type` (setengah_jadi = item
 * yang DIBUAT lewat resep produksi -> saran "produksi"; bahan_baku/packaging/
 * operasional = dibeli dari vendor -> saran "beli"). Saran ini SEKEDAR HINT
 * UI, bukan keputusan otomatis -- CK tetap yang memutuskan aksi akhir.
 */
export async function getLayarCk(client: PoolClient, locationAsalId: number): Promise<LayarCkItem[]> {
  const permintaan = await listPermintaanTransfer(client, { locationId: locationAsalId, status: "diminta" });
  const relevan = permintaan.filter((p) => p.locationAsalId === locationAsalId);

  const hasil: LayarCkItem[] = [];
  for (const p of relevan) {
    const { rows: itemRows } = await client.query<{ id: number; type: string }>(
      `SELECT id, type FROM inventory_items WHERE kode = $1`,
      [p.itemKode],
    );
    const item = itemRows[0];
    const stokSaatIni = item ? await getCurrentStock(client, item.id, locationAsalId) : 0;

    const statusStok: StatusStokPermintaan = stokSaatIni <= 0 ? "habis" : stokSaatIni < p.qtyDiminta ? "kurang" : "cukup";
    const saran: SaranPemenuhan = item?.type === "setengah_jadi" ? "produksi" : "beli";

    hasil.push({ ...p, stokSaatIni, statusStok, saran });
  }
  return hasil;
}
