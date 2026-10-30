import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db/pool.js";
import {
  authenticate,
  authenticateByPin,
  createUser,
  gantiKredensialSendiri,
  listActiveStafByLocation,
  listUsers,
  resetCredential,
  updateUser,
} from "./users.js";
import { isLockedOut, recordLoginAttempt } from "./rate-limit.js";
import { signAuthToken } from "./jwt.js";
import { getAuthUser, requireAuth, requireGantiKredensialDulu, requirePermission } from "./permissions.js";
import { ROLES, type AuthUser } from "./types.js";

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
    requireGantiKredensialDulu,
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
    requireGantiKredensialDulu,
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
    requireGantiKredensialDulu,
    requirePermission("user.manage"),
    asyncHandler(async (req, res) => {
      const { name, isActive, locationIds, role, nomorWhatsapp } = req.body ?? {};
      const userId = Number(req.params.id);

      // Guard "tidak bisa nonaktifkan akun sendiri" + "tidak boleh nol owner
      // aktif tersisa" (nonaktifkan MAUPUN ubah role) sekarang di
      // `updateUser` (satu sumber kebenaran, dipakai baik untuk endpoint
      // ini) -- di sini cuma meneruskan siapa yang sedang login (sebagai
      // string, lihat catatan di auth/types.ts).
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const hasil = await updateUser(
          client,
          userId,
          { name, isActive, locationIds, role, nomorWhatsapp },
          String(getAuthUser(req).id),
        );
        await client.query("COMMIT");
        // generatedPin/generatedPassword HANYA terisi kalau role pindah
        // lintas keluarga auth (staf/PIN <-> password) -- lihat UpdateUserResult.
        res.json({ id: userId, ...hasil });
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
    requireGantiKredensialDulu,
    requirePermission("user.manage"),
    asyncHandler(async (req, res) => {
      const userId = Number(req.params.id);
      const owner = getAuthUser(req);
      // Body opsional {pinManual?, passwordManual?} (2026-10-30) -- owner boleh ketik
      // kredensial sementara sendiri, atau biarkan kosong untuk auto-generate seperti
      // sebelumnya. Validasi pola lemah/panjang dilakukan di resetCredential.
      const input = {
        pinManual: typeof req.body?.pinManual === "string" ? req.body.pinManual : undefined,
        passwordManual: typeof req.body?.passwordManual === "string" ? req.body.passwordManual : undefined,
      };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await resetCredential(client, userId, input, owner.id);
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

  // Ganti kredensial MILIK SENDIRI (2026-10-30) -- satu-satunya endpoint yang tetap
  // diizinkan selama `wajib_ganti_kredensial` aktif (lihat requireGantiKredensialDulu,
  // core/src/server/build-server.ts), tapi juga bisa dipakai kapan saja secara sukarela.
  // Rate-limit: method rate-limit DIGABUNG ke "password"/"pin" yang sudah ada (bukan nilai
  // method baru) -- isLockedOut() memang sudah menggabungkan kedua metode per user, jadi
  // menambah value baru ke CHECK constraint core_login_attempts tidak perlu.
  router.post(
    "/ganti-kredensial",
    requireAuth,
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const kredensialLama = req.body?.kredensialLama;
      const kredensialBaru = req.body?.kredensialBaru;
      if (!kredensialLama || !kredensialBaru) {
        res.status(400).json({ error: "kredensialLama dan kredensialBaru wajib diisi" });
        return;
      }

      const method: "password" | "pin" = user.role === "staf" ? "pin" : "password";

      const client = await pool.connect();
      try {
        if (await isLockedOut(client, user.id)) {
          res.status(429).json({ error: LOCKOUT_MESSAGE });
          return;
        }

        let result: Awaited<ReturnType<typeof gantiKredensialSendiri>>;
        try {
          await client.query("BEGIN");
          result = await gantiKredensialSendiri(client, user.id, kredensialLama, kredensialBaru);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          // Percobaan gagal TETAP dicatat (statement sendiri, di luar transaksi yang
          // baru di-rollback) supaya ikut terhitung ke rate-limit 5x/15menit.
          await recordLoginAttempt(client, { userId: user.id, username: user.username, method, success: false });
          res.status(401).json({ error: err instanceof Error ? err.message : "Gagal ganti kredensial." });
          return;
        }
        await recordLoginAttempt(client, { userId: user.id, username: user.username, method, success: true });

        // Dibangun ULANG dari field AuthUser yang eksplisit (BUKAN `{...user, ...}`) --
        // `user` di sini adalah payload JWT yang sudah di-decode, yang juga membawa
        // `iat`/`exp` bawaan jsonwebtoken. Spread langsung akan membuat `signAuthToken`
        // menolak ("payload already has an exp property") karena `jwt.sign` menganggap
        // `exp` yang sudah ada sebagai konflik dengan opsi `expiresIn`.
        const updated: AuthUser = {
          id: user.id,
          username: user.username,
          role: user.role,
          allLocations: user.allLocations,
          locationIds: user.locationIds,
          tokenVersion: result.newTokenVersion,
          wajibGantiKredensial: false,
        };
        res.json({ token: signAuthToken(updated), user: updated });
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
