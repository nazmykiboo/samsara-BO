import { Router, type Request, type Response, type NextFunction } from "express";
import type { PoolClient } from "pg";
import { pool, getAuthUser, requirePermission } from "@samsara/core";
import {
  createJadwalShift,
  deleteJadwalShift,
  getJadwalGrid,
  listJadwalShift,
  salinMingguJadwal,
  updateJadwalShift,
} from "../domain/jadwal.js";
import {
  createPengajuanLibur,
  decidePengajuanLibur,
  getSisaKuotaCuti,
  listPengajuanLibur,
  overridePengajuanLibur,
} from "../domain/pengajuan-libur.js";
import { createShiftTemplate, listShiftTemplate, updateShiftTemplate } from "../domain/shift-template.js";

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function createRouter(): Router {
  const router = Router();

  router.get("/status", requirePermission("hr.status"), (_req, res) => {
    res.json({ module: "hr", status: "ok" });
  });

  // --- Jadwal shift --------------------------------------------------------

  router.get(
    "/jadwal-shift",
    requirePermission("jadwal.lihat"),
    asyncHandler(async (req, res) => {
      const dari = String(req.query.dari ?? "");
      const sampai = String(req.query.sampai ?? "");
      if (!dari || !sampai) {
        res.status(400).json({ error: "Query param 'dari' dan 'sampai' (YYYY-MM-DD) wajib diisi" });
        return;
      }
      const client = await pool.connect();
      try {
        const user = getAuthUser(req);
        const rows = await listJadwalShift(client, user, {
          dari,
          sampai,
          lokasiId: optionalNumber(req.query.lokasiId),
          userId: optionalNumber(req.query.userId),
        });
        res.json(rows);
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/jadwal",
    requirePermission("jadwal.lihat"),
    asyncHandler(async (req, res) => {
      const minggu = String(req.query.minggu ?? "");
      if (!minggu) {
        res.status(400).json({ error: "Query param 'minggu' (YYYY-MM-DD, tanggal mana pun dalam minggu target) wajib diisi" });
        return;
      }
      const client = await pool.connect();
      try {
        const user = getAuthUser(req);
        const grid = await getJadwalGrid(client, user, { lokasiId: optionalNumber(req.query.lokasi), minggu });
        res.json(grid);
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/jadwal-shift",
    requirePermission("jadwal.manage"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const { userId, lokasiId, tanggal, shiftTemplateId } = req.body ?? {};
      const result = await withTransaction((client) =>
        createJadwalShift(
          client,
          { userId: Number(userId), lokasiId: Number(lokasiId), tanggal, shiftTemplateId: Number(shiftTemplateId) },
          Number(user.id),
        ),
      );
      res.status(201).json(result);
    }),
  );

  // Salin minggu: reuse permission `jadwal.manage` (sama seperti POST/PATCH/
  // DELETE jadwal-shift) -- aksinya cuma membuat banyak baris jadwal
  // sekaligus, bukan wewenang baru yang perlu action sendiri.
  router.post(
    "/jadwal/salin-minggu",
    requirePermission("jadwal.manage"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const { lokasiId, mingguSumber, mingguTujuan } = req.body ?? {};
      const result = await withTransaction((client) =>
        salinMingguJadwal(
          client,
          { lokasiId: Number(lokasiId), mingguSumber, mingguTujuan },
          Number(user.id),
        ),
      );
      res.status(201).json(result);
    }),
  );

  // Batch assign: SATU panggilan API, BUKAN satu transaksi DB atomik. Tiap
  // userId diproses independen di `withTransaction`-nya SENDIRI (pola sama
  // persis seperti POST /jadwal-shift di atas, cuma dipanggil berkali-kali
  // dalam loop) -- sengaja sekuensial, bukan Promise.all, supaya urutan hasil
  // deterministik (sama dengan urutan `userIds` yang dikirim) dan connection
  // pool tidak kebanjiran. Item yang gagal (mis. userId tidak ada) ditangkap
  // per iterasi dan TIDAK menghentikan/membatalkan item lain, jadi response
  // selalu 200: request-nya sendiri berhasil DIPROSES, keberhasilan per item
  // dibaca frontend dari array hasil. Reuse permission `jadwal.manage` --
  // aksinya cuma membuat banyak baris jadwal sekaligus, bukan wewenang baru
  // (alasan sama seperti /jadwal/salin-minggu).
  //
  // Pengecekan per user cuma `konflikCuti` dari `createJadwalShift` (penanda,
  // bukan blocker) -- TIDAK ADA konsep kuota untuk pembuatan jadwal shift di
  // sistem ini; kuota (bulanan/harian lokasi) itu domain pengajuan libur.
  router.post(
    "/jadwal/batch",
    requirePermission("jadwal.manage"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const { lokasiId, tanggal, shiftTemplateId, userIds } = req.body ?? {};
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: "Body 'userIds' wajib berupa array dan tidak boleh kosong" });
        return;
      }

      const results: Array<{
        userId: string;
        success: boolean;
        id?: string;
        konflikCuti?: boolean;
        error?: string;
      }> = [];

      for (const uid of userIds) {
        try {
          const hasil = await withTransaction((client) =>
            createJadwalShift(
              client,
              {
                userId: Number(uid),
                lokasiId: Number(lokasiId),
                tanggal,
                shiftTemplateId: Number(shiftTemplateId),
              },
              Number(user.id),
            ),
          );
          results.push({ userId: String(uid), success: true, id: hasil.id, konflikCuti: hasil.konflikCuti });
        } catch (err) {
          results.push({
            userId: String(uid),
            success: false,
            error: err instanceof Error ? err.message : "Gagal menyimpan",
          });
        }
      }

      res.json(results);
    }),
  );

  // Batch hapus: pola identik dengan POST /jadwal/batch di atas (satu
  // panggilan API, transaksi terpisah per item, gagal per item tidak
  // membatalkan item lain, selalu 200 dengan array hasil berurutan).
  router.post(
    "/jadwal/batch-hapus",
    requirePermission("jadwal.manage"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const { ids } = req.body ?? {};
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: "Body 'ids' wajib berupa array dan tidak boleh kosong" });
        return;
      }

      const results: Array<{ id: string; success: boolean; error?: string }> = [];

      for (const id of ids) {
        try {
          await withTransaction((client) => deleteJadwalShift(client, Number(id), Number(user.id)));
          results.push({ id: String(id), success: true });
        } catch (err) {
          results.push({
            id: String(id),
            success: false,
            error: err instanceof Error ? err.message : "Gagal menghapus",
          });
        }
      }

      res.json(results);
    }),
  );

  router.patch(
    "/jadwal-shift/:id",
    requirePermission("jadwal.manage"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const { lokasiId, tanggal, shiftTemplateId } = req.body ?? {};
      const result = await withTransaction((client) =>
        updateJadwalShift(
          client,
          Number(req.params.id),
          {
            lokasiId: lokasiId === undefined ? undefined : Number(lokasiId),
            tanggal,
            shiftTemplateId: shiftTemplateId === undefined ? undefined : Number(shiftTemplateId),
          },
          Number(user.id),
        ),
      );
      res.json({ id: req.params.id, ...result });
    }),
  );

  router.delete(
    "/jadwal-shift/:id",
    requirePermission("jadwal.manage"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      await withTransaction((client) => deleteJadwalShift(client, Number(req.params.id), Number(user.id)));
      res.json({ id: req.params.id, deleted: true });
    }),
  );

  // --- Pengajuan libur -------------------------------------------------------

  router.get(
    "/pengajuan-libur",
    requirePermission("pengajuan_libur.lihat"),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const user = getAuthUser(req);
        const statusRaw = req.query.status;
        const status =
          statusRaw === "diajukan" || statusRaw === "disetujui" || statusRaw === "ditolak" ? statusRaw : undefined;
        const rows = await listPengajuanLibur(client, user, { status, userId: optionalNumber(req.query.userId) });
        res.json(rows);
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/pengajuan-libur/kuota",
    requirePermission("pengajuan_libur.lihat"),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const user = getAuthUser(req);
        res.json(await getSisaKuotaCuti(client, Number(user.id)));
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/pengajuan-libur",
    requirePermission("pengajuan_libur.create"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const { tanggalMulai, tanggalSelesai, alasan } = req.body ?? {};
      const result = await withTransaction((client) =>
        createPengajuanLibur(client, Number(user.id), { tanggalMulai, tanggalSelesai, alasan }),
      );
      res.status(201).json(result);
    }),
  );

  // Override: reuse permission `pengajuan_libur.approve` -- yang boleh
  // membuatkan cuti darurat untuk staf lain memang persis yang boleh
  // menyetujui pengajuan (owner+manajer_ops), jadi tidak perlu action baru.
  router.post(
    "/pengajuan-libur/override",
    requirePermission("pengajuan_libur.approve"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const { userId, tanggalMulai, tanggalSelesai, alasan, penggantiNama } = req.body ?? {};
      const result = await withTransaction((client) =>
        overridePengajuanLibur(client, Number(user.id), {
          userId: Number(userId),
          tanggalMulai,
          tanggalSelesai,
          alasan,
          penggantiNama,
        }),
      );
      res.status(201).json(result);
    }),
  );

  router.patch(
    "/pengajuan-libur/:id/keputusan",
    requirePermission("pengajuan_libur.approve"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const keputusan = req.body?.keputusan;
      if (keputusan !== "disetujui" && keputusan !== "ditolak") {
        res.status(400).json({ error: "Body 'keputusan' wajib 'disetujui' atau 'ditolak'" });
        return;
      }
      await withTransaction((client) =>
        decidePengajuanLibur(client, Number(req.params.id), keputusan, Number(user.id)),
      );
      res.json({ id: req.params.id, status: keputusan });
    }),
  );

  // --- Shift template (dipakai dropdown "buat jadwal", dikelola lewat Pengaturan) --

  router.get(
    "/shift-template",
    requirePermission("shift_template.manage"),
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        res.json(await listShiftTemplate(client));
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/shift-template",
    requirePermission("shift_template.manage"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const { kode, nama, jamMulai, jamSelesai, urutanTampil } = req.body ?? {};
      const result = await withTransaction((client) =>
        createShiftTemplate(
          client,
          { kode, nama, jamMulai, jamSelesai, urutanTampil: urutanTampil === undefined ? undefined : Number(urutanTampil) },
          Number(user.id),
        ),
      );
      res.status(201).json(result);
    }),
  );

  router.patch(
    "/shift-template/:id",
    requirePermission("shift_template.manage"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const { nama, jamMulai, jamSelesai, aktif, urutanTampil } = req.body ?? {};
      await withTransaction((client) =>
        updateShiftTemplate(
          client,
          Number(req.params.id),
          { nama, jamMulai, jamSelesai, aktif, urutanTampil: urutanTampil === undefined ? undefined : Number(urutanTampil) },
          Number(user.id),
        ),
      );
      res.json({ id: req.params.id });
    }),
  );

  // Error handler khusus router ini -- pola sama persis seperti
  // modules/inventory/src/api/router.ts (WAJIB di tiap router modul, TIDAK
  // ada error handler global di build-server.ts): tanpa ini, error bisnis
  // dari domain layer (mis. "tidak bisa memutuskan pengajuan milik sendiri")
  // bubble ke default error handler Express sebagai 500 polos tanpa pesan.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan";
    const status = /tidak ditemukan/i.test(message) ? 404 : 400;
    res.status(status).json({ error: message });
  });

  return router;
}
