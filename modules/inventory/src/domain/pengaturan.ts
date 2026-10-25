import type { PoolClient } from "pg";
import type { AuthUser } from "@samsara/core";
import type { HppMethod } from "./hpp.js";
import { adaJadwalKeDepanViaApi } from "../lib/internal-api.js";

// ---------------------------------------------------------------------------
// Metode HPP default (pengaturan global, owner-only untuk mengubah)
// ---------------------------------------------------------------------------

export async function getHppDefaultMethod(client: PoolClient): Promise<HppMethod> {
  const { rows } = await client.query<{ value: string }>(
    `SELECT value FROM inventory_settings WHERE key = 'hpp_default_method'`,
  );
  return rows[0]?.value === "harga_beli_terakhir" ? "harga_beli_terakhir" : "harga_master";
}

export async function setHppDefaultMethod(client: PoolClient, method: HppMethod): Promise<void> {
  await client.query(
    `INSERT INTO inventory_settings (key, value, updated_at) VALUES ('hpp_default_method', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [method],
  );
}

/**
 * Resolusi metode HPP yang benar-benar dipakai untuk satu request: query
 * param `?metode=` cuma jadi OVERRIDE untuk owner/manajer_ops -- role lain
 * (supervisor/staf) selalu pakai default global, walau mereka mengirim
 * `?metode=` (diabaikan, bukan ditolak, supaya tidak memblokir akses baca).
 */
export async function resolveHppMethod(
  client: PoolClient,
  user: AuthUser,
  queryMetode: unknown,
): Promise<HppMethod> {
  const defaultMethod = await getHppDefaultMethod(client);
  const canOverride = user.role === "owner" || user.role === "manajer_ops";
  if (!canOverride) return defaultMethod;
  return queryMetode === "harga_beli_terakhir" || queryMetode === "harga_master" ? queryMetode : defaultMethod;
}

// ---------------------------------------------------------------------------
// Target food cost % (pengaturan global, owner-only untuk mengubah) --
// dipakai domain/harga-channel.ts (getRekomendasiHarga) sebagai default
// kalau request tidak mengirim target eksplisit.
// ---------------------------------------------------------------------------

const TARGET_FOOD_COST_FALLBACK = 30;

export async function getTargetFoodCostPersen(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ value: string }>(
    `SELECT value FROM inventory_settings WHERE key = 'target_food_cost_persen'`,
  );
  const value = rows[0] === undefined ? NaN : Number(rows[0].value);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : TARGET_FOOD_COST_FALLBACK;
}

/** Validasi (>0 dan <=100) di sini, bukan di router -- lihat pola validasi domain lain (mis. master.ts). */
export async function setTargetFoodCostPersen(client: PoolClient, value: number): Promise<void> {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error("'targetFoodCostPersen' wajib angka > 0 dan <= 100");
  }
  await client.query(
    `INSERT INTO inventory_settings (key, value, updated_at) VALUES ('target_food_cost_persen', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [String(value)],
  );
}

// ---------------------------------------------------------------------------
// Lokasi
// ---------------------------------------------------------------------------

export type LokasiTipe = "outlet" | "kitchen";

export interface LokasiRow {
  id: number;
  name: string;
  entitas: string;
  isActive: boolean;
  kode: string | null;
  tipe: LokasiTipe | null;
  alamat: string | null;
  kota: string | null;
  telepon: string | null;
  jamBuka: string | null;
  jamTutup: string | null;
  penanggungJawab: string | null;
  tanggalBuka: string | null;
  kitchenDefaultId: number | null;
}

function baseLokasiRowToDto(row: {
  id: number;
  name: string;
  entitas: string;
  is_active: boolean;
  kode: string | null;
  tipe: string | null;
  alamat: string | null;
  kota: string | null;
  telepon: string | null;
  jam_buka: string | null;
  jam_tutup: string | null;
  penanggung_jawab: string | null;
  tanggal_buka: string | null;
  kitchen_default_id: number | null;
}): LokasiRow {
  return {
    id: row.id,
    name: row.name,
    entitas: row.entitas,
    isActive: row.is_active,
    kode: row.kode,
    tipe: row.tipe === "outlet" || row.tipe === "kitchen" ? row.tipe : null,
    alamat: row.alamat,
    kota: row.kota,
    telepon: row.telepon,
    jamBuka: row.jam_buka,
    jamTutup: row.jam_tutup,
    penanggungJawab: row.penanggung_jawab,
    tanggalBuka: row.tanggal_buka,
    kitchenDefaultId: row.kitchen_default_id,
  };
}

const SELECT_LOKASI = `
  SELECT id, name, entitas, is_active, kode, tipe, alamat, kota, telepon,
         jam_buka::text AS jam_buka, jam_tutup::text AS jam_tutup,
         penanggung_jawab, to_char(tanggal_buka, 'YYYY-MM-DD') AS tanggal_buka, kitchen_default_id
  FROM core_locations
`;

/**
 * Daftar SEMUA lokasi (termasuk nonaktif -- pemanggil yang mau filter aktif
 * saja melakukannya sendiri, sama seperti pola `listUsers`/`listOpname` di
 * modul ini: domain layer mengembalikan apa adanya, penyaringan tampilan ada
 * di pemanggil/router kalau perlu). TIDAK digerbang permission di sini --
 * endpoint publik (lihat router) karena dipakai juga sebelum login (pilih
 * lokasi di flow login PIN staf).
 */
export async function listLokasi(client: PoolClient): Promise<LokasiRow[]> {
  const { rows } = await client.query(`${SELECT_LOKASI} ORDER BY tipe, name`);
  return rows.map(baseLokasiRowToDto);
}

export interface CreateLokasiInput {
  name: string;
  entitas: string;
  kode?: string;
  tipe?: LokasiTipe;
  alamat?: string;
  kota?: string;
  telepon?: string;
  jamBuka?: string;
  jamTutup?: string;
  penanggungJawab?: string;
  tanggalBuka?: string;
  kitchenDefaultId?: number;
}

export async function createLokasi(client: PoolClient, input: CreateLokasiInput): Promise<{ id: number }> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO core_locations
       (name, entitas, kode, tipe, alamat, kota, telepon, jam_buka, jam_tutup, penanggung_jawab, tanggal_buka, kitchen_default_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      input.name,
      input.entitas,
      input.kode ?? null,
      input.tipe ?? null,
      input.alamat ?? null,
      input.kota ?? null,
      input.telepon ?? null,
      input.jamBuka ?? null,
      input.jamTutup ?? null,
      input.penanggungJawab ?? null,
      input.tanggalBuka ?? null,
      input.kitchenDefaultId ?? null,
    ],
  );
  return { id: rows[0].id };
}

