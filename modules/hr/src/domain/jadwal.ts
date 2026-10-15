import type { PoolClient } from "pg";
import type { AuthUser } from "@samsara/core";
import { writeAuditLog } from "@samsara/core";

/**
 * Jadwal shift staf per lokasi. Akses baca/tulis dibedakan di sini
 * (domain layer), bukan cuma di router -- owner/manajer_ops (selalu
 * `allLocations: true`, lihat core/src/auth/users.ts) bebas lihat/kelola
 * jadwal lokasi & staf manapun; supervisor/staf boleh LIHAT jadwal SEMUA
 * staf di LOKASI MEREKA (bukan cuma diri sendiri lagi sejak kebutuhan
 * "siapa teman se-shift") -- lokasi-scoped lewat `user.locationIds`, sama
 * pola dengan `stok.lihat` di modul Inventory. `lokasiId` yang dikirim
 * role itu DIABAIKAN (dipaksa ke lokasi sendiri), bukan ditolak -- sama
 * seperti pola `resolveHppMethod` di modul Inventory untuk query param di
 * luar wewenang role peminta. `userId` tetap boleh dipakai role ini untuk
 * mempersempit (bukan memperluas) hasil yang sudah lokasi-scoped.
 */

function isManajerial(role: AuthUser["role"]): boolean {
  return role === "owner" || role === "manajer_ops";
}

/**
 * Subquery penanda bentrok jadwal vs cuti yang SUDAH DISETUJUI. Sengaja
 * correlated subquery di SELECT utama (bukan N+1 query per baris) --
 * `hr_pengajuan_libur` sudah terindeks (user_id, status), dan hasilnya ikut
 * satu round-trip yang sama dengan baris jadwalnya. `$ALIAS` diganti alias
 * tabel `hr_jadwal_shift` di query pemanggil lewat `konflikCutiSql()`.
 *
 * TIDAK PERNAH memblokir create/update jadwal -- keputusan operasional
 * (mis. cuti dibatalkan belakangan, atau staf tetap masuk setengah hari)
 * bukan kesalahan input, jadi jadwalnya tetap tersimpan dan konflik ini
 * cuma ditandai sebagai peringatan untuk manajer, pola sama seperti
 * `melebihiKuota` di pengajuan-libur.ts.
 */
function konflikCutiSql(alias: string): string {
  return `EXISTS (
            SELECT 1 FROM hr_pengajuan_libur pl
            WHERE pl.user_id = ${alias}.user_id AND pl.status = 'disetujui'
              AND pl.tanggal_mulai <= ${alias}.tanggal AND pl.tanggal_selesai >= ${alias}.tanggal
          )`;
}

/** Konflik cuti untuk SATU pasangan (user, tanggal) -- dipakai setelah
 * INSERT/UPDATE satu baris, di mana tidak ada SELECT utama yang bisa
 * dititipi `konflikCutiSql`. */
