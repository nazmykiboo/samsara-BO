import express, { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requirePermission } from "../auth/permissions.js";
import { getBusinessIdentity, getBusinessLogo, setBusinessDisplayName, setBusinessLogo } from "../business-identity/identity.js";
import { listLokasiPublik } from "../locations/locations.js";

/**
 * Router core level yang di-mount SEBELUM `requireAuth` global (lihat
 * `build-server.ts`) -- satu-satunya cara punya endpoint publik di aplikasi
 * ini, sama seperti `/api/auth/login`. Endpoint yang butuh login/permission
 * memasang `requireAuth`/`requirePermission` SENDIRI per-route di sini
 * (pola identik `auth/router.ts`).
 *
 * Isinya: identitas bisnis (nama+logo) dan daftar lokasi publik -- DUA hal
 * yang sama-sama wajib bisa diakses SEBELUM ada token auth (halaman login,
 * tab title, flow pilih-lokasi login PIN staf).
 */
function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/** Body parser raw khusus upload logo -- pola sama seperti `csvBody()` modul sales-sync: per-route, bukan global, supaya limit JSON global (100kb) tidak perlu dinaikkan demi satu endpoint ini. */
function logoBody() {
  return express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "600kb" });
}

export function createPublicCoreRouter(): Router {
  const router = Router();

  router.get(
    "/identitas-bisnis",
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        const identity = await getBusinessIdentity(client);
        res.json(identity);
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/identitas-bisnis/logo",
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        const logo = await getBusinessLogo(client);
        if (!logo) {
          res.status(404).json({ error: "Logo belum diunggah" });
          return;
        }
        res.setHeader("Content-Type", logo.contentType);
        res.setHeader("Cache-Control", "no-cache");
        res.send(logo.bytes);
      } finally {
        client.release();
      }
    }),
  );

  router.put(
    "/identitas-bisnis",
    requireAuth,
    requirePermission("identitas_bisnis.manage"),
    asyncHandler(async (req, res) => {
      // `express.json()` global (build-server.ts) sudah memparse body ini --
      // request PUT ini memang Content-Type application/json, BEDA dari PUT
      // .../logo di bawah yang Content-Type-nya gambar mentah.
      const displayName = req.body?.displayName;
      if (typeof displayName !== "string") {
        res.status(400).json({ error: "Body 'displayName' (string) wajib diisi" });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setBusinessDisplayName(client, displayName);
        await client.query("COMMIT");
        res.json({ displayName: displayName.trim() });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }),
  );

  router.put(
    "/identitas-bisnis/logo",
    requireAuth,
    requirePermission("identitas_bisnis.manage"),
    logoBody(),
    asyncHandler(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({
          error: "Body wajib berisi file gambar mentah (PNG/JPG/WebP) dengan Content-Type yang sesuai, maksimal 500KB",
        });
        return;
      }
      const contentType = req.headers["content-type"] ?? "";
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setBusinessLogo(client, req.body, contentType);
        await client.query("COMMIT");
        res.json({ ok: true });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/lokasi",
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        res.json(await listLokasiPublik(client));
      } finally {
        client.release();
      }
    }),
  );

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan";
    res.status(400).json({ error: message });
  });

  return router;
}