export interface UpdateLokasiInput {
  name?: string;
  entitas?: string;
  isActive?: boolean;
  kode?: string | null;
  tipe?: LokasiTipe | null;
  alamat?: string | null;
  kota?: string | null;
  telepon?: string | null;
  jamBuka?: string | null;
  jamTutup?: string | null;
  penanggungJawab?: string | null;
  tanggalBuka?: string | null;
  kitchenDefaultId?: number | null;
}

/**
 * Cek penghalang nonaktifkan lokasi -- dipanggil dari `updateLokasi` HANYA
 * saat `input.isActive === false`. Mengembalikan daftar alasan (kosong =
 * boleh dinonaktifkan). Urutan kategori sengaja dari yang paling "data
 * finansial" (stok) ke yang paling "operasional" (jadwal) -- tidak
 * berhenti di penghalang pertama, supaya owner lihat SEMUA yang perlu
 * diselesaikan sekali baca, bukan trial-error satu-satu.
 *
 * "jadwal ke depan" dicek lewat HTTP ke modul HR (`adaJadwalKeDepanViaApi`),
 * BUKAN query langsung ke `hr_jadwal_shift` -- itu tabel milik modul HR,
 * dan Inventory tidak boleh query tabel modul bisnis lain secara langsung
 * (lihat `lib/internal-api.ts`). Kalau modul HR nonaktif, panggilan itu
 * melempar Error yang diteruskan apa adanya (pengecekan jadwal gagal total
 * lebih aman daripada diam-diam dianggap "tidak ada jadwal").
 */