async function hitungKonflikCuti(client: PoolClient, userId: number | string, tanggal: string): Promise<boolean> {
  const { rows } = await client.query<{ konflik: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM hr_pengajuan_libur pl
       WHERE pl.user_id = $1 AND pl.status = 'disetujui'
         AND pl.tanggal_mulai <= $2 AND pl.tanggal_selesai >= $2
     ) AS konflik`,
    [userId, tanggal],
  );
  return rows[0].konflik;
}

export interface JadwalShiftRow {
  id: string;
  userId: string;
  userName: string;
  lokasiId: string;
  lokasiName: string;
  tanggal: string;
  shiftTemplateId: string | null;
  shiftTemplateNama: string | null;
  /** DEPRECATED sejak shift template -- lihat migrasi 0002_add_shift_template.sql. Duplikat dari jam shift_template terpilih, dipertahankan untuk kompatibilitas. */
  jamMulai: string;
  jamSelesai: string;
  dibuatOleh: string | null;
  /** Staf ini punya pengajuan libur berstatus 'disetujui' yang mencakup
   * `tanggal` -- dijadwalkan padahal sedang cuti. Peringatan saja, bukan
   * blocker (lihat `konflikCutiSql`). */
  konflikCuti: boolean;
}

export interface ListJadwalShiftParams {
  lokasiId?: number;
  dari: string;
  sampai: string;
  userId?: number;
}

function mapRow(row: {
  id: string;
  user_id: string;
  user_name: string;
  lokasi_id: string;
  lokasi_name: string;
  tanggal: string;
  shift_template_id: string | null;
  shift_template_nama: string | null;
  jam_mulai: string;
  jam_selesai: string;
  dibuat_oleh: string | null;
  konflik_cuti: boolean;
}): JadwalShiftRow {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    lokasiId: row.lokasi_id,
    lokasiName: row.lokasi_name,
    tanggal: row.tanggal,
    shiftTemplateId: row.shift_template_id,
    shiftTemplateNama: row.shift_template_nama,
    jamMulai: row.jam_mulai,
    jamSelesai: row.jam_selesai,
    dibuatOleh: row.dibuat_oleh,
    konflikCuti: row.konflik_cuti,
  };
}

/**
 * Daftar jadwal shift dalam rentang tanggal. owner/manajer_ops boleh
 * filter `lokasiId`/`userId` bebas (dua-duanya opsional -- kosongkan
 * `lokasiId` untuk lihat semua lokasi). supervisor/staf: `lokasiId` yang
 * dikirim DIABAIKAN, selalu dipaksa ke `user.locationIds` (semua lokasi
 * yang ditugaskan ke user itu, biasanya satu) -- hasilnya SEMUA staf di
 * lokasi itu, bukan cuma diri sendiri. `userId` opsional tetap dihormati
 * untuk role ini sekadar mempersempit hasil yang sudah lokasi-scoped
 * (tidak bisa dipakai untuk memperluas ke luar lokasi sendiri).
 */
export async function listJadwalShift(
  client: PoolClient,
  user: AuthUser,
  params: ListJadwalShiftParams,
): Promise<JadwalShiftRow[]> {
  const conditions: string[] = ["j.tanggal BETWEEN $1 AND $2"];
  const values: unknown[] = [params.dari, params.sampai];

  if (isManajerial(user.role)) {
    if (params.lokasiId !== undefined) {
      values.push(params.lokasiId);
      conditions.push(`j.lokasi_id = $${values.length}`);
    }
    if (params.userId !== undefined) {
      values.push(params.userId);
      conditions.push(`j.user_id = $${values.length}`);
    }
  } else {
    if (user.locationIds.length === 0) {
      conditions.push("1 = 0");
    } else {
      values.push(user.locationIds);
      conditions.push(`j.lokasi_id = ANY($${values.length})`);
    }
    if (params.userId !== undefined) {
      values.push(params.userId);
      conditions.push(`j.user_id = $${values.length}`);
    }
  }

  const { rows } = await client.query<{
    id: string;
    user_id: string;
    user_name: string;
    lokasi_id: string;
    lokasi_name: string;
    tanggal: string;
    shift_template_id: string | null;
    shift_template_nama: string | null;
    jam_mulai: string;
    jam_selesai: string;
    dibuat_oleh: string | null;
    konflik_cuti: boolean;
  }>(
    `SELECT j.id, j.user_id, u.name AS user_name, j.lokasi_id, l.name AS lokasi_name,
            j.tanggal, j.shift_template_id, st.nama AS shift_template_nama,
            j.jam_mulai, j.jam_selesai, j.dibuat_oleh,
            ${konflikCutiSql("j")} AS konflik_cuti
     FROM hr_jadwal_shift j
     JOIN core_users u ON u.id = j.user_id
     JOIN core_locations l ON l.id = j.lokasi_id
     LEFT JOIN hr_shift_template st ON st.id = j.shift_template_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY j.tanggal, j.jam_mulai`,
    values,
  );
  return rows.map(mapRow);
}

async function assertUserExists(client: PoolClient, userId: number): Promise<void> {
  const { rows } = await client.query(`SELECT 1 FROM core_users WHERE id = $1`, [userId]);
  if (!rows[0]) throw new Error(`User id ${userId} tidak ditemukan`);
}

async function assertLokasiExists(client: PoolClient, lokasiId: number): Promise<void> {
  const { rows } = await client.query(`SELECT 1 FROM core_locations WHERE id = $1`, [lokasiId]);
  if (!rows[0]) throw new Error(`Lokasi id ${lokasiId} tidak ditemukan`);
}

async function shiftTemplateJam(client: PoolClient, shiftTemplateId: number): Promise<{ jamMulai: string; jamSelesai: string }> {
  const { rows } = await client.query<{ jam_mulai: string; jam_selesai: string }>(
    `SELECT jam_mulai, jam_selesai FROM hr_shift_template WHERE id = $1`,
    [shiftTemplateId],
  );
  if (!rows[0]) throw new Error(`Shift template id ${shiftTemplateId} tidak ditemukan`);
  return { jamMulai: rows[0].jam_mulai, jamSelesai: rows[0].jam_selesai };
}

export interface CreateJadwalShiftInput {
  userId: number;
  lokasiId: number;
  tanggal: string;
  shiftTemplateId: number;
}

/**
 * Buat 1 baris jadwal shift. Jam diambil dari `shiftTemplateId` (lookup ke
 * `hr_shift_template`, BUKAN input manual lagi sejak migrasi
 * 0002_add_shift_template.sql) -- nilainya diduplikasi ke kolom
 * `jam_mulai`/`jam_selesai` yang DEPRECATED supaya data tetap konsisten
 * untuk query lama. TIDAK memvalidasi `userId` sungguh di-assign ke
 * `lokasiId` itu (lihat `core_user_lokasi`) -- sengaja, supaya
 * owner/manajer_ops tetap bisa menugaskan staf menutup shift di lokasi
 * lain kalau perlu (keputusan operasional, bukan kesalahan input).
 * Dengan alasan yang sama, bentrok dengan cuti yang sudah disetujui juga
 * TIDAK memblokir -- baris tetap dibuat, response cuma menandai
 * `konflikCuti` (lihat `konflikCutiSql`).
 */
export async function createJadwalShift(
  client: PoolClient,
  input: CreateJadwalShiftInput,
  dibuatOleh?: number,
): Promise<{ id: string; konflikCuti: boolean }> {
  await assertUserExists(client, input.userId);
  await assertLokasiExists(client, input.lokasiId);
  const { jamMulai, jamSelesai } = await shiftTemplateJam(client, input.shiftTemplateId);

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO hr_jadwal_shift (user_id, lokasi_id, tanggal, shift_template_id, jam_mulai, jam_selesai, dibuat_oleh)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.userId, input.lokasiId, input.tanggal, input.shiftTemplateId, jamMulai, jamSelesai, dibuatOleh ?? null],
  );
  const id = rows[0].id;
  await writeAuditLog(client, {
    userId: dibuatOleh ?? null,
    tableName: "hr_jadwal_shift",
    recordId: Number(id),
    fieldName: "created",
    oldValue: null,
    newValue: input,
  });
  const konflikCuti = await hitungKonflikCuti(client, input.userId, input.tanggal);
  return { id, konflikCuti };
}

export interface UpdateJadwalShiftInput {
  lokasiId?: number;
  tanggal?: string;
  shiftTemplateId?: number;
}

/**
 * Ubah lokasi/tanggal/shift template 1 baris jadwal. `user_id` baris TIDAK
 * bisa diubah lewat endpoint ini (pindah staf = hapus + buat baru), tapi
 * tetap di-SELECT karena dibutuhkan untuk menghitung `konflikCuti` terhadap
 * tanggal BARU setelah update.
 */
export async function updateJadwalShift(
  client: PoolClient,
  id: number,
  input: UpdateJadwalShiftInput,
  userId?: number,
): Promise<{ konflikCuti: boolean }> {
  const { rows } = await client.query<{
    id: number;
    user_id: string;
    lokasi_id: number;
    tanggal: string;
    shift_template_id: number | null;
    jam_mulai: string;
    jam_selesai: string;
  }>(
    `SELECT id, user_id, lokasi_id, tanggal, shift_template_id, jam_mulai, jam_selesai FROM hr_jadwal_shift WHERE id = $1`,
    [id],
  );
  const old = rows[0];
  if (!old) throw new Error(`Jadwal shift id ${id} tidak ditemukan`);

  if (input.lokasiId !== undefined) await assertLokasiExists(client, input.lokasiId);

  const jamBaru =
    input.shiftTemplateId !== undefined
      ? await shiftTemplateJam(client, input.shiftTemplateId)
      : { jamMulai: old.jam_mulai, jamSelesai: old.jam_selesai };

  const newRow = {
    lokasi_id: input.lokasiId ?? old.lokasi_id,
    tanggal: input.tanggal ?? old.tanggal,
    shift_template_id: input.shiftTemplateId ?? old.shift_template_id,
    jam_mulai: jamBaru.jamMulai,
    jam_selesai: jamBaru.jamSelesai,
  };

  await client.query(
    `UPDATE hr_jadwal_shift SET lokasi_id = $1, tanggal = $2, shift_template_id = $3, jam_mulai = $4, jam_selesai = $5 WHERE id = $6`,
    [newRow.lokasi_id, newRow.tanggal, newRow.shift_template_id, newRow.jam_mulai, newRow.jam_selesai, id],
  );

  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "hr_jadwal_shift",
    recordId: id,
    fieldName: "updated",
    oldValue: old,
    newValue: newRow,
  });

  const konflikCuti = await hitungKonflikCuti(client, old.user_id, newRow.tanggal);
  return { konflikCuti };
}

export async function deleteJadwalShift(client: PoolClient, id: number, userId?: number): Promise<void> {
  const { rows } = await client.query(`SELECT id FROM hr_jadwal_shift WHERE id = $1`, [id]);
  if (!rows[0]) throw new Error(`Jadwal shift id ${id} tidak ditemukan`);

  await client.query(`DELETE FROM hr_jadwal_shift WHERE id = $1`, [id]);
  await writeAuditLog(client, {
    userId: userId ?? null,
    tableName: "hr_jadwal_shift",
    recordId: id,
    fieldName: "deleted",
    oldValue: true,
    newValue: null,
  });
}

/** Senin minggu yang memuat `dateStr` ("YYYY-MM-DD"). Dihitung lewat Date.UTC
 * murni (bukan `new Date(dateStr)` lokal) supaya tidak kena pergeseran
 * timezone -- pola yang sama alasannya dengan override type parser DATE
 * (OID 1082) di `core/src/db/pool.ts` untuk kasus serupa. */
function mondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diffToMonday);
  return utc.toISOString().slice(0, 10);
}

function addDaysUTC(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Selisih hari `b - a` (bisa negatif). Date.UTC murni, alasan sama seperti
 * `mondayOfWeek`/`addDaysUTC` di atas. */
function diffDaysUTC(a: string, b: string): number {
  const toUtcMs = (s: string): number => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

export interface SalinMingguJadwalInput {
  lokasiId: number;
  /** Tanggal mana pun dalam minggu SUMBER (YYYY-MM-DD) -- Senin-nya dihitung sendiri. */
  mingguSumber: string;
  /** Tanggal mana pun dalam minggu TUJUAN (YYYY-MM-DD). */
  mingguTujuan: string;
}

/**
 * Duplikat semua assignment jadwal satu lokasi dari minggu sumber ke minggu
 * tujuan, hari-ke-hari (Senin sumber -> Senin tujuan, dst lewat offset
 * `diffDaysUTC`). Dipakai tombol "salin minggu lalu" supaya manajer tidak
 * mengetik ulang 7 hari x beberapa shift tiap minggu.
 *
 * IDEMPOTEN: baris yang sudah identik di minggu tujuan (user + lokasi +
 * tanggal + shift template sama, `IS NOT DISTINCT FROM` karena
 * `shift_template_id` bisa NULL untuk jadwal pra-migrasi 0002) DILEWATI,
 * tidak diduplikasi -- jadi dipanggil dua kali hasilnya sama, dan minggu
 * tujuan yang sudah sebagian terisi tetap aman disalin ke.
 * `jam_mulai`/`jam_selesai` (DEPRECATED) diduplikasi APA ADANYA dari baris
 * sumber, tidak di-lookup ulang ke template -- menyalin jadwal tidak boleh
 * diam-diam mengubah jam baris lama kalau template-nya sudah diedit sejak
 * jadwal sumber dibuat.
 */
export async function salinMingguJadwal(
  client: PoolClient,
  input: SalinMingguJadwalInput,
  dibuatOleh?: number,
): Promise<{ disalin: number; dilewati: number }> {
  await assertLokasiExists(client, input.lokasiId);

  const sumberMulai = mondayOfWeek(input.mingguSumber);
  const sumberSelesai = addDaysUTC(sumberMulai, 6);
  const tujuanMulai = mondayOfWeek(input.mingguTujuan);

  const { rows: sumberRows } = await client.query<{
    id: string;
    user_id: string;
    tanggal: string;
    shift_template_id: string | null;
    jam_mulai: string;
    jam_selesai: string;
  }>(
    `SELECT id, user_id, tanggal, shift_template_id, jam_mulai, jam_selesai
     FROM hr_jadwal_shift
     WHERE lokasi_id = $1 AND tanggal BETWEEN $2 AND $3
     ORDER BY tanggal, jam_mulai, id`,
    [input.lokasiId, sumberMulai, sumberSelesai],
  );

  let disalin = 0;
  let dilewati = 0;

  for (const baris of sumberRows) {
    const offset = diffDaysUTC(sumberMulai, baris.tanggal);
    const tanggalBaru = addDaysUTC(tujuanMulai, offset);

    const { rows: adaRows } = await client.query(
      `SELECT 1 FROM hr_jadwal_shift
       WHERE user_id = $1 AND lokasi_id = $2 AND tanggal = $3
         AND shift_template_id IS NOT DISTINCT FROM $4::bigint
       LIMIT 1`,
      [baris.user_id, input.lokasiId, tanggalBaru, baris.shift_template_id],
    );
    if (adaRows[0]) {
      dilewati++;
      continue;
    }

    const { rows: baruRows } = await client.query<{ id: string }>(
      `INSERT INTO hr_jadwal_shift (user_id, lokasi_id, tanggal, shift_template_id, jam_mulai, jam_selesai, dibuat_oleh)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        baris.user_id,
        input.lokasiId,
        tanggalBaru,
        baris.shift_template_id,
        baris.jam_mulai,
        baris.jam_selesai,
        dibuatOleh ?? null,
      ],
    );
    await writeAuditLog(client, {
      userId: dibuatOleh ?? null,
      tableName: "hr_jadwal_shift",
      recordId: Number(baruRows[0].id),
      fieldName: "created",
      oldValue: null,
      newValue: {
        userId: baris.user_id,
        lokasiId: input.lokasiId,
        tanggal: tanggalBaru,
        shiftTemplateId: baris.shift_template_id,
        disalinDariTanggal: baris.tanggal,
        disalinDariId: baris.id,
      },
    });
    disalin++;
  }

  return { disalin, dilewati };
}

