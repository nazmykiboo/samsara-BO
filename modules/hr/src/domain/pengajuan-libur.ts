import type { PoolClient } from "pg";
import type { AuthUser } from "@samsara/core";
import { writeAuditLog } from "@samsara/core";

/**
 * Pengajuan libur/cuti staf. Pola akses: SIAPA PUN yang login boleh
 * mengajukan untuk DIRI SENDIRI (userId selalu dari token, tidak pernah
 * dari body -- lihat `createPengajuanLibur`, tidak bisa mengajukan atas
 * nama orang lain). owner/manajer_ops melihat semua pengajuan (antrian
 * approval) dan memutuskan (setuju/tolak); supervisor/staf cuma melihat
 * riwayat pengajuan MEREKA SENDIRI (beda dari jadwal.lihat yang sekarang
 * lokasi-scoped -- kuota cuti/alasan tetap privat per orang, tidak ada
 * kebutuhan bisnis untuk staf lain melihatnya).
 *
 * Kuota cuti bulanan: dibaca dari `hr_settings` (key 'cuti_kuota_bulanan',
 * lihat migrasi 0003_create_settings.sql). Pengajuan yang akan membuat
 * total hari DISETUJUI di bulan `tanggal_mulai`-nya melebihi kuota TETAP
 * bisa dibuat (tidak ditolak sistem) -- cuma ditandai `melebihiKuota` +
 * `selisih` di response, supaya manajer lihat sebagai peringatan saat
 * approve, bukan blocker otomatis. Dihitung ULANG tiap kali dibaca
 * (create maupun list), bukan disimpan sebagai kolom -- supaya selalu
 * mencerminkan status pengajuan LAIN yang disetujui/ditolak belakangan.
 *
 * SOP cuti (migrasi 0004_add_sop_cuti_override.sql):
 * - H-2: pengajuan NORMAL wajib minimal 2 hari sebelum tanggal mulai. Ini
 *   SATU-SATUNYA aturan cuti yang benar-benar MEMBLOKIR insert.
 * - Kuota harian lokasi (`kuotaHarianPenuh`): maksimal 1 cuti disetujui per
 *   lokasi per tanggal. Ditandai saja, tidak memblokir -- sama pola dengan
 *   kuota bulanan, dan sama-sama dihitung ulang tiap baca.
 * - Override (`overridePengajuanLibur`): jalur darurat owner/manajer_ops
 *   untuk membuatkan cuti staf LAIN, menembus H-2, langsung 'disetujui'.
 */

function isManajerial(role: AuthUser["role"]): boolean {
  return role === "owner" || role === "manajer_ops";
}

/** "YYYY-MM-DD" -> epoch ms tengah malam UTC. Date.UTC murni (bukan
 * `new Date(str)` lokal) supaya tidak kena pergeseran timezone -- pola yang
 * sama dengan `mondayOfWeek`/`addDaysUTC`/`diffDaysUTC` di jadwal.ts. */
