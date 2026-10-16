import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import type { AuthUser, Role } from "./types.js";

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
 * tidak mewajibkan `locationIds` untuknya.
 */
function isAllLocationsRole(role: Role): boolean {
  return role === "owner" || role === "manajer_ops" || role === "integrasi";
}

/**
 * Role yang login pakai username+password. Role di luar ini (staf) login pakai
 * PIN. `integrasi` ikut jalur password karena n8n memanggil
 * `POST /auth/login` dengan username+password, bukan layar pilih-nama + PIN.
 */
const PASSWORD_ROLES: Role[] = ["owner", "manajer_ops", "supervisor", "integrasi"];

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
  }>(
    `SELECT u.id, u.username, u.password_hash, u.is_active, r.name AS role
     FROM core_users u
     JOIN core_roles r ON r.id = u.role_id
     WHERE u.username = $1`,
    [username],
  );
  const row = rows[0];
  if (!row || !row.is_active) return null;
  // Staf tidak punya password_hash sama sekali -- wajib pakai /login-pin.
  if (!PASSWORD_ROLES.includes(row.role) || !row.password_hash) return null;

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) return null;

  const allLocations = isAllLocationsRole(row.role);
  const locationIds = allLocations ? [] : await getUserLocationIds(client, row.id);

  return { id: row.id, username: row.username, role: row.role, allLocations, locationIds };
}

/** Versi PIN dari `authenticate` -- cuma role staf yang boleh lewat sini. */
export async function authenticateByPin(client: PoolClient, userId: number, pin: string): Promise<AuthUser | null> {
  const { rows } = await client.query<{
    id: number;
    username: string;
    pin_hash: string | null;
    is_active: boolean;
    role: Role;
  }>(
    `SELECT u.id, u.username, u.pin_hash, u.is_active, r.name AS role
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
  return { id: row.id, username: row.username, role: row.role, allLocations: false, locationIds };
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
    if (await isPinTakenAtLocations(client, pin, locationIds)) {
      throw new Error("PIN ini sudah dipakai staf/supervisor lain di salah satu lokasi yang sama -- pilih PIN lain");
    }
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
}

/**
 * @param requestingUserId Id user yang sedang login, sebagai STRING (lihat
 * catatan `AuthUser.id` di `types.ts` -- JWT payload bisa jadi string di
 * runtime walau tipenya bilang number, jadi perbandingan di sini SELALU
 * lewat `String(...)` di kedua sisi, tidak pernah `===` angka langsung).
 * Dipakai untuk guard "tidak bisa menonaktifkan akun sendiri".
 */
export async function updateUser(
  client: PoolClient,
  userId: number,
  input: UpdateUserInput,
  requestingUserId?: string,
): Promise<void> {
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
    // Guard 2: tidak boleh menyisakan nol owner AKTIF di sistem -- lebih
    // umum dari Guard 1 (relevan kalau nanti ada owner kedua, dan juga
    // menutup celah token basi: akun yang SUDAH dinonaktifkan tapi
    // token lamanya masih valid secara kriptografis -- sistem ini belum
    // punya mekanisme revoke token, lihat §13.6/14 architecture-decisions.md
    // -- tidak bisa dipakai untuk menonaktifkan owner aktif terakhir).
    if (row.role === "owner" && row.is_active) {
      const { rows: activeOwners } = await client.query<{ count: string }>(
        `SELECT count(*) FROM core_users u JOIN core_roles r ON r.id = u.role_id
         WHERE r.name = 'owner' AND u.is_active = true AND u.id != $1`,
        [userId],
      );
      if (Number(activeOwners[0].count) === 0) {
        throw new Error("Tidak bisa menonaktifkan owner terakhir yang aktif -- sistem wajib punya minimal 1 owner aktif.");
      }
    }
  }

  if (input.name !== undefined || input.isActive !== undefined) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new Error("Nama tidak boleh kosong");
      params.push(input.name.trim());
      sets.push(`name = $${params.length}`);
    }
    if (input.isActive !== undefined) {
      params.push(input.isActive);
      sets.push(`is_active = $${params.length}`);
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
  }
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
  }>
> {
  const { rows } = await client.query<{ id: string; username: string; name: string; role: Role; is_active: boolean }>(
    `SELECT u.id, u.username, u.name, r.name AS role, u.is_active
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

/**
 * Reset kredensial user -- tidak ada mekanisme "lupa PIN/password" sama
 * sekali di sistem ini, jadi ini satu-satunya jalan pemulihan: owner
 * generate kredensial baru, kredensial LAMA langsung tidak berlaku (diganti
 * total, bukan ditambah) begitu baris ini di-UPDATE.
 */
export async function resetCredential(client: PoolClient, userId: number): Promise<ResetCredentialResult> {
  const { rows } = await client.query<{ id: number; role: Role }>(
    `SELECT u.id, r.name AS role FROM core_users u JOIN core_roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new Error(`User id ${userId} tidak ditemukan`);

  if (PASSWORD_ROLES.includes(row.role)) {
    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    await client.query(`UPDATE core_users SET password_hash = $1, updated_at = now() WHERE id = $2`, [
      passwordHash,
      userId,
    ]);
    return { role: row.role, generatedPassword: password };
  }

  const locationIds = await getUserLocationIds(client, row.id);
  let pin = "";
  let attempts = 0;
  do {
    pin = generatePin();
    attempts += 1;
    if (attempts > 20) {
      throw new Error("Gagal membuat PIN unik setelah beberapa percobaan -- coba lagi.");
    }
  } while (await isPinTakenAtLocations(client, pin, locationIds, row.id));

  const pinHash = await hashPin(pin);
  await client.query(`UPDATE core_users SET pin_hash = $1, updated_at = now() WHERE id = $2`, [pinHash, userId]);
  return { role: row.role, generatedPin: pin };
}