export interface JadwalGridStaf {
  userId: string;
  userName: string;
  /** Staf ini punya cuti disetujui yang mencakup tanggal sel ini -- dipakai
   * frontend untuk menandai namanya di grid (lihat `konflikCutiSql`). */
  konflikCuti: boolean;
}

export interface JadwalGridShiftCell {
  shiftTemplateId: string;
  shiftTemplateNama: string;
  jamMulai: string;
  jamSelesai: string;
  staf: JadwalGridStaf[];
}

export interface JadwalGridHari {
  tanggal: string;
  shift: JadwalGridShiftCell[];
}

export interface JadwalGridResult {
  lokasiId: string;
  lokasiName: string;
  mingguMulai: string;
  mingguSelesai: string;
  hari: JadwalGridHari[];
}

export interface GetJadwalGridParams {
  /** Wajib untuk owner/manajer_ops. Untuk supervisor/staf: dihormati HANYA
   * kalau ada di `user.locationIds`, selain itu DIABAIKAN dan dipaksa ke
   * lokasi pertama yang ditugaskan ke user itu (pola sama seperti
   * `listJadwalShift`). */
  lokasiId?: number;
  /** Tanggal mana pun dalam minggu target (YYYY-MM-DD) -- grid dihitung dari
   * Senin minggu itu sampai Minggu-nya. */
  minggu: string;
}

