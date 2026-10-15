import type { Router } from "express";
import type { PermissionDef } from "../auth/types.js";

export interface ModuleApiEndpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  /**
   * Deklarasi permission untuk endpoint ini -- dibaca `initPermissionRegistry`
   * (auth/permissions.ts) supaya modul manapun otomatis ikut sistem
   * role/permission yang sama tanpa membangun mekanismenya sendiri. Endpoint
   * tanpa `permission` cuma butuh login (requireAuth), tidak ada gate role.
   */
  permission?: PermissionDef;
}

/**
 * Bentuk data dari file `module.json` tiap modul. File ini murni JSON
 * (tidak boleh berisi kode) supaya bisa dibaca tooling/dokumentasi tanpa
 * menjalankan TypeScript.
 */
export interface ModuleManifest {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  dependsOn: string[];
  tablePrefix: string;
  tables: string[];
  api: {
    basePath: string;
    endpoints: ModuleApiEndpoint[];
  };
  /**
   * Permission yang TIDAK terikat 1:1 ke satu endpoint tertentu -- dipakai
   * untuk filter FIELD di response (mis. `hpp.lihat_harga`, dicek pakai
   * `hasPermission`, bukan gate akses lewat `requirePermission`), atau
   * untuk mendeklarasikan aksi yang direncanakan tapi endpoint-nya belum
   * dibangun (didokumentasikan, tidak ditegakkan sampai endpoint-nya ada).
   */
  permissions?: PermissionDef[];
  migrationsDir: string;
}

/**
 * Manifest + kode yang sudah dimuat dari package modul (default export-nya).
 * `migrationsPath` sudah di-resolve jadi absolute path oleh modul itu sendiri.
 */
export interface LoadedModule {
  manifest: ModuleManifest;
  createRouter: () => Router;
  migrationsPath: string;
}