function toUtcMs(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Tanggal HARI INI di kalender Asia/Jakarta (lokasi bisnis Samsara), "YYYY-MM-DD".
 * BUG yang diperbaiki di sini (ditemukan lewat verifikasi live aturan H-2): versi lama
 * `new Date().toISOString().slice(0,10)` mengembalikan tanggal UTC, bukan WIB -- salah
 * selama ~7 jam tiap hari (00:00-06:59 WIB, persis jam sebelum outlet buka jam 06:00,
 * UTC masih tanggal KEMARIN karena Jakarta UTC+7). Efeknya nyata, bukan kosmetik: selama
 * jam itu, aturan H-2 dan "bulan kalender ini" (kuota bulanan/`getSisaKuotaCuti`) ikut
 * salah hitung. `Intl.DateTimeFormat` dengan `timeZone` eksplisit TIDAK bergantung pada
 * timezone OS/proses Node -- tetap benar di mesin dev mana pun atau nanti di VPS,
 * berapa pun timezone server itu di-set. */
function hariIniJakarta(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Jumlah hari INKLUSIF dari satu rentang tanggal (YYYY-MM-DD kedua ujung) --
 * rentang 1 hari (mulai = selesai) bernilai 1, karena itu `+ 1`. */
function jumlahHari(tanggalMulai: string, tanggalSelesai: string): number {
  return Math.round((toUtcMs(tanggalSelesai) - toUtcMs(tanggalMulai)) / 86_400_000) + 1;
}

/** Selisih hari `b - a` (bisa negatif), TANPA `+ 1` -- beda dari
 * `jumlahHari` yang menghitung panjang rentang inklusif. Dipakai aturan H-2
 * ("berapa hari dari hari ini ke tanggal mulai cuti"). */
function selisihHari(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

/** Minimal hari antara HARI INI dan tanggal mulai cuti untuk pengajuan
 * NORMAL. Satu-satunya jalan menembusnya: `overridePengajuanLibur`. */
const MINIMUM_HARI_PENGAJUAN = 2;

/** Lokasi tetap staf (`core_user_lokasi`) -- ambil yang PERTAMA kalau
 * ternyata ada lebih dari satu, karena staf/supervisor normalnya cuma
 * ditugaskan ke satu lokasi. `null` berarti user tidak punya baris di tabel
 * itu sama sekali: ini NORMAL untuk owner/manajer_ops (`allLocations`, lihat
 * core/src/auth/users.ts -- mereka sengaja tidak punya lokasi tetap), dan
 * untuk mereka kuota harian cuti per lokasi memang tidak relevan (tidak
 * dicek, bukan error). */
async function resolveUserLokasiId(client: PoolClient, userId: number): Promise<number | null> {
  const { rows } = await client.query<{ location_id: string }>(
    `SELECT location_id FROM core_user_lokasi WHERE user_id = $1 ORDER BY location_id LIMIT 1`,
    [userId],
  );
  return rows[0] ? Number(rows[0].location_id) : null;
}

/**
 * Apakah kuota harian cuti LOKASI sudah penuh untuk rentang tanggal ini --
 * aturan bisnis: maksimal 1 cuti berstatus 'disetujui' per lokasi per
 * tanggal, supaya outlet/CK tidak kehilangan lebih dari satu staf di hari
 * yang sama. true kalau ADA pengajuan disetujui milik user MANA PUN di
 * lokasi yang sama yang tanggalnya OVERLAP (`startA <= endB AND endA >=
 * startB`).
 *
 * Seperti kuota bulanan, ini TIDAK memblokir submit pengajuan normal --
 * cuma ditandai `kuotaHarianPenuh` supaya manajer melihatnya saat approve.
 * Satu-satunya tempat ia jadi syarat keras: `overridePengajuanLibur` (kalau
 * penuh, nama pengganti wajib diisi).
 */
async function cekKuotaHarianLokasiPenuh(
  client: PoolClient,
  lokasiId: number,
  tanggalMulai: string,
  tanggalSelesai: string,
  excludeId?: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM hr_pengajuan_libur p
     JOIN core_user_lokasi ul ON ul.user_id = p.user_id
     WHERE p.status = 'disetujui' AND ul.location_id = $1
       AND p.tanggal_mulai <= $3 AND p.tanggal_selesai >= $2
       AND ($4::bigint IS NULL OR p.id <> $4)
     LIMIT 1`,
    [lokasiId, tanggalMulai, tanggalSelesai, excludeId ?? null],
  );
  return rows[0] !== undefined;
}

/** `kuotaHarianPenuh` untuk satu pengajuan, sudah termasuk resolve lokasi
 * staf-nya. `false` kalau user tidak punya lokasi tetap (lihat
 * `resolveUserLokasiId`). */
async function hitungKuotaHarian(
  client: PoolClient,
  userId: number,
  tanggalMulai: string,
  tanggalSelesai: string,
  excludeId?: number,
): Promise<boolean> {
  const lokasiId = await resolveUserLokasiId(client, userId);
  if (lokasiId === null) return false;
  return cekKuotaHarianLokasiPenuh(client, lokasiId, tanggalMulai, tanggalSelesai, excludeId);
}

async function getCutiKuotaBulanan(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ value: string }>(
    `SELECT value FROM hr_settings WHERE key = 'cuti_kuota_bulanan'`,
  );
  return rows[0] ? Number(rows[0].value) : 2;
}

/** Total hari pengajuan berstatus 'disetujui' milik `userId` di bulan kalender
 * yang memuat `tanggalAcuan`, TIDAK termasuk `excludeId` (dipakai supaya
 * pengajuan yang sedang dihitung tidak menghitung dirinya sendiri dua kali). */
async function hariDisetujuiBulanIni(
  client: PoolClient,
  userId: number,
  tanggalAcuan: string,
  excludeId?: number,
): Promise<number> {
  const bulan = tanggalAcuan.slice(0, 7); // "YYYY-MM"
  const { rows } = await client.query<{ tanggal_mulai: string; tanggal_selesai: string }>(
    `SELECT tanggal_mulai, tanggal_selesai FROM hr_pengajuan_libur
     WHERE user_id = $1 AND status = 'disetujui' AND to_char(tanggal_mulai, 'YYYY-MM') = $2
       AND ($3::bigint IS NULL OR id <> $3)`,
    [userId, bulan, excludeId ?? null],
  );
  return rows.reduce((sum, r) => sum + jumlahHari(r.tanggal_mulai, r.tanggal_selesai), 0);
}

export interface KuotaResult {
  melebihiKuota: boolean;
  /** Jumlah hari kelebihan dari kuota -- 0 kalau `melebihiKuota` false. */
  selisih: number;
}

async function hitungKuota(
  client: PoolClient,
  userId: number,
  tanggalMulai: string,
  tanggalSelesai: string,
  excludeId?: number,
): Promise<KuotaResult> {
  const kuota = await getCutiKuotaBulanan(client);
  const sudahDisetujui = await hariDisetujuiBulanIni(client, userId, tanggalMulai, excludeId);
  const totalJikaDisetujui = sudahDisetujui + jumlahHari(tanggalMulai, tanggalSelesai);
  const melebihiKuota = totalJikaDisetujui > kuota;
  return { melebihiKuota, selisih: melebihiKuota ? totalJikaDisetujui - kuota : 0 };
}

export interface SisaKuotaCuti {
  bulan: string;
  kuotaBulanan: number;
  terpakai: number;
  sisa: number;
}

/** Sisa kuota cuti user untuk bulan kalender HARI INI (dipakai tampilan
 * "Sisa cuti bulan ini: X dari Y hari" di tab Pengajuan Libur). `sisa` bisa
 * negatif kalau sudah ada pengajuan disetujui yang melebihi kuota -- sengaja
 * tidak di-clamp ke 0, supaya kelebihannya tetap terlihat apa adanya. */
export async function getSisaKuotaCuti(client: PoolClient, userId: number): Promise<SisaKuotaCuti> {
  const hariIni = hariIniJakarta();
  const kuota = await getCutiKuotaBulanan(client);
  const terpakai = await hariDisetujuiBulanIni(client, userId, hariIni);
  return { bulan: hariIni.slice(0, 7), kuotaBulanan: kuota, terpakai, sisa: kuota - terpakai };
}

export type PengajuanLiburStatus = "diajukan" | "disetujui" | "ditolak";

export interface PengajuanLiburRow {
  id: string;
  userId: string;
  userName: string;
  tanggalMulai: string;
  tanggalSelesai: string;
  alasan: string | null;
  status: PengajuanLiburStatus;
  diputuskanOleh: string | null;
  diputuskanPada: string | null;
  createdAt: string;
  /** Dihitung ulang tiap baca (lihat `hitungKuota`) -- kalau pengajuan ini
   * DITAMBAHKAN ke hari disetujui lain milik user yang sama bulan ini,
   * apakah melebihi `cuti_kuota_bulanan`. Dipakai frontend untuk badge
   * "Melebihi kuota" di antrian approval manajer. */
  melebihiKuota: boolean;
  selisihKuota: number;
  /** Dihitung ulang tiap baca (lihat `cekKuotaHarianLokasiPenuh`) -- di
   * lokasi staf ini sudah ada cuti LAIN berstatus disetujui yang tanggalnya
   * overlap dengan pengajuan ini. Peringatan, bukan blocker. Ikut
   * dikembalikan untuk SEMUA role (staf yang mengajukan juga melihatnya,
   * supaya tahu peluang disetujuinya kecil sebelum manajer memutuskan). */
  kuotaHarianPenuh: boolean;
}

function mapRow(row: {
  id: string;
  user_id: string;
  user_name: string;
  tanggal_mulai: string;
  tanggal_selesai: string;
  alasan: string | null;
  status: PengajuanLiburStatus;
  diputuskan_oleh: string | null;
  diputuskan_pada: string | null;
  created_at: string;
  kuota: KuotaResult;
  kuota_harian_penuh: boolean;
}): PengajuanLiburRow {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    tanggalMulai: row.tanggal_mulai,
    tanggalSelesai: row.tanggal_selesai,
    alasan: row.alasan,
    status: row.status,
    diputuskanOleh: row.diputuskan_oleh,
    diputuskanPada: row.diputuskan_pada,
    createdAt: row.created_at,
    melebihiKuota: row.kuota.melebihiKuota,
    selisihKuota: row.kuota.selisih,
    kuotaHarianPenuh: row.kuota_harian_penuh,
  };
}

export interface ListPengajuanLiburParams {
  status?: PengajuanLiburStatus;
  userId?: number;
}

/**
 * owner/manajer_ops boleh filter `userId` bebas (atau kosongkan untuk
 * lihat semua -- ini yang dipakai sebagai antrian approval bersama
 * `status: 'diajukan'`). supervisor/staf: `userId` yang dikirim DIABAIKAN,
 * selalu dipaksa ke `user.id` sendiri.
 */
export async function listPengajuanLibur(
  client: PoolClient,
  user: AuthUser,
  params: ListPengajuanLiburParams,
): Promise<PengajuanLiburRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.status !== undefined) {
    values.push(params.status);
    conditions.push(`p.status = $${values.length}`);
  }

  if (isManajerial(user.role)) {
    if (params.userId !== undefined) {
      values.push(params.userId);
      conditions.push(`p.user_id = $${values.length}`);
    }
  } else {
    values.push(String(user.id));
    conditions.push(`p.user_id = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await client.query<{
    id: string;
    user_id: string;
    user_name: string;
    tanggal_mulai: string;
    tanggal_selesai: string;
    alasan: string | null;
    status: PengajuanLiburStatus;
    diputuskan_oleh: string | null;
    diputuskan_pada: string | null;
    created_at: string;
  }>(
    `SELECT p.id, p.user_id, u.name AS user_name, p.tanggal_mulai, p.tanggal_selesai,
            p.alasan, p.status, p.diputuskan_oleh, p.diputuskan_pada, p.created_at
     FROM hr_pengajuan_libur p
     JOIN core_users u ON u.id = p.user_id
     ${where}
     ORDER BY p.created_at DESC`,
    values,
  );

  const result: PengajuanLiburRow[] = [];
  for (const row of rows) {
    const kuota = await hitungKuota(client, Number(row.user_id), row.tanggal_mulai, row.tanggal_selesai, Number(row.id));
    const kuotaHarianPenuh = await hitungKuotaHarian(
      client,
      Number(row.user_id),
      row.tanggal_mulai,
      row.tanggal_selesai,
      Number(row.id),
    );
    result.push(mapRow({ ...row, kuota, kuota_harian_penuh: kuotaHarianPenuh }));
  }
  return result;
}

export interface CreatePengajuanLiburInput {
  tanggalMulai: string;
  tanggalSelesai: string;
  alasan?: string;
}

/**
 * `userId` SELALU dari token login (parameter terpisah, bukan bagian
 * `input`) -- tidak ada jalan untuk mengajukan atas nama user lain.
 *
 * SATU-SATUNYA aturan yang MEMBLOKIR di sini: H-2 (lihat
 * `MINIMUM_HARI_PENGAJUAN`) -- pengajuan untuk hari ini/besok ditolak tanpa
 * insert sama sekali. Berlaku untuk SEMUA role, karena fungsi ini satu
 * jalur untuk siapa pun yang mengajukan untuk DIRI SENDIRI (owner dan
 * manajer_ops termasuk, lihat catatan di atas file); jalur darurat yang
 * menembusnya cuma `overridePengajuanLibur`, dan itu khusus mengajukan
 * untuk ORANG LAIN.
 *
 * Kuota TIDAK PERNAH memblokir -- baik kuota bulanan staf (`melebihiKuota`/
 * `selisih`) maupun kuota harian lokasi (`kuotaHarianPenuh`): pengajuan
 * tetap dibuat (status awal selalu 'diajukan' seperti biasa), response cuma
 * menandainya sebagai peringatan untuk manajer saat approve.
 */
export async function createPengajuanLibur(
  client: PoolClient,
  userId: number,
  input: CreatePengajuanLiburInput,
): Promise<{ id: string; kuotaHarianPenuh: boolean } & KuotaResult> {
  const hariIni = hariIniJakarta();
  if (selisihHari(hariIni, input.tanggalMulai) < MINIMUM_HARI_PENGAJUAN) {
    throw new Error(
      `Pengajuan cuti harus diajukan minimal H-${MINIMUM_HARI_PENGAJUAN} (${MINIMUM_HARI_PENGAJUAN} hari sebelum tanggal mulai). Untuk situasi darurat, minta owner/manajer_ops membuatkan lewat menu override.`,
    );
  }

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO hr_pengajuan_libur (user_id, tanggal_mulai, tanggal_selesai, alasan)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, input.tanggalMulai, input.tanggalSelesai, input.alasan ?? null],
  );
  const id = rows[0].id;
  await writeAuditLog(client, {
    userId,
    tableName: "hr_pengajuan_libur",
    recordId: Number(id),
    fieldName: "created",
    oldValue: null,
    newValue: input,
  });
  const kuota = await hitungKuota(client, userId, input.tanggalMulai, input.tanggalSelesai, Number(id));
  const kuotaHarianPenuh = await hitungKuotaHarian(
    client,
    userId,
    input.tanggalMulai,
    input.tanggalSelesai,
    Number(id),
  );
  return { id, ...kuota, kuotaHarianPenuh };
}

export type KeputusanPengajuanLibur = "disetujui" | "ditolak";

/**
 * Setujui/tolak 1 pengajuan. Ditolak (error) kalau: pengajuan tidak ada,
 * sudah diputuskan sebelumnya (tidak bisa diputuskan ulang), ATAU
 * approver mencoba memutuskan pengajuan MILIK SENDIRI -- konflik
 * kepentingan, pola sama seperti "owner tidak bisa menonaktifkan akun
 * sendiri" di core (core/src/auth/users.ts updateUser).
 */
export async function decidePengajuanLibur(
  client: PoolClient,
  id: number,
  keputusan: KeputusanPengajuanLibur,
  approverUserId: number,
): Promise<void> {
  const { rows } = await client.query<{ id: number; user_id: string; status: PengajuanLiburStatus }>(
    `SELECT id, user_id, status FROM hr_pengajuan_libur WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`Pengajuan libur id ${id} tidak ditemukan`);

  if (row.status !== "diajukan") {
    throw new Error(`Pengajuan libur id ${id} sudah diputuskan (status "${row.status}"), tidak bisa diputuskan ulang`);
  }

  if (row.user_id === String(approverUserId)) {
    throw new Error("Tidak bisa memutuskan (setuju/tolak) pengajuan libur milik sendiri");
  }

  await client.query(
    `UPDATE hr_pengajuan_libur SET status = $1, diputuskan_oleh = $2, diputuskan_pada = now() WHERE id = $3`,
    [keputusan, approverUserId, id],
  );

  await writeAuditLog(client, {
    userId: approverUserId,
    tableName: "hr_pengajuan_libur",
    recordId: id,
    fieldName: "status",
    oldValue: "diajukan",
    newValue: keputusan,
  });
}

export interface OverridePengajuanLiburInput {
  /** Staf yang DIBUATKAN cutinya -- beda dari `createPengajuanLibur` yang
   * selalu untuk diri sendiri. Tidak boleh sama dengan approver. */
  userId: number;
  tanggalMulai: string;
  tanggalSelesai: string;
  alasan?: string;
  /** Wajib HANYA kalau aturan "kuota_harian_lokasi" dilanggar. */
  penggantiNama?: string;
}

/** Kode aturan SOP cuti yang bisa ditembus lewat override. */
export type AturanCutiDilanggar = "h2_minimum" | "kuota_harian_lokasi" | "kuota_bulanan_staf";

export interface OverridePengajuanLiburResult {
  id: string;
  /** Jumlah aturan yang ditembus (0-3) -- severity ringkas untuk UI/laporan. */
  level: number;
  aturanDilanggar: AturanCutiDilanggar[];
}

/**
 * Jalur DARURAT: owner/manajer_ops MEMBUATKAN cuti untuk staf lain, langsung
 * berstatus 'disetujui' dalam satu langkah (bukan 'diajukan' lalu diputuskan
 * terpisah) dan MENEMBUS aturan H-2 yang mengikat `createPengajuanLibur`.
 * Permission-nya `pengajuan_libur.approve` (owner+manajer_ops) -- sengaja
 * reuse, karena yang boleh override memang persis yang boleh menyetujui.
 *
 * Yang TIDAK ditembus:
 * - Konflik kepentingan: tidak bisa override untuk DIRI SENDIRI, pola sama
 *   persis seperti `decidePengajuanLibur` (owner/manajer_ops yang mau cuti
 *   untuk dirinya sendiri tetap lewat jalur normal + H-2, dan tetap harus
 *   diputuskan orang lain).
 * - Kuota harian lokasi: kalau penuh, `penggantiNama` WAJIB diisi -- satu
 *   outlet boleh kehilangan staf kedua di hari yang sama HANYA kalau sudah
 *   jelas siapa penggantinya.
 *
 * Aturan yang dilanggar TIDAK memblokir (kecuali dua hal di atas), cuma
 * dicatat sebagai `aturanDilanggar`/`level` di response dan di audit log,
 * supaya "berapa sering kita keluar SOP, dan seberapa jauh" bisa diaudit.
 */
export async function overridePengajuanLibur(
  client: PoolClient,
  approverUserId: number,
  input: OverridePengajuanLiburInput,
): Promise<OverridePengajuanLiburResult> {
  if (input.userId === approverUserId) {
    throw new Error(
      "Tidak bisa membuat pengajuan override untuk diri sendiri (konflik kepentingan, sama seperti tidak bisa memutuskan pengajuan sendiri)",
    );
  }

  const { rows: userRows } = await client.query(`SELECT 1 FROM core_users WHERE id = $1`, [input.userId]);
  if (!userRows[0]) throw new Error(`User id ${input.userId} tidak ditemukan`);

  const hariIni = hariIniJakarta();
  const aturanDilanggar: AturanCutiDilanggar[] = [];

  if (selisihHari(hariIni, input.tanggalMulai) < MINIMUM_HARI_PENGAJUAN) {
    aturanDilanggar.push("h2_minimum");
  }

  // Tanpa excludeId: baris override-nya sendiri belum ada saat dicek.
  const kuotaHarianPenuh = await hitungKuotaHarian(client, input.userId, input.tanggalMulai, input.tanggalSelesai);
  if (kuotaHarianPenuh) aturanDilanggar.push("kuota_harian_lokasi");

  const kuotaBulanan = await hitungKuota(client, input.userId, input.tanggalMulai, input.tanggalSelesai);
  if (kuotaBulanan.melebihiKuota) aturanDilanggar.push("kuota_bulanan_staf");

  if (aturanDilanggar.includes("kuota_harian_lokasi") && !input.penggantiNama?.trim()) {
    throw new Error("Nama pengganti wajib diisi kalau kuota harian cuti lokasi ini sudah penuh");
  }

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO hr_pengajuan_libur (user_id, tanggal_mulai, tanggal_selesai, alasan, status, diputuskan_oleh, diputuskan_pada, pengganti_nama, dibuat_via_override)
     VALUES ($1, $2, $3, $4, 'disetujui', $5, now(), $6, true)
     RETURNING id`,
    [
      input.userId,
      input.tanggalMulai,
      input.tanggalSelesai,
      input.alasan ?? null,
      approverUserId,
      input.penggantiNama?.trim() || null,
    ],
  );
  const id = rows[0].id;

  await writeAuditLog(client, {
    userId: approverUserId,
    tableName: "hr_pengajuan_libur",
    recordId: Number(id),
    fieldName: "created_via_override",
    oldValue: null,
    newValue: {
      level: aturanDilanggar.length,
      aturanDilanggar,
      penggantiNama: input.penggantiNama ?? null,
      userId: input.userId,
      tanggalMulai: input.tanggalMulai,
      tanggalSelesai: input.tanggalSelesai,
    },
  });

  return { id, level: aturanDilanggar.length, aturanDilanggar };
}