async function cekPenghalangNonaktifLokasi(
  client: PoolClient,
  locationId: number,
  authHeader: string,
): Promise<string[]> {
  const penghalang: string[] = [];

  const { rows: stokRows } = await client.query(
    `SELECT 1 FROM inventory_current_stock WHERE location_id = $1 AND qty != 0 LIMIT 1`,
    [locationId],
  );
  if (stokRows.length > 0) penghalang.push("Masih ada stok tersisa di lokasi ini");

  const { rows: transferRows } = await client.query(
    `SELECT 1 FROM inventory_transfer_dalam_perjalanan WHERE location_asal_id = $1 OR location_tujuan_id = $1 LIMIT 1`,
    [locationId],
  );
  if (transferRows.length > 0) penghalang.push("Ada transfer yang masih berjalan (sudah dikirim, belum diterima)");

  const { rows: permintaanRows } = await client.query(
    `SELECT 1 FROM inventory_permintaan_transfer
     WHERE (location_asal_id = $1 OR location_tujuan_id = $1) AND status = 'diminta' LIMIT 1`,
    [locationId],
  );
  if (permintaanRows.length > 0) penghalang.push("Ada permintaan transfer yang masih pending");

  const { rows: opnameRows } = await client.query(
    `SELECT 1 FROM inventory_transaksi_opname WHERE location_id = $1 AND status = 'draft' LIMIT 1`,
    [locationId],
  );
  if (opnameRows.length > 0) penghalang.push("Ada draft opname yang belum diputuskan");

  if (await adaJadwalKeDepanViaApi(authHeader, locationId)) {
    penghalang.push("Ada jadwal shift staf ke depan di lokasi ini");
  }

  return penghalang;
}

/**
 * Error khusus supaya router bisa membedakan "ditolak karena penghalang
 * nyata" (400, tampilkan daftarnya ke owner) dari error validasi biasa.
 */
export class LokasiTidakBisaNonaktifError extends Error {
  constructor(public readonly penghalang: string[]) {
    super(`Lokasi tidak bisa dinonaktifkan: ${penghalang.join("; ")}`);
    this.name = "LokasiTidakBisaNonaktifError";
  }
}

/**
 * @param authHeader Header `Authorization` request yang memicu update ini
 * -- WAJIB diisi kalau `input.isActive === false` (diteruskan ke guard
 * jadwal shift di atas); diabaikan sama sekali untuk update lain.
 */
export async function updateLokasi(
  client: PoolClient,
  id: number,
  input: UpdateLokasiInput,
  authHeader?: string,
): Promise<void> {
  const { rows } = await client.query<{
    id: number;
    name: string;
    entitas: string;
    is_active: boolean;
    kode: string | null;
    tipe: string | null;
    alamat: string | null;
    kota: string | null;
    telepon: string | null;
    jam_buka: string | null;
    jam_tutup: string | null;
    penanggung_jawab: string | null;
    tanggal_buka: string | null;
    kitchen_default_id: number | null;
  }>(`${SELECT_LOKASI} WHERE id = $1`, [id]);
  const old = rows[0];
  if (!old) throw new Error(`Lokasi id ${id} tidak ditemukan`);

  if (input.isActive === false && old.is_active) {
    if (!authHeader) throw new Error("Header Authorization wajib diteruskan untuk menonaktifkan lokasi");
    const penghalang = await cekPenghalangNonaktifLokasi(client, id, authHeader);
    if (penghalang.length > 0) throw new LokasiTidakBisaNonaktifError(penghalang);
  }

  await client.query(
    `UPDATE core_locations
     SET name = $1, entitas = $2, is_active = $3, kode = $4, tipe = $5, alamat = $6, kota = $7,
         telepon = $8, jam_buka = $9, jam_tutup = $10, penanggung_jawab = $11, tanggal_buka = $12,
         kitchen_default_id = $13
     WHERE id = $14`,
    [
      input.name ?? old.name,
      input.entitas ?? old.entitas,
      input.isActive ?? old.is_active,
      input.kode === undefined ? old.kode : input.kode,
      input.tipe === undefined ? old.tipe : input.tipe,
      input.alamat === undefined ? old.alamat : input.alamat,
      input.kota === undefined ? old.kota : input.kota,
      input.telepon === undefined ? old.telepon : input.telepon,
      input.jamBuka === undefined ? old.jam_buka : input.jamBuka,
      input.jamTutup === undefined ? old.jam_tutup : input.jamTutup,
      input.penanggungJawab === undefined ? old.penanggung_jawab : input.penanggungJawab,
      input.tanggalBuka === undefined ? old.tanggal_buka : input.tanggalBuka,
      input.kitchenDefaultId === undefined ? old.kitchen_default_id : input.kitchenDefaultId,
      id,
    ],
  );

  // Lokasi dinonaktifkan -> staf yang HANYA bertugas di lokasi ini kehilangan
  // akses efektif (lihat useLokasiOptions di frontend, dibatasi locationIds
  // milik user). Token lama mereka masih mengklaim lokasi yang sekarang
  // nonaktif -- naikkan token_version supaya token lama dibasikan, sama
  // persis pola yang sudah dipakai `updateUser` saat locationIds diubah.
  if (input.isActive === false && old.is_active) {
    await client.query(
      `UPDATE core_users SET token_version = token_version + 1, updated_at = now()
       WHERE id IN (SELECT user_id FROM core_user_lokasi WHERE location_id = $1)`,
      [id],
    );
  }
}

