import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import type { AuthUser, Role } from "./types.js";
import { writeAuditLog } from "./audit.js";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashPin(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPin(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** PIN 6 digit, dibangkitkan pakai CSPRNG (node:crypto), bukan Math.random. */
function generatePin(): string {
  return String(randomInt(100000, 1000000));
}

/** Password acak CSPRNG untuk reset kredensial role password (manajer_ops/supervisor) -- ~12 karakter base64url. */
function generatePassword(): string {
  return randomBytes(9).toString("base64url");
}

/**
 * Role yang aksesnya tidak pernah dibatasi lokasi. `integrasi` ikut di sini
 * karena akun bot (n8n) bukan akun outlet: dia mengimpor arsip CSV lintas
 * platform/lokasi, tidak terikat satu lokasi fisik -- jadi `createUser()`
 * tidak mewajibkan `locationIds` untuknya. `sistem_otomatis` ikut dengan
 * alasan sama: transaksi Penjualan yang dibuatnya mengikuti lokasi hasil
 * resolusi outlet per order (lihat `resolveLocationId` di
 * `modules/sales-sync/src/domain/proses.ts`), bukan lokasi milik identitas
 * pemanggil.
 */
function isAllLocationsRole(role: Role): boolean {
  return role === "owner" || role === "manajer_ops" || role === "integrasi" || role === "sistem_otomatis";
}

/**
 * Role yang login pakai username+password. Role di luar ini (staf) login pakai
 * PIN. `integrasi` ikut jalur password karena n8n memanggil
 * `POST /auth/login` dengan username+password, bukan layar pilih-nama + PIN.
 * `sistem_otomatis` JUGA ikut jalur ini supaya `createUser()` (dipakai script
 * seed) bisa membuatnya dengan pola yang sama persis -- TAPI login
 * interaktifnya diblok eksplisit di `authenticate()` di bawah, jadi
 * password yang di-generate script seed tidak pernah benar-benar dipakai.
 */
const PASSWORD_ROLES: Role[] = ["owner", "manajer_ops", "supervisor", "integrasi", "sistem_otomatis"];

async function getUserLocationIds(client: PoolClient, userId: number | string): Promise<number[]> {
  const { rows } = await client.query<{ location_id: string }>(
    `SELECT location_id FROM core_user_lokasi WHERE user_id = $1`,
    [userId],
  );
  return rows.map((r) => Number(r.location_id));
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "staf";
}

/**
 * Staf tidak pernah mengetik username (login lewat pilih nama + PIN), tapi
 * `core_users.username` tetap wajib unik & NOT NULL (dipakai di banyak
 * tempat -- JWT payload, tampilan UI) supaya tidak perlu mengubah tipe
 * `AuthUser.username` jadi nullable dan merembet ke banyak kode lain.
 * Jadi untuk staf, username di-generate otomatis dari nama (slug), dengan
 * angka tambahan kalau sudah dipakai.
 */
async function generateUniqueUsername(client: PoolClient, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 1;
  for (;;) {
    const { rows } = await client.query(`SELECT 1 FROM core_users WHERE username = $1`, [candidate]);
    if (!rows[0]) return candidate;
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
}

/**
 * PIN unik di antara staf/supervisor yang satu lokasi -- WAJIB dicek di
 * application layer (bukan constraint database), karena `pin_hash` adalah
 * hash bcrypt (salt acak per hash), jadi dua PIN yang sama persis tidak
 * akan pernah terlihat sama di level SQL. Satu-satunya cara mengecek
 * adalah ambil kandidat baris lalu `bcrypt.compare` satu-satu.
 */
async function isPinTakenAtLocations(
  client: PoolClient,
  pin: string,
  locationIds: number[],
  excludeUserId?: number,
): Promise<boolean> {
  if (locationIds.length === 0) return false;

  const conditions = [`r.name IN ('staf', 'supervisor')`, `u.pin_hash IS NOT NULL`, `cul.location_id = ANY($1)`];
  const params: unknown[] = [locationIds];
  if (excludeUserId !== undefined) {
    params.push(excludeUserId);
    conditions.push(`u.id != $${params.length}`);
  }

  const { rows } = await client.query<{ pin_hash: string }>(
    `SELECT DISTINCT u.pin_hash
     FROM core_users u
     JOIN core_roles r ON r.id = u.role_id
     JOIN core_user_lokasi cul ON cul.user_id = u.id
     WHERE ${conditions.join(" AND ")}`,
    params,
  );
  for (const row of rows) {
    if (await bcrypt.compare(pin, row.pin_hash)) return true;
  }
  return false;
}

/** Cari user berdasarkan username, verifikasi password. `null` kalau salah/tidak aktif/bukan role password. */
export async function authenticate(client: PoolClient, username: string, password: string): Promise<AuthUser | null> {
  const { rows } = await client.query<{
    id: number;
    username: string;
    password_hash: string | null;
    is_active: boolean;
    role: Role;
    token_version: number;
    wajib_ganti_kredensial: boolean;
  }>(
    `SELECT u.id, u.username, u.password_hash, u.is_active, u.token_version, u.wajib_ganti_kredensial, r.name AS role
     FROM core_users u
     JOIN core_roles r ON r.id = u.role_id
     WHERE u.username = $1`,
    [username],
  );
  const row = rows[0];
  if (!row || !row.is_active) return null;
  // Login interaktif untuk "sistem_otomatis" DIBLOK PERMANEN di sini --
  // identitas ini cuma boleh dipakai lewat token internal yang di-mint
  // server sendiri (`signInternalServiceToken`), tidak pernah lewat
  // POST /auth/login walau password-nya (digenerate script seed, tidak
  // pernah ditampilkan/dipakai) kebetulan benar. Pengaman kedua di luar
  // whitelist permission -- lihat catatan di core/src/auth/types.ts.
  if (row.role === "sistem_otomatis") return null;
  // Staf tidak punya password_hash sama sekali -- wajib pakai /login-pin.
  if (!PASSWORD_ROLES.includes(row.role) || !row.password_hash) return null;

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) return null;

  const allLocations = isAllLocationsRole(row.role);
  const locationIds = allLocations ? [] : await getUserLocationIds(client, row.id);

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    allLocations,
    locationIds,
    tokenVersion: row.token_version,
    wajibGantiKredensial: row.wajib_ganti_kredensial,
  };
}

/** Versi PIN dari `authenticate` -- cuma role staf yang boleh lewat sini. */
export async function authenticateByPin(client: PoolClient, userId: number, pin: string): Promise<AuthUser | null> {
  const { rows } = await client.query<{
    id: number;
    username: string;
    pin_hash: string | null;
    is_active: boolean;
    role: Role;
    token_version: number;
    wajib_ganti_kredensial: boolean;
  }>(
    `SELECT u.id, u.username, u.pin_hash, u.is_active, u.token_version, u.wajib_ganti_kredensial, r.name AS role
     FROM core_users u
     JOIN core_roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row || !row.is_active) return null;
  // Role selain staf tidak punya pin_hash -- wajib pakai /login (password).
  if (row.role !== "staf" || !row.pin_hash) return null;

  const valid = await verifyPin(pin, row.pin_hash);
  if (!valid) return null;

  const locationIds = await getUserLocationIds(client, row.id);
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    allLocations: false,
    locationIds,
    tokenVersion: row.token_version,
    wajibGantiKredensial: row.wajib_ganti_kredensial,
  };
}

/**
 * Daftar nama staf AKTIF di satu lokasi -- dipakai layar pilih-nama sebelum
 * PIN, TANPA data sensitif. `id` string karena `core_users.id` BIGINT (lihat
 * catatan headerId di apps/web/src/api/types.ts untuk pola yang sama).
 */
export async function listActiveStafByLocation(
  client: PoolClient,
  locationId: number,
): Promise<Array<{ id: string; name: string }>> {
  const { rows } = await client.query<{ id: string; name: string }>(
    `SELECT u.id, u.name
     FROM core_users u
     JOIN core_roles r ON r.id = u.role_id
     JOIN core_user_lokasi cul ON cul.user_id = u.id
     WHERE r.name = 'staf' AND u.is_active = true AND cul.location_id = $1
     ORDER BY u.name`,
    [locationId],
  );
  return rows;
}

export interface CreateUserInput {
  name: string;
  role: Role;
  /** Diabaikan untuk role owner/manajer_ops (aksesnya selalu semua lokasi). Wajib diisi (>=1) untuk staf. */
  locationIds?: number[];
  /** Wajib untuk owner/manajer_ops/supervisor. */
  username?: string;
  /** Wajib untuk owner/manajer_ops/supervisor. */
  password?: string;
  /** Opsional untuk staf -- kalau kosong, PIN 6 digit di-generate otomatis. Diabaikan untuk role lain. */
  pin?: string;
}

export interface CreateUserResult {
  /** String karena `core_users.id` BIGINT (pola yang sama seperti id BIGINT lain di seluruh codebase ini). */
  id: string;
  username: string;
  /**
   * Cuma ada kalau role staf DAN `pin` tidak diisi manual saat create --
   * PIN plaintext ini TIDAK PERNAH disimpan di mana pun (cuma hash-nya),
   * jadi ini satu-satunya kesempatan sistem bisa menunjukkannya. Caller
   * (router/CLI) bertanggung jawab menampilkannya SEKALI ke owner dan
   * tidak menuliskannya ke log/file.
   */
  generatedPin?: string;
}

/**
 * Buat user baru. `locationIds` divalidasi ADA di `core_locations` lewat
 * query langsung sebelum insert -- pesan error lebih jelas daripada
 * menyerahkannya ke foreign key constraint (`core_user_lokasi_location_id_fkey`,
 * lihat migrasi `core/src/db/migrations/0006_move_locations_to_core.sql`)
 * yang tetap jadi jaring pengaman kedua.
 */
export async function createUser(client: PoolClient, input: CreateUserInput): Promise<CreateUserResult> {
  const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = $1`, [
    input.role,
  ]);
  if (!roleRows[0]) throw new Error(`Role "${input.role}" tidak dikenal`);
  if (!input.name?.trim()) throw new Error("Nama wajib diisi");

  const locationIds = input.locationIds ?? [];
  for (const locationId of locationIds) {
    const { rows: locRows } = await client.query(`SELECT 1 FROM core_locations WHERE id = $1`, [locationId]);
    if (!locRows[0]) throw new Error(`Lokasi id ${locationId} tidak ditemukan di core_locations`);
  }

  let username: string;
  let passwordHash: string | null = null;
  let pinHash: string | null = null;
  let generatedPin: string | undefined;

  if (PASSWORD_ROLES.includes(input.role)) {
    if (!input.username?.trim() || !input.password) {
      throw new Error(`Role "${input.role}" wajib diisi username dan password`);
    }
    username = input.username.trim();
    passwordHash = await hashPassword(input.password);
  } else {
    if (locationIds.length === 0) {
      throw new Error("Staf wajib ditetapkan ke minimal satu lokasi (dipakai untuk daftar pilih nama saat login PIN)");
    }
    const pin = input.pin?.trim() || generatePin();
    if (!/^\d{4,8}$/.test(pin)) {
      throw new Error("PIN harus angka 4-8 digit");
    }
    // Aturan "PIN unik per lokasi" DICABUT (2026-10-30) -- login PIN selalu
    // lewat pilih-nama-dulu (POST /login-pin mengirim {userId, pin}
    // eksplisit), PIN cuma pernah diverifikasi ke SATU user yang sudah
    // diketahui id-nya, tidak pernah dicari lintas user. Aturan unik ini
    // tidak pernah benar-benar dibutuhkan untuk korektnes login, cuma
    // pengaman berlebih yang bikin PIN gampang ditebak dicoba sendiri
    // (lihat docs/architecture-decisions.md, audit Tahap 0 fitur ini).
    pinHash = await hashPin(pin);
    if (!input.pin?.trim()) generatedPin = pin;
    username = await generateUniqueUsername(client, input.name);
  }

  const { rows: userRows } = await client.query<{ id: string }>(
    `INSERT INTO core_users (username, name, password_hash, pin_hash, role_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [username, input.name.trim(), passwordHash, pinHash, roleRows[0].id],
  );
  const userId = userRows[0].id;

  if (!isAllLocationsRole(input.role)) {
    for (const locationId of locationIds) {
      await client.query(`INSERT INTO core_user_lokasi (user_id, location_id) VALUES ($1, $2)`, [userId, locationId]);
    }
  }

  return { id: userId, username, generatedPin };
}

export interface UpdateUserInput {
  name?: string;
  isActive?: boolean;
  /** Full-replace (sama pola seperti baris resep di modul inventory) -- diabaikan untuk role owner/manajer_ops. */
  locationIds?: number[];
  /** Owner saja (digerbang di router). Lintas keluarga auth (staf/PIN <-> password) MEMBUAT KREDENSIAL BARU -- lihat UpdateUserResult. */
  role?: Role;
  /** Nullable -- kirim string kosong/null untuk mengosongkan. Kolom sudah ada sejak migrasi 0007 (Fase 2 WhatsApp), BARU dipakai di sini. */
  nomorWhatsapp?: string | null;
}

export interface UpdateUserResult {
  /** Terisi HANYA kalau `role` pindah KE staf dari keluarga password -- PIN lama tidak ada, PIN baru digenerate otomatis (pola sama seperti resetCredential). */
  generatedPin?: string;
  /** Terisi HANYA kalau `role` pindah DARI staf ke keluarga password -- password lama tidak ada, password baru digenerate otomatis. */
  generatedPassword?: string;
}

/**
 * @param requestingUserId Id user yang sedang login, sebagai STRING (lihat
 * catatan `AuthUser.id` di `types.ts` -- JWT payload bisa jadi string di
 * runtime walau tipenya bilang number, jadi perbandingan di sini SELALU
 * lewat `String(...)` di kedua sisi, tidak pernah `===` angka langsung).
 * Dipakai untuk guard "tidak bisa menonaktifkan akun sendiri".
 *
 * REVOKE TOKEN (`core_users.token_version`): dinaikkan untuk perubahan yang
 * membuat token lama menyesatkan -- user dinonaktifkan, `locationIds`
 * diubah, ATAU role diubah (role ikut masuk payload JWT; token lama akan
 * terus dipercaya membawa role LAMA sampai TTL 12 jam habis kalau tidak
 * dibasikan, termasuk kasus penurunan hak akses mis. owner -> staf -- ini
 * sudah diimplementasikan di bawah, lihat § "Ubah role").
 */
export async function updateUser(
  client: PoolClient,
  userId: number,
  input: UpdateUserInput,
  requestingUserId?: string,
): Promise<UpdateUserResult> {
  const { rows } = await client.query<{ id: number; role: Role; is_active: boolean }>(
    `SELECT u.id, r.name AS role, u.is_active FROM core_users u JOIN core_roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new Error(`User id ${userId} tidak ditemukan`);

  if (input.isActive === false) {
    // Guard 1: tidak bisa menonaktifkan akun sendiri -- tidak ada akun lain
    // yang bisa membatalkannya lagi lewat UI (halaman ini owner-only).
    if (requestingUserId !== undefined && String(userId) === requestingUserId) {
      throw new Error("Tidak bisa menonaktifkan akun sendiri.");
    }
  }

  // Guard "jangan sisakan nol owner AKTIF" dipakai DUA kondisi: nonaktifkan
  // ATAU ubah role owner -> role lain. Fungsi kecil supaya tidak diulang.
  async function pastikanBukanOwnerAktifTerakhir(aksi: string): Promise<void> {
    if (row.role !== "owner" || !row.is_active) return;
    const { rows: activeOwners } = await client.query<{ count: string }>(
      `SELECT count(*) FROM core_users u JOIN core_roles r ON r.id = u.role_id
       WHERE r.name = 'owner' AND u.is_active = true AND u.id != $1`,
      [userId],
    );
    if (Number(activeOwners[0].count) === 0) {
      throw new Error(`Tidak bisa ${aksi} owner terakhir yang aktif -- sistem wajib punya minimal 1 owner aktif.`);
    }
  }
  if (input.isActive === false) await pastikanBukanOwnerAktifTerakhir("menonaktifkan");

  const hasil: UpdateUserResult = {};

  // --- Ubah role (owner saja, digerbang router) ---------------------------
  if (input.role !== undefined && input.role !== row.role) {
    const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = $1`, [
      input.role,
    ]);
    if (!roleRows[0]) throw new Error(`Role "${input.role}" tidak dikenal`);
    await pastikanBukanOwnerAktifTerakhir("mengubah role");

    const dariKeluargaPassword = PASSWORD_ROLES.includes(row.role);
    const keKeluargaPassword = PASSWORD_ROLES.includes(input.role);

    if (dariKeluargaPassword !== keKeluargaPassword) {
      // Lintas keluarga auth -- kredensial LAMA tidak cocok lagi dengan
      // metode login role BARU, jadi dibuat ulang (pola sama seperti
      // resetCredential): username yang sudah ada TETAP dipakai, cuma
      // password_hash/pin_hash yang diganti.
      if (keKeluargaPassword) {
        const password = generatePassword();
        const passwordHash = await hashPassword(password);
        await client.query(
          `UPDATE core_users SET role_id = $1, password_hash = $2, pin_hash = NULL, updated_at = now() WHERE id = $3`,
          [roleRows[0].id, passwordHash, userId],
        );
        hasil.generatedPassword = password;
      } else {
        // Jadi staf -- WAJIB minimal 1 lokasi (sama aturan createUser),
        // dari locationIds yang DIKIRIM di request ini kalau ada, atau
        // yang SUDAH ter-assign sebelumnya kalau tidak.
        const locationIdsUntukPin = input.locationIds ?? (await getUserLocationIds(client, userId));
        if (locationIdsUntukPin.length === 0) {
          throw new Error("Staf wajib ditetapkan ke minimal satu lokasi -- isi 'locationIds' sekaligus saat mengubah role ke staf.");
        }
        // Aturan "PIN unik per lokasi" DICABUT (2026-10-30, lihat catatan
        // di createUser) -- generate sekali, tidak perlu loop-sampai-unik lagi.
        const pin = generatePin();
        const pinHash = await hashPin(pin);
        await client.query(
          `UPDATE core_users SET role_id = $1, pin_hash = $2, password_hash = NULL, updated_at = now() WHERE id = $3`,
          [roleRows[0].id, pinHash, userId],
        );
        hasil.generatedPin = pin;
      }
    } else {
      await client.query(`UPDATE core_users SET role_id = $1, updated_at = now() WHERE id = $2`, [
        roleRows[0].id,
        userId,
      ]);
    }

    // Audit log: role adalah field sensitif (naik/turun hak akses).
    await writeAuditLog(client, {
      userId: requestingUserId !== undefined ? Number(requestingUserId) : null,
      tableName: "core_users",
      recordId: userId,
      fieldName: "role",
      oldValue: row.role,
      newValue: input.role,
    });

    // Role ikut masuk payload JWT -- token lama WAJIB dibasikan, baik naik
    // maupun turun hak akses (lihat catatan di atas fungsi ini).
    await client.query(`UPDATE core_users SET token_version = token_version + 1, updated_at = now() WHERE id = $1`, [
      userId,
    ]);

    // Role EFEKTIF dipakai pengecekan isAllLocationsRole di bawah (blok
    // locationIds) HARUS role BARU, bukan `row.role` yang sudah basi.
    row.role = input.role;
  }

  if (input.name !== undefined || input.isActive !== undefined || input.nomorWhatsapp !== undefined) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new Error("Nama tidak boleh kosong");
      params.push(input.name.trim());
      sets.push(`name = $${params.length}`);
    }
    if (input.nomorWhatsapp !== undefined) {
      params.push(input.nomorWhatsapp?.trim() || null);
      sets.push(`nomor_whatsapp = $${params.length}`);
    }
    if (input.isActive !== undefined) {
      params.push(input.isActive);
      sets.push(`is_active = $${params.length}`);
      // Dinonaktifkan -> token yang sudah terbit harus langsung basi (jangan
      // tunggu TTL 12 jam). Increment RELATIF di SQL (bukan baca-lalu-tulis
      // angka dari aplikasi) supaya dua request bersamaan tidak saling
      // menimpa versi. Diaktifkan lagi (`true`) TIDAK menaikkan apa pun --
      // tidak ada token yang perlu dibasikan di arah itu.
      if (input.isActive === false) sets.push(`token_version = token_version + 1`);
    }
    params.push(userId);
    await client.query(`UPDATE core_users SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length}`, params);
  }

  if (input.locationIds !== undefined && !isAllLocationsRole(row.role)) {
    for (const locationId of input.locationIds) {
      const { rows: locRows } = await client.query(`SELECT 1 FROM core_locations WHERE id = $1`, [locationId]);
      if (!locRows[0]) throw new Error(`Lokasi id ${locationId} tidak ditemukan di core_locations`);
    }
    await client.query(`DELETE FROM core_user_lokasi WHERE user_id = $1`, [userId]);
    for (const locationId of input.locationIds) {
      await client.query(`INSERT INTO core_user_lokasi (user_id, location_id) VALUES ($1, $2)`, [userId, locationId]);
    }
    // Daftar lokasi ikut masuk payload JWT (`AuthUser.locationIds`), jadi token
    // lama langsung dibasikan -- baik saat lokasi DITAMBAH (token lama kurang
    // izin, user bingung kenapa masih 403) maupun DIKURANGI (token lama masih
    // memberi akses ke lokasi yang sudah dicabut -- ini sisi keamanannya).
    // Statement terpisah dari blok UPDATE di atas karena blok itu hanya jalan
    // kalau `name`/`isActive` ikut dikirim; `locationIds` bisa dikirim sendiri.
    await client.query(`UPDATE core_users SET token_version = token_version + 1, updated_at = now() WHERE id = $1`, [
      userId,
    ]);
  }

  return hasil;
}

export async function listUsers(client: PoolClient): Promise<
  Array<{
    /** String karena `core_users.id` BIGINT. */
    id: string;
    username: string;
    name: string;
    role: Role;
    isActive: boolean;
    locationIds: number[];
    authMethod: "password" | "pin";
    /** Nullable, kolom sejak migrasi 0007, baru dipakai sejak Tahap 2 "Kelola User". */
    nomorWhatsapp: string | null;
  }>
> {
  const { rows } = await client.query<{
    id: string;
    username: string;
    name: string;
    role: Role;
    is_active: boolean;
    nomor_whatsapp: string | null;
  }>(
    `SELECT u.id, u.username, u.name, r.name AS role, u.is_active, u.nomor_whatsapp
     FROM core_users u
     JOIN core_roles r ON r.id = u.role_id
     ORDER BY u.id`,
  );
  const result = [];
  for (const row of rows) {
    const locationIds = isAllLocationsRole(row.role) ? [] : await getUserLocationIds(client, row.id);
    result.push({
      id: row.id,
      username: row.username,
      name: row.name,
      role: row.role,
      isActive: row.is_active,
      locationIds,
      authMethod: (PASSWORD_ROLES.includes(row.role) ? "password" : "pin") as "password" | "pin",
      nomorWhatsapp: row.nomor_whatsapp,
    });
  }
  return result;
}

export interface ResetCredentialResult {
  role: Role;
  /** Ada kalau role staf. Plaintext PIN BARU -- tidak pernah disimpan, cuma dikembalikan sekali di sini. */
  generatedPin?: string;
  /** Ada kalau role password (owner/manajer_ops/supervisor). Plaintext password BARU, sama alasannya. */
  generatedPassword?: string;
}

export interface ResetCredentialInput {
  /** Owner ketik PIN manual (role staf). Kalau tidak diisi, PIN digenerate CSPRNG seperti sebelumnya. */
  pinManual?: string;
  /** Owner ketik password manual (role password). Kalau tidak diisi, password digenerate CSPRNG. */
  passwordManual?: string;
}

/**
 * Tolak pola PIN 6-digit yang gampang ditebak (2026-10-30, dipakai HANYA
 * untuk PIN yang DIKETIK MANUAL owner -- PIN hasil generate CSPRNG tidak
 * pernah perlu dicek ini, peluangnya microscopic). Dua pola: (1) enam digit
 * SAMA SEMUA (111111, dst), (2) enam digit BERURUTAN NAIK atau TURUN penuh
 * (123456, 654321, dst). Aturan sengaja sederhana (bukan blocklist luas
 * tanggal/pola umum lain) -- keputusan eksplisit saat perencanaan fitur ini.
 */
function pinPolaLemah(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  let naikPenuh = true;
  let turunPenuh = true;
  for (let i = 1; i < pin.length; i++) {
    const diff = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (diff !== 1) naikPenuh = false;
    if (diff !== -1) turunPenuh = false;
  }
  return naikPenuh || turunPenuh;
}

/** PIN manual (reset oleh owner) WAJIB 6 digit tepat & bukan pola lemah -- beda dari PIN
 * generate-otomatis createUser yang masih longgar 4-8 digit (jalur lama, tidak diubah). */
function validasiPinManual(pin: string): void {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN manual harus tepat 6 digit angka.");
  if (pinPolaLemah(pin)) {
    throw new Error("PIN terlalu mudah ditebak (semua digit sama atau berurutan) -- pilih PIN lain.");
  }
}

/** Password manual (reset oleh owner) minimal 8 karakter -- tidak ada aturan kekuatan password
 * lain di repo ini untuk ditiru, ini lantai minimum yang wajar (bukan angka yang diminta owner
 * secara spesifik, dicatat sebagai keputusan default kecil). */
function validasiPasswordManual(password: string): void {
  if (password.length < 8) throw new Error("Password manual minimal 8 karakter.");
}

/**
 * Reset kredensial user -- tidak ada mekanisme "lupa PIN/password" sama
 * sekali di sistem ini, jadi ini salah satu jalan pemulihan (yang lain:
 * `gantiKredensialSendiri`, kalau user masih ingat kredensial lamanya):
 * owner generate kredensial baru ATAU ketik sendiri (2026-10-30, `input`),
 * kredensial LAMA langsung tidak berlaku (diganti total, bukan ditambah)
 * begitu baris ini di-UPDATE.
 *
 * `token_version` ikut dinaikkan di statement UPDATE yang sama: tanpa itu,
 * kredensial lama memang mati tapi SESI lama (token yang sudah dipegang) tetap
 * hidup sampai 12 jam -- padahal alasan utama owner me-reset kredensial justru
 * "akunnya dipakai orang lain / HP-nya hilang".
 *
 * `wajib_ganti_kredensial` SELALU diset `true` di sini (manual maupun
 * otomatis) -- user yang kredensialnya baru di-reset wajib menggantinya
 * sendiri lewat `gantiKredensialSendiri` sebelum bisa memakai menu lain
 * (ditegakkan middleware `requireGantiKredensialDulu`).
 */
export async function resetCredential(
  client: PoolClient,
  userId: number,
  input?: ResetCredentialInput,
  requestingUserId?: number,
): Promise<ResetCredentialResult> {
  const { rows } = await client.query<{ id: number; role: Role }>(
    `SELECT u.id, r.name AS role FROM core_users u JOIN core_roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new Error(`User id ${userId} tidak ditemukan`);

  async function catatAuditReset(cara: "manual" | "otomatis"): Promise<void> {
    // Penanda SAJA -- TIDAK PERNAH nilai kredensial itu sendiri (F6: kredensial
    // tidak pernah masuk audit log atau log aplikasi).
    await writeAuditLog(client, {
      userId: requestingUserId ?? null,
      tableName: "core_users",
      recordId: userId,
      fieldName: "kredensial_direset",
      oldValue: null,
      newValue: cara,
    });
  }

  if (PASSWORD_ROLES.includes(row.role)) {
    let password: string;
    if (input?.passwordManual) {
      validasiPasswordManual(input.passwordManual);
      password = input.passwordManual;
    } else {
      password = generatePassword();
    }
    const passwordHash = await hashPassword(password);
    await client.query(
      `UPDATE core_users SET password_hash = $1, token_version = token_version + 1, wajib_ganti_kredensial = true, updated_at = now() WHERE id = $2`,
      [passwordHash, userId],
    );
    await catatAuditReset(input?.passwordManual ? "manual" : "otomatis");
    return { role: row.role, generatedPassword: password };
  }

  let pin: string;
  if (input?.pinManual) {
    validasiPinManual(input.pinManual);
    pin = input.pinManual;
  } else {
    pin = generatePin();
  }

  const pinHash = await hashPin(pin);
  await client.query(
    `UPDATE core_users SET pin_hash = $1, token_version = token_version + 1, wajib_ganti_kredensial = true, updated_at = now() WHERE id = $2`,
    [pinHash, userId],
  );
  await catatAuditReset(input?.pinManual ? "manual" : "otomatis");
  return { role: row.role, generatedPin: pin };
}

export interface GantiKredensialSendiriResult {
  /** `token_version` SETELAH dinaikkan -- router menandatangani token baru dengan nilai ini. */
  newTokenVersion: number;
}

/**
 * Ganti kredensial MILIK SENDIRI (2026-10-30) -- satu-satunya endpoint yang
 * tetap diizinkan selama `wajib_ganti_kredensial` aktif (lihat middleware
 * `requireGantiKredensialDulu`), TAPI juga bisa dipanggil kapan saja (user
 * yang tidak sedang dipaksa ganti pun boleh mengganti kredensialnya sendiri
 * secara sukarela). WAJIB tahu kredensial LAMA (beda dari `resetCredential`
 * yang dipanggil OWNER tanpa perlu tahu kredensial lama korban).
 *
 * Rate-limit percobaan gagal ditegakkan oleh PEMANGGIL (router), lewat
 * `core/src/auth/rate-limit.ts` yang sudah ada (pola sama seperti
 * `/login`/`/login-pin`) -- fungsi ini sendiri cuma verifikasi+update,
 * tidak tahu apa-apa soal rate-limit.
 */
export async function gantiKredensialSendiri(
  client: PoolClient,
  userId: number,
  kredensialLama: string,
  kredensialBaru: string,
): Promise<GantiKredensialSendiriResult> {
  const { rows } = await client.query<{
    id: number;
    role: Role;
    password_hash: string | null;
    pin_hash: string | null;
    token_version: number;
  }>(
    `SELECT u.id, r.name AS role, u.password_hash, u.pin_hash, u.token_version
     FROM core_users u JOIN core_roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new Error(`User id ${userId} tidak ditemukan`);

  if (PASSWORD_ROLES.includes(row.role)) {
    if (!row.password_hash || !(await verifyPassword(kredensialLama, row.password_hash))) {
      throw new Error("Password lama salah.");
    }
    validasiPasswordManual(kredensialBaru);
    const hash = await hashPassword(kredensialBaru);
    const { rows: updated } = await client.query<{ token_version: number }>(
      `UPDATE core_users SET password_hash = $1, token_version = token_version + 1, wajib_ganti_kredensial = false, updated_at = now()
       WHERE id = $2 RETURNING token_version`,
      [hash, userId],
    );
    await writeAuditLog(client, {
      userId,
      tableName: "core_users",
      recordId: userId,
      fieldName: "kredensial_diganti_sendiri",
      oldValue: null,
      newValue: true,
    });
    return { newTokenVersion: updated[0].token_version };
  }

  if (!row.pin_hash || !(await verifyPin(kredensialLama, row.pin_hash))) {
    throw new Error("PIN lama salah.");
  }
  validasiPinManual(kredensialBaru);
  const hash = await hashPin(kredensialBaru);
  const { rows: updated } = await client.query<{ token_version: number }>(
    `UPDATE core_users SET pin_hash = $1, token_version = token_version + 1, wajib_ganti_kredensial = false, updated_at = now()
     WHERE id = $2 RETURNING token_version`,
    [hash, userId],
  );
  await writeAuditLog(client, {
    userId,
    tableName: "core_users",
    recordId: userId,
    fieldName: "kredensial_diganti_sendiri",
    oldValue: null,
    newValue: true,
  });
  return { newTokenVersion: updated[0].token_version };
}
