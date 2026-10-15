import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db/pool.js";
import {
  authenticate,
  authenticateByPin,
  createUser,
  listActiveStafByLocation,
  listUsers,
  resetCredential,
  updateUser,
} from "./users.js";
import { isLockedOut, recordLoginAttempt } from "./rate-limit.js";
import { signAuthToken } from "./jwt.js";
import { getAuthUser, requireAuth, requirePermission } from "./permissions.js";
import { ROLES } from "./types.js";

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const LOCKOUT_MESSAGE =
  "Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi dalam beberapa menit.";

/**
 * Router auth: `/login`, `/login-pin`, dan `/staf` TIDAK butuh `requireAuth`
 * (perlu diakses sebelum ada token sama sekali -- lihat core/src/server/
 * build-server.ts, router ini di-mount SEBELUM requireAuth global). Endpoint
 * kelola user butuh login + permission `user.manage` (role owner saja,
 * lihat CORE_PERMISSIONS di permissions.ts).
 */
export function createAuthRouter(): Router {
  const router = Router();

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const { username, password } = req.body ?? {};
      if (!username || !password) {
        res.status(400).json({ error: "username dan password wajib diisi" });
        return;
      }
      const client = await pool.connect();
      try {
        // Resolve dulu id-nya (walau password belum diverifikasi) supaya
        // rate-limit bisa dicek SEBELUM percobaan verifikasi, dan supaya
        // attempt tetap tercatat biarpun usernamenya salah total.
        const { rows } = await client.query<{ id: number }>(`SELECT id FROM core_users WHERE username = $1`, [
          username,
        ]);
        const userId = rows[0]?.id ?? null;

        if (userId !== null && (await isLockedOut(client, userId))) {
          res.status(429).json({ error: LOCKOUT_MESSAGE });
          return;
        }

        const user = await authenticate(client, username, password);
        await recordLoginAttempt(client, { userId, username, method: "password", success: user !== null });

        if (!user) {
          res.status(401).json({ error: "Username atau password salah" });
          return;
        }
        res.json({ token: signAuthToken(user), user });
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/login-pin",
    asyncHandler(async (req, res) => {
      const userId = Number(req.body?.userId);
      const pin = req.body?.pin;
      if (!Number.isFinite(userId) || !pin) {
        res.status(400).json({ error: "userId dan pin wajib diisi" });
        return;
      }
      const client = await pool.connect();
      try {
        const { rows } = await client.query<{ username: string }>(`SELECT username FROM core_users WHERE id = $1`, [
          userId,
        ]);
        const resolvedUserId = rows[0] ? userId : null;
        const usernameForLog = rows[0]?.username ?? `user#${userId}`;

        if (resolvedUserId !== null && (await isLockedOut(client, resolvedUserId))) {
          res.status(429).json({ error: LOCKOUT_MESSAGE });
          return;
        }

        const user = await authenticateByPin(client, userId, String(pin));
        await recordLoginAttempt(client, {
          userId: resolvedUserId,
          username: usernameForLog,
          method: "pin",
          success: user !== null,
        });

        if (!user) {
          res.status(401).json({ error: "PIN salah" });
          return;
        }
        res.json({ token: signAuthToken(user), user });
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/staf",
    asyncHandler(async (req, res) => {
      const locationId = Number(req.query.lokasi);
      if (!Number.isFinite(locationId)) {
        res.status(400).json({ error: "Query param 'lokasi' (id) wajib diisi" });
        return;
      }
      const client = await pool.connect();
      try {
        res.json(await listActiveStafByLocation(client, locationId));
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/users",
    requireAuth,
    requirePermission("user.manage"),
    asyncHandler(async (req, res) => {
      const { name, role, locationIds, username, password, pin } = req.body ?? {};
      if (!name || !role) {
        res.status(400).json({ error: "name dan role wajib diisi" });
        return;
      }
      if (!ROLES.includes(role)) {
        res.status(400).json({ error: `role harus salah satu dari: ${ROLES.join(", ")}` });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await createUser(client, { name, role, locationIds, username, password, pin });
        await client.query("COMMIT");
        res.status(201).json(result);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/users",
    requireAuth,
    requirePermission("user.manage"),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        res.json(await listUsers(client));
      } finally {
        client.release();
      }
    }),
  );

  router.patch(
    "/users/:id",
    requireAuth,
    requirePermission("user.manage"),
    asyncHandler(async (req, res) => {
      const { name, isActive, locationIds } = req.body ?? {};
      const userId = Number(req.params.id);

      // Guard "tidak bisa nonaktifkan akun sendiri" + "tidak boleh nol owner
      // aktif tersisa" sekarang di `updateUser` (satu sumber kebenaran,
      // dipakai baik untuk endpoint ini) -- di sini cuma meneruskan siapa
      // yang sedang login (sebagai string, lihat catatan di auth/types.ts).
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await updateUser(client, userId, { name, isActive, locationIds }, String(getAuthUser(req).id));
        await client.query("COMMIT");
        res.json({ id: userId });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/users/:id/reset",
    requireAuth,
    requirePermission("user.manage"),
    asyncHandler(async (req, res) => {
      const userId = Number(req.params.id);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await resetCredential(client, userId);
        await client.query("COMMIT");
        res.json(result);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
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