/**
 * Salin konfigurasi "channel aktif per lokasi" dari satu lokasi ke lokasi
 * lain -- supaya bikin outlet baru tidak perlu set ulang satu-satu channel
 * mana yang aktif/nonaktif. SENGAJA scope-nya cuma channel aktif (satu-
 * satunya konfigurasi per-lokasi baru yang ditambahkan Tahap 1 ini) --
 * BUKAN menyalin data transaksional (stok, dst, yang memang tidak masuk
 * akal disalin antar lokasi).
 *
 * REPLACE penuh di tujuan (bukan merge): baris existing tujuan dihapus dulu,
 * supaya hasil akhirnya PERSIS sama seperti sumber, bukan gabungan yang
 * bisa membingungkan ("kenapa channel X masih aktif padahal sumbernya
 * nonaktif?").
 */
export async function salinKonfigurasiLokasi(
  client: PoolClient,
  dariLocationId: number,
  keLocationId: number,
): Promise<void> {
  if (dariLocationId === keLocationId) {
    throw new Error("Lokasi sumber dan tujuan salin konfigurasi tidak boleh sama");
  }
  for (const locId of [dariLocationId, keLocationId]) {
    const { rows } = await client.query(`SELECT 1 FROM core_locations WHERE id = $1`, [locId]);
    if (!rows[0]) throw new Error(`Lokasi id ${locId} tidak ditemukan`);
  }

  await client.query(`DELETE FROM inventory_location_channel WHERE location_id = $1`, [keLocationId]);
  await client.query(
    `INSERT INTO inventory_location_channel (location_id, channel_id, is_active)
     SELECT $2, channel_id, is_active FROM inventory_location_channel WHERE location_id = $1`,
    [dariLocationId, keLocationId],
  );
}

// ---------------------------------------------------------------------------
// Channel penjualan
// ---------------------------------------------------------------------------

export async function createChannel(client: PoolClient, name: string): Promise<{ id: number }> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_sales_channel (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return { id: rows[0].id };
}

export interface UpdateChannelInput {
  name?: string;
  isActive?: boolean;
}

export async function updateChannel(client: PoolClient, id: number, input: UpdateChannelInput): Promise<void> {
  const { rows } = await client.query<{ id: number; name: string; is_active: boolean }>(
    `SELECT id, name, is_active FROM inventory_sales_channel WHERE id = $1`,
    [id],
  );
  const old = rows[0];
  if (!old) throw new Error(`Channel id ${id} tidak ditemukan`);

  await client.query(`UPDATE inventory_sales_channel SET name = $1, is_active = $2 WHERE id = $3`, [
    input.name ?? old.name,
    input.isActive ?? old.is_active,
    id,
  ]);
}