/**
 * Jadwal terstruktur per hari x shift untuk SATU lokasi dalam satu minggu
 * (Senin-Minggu, dihitung dari `minggu`) -- dipakai tampilan grid "siapa
 * teman se-shift" (read-only, beda dari `listJadwalShift` yang baris
 * datar dipakai form CRUD). Baris shift SELALU ada untuk tiap shift
 * template AKTIF walau belum ada staf dijadwalkan (sel kosong, bukan
 * baris hilang) supaya bentuk grid konsisten dipakai frontend. Jadwal
 * lama tanpa `shift_template_id` (pra-migrasi 0002_add_shift_template.sql)
 * sengaja tidak muncul di grid ini -- tidak bisa dipetakan ke baris shift
 * mana pun.
 */
export async function getJadwalGrid(
  client: PoolClient,
  user: AuthUser,
  params: GetJadwalGridParams,
): Promise<JadwalGridResult> {
  let lokasiId: number;
  if (isManajerial(user.role)) {
    if (params.lokasiId === undefined) throw new Error("Query param 'lokasi' wajib diisi");
    lokasiId = params.lokasiId;
  } else {
    if (user.locationIds.length === 0) throw new Error("User tidak ditugaskan ke lokasi manapun");
    lokasiId =
      params.lokasiId !== undefined && user.locationIds.includes(params.lokasiId)
        ? params.lokasiId
        : user.locationIds[0]!;
  }
  await assertLokasiExists(client, lokasiId);

  const { rows: lokasiRows } = await client.query<{ name: string }>(
    `SELECT name FROM core_locations WHERE id = $1`,
    [lokasiId],
  );
  const lokasiName = lokasiRows[0]!.name;

  const mingguMulai = mondayOfWeek(params.minggu);
  const mingguSelesai = addDaysUTC(mingguMulai, 6);

  const { rows: templateRows } = await client.query<{
    id: string;
    nama: string;
    jam_mulai: string;
    jam_selesai: string;
  }>(`SELECT id, nama, jam_mulai, jam_selesai FROM hr_shift_template WHERE aktif = true ORDER BY urutan_tampil, nama`);

  const { rows: jadwalRows } = await client.query<{
    tanggal: string;
    shift_template_id: string;
    user_id: string;
    user_name: string;
    konflik_cuti: boolean;
  }>(
    `SELECT j.tanggal, j.shift_template_id, j.user_id, u.name AS user_name,
            ${konflikCutiSql("j")} AS konflik_cuti
     FROM hr_jadwal_shift j
     JOIN core_users u ON u.id = j.user_id
     WHERE j.lokasi_id = $1 AND j.tanggal BETWEEN $2 AND $3 AND j.shift_template_id IS NOT NULL
     ORDER BY u.name`,
    [lokasiId, mingguMulai, mingguSelesai],
  );

  const hari: JadwalGridHari[] = [];
  for (let i = 0; i < 7; i++) {
    const tanggal = addDaysUTC(mingguMulai, i);
    const shift: JadwalGridShiftCell[] = templateRows.map((t) => ({
      shiftTemplateId: t.id,
      shiftTemplateNama: t.nama,
      jamMulai: t.jam_mulai,
      jamSelesai: t.jam_selesai,
      staf: jadwalRows
        .filter((r) => r.tanggal === tanggal && r.shift_template_id === t.id)
        .map((r) => ({ userId: r.user_id, userName: r.user_name, konflikCuti: r.konflik_cuti })),
    }));
    hari.push({ tanggal, shift });
  }

  return { lokasiId: String(lokasiId), lokasiName, mingguMulai, mingguSelesai, hari };
}
