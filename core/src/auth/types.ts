/**
 * `integrasi` BUKAN role manusia: akun otomatis (workflow n8n) yang cuma
 * boleh memanggil 4 endpoint import CSV modul sales-sync (action
 * `sales_sync.import`). Karena sistem permission di repo ini murni WHITELIST
 * (role harus terdaftar di `PermissionDef.roles` supaya lolos), menjaga
 * "integrasi" TIDAK PERNAH muncul di roles[] action lain sudah cukup untuk
 * menolaknya di seluruh endpoint lain. Lihat migrasi
 * `core/src/db/migrations/0008_add_integrasi_role.sql`.
 */
export type Role = "owner" | "manajer_ops" | "supervisor" | "staf" | "integrasi";

export const ROLES: Role[] = ["owner", "manajer_ops", "supervisor", "staf", "integrasi"];

/** Lingkup lokasi untuk satu role pada satu aksi. */
export type LocationScope = "any" | "own";

/**
 * Definisi permission untuk satu aksi (mis. "pembelian.create"). Modul
 * mendeklarasikan ini di `module.json` § `api.endpoints[].permission` --
 * lihat `docs/module-manifest.md`.
 */
export interface PermissionDef {
  action: string;
  /** Role yang boleh melakukan aksi ini sama sekali. */
  roles: Role[];
  /**
   * Lingkup lokasi per role (default "any" kalau role tidak disebut di sini).
   * "own" berarti request harus merujuk lokasi yang ada di daftar lokasi
   * user (lihat AuthUser.locationIds) -- pengecekan aktualnya dilakukan
   * oleh middleware `requirePermission` lewat `extractLocationIds`.
   */
  locationScope?: Partial<Record<Role, LocationScope>>;
}

/**
 * Payload yang disimpan di JWT dan dipasang ke `req` oleh `requireAuth`.
 *
 * CATATAN (bug pre-existing, belum diperbaiki -- di luar scope sesi yang
 * menemukannya): `id` diketik `number` di sini, tapi `core_users.id` adalah
 * BIGINT, dan nilai yang masuk ke sini (dari `authenticate`/`authenticateByPin`)
 * berasal dari query mentah tanpa cast eksplisit -- jadi runtime-nya genuinely
 * STRING (sama seperti pola BIGINT-jadi-string di tempat lain, lihat
 * `apps/web/src/api/types.ts`). Memperbaikinya dengan benar berarti mengubah
 * tipe ini jadi `string` dan merembet ke frontend `AuthUser`, setiap
 * perbandingan/pemakaian `user.id` di seluruh app. Kalau butuh membandingkan
 * `AuthUser.id` ke nilai lain, selalu bungkus dengan `String(...)` di kedua
 * sisi dulu (lihat contoh di `auth/router.ts`'s PATCH /users/:id).
 */
export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  /** `true` untuk role yang aksesnya tidak dibatasi lokasi (owner, manajer_ops). */
  allLocations: boolean;
  /** Daftar id lokasi yang boleh diakses -- kosong & tidak relevan kalau `allLocations` true. */
  locationIds: number[];
  /**
   * Counter revoke token (`core_users.token_version`), disisipkan ke payload
   * JWT saat login dan dibandingkan ke nilai TERKINI di database oleh
   * `requireAuth` pada SETIAP request -- kalau beda, token dianggap basi (401)
   * walau tanda tangannya masih sah dan belum kedaluwarsa. Lihat
   * `core/src/db/migrations/0009_add_token_version_to_users.sql`.
   *
   * BEDA dari `id` di atas: `token_version` adalah INTEGER biasa (bukan
   * BIGINT), dan driver `pg` memulangkan INTEGER sebagai JS `number` asli --
   * jadi tipe `number` di sini benar secara runtime, tidak kena gotcha
   * BIGINT-jadi-string seperti `id`. Perbandingannya karena itu boleh
   * `!==` langsung, tanpa `String(...)`/`Number(...)` dulu.
   */
  tokenVersion: number;
}
