import express from "express";
import type { LoadedModule } from "../manifest/types.js";
import { createAuthRouter } from "../auth/router.js";
import { initPermissionRegistry, requireAuth } from "../auth/permissions.js";

/**
 * @param allModules Semua modul terdaftar (dipakai untuk `/health`, termasuk yang nonaktif).
 * @param enabledInOrder Modul yang `enabled: true`, sudah terurut sesuai dependency — ini yang di-mount.
 */
export function buildServer(allModules: LoadedModule[], enabledInOrder: LoadedModule[]) {
  const app = express();
  app.use(express.json());

  // /health TIDAK butuh login (dipakai monitoring/infra), dan didaftarkan
  // sebelum requireAuth global di bawah.
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      modules: allModules.map((m) => ({
        name: m.manifest.name,
        version: m.manifest.version,
        enabled: m.manifest.enabled,
      })),
    });
  });

  // Permission registry dibangun dari module.json semua modul (termasuk yang
  // nonaktif -- tidak masalah, cuma dipakai untuk lookup saat request masuk
  // ke endpoint yang benar-benar di-mount) SEBELUM modul mana pun di-mount.
  initPermissionRegistry(allModules);

  // /api/auth/login TIDAK butuh login (untuk dapat token). Endpoint lain di
  // router ini (mis. /api/auth/users) sudah pasang requireAuth sendiri di
  // dalam auth/router.ts.
  app.use("/api/auth", createAuthRouter());

  // Semua endpoint SETELAH baris ini wajib login (CLAUDE.md/instruksi owner:
  // "semua endpoint wajib login" -- /health dan /api/auth/login adalah
  // pengecualian yang memang perlu tetap terbuka).
  app.use(requireAuth);

  for (const mod of enabledInOrder) {
    app.use(mod.manifest.api.basePath, mod.createRouter());
  }

  return app;
}
