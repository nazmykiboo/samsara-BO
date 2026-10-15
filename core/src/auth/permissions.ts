import type { Request, Response, NextFunction } from "express";
import type { LoadedModule } from "../manifest/types.js";
import type { AuthUser, PermissionDef } from "./types.js";
import { verifyAuthToken } from "./jwt.js";

/**
 * Permission yang dimiliki `core` sendiri (bukan modul bisnis apa pun) --
 * mis. kelola user. Digabung dengan permission yang dideklarasikan tiap
 * modul di `module.json` § `api.endpoints[].permission`.
 */
const CORE_PERMISSIONS: PermissionDef[] = [{ action: "user.manage", roles: ["owner"] }];

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

/** Middleware: wajib ada JWT valid di header `Authorization: Bearer <token>`. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Header Authorization: Bearer <token> wajib diisi" });
    return;
  }
  try {
    const user = verifyAuthToken(header.slice("Bearer ".length));
    (req as unknown as { auth: AuthUser }).auth = user;
    next();
  } catch {
    res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
  }
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
