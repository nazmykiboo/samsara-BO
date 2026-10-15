import express, { Router, type Request, type Response, type NextFunction } from "express";
import type { PoolClient } from "pg";
import { pool, getAuthUser, requirePermission } from "@samsara/core";
import {
  importBiayaPlatform,
  importLogPenjualan,
  importRawMajoo,
  importTransaksi,
  type HasilImport,
} from "../domain/import-csv.js";
import { listBelumDiproses } from "../domain/belum-diproses.js";
import { listItemMapping, setItemMapping, syncItemMappingFromLog } from "../domain/item-mapping.js";
import { prosesSinkronisasi } from "../domain/proses.js";

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

/**
 * Body parser KHUSUS per-route untuk endpoint import: teks mentah dengan
 * Content-Type `text/csv`, limit 15mb.
 *
 * SENGAJA tidak dipasang global dan SENGAJA tidak menaikkan limit
 * `express.json()` di `core/src/server/build-server.ts`: limit JSON global
 * (default Express, 100kb) berlaku untuk SEMUA modul, jadi menaikkannya demi
 * satu endpoint import akan memperbesar blast radius ke modul lain. Repo ini
 * juga tidak punya multer/library upload apa pun -- dan tidak perlu: CSV cukup
 * dikirim sebagai body mentah.
 */
function csvBody() {
  return express.text({ type: "text/csv", limit: "15mb" });
}

/**
 * Validasi body import: kalau Content-Type-nya bukan `text/csv`,
 * `express.text()` tidak memproses body dan `req.body` tetap `{}` dari
 * `express.json()` global -- tanpa cek ini pesan errornya akan membingungkan.
 */
function ambilCsv(req: Request, res: Response): string | null {
  const body = req.body;
  if (typeof body !== "string" || body.trim() === "") {
    res.status(400).json({
      error: "Body wajib berisi teks CSV mentah dengan header Content-Type: text/csv",
    });
    return null;
  }
  return body;
}

function endpointImport(
  router: Router,
  path: string,
  importer: (client: PoolClient, text: string) => Promise<HasilImport>,
): void {
  // Urutan middleware: body parser CSV DULU, baru requirePermission.
  // Aman: requirePermission/getAuthUser tidak menyentuh body sama sekali, dan
  // `requireAuth` global sudah dipasang di build-server.ts sebelum modul mana
  // pun di-mount, jadi req.auth sudah terisi sebelum sampai ke sini.
  router.post(
    path,
    csvBody(),
    requirePermission("sales_sync.manage"),
    asyncHandler(async (req, res) => {
      const text = ambilCsv(req, res);
      if (text === null) return;
      const hasil = await withTransaction((client) => importer(client, text));
      res.json(hasil);
    }),
  );
}

export function createRouter(): Router {
  const router = Router();

  // --- Import CSV arsip mentah (4 sumber) ----------------------------------

  endpointImport(router, "/import/log-penjualan", importLogPenjualan);
  endpointImport(router, "/import/transaksi", importTransaksi);
  endpointImport(router, "/import/raw-majoo", importRawMajoo);
  endpointImport(router, "/import/biaya-platform", importBiayaPlatform);

  // --- Pemetaan item eksternal -> menu internal ---------------------------

  router.get(
    "/item-mapping",
    requirePermission("sales_sync.manage"),
    asyncHandler(async (req, res) => {
      const statusRaw = req.query.status;
      const status = typeof statusRaw === "string" && statusRaw !== "" ? statusRaw : undefined;
      // Antrian disegarkan dulu dari arsip log (idempoten, ON CONFLICT DO
      // NOTHING -- tidak pernah menimpa pemetaan yang sudah dikerjakan) supaya
      // kode eksternal baru tidak pernah "hilang" dari antrian kalau baris log
      // masuk lewat jalur selain POST /import/log-penjualan.
      const rows = await withTransaction(async (client) => {
        await syncItemMappingFromLog(client);
        return listItemMapping(client, status);
      });
      res.json(rows);
    }),
  );

  router.patch(
    "/item-mapping/:id",
    requirePermission("sales_sync.manage"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const kodeMenu = req.body?.kodeMenu;
      if (typeof kodeMenu !== "string" || kodeMenu.trim() === "") {
        res.status(400).json({ error: "kodeMenu wajib diisi" });
        return;
      }
      const hasil = await withTransaction((client) =>
        setItemMapping(client, Number(req.params.id), kodeMenu.trim(), Number(user.id)),
      );
      res.json(hasil);
    }),
  );

  // --- Arsip yang belum pengaruh stok (read-only) -------------------------

  router.get(
    "/belum-diproses",
    requirePermission("sales_sync.manage"),
    // TIDAK dibungkus withTransaction: endpoint ini tidak menulis apa pun,
    // cukup satu koneksi dengan `finally client.release()` (pola sama seperti
    // endpoint GET murni-baca di modules/inventory/src/api/router.ts).
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const rows = await listBelumDiproses(client, {
          tanggalMulai: typeof req.query.tanggal_mulai === "string" ? req.query.tanggal_mulai : undefined,
          tanggalSelesai: typeof req.query.tanggal_selesai === "string" ? req.query.tanggal_selesai : undefined,
        });
        res.json(rows);
      } finally {
        client.release();
      }
    }),
  );

  // --- Proses arsip -> transaksi Penjualan Inventory ----------------------

  router.post(
    "/proses",
    requirePermission("sales_sync.manage"),
    asyncHandler(async (req, res) => {
      // Sudah pasti ada & valid: `requireAuth` global menolak request tanpa
      // header Authorization: Bearer <token> sebelum router ini dipanggil.
      const authHeader = req.headers.authorization as string;
      const user = getAuthUser(req);
      // Endpoint ini TIDAK perlu body parser khusus seperti endpoint import CSV:
      // body-nya kecil (satu field tanggal), `express.json()` global di
      // core/src/server/build-server.ts sudah cukup. Validasi formatnya ada di
      // domain (prosesSinkronisasi), pesannya diteruskan apa adanya oleh error
      // handler router di bawah -> HTTP 400.
      const tanggalMulai = typeof req.body?.tanggalMulai === "string" ? req.body.tanggalMulai : undefined;
      // prosesSinkronisasi mengelola transaksinya SENDIRI (satu per order) --
      // karena itu TIDAK dibungkus withTransaction di sini, lihat komentar di
      // ../domain/proses.ts.
      const hasil = await prosesSinkronisasi(authHeader, Number(user.id), tanggalMulai);
      res.json(hasil);
    }),
  );

  // Error handler khusus router ini -- pola sama persis seperti
  // modules/hr/src/api/router.ts dan modules/inventory/src/api/router.ts
  // (WAJIB di tiap router modul, TIDAK ada error handler global di
  // build-server.ts): tanpa ini, error bisnis dari domain layer bubble ke
  // default error handler Express sebagai 500 polos tanpa pesan.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan";
    const status = /tidak ditemukan/i.test(message) ? 404 : 400;
    res.status(status).json({ error: message });
  });

  return router;
}
