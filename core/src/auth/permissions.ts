import type { Request, Response, NextFunction } from "express";
import type { LoadedModule } from "../manifest/types.js";
import type { AuthUser, PermissionDef } from "./types.js";
import { verifyAuthToken } from "./jwt.js";
import { pool } from "../db/pool.js";

/**
 * Permission yang dimiliki `core` sendiri (bukan modul bisnis apa pun) --
 * mis. kelola user. Digabung dengan permission yang dideklarasikan tiap
 * modul di `module.json` § `api.endpoints[].permission`.
 */
const CORE_PERMISSIONS: PermissionDef[] = [
  { action: "user.manage", roles: ["owner"] },
  { action: "identitas_bisnis.manage", roles: ["owner"] },
];

let registry: Map<string, PermissionDef> | null = null;

/**
 * Dipanggil sekali oleh `buildServer` sebelum modul di-mount, supaya
 * `requirePermission`/`hasPermission` di router modul mana pun bisa langsung
 * `import` dari `@samsara/core` tanpa perlu menerima registry lewat parameter.
 */
export function initPermissionRegistry(modules: LoadedModule[]): void {
  const map = new Map<string, PermissionDef>();
  for (const def of CORE_PERMISSIONS) map.set(def.action, def);
  for (const mod of modules) {
    for (const endpoint of mod.manifest.api.endpoints) {
      if (endpoint.permission) map.set(endpoint.permission.action, endpoint.permission);
    }
    for (const def of mod.manifest.permissions ?? []) {
      map.set(def.action, def);
    }
  }
  registry = map;
}

function getPermissionDef(action: string): PermissionDef {
  if (!registry) {
    throw new Error("Permission registry belum diinisialisasi -- initPermissionRegistry() belum dipanggil");
  }
  const def = registry.get(action);
  if (!def) {
    throw new Error(
      `Permission "${action}" tidak terdaftar di module.json manapun (atau CORE_PERMISSIONS) -- deklarasikan dulu sebelum dipakai router`,
    );
  }
  return def;
}

/** Ambil user yang sudah login dari request (diset oleh `requireAuth`). */
export function getAuthUser(req: Request): AuthUser {
  const user = (req as unknown as { auth?: AuthUser }).auth;
  if (!user) throw new Error("req.auth belum diset -- pastikan requireAuth dipasang sebelum handler ini");
  return user;
}

/**
 * Pesan untuk token yang tanda tangannya SAH tapi versinya sudah basi (user
 * dinonaktifkan / kredensial di-reset / lokasinya diubah) -- SENGAJA dibedakan
 * dari "Token tidak valid atau kedaluwarsa" (signature gagal / lewat TTL 12
 * jam) supaya dua skenario itu bisa dipisah saat menelusuri keluhan user.
 */
const SESSION_REVOKED_MESSAGE = "Sesi berakhir, silakan login ulang";

/**
 * Middleware: wajib ada JWT valid di header `Authorization: Bearer <token>`,
 * DAN `tokenVersion` di payload harus masih sama dengan
 * `core_users.token_version` di database.
 *
 * Konsekuensi yang perlu diketahui: middleware ini dipasang GLOBAL di
 * `buildServer`, jadi pengecekan versi ini menambah SATU query ke database di
 * setiap request terautentikasi ke modul apa pun (sebelumnya middleware ini
 * murni verify-signature, nol query). Trade-off ini disetujui owner sebagai
 * harga dari kemampuan revoke token: tanpa query, token user yang baru
 * dinonaktifkan tetap sah sampai 12 jam. Query-nya sengaja dibuat semurah
 * mungkin: satu baris, lookup lewat primary key (`core_users_pkey`), satu
 * kolom INTEGER, dan `pool.query` (bukan `pool.connect()` + release manual)
 * supaya koneksi dari pool langsung dilepas sendiri setelah query selesai.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Header Authorization: Bearer <token> wajib diisi" });
    return;
  }

  let user: AuthUser;
  try {
    user = verifyAuthToken(header.slice("Bearer ".length));
  } catch {
    res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
    return;
  }

  // Query DB SETELAH verify (bukan sebelum): token palsu ditolak tanpa pernah
  // menyentuh database sama sekali.
  let rows: Array<{ token_version: number }>;
  try {
    ({ rows } = await pool.query<{ token_version: number }>(
      `SELECT token_version FROM core_users WHERE id = $1`,
      [user.id],
    ));
  } catch (err) {
    // Database tidak bisa dihubungi -- itu kegagalan server (500 lewat error
    // handler Express), BUKAN "token tidak valid". Wajib ditangkap eksplisit:
    // Express 4 tidak menangkap promise yang reject dari middleware async,
    // jadi tanpa ini request-nya menggantung + unhandled rejection.
    next(err);
    return;
  }
  // `rows.length === 0` = barisnya memang sudah tidak ada (user dihapus
  // permanen, mis. pembersihan fixture test) -- tetap 401 dengan pesan yang
  // sama, bukan 500: dari sisi pemakai efeknya identik (sesinya sudah tidak
  // berlaku), dan pesan berbeda cuma akan membocorkan apakah sebuah id pernah
  // ada. Perbandingan `!==` langsung aman karena token_version adalah INTEGER
  // (pulang sebagai JS number dari driver `pg`), beda dari `id` yang BIGINT.
  if (rows.length === 0 || rows[0].token_version !== user.tokenVersion) {
    res.status(401).json({ error: SESSION_REVOKED_MESSAGE });
    return;
  }

  (req as unknown as { auth: AuthUser }).auth = user;
  next();
}

/**
 * Cek non-blocking apakah user boleh melakukan `action` -- dipakai untuk
 * FILTER FIELD di response (mis. sembunyikan HPP/margin), bukan untuk
 * menolak akses ke endpoint. Lihat `requirePermission` untuk gate akses.
 */
export function hasPermission(user: AuthUser, action: string): boolean {
  return getPermissionDef(action).roles.includes(user.role);
}

export interface RequirePermissionOptions {
  /** Ambil id lokasi yang direferensikan request ini, untuk dicek terhadap locationScope "own". */
  extractLocationIds?: (req: Request) => number[];
}

/**
 * Middleware: tolak (403) kalau role user tidak ada di `PermissionDef.roles`,
 * atau (kalau locationScope role itu "own") request menyentuh lokasi di luar
 * `user.locationIds`. Wajib dipasang SETELAH `requireAuth`.
 */
export function requirePermission(action: string, options: RequirePermissionOptions = {}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const def = getPermissionDef(action);
    const user = getAuthUser(req);

    if (!def.roles.includes(user.role)) {
      res.status(403).json({ error: `Role "${user.role}" tidak punya izin untuk aksi "${action}"` });
      return;
    }

    const scope = def.locationScope?.[user.role] ?? "any";
    if (scope === "own" && !user.allLocations && options.extractLocationIds) {
      const ids = options.extractLocationIds(req);
      const allowed = ids.every((id) => user.locationIds.includes(id));
      if (!allowed) {
        res.status(403).json({ error: `Role "${user.role}" cuma boleh mengakses lokasi sendiri untuk aksi "${action}"` });
        return;
      }
    }

    next();
  };
}
