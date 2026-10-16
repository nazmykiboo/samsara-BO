import express, { Router, type Request, type Response, type NextFunction } from "express";
import type { PoolClient } from "pg";
import { pool, getAuthUser, hasPermission, requirePermission } from "@samsara/core";
import { getItemCostReport, getMenuHppReport, setMenuHargaJual } from "../domain/hpp.js";
import {
  batchUpsertHargaChannel,
  exportHargaChannelCsv,
  getRekomendasiHarga,
  previewImportHargaChannel,
  setVisibilitasChannel,
  upsertHargaChannel,
} from "../domain/harga-channel.js";
import {
  JENIS_MUTASI_LAIN_VALID,
  createMutasiLain,
  createOpname,
  createPembelian,
  createPenjualan,
  createProduksi,
  createTransferKirim,
  createTransferTerima,
  decideOpname,
  getCurrentStock,
  getDalamPerjalanan,
  listOpname,
} from "../domain/stok.js";
import {
  createItem,
  createMenu,
  createResepProduksi,
  deactivateItem,
  deactivateMenu,
  deactivateResepProduksi,
  duplicateMenu,
  getMenuResep,
  getResepProduksiBaris,
  listItems,
  listMenu,
  listResepProduksi,
  updateItem,
  updateMenuResep,
  updateResepProduksi,
} from "../domain/master.js";
import {
  createChannel,
  createLokasi,
  getHppDefaultMethod,
  getTargetFoodCostPersen,
  resolveHppMethod,
  setHppDefaultMethod,
  setTargetFoodCostPersen,
  updateChannel,
  updateLokasi,
} from "../domain/pengaturan.js";
import {
  createKategori,
  createKategoriMenu,
  createSatuan,
  listKategori,
  listKategoriMenu,
  listSatuan,
  updateKategori,
  updateKategoriMenu,
  updateSatuan,
} from "../domain/referensi.js";
import { listMinStokByLocation, upsertMinStok } from "../domain/min-stok.js";
import {
  batalkanPermintaan,
  createPermintaanTransfer,
  listPermintaanTransfer,
  type PermintaanTransferStatus,
} from "../domain/permintaan-transfer.js";
import {
  getAnalitikOperasional,
  getAnalitikPenjualan,
  getDetailTransaksiPenjualan,
  getLaporanHarian,
} from "../domain/laporan.js";

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

/** Query param string opsional: kosong/absen -> undefined (artinya "tanpa filter"), bukan string kosong. */
function optionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Penanda "param tanggal diisi tapi bentuknya salah" -- dibedakan dari
 * `undefined` (tidak diisi, boleh pakai default) supaya salah format dijawab
 * 400 dengan pesan jelas, bukan diteruskan ke Postgres dan jadi error cast
 * yang pesannya tidak ramah.
 */
const INVALID_TANGGAL = "__tanggal_tidak_valid__";
const FORMAT_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function optionalTanggal(raw: unknown): string | undefined {
  const value = optionalString(raw);
  if (value === undefined) return undefined;
  return FORMAT_TANGGAL.test(value) ? value : INVALID_TANGGAL;
}

/**
 * Body parser KHUSUS per-route untuk POST /menu/harga-channel/import: teks
 * mentah dengan Content-Type `text/csv`. Pola yang sama dipakai modul
 * sales-sync (lihat modules/sales-sync/src/api/router.ts) -- SENGAJA tidak
 * dipasang global dan SENGAJA tidak menaikkan limit `express.json()` di
 * core/src/server/build-server.ts, karena limit JSON global berlaku untuk
 * SEMUA modul. Limit 5mb: CSV harga = ~3 kolom pendek per baris, ribuan baris
 * pun masih jauh di bawah itu (beda dari sales-sync yang 15mb karena CSV
 * transaksi mentah jauh lebih besar).
 */
function csvBody() {
  return express.text({ type: "text/csv", limit: "5mb" });
}

/**
 * Validasi body CSV: kalau Content-Type-nya bukan `text/csv`, `express.text()`
 * tidak memproses body dan `req.body` tetap `{}` dari `express.json()` global
 * -- tanpa cek ini pesan errornya membingungkan.
 */
function ambilCsv(req: Request, res: Response): string | null {
  const body = req.body;
  if (typeof body !== "string" || body.trim() === "") {
    res.status(400).json({ error: "Body wajib berisi teks CSV mentah dengan header Content-Type: text/csv" });
    return null;
  }
  return body;
}

/** locationId dari body request, dibungkus array supaya cocok dengan `RequirePermissionOptions.extractLocationIds`. */
function locationIdFromBody(req: Request): number[] {
  const id = Number(req.body?.locationId);
  return Number.isFinite(id) ? [id] : [];
}

export function createRouter(): Router {
  const router = Router();

  router.get("/status", requirePermission("inventory.status"), (_req, res) => {
    res.json({ module: "inventory", status: "ok" });
  });

  // --- HPP -------------------------------------------------------------------
  // Endpoint HPP bisa diakses KEEMPAT role manusia (owner/manajer_ops/
  // supervisor/staf) -- yang dibatasi per role adalah FIELD di response-nya
  // (hpp.lihat_harga) dan metode HPP yang dipakai (resolveHppMethod: query
  // param ?metode= cuma jadi override untuk owner/manajer_ops, role lain
  // selalu pakai default global -- lihat domain/pengaturan.ts).
  //
  // Gate akses-nya (master_item.lihat / master_menu.lihat) tetap WAJIB ada
  // walau populasi role-nya keempat role manusia: tanpa gate sama sekali,
  // SIAPA PUN yang login lolos -- termasuk akun otomatis role `integrasi`
  // (n8n) yang cuma boleh 4 endpoint import modul sales-sync. Permission di
  // repo ini murni whitelist (lihat core/src/auth/permissions.ts), jadi role
  // yang tidak terdaftar di roles[] otomatis ditolak 403. Action READ ini
  // SENGAJA terpisah dari master_item.edit/master_menu.edit (itu WRITE,
  // populasi role-nya lebih sempit) dan dari hpp.lihat_harga (itu filter
  // FIELD lewat hasPermission, bukan gate akses lewat requirePermission).

  router.get(
    "/items/:kode/hpp",
    requirePermission("master_item.lihat"),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const user = getAuthUser(req);
        const method = await resolveHppMethod(client, user, req.query.metode);
        const report = await getItemCostReport(client, req.params.kode, method);
        if (!hasPermission(user, "hpp.lihat_harga")) {
          const { cost_per_recipe_unit, ...publicReport } = report;
          res.json(publicReport);
          return;
        }
        res.json(report);
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/menu/:kode/hpp",
    requirePermission("master_menu.lihat"),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const user = getAuthUser(req);
        const method = await resolveHppMethod(client, user, req.query.metode);
        const report = await getMenuHppReport(client, req.params.kode, method);
        if (!hasPermission(user, "hpp.lihat_harga")) {
          // harga_jual (top-level & per-channel) TETAP tampil -- staf/
          // supervisor perlu tahu harga jual untuk operasional sehari-hari.
          // Yang disembunyikan cuma sisi biaya/margin/persentase.
          const { hpp_per_porsi, food_cost_pct, margin, channels, ...publicReport } = report;
          const publicChannels = channels.map(({ foodCostPct, markupPct, marginPct, ...rest }) => rest);
          res.json({ ...publicReport, channels: publicChannels });
          return;
        }
        res.json(report);
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/menu/:kode/rekomendasi-harga",
    requirePermission("master_menu.lihat"),
    // Read-only, cuma kalkulasi (tidak menyimpan apa pun) -- keempat role
    // manusia boleh akses, sama seperti GET .../hpp. Metode HPP dan target
    // food cost dua-duanya opsional di-override lewat query param, sama
    // persis pola resolveHppMethod (?metode= cuma berlaku untuk
    // owner/manajer_ops, role lain selalu pakai default global).
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const user = getAuthUser(req);
        const method = await resolveHppMethod(client, user, req.query.metode);
        const targetRaw = Number(req.query.target_food_cost);
        const target = Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : await getTargetFoodCostPersen(client);
        const result = await getRekomendasiHarga(client, req.params.kode, target, method);
        res.json(result);
      } finally {
        client.release();
      }
    }),
  );

  // --- Edit harga massal per channel (grid "Simpan Semua" + CSV) ----------
  // Tiga endpoint di bawah lingkupnya LINTAS menu, jadi path-nya statis
  // (`/menu/harga-channel/...`), bukan di bawah `/menu/:kode/...`. Semuanya
  // pakai permission harga_jual.edit yang SUDAH ADA (sama dengan
  // PATCH /menu/:kode/harga-channel) -- tidak ada permission baru: ini cara
  // lain mengerjakan hal yang sama (mengubah harga jual per channel), cuma
  // massal, bukan kategori akses baru.
  //
  // Didaftarkan SEBELUM rute `/menu/:kode/...` di bawahnya: saat ini tidak ada
  // pola yang bentrok (segmen ke-3 "batch"/"export"/"import" beda dari
  // "harga-jual"/"harga-channel"/"hpp"/"resep"), tapi urutan ini membuatnya
  // tetap aman kalau nanti ada rute `/menu/:kode/export` dan sejenisnya.

  // ATOMIK SUNGGUHAN: satu baris gagal -> SEMUA baris batch ini di-ROLLBACK
  // (tidak ada yang tersimpan). Ini SENGAJA BEDA dari pola batch modul HR
  // (POST /jadwal/batch) dan import CSV sales-sync yang "transaksi independen
  // per item". Diminta owner eksplisit demi UX grid "Simpan Semua" -- lihat
  // doc batchUpsertHargaChannel di domain/harga-channel.ts.
  router.patch(
    "/menu/harga-channel/batch",
    requirePermission("harga_jual.edit"),
    asyncHandler(async (req, res) => {
      const baris = req.body?.baris;
      const user = getAuthUser(req);
      // Validasi bentuk 'baris' (array, tidak kosong) ada di domain layer
      // supaya aturannya sama lewat router maupun test -- error-nya dipetakan
      // ke 400 oleh error handler router di bawah.
      await withTransaction((client) => batchUpsertHargaChannel(client, baris, user.id));
      res.json({ disimpan: baris.length });
    }),
  );

  // Kirim CSV mentah (BUKAN JSON) -- kebalikan dari endpoint import di bawah.
  router.get(
    "/menu/harga-channel/export",
    requirePermission("harga_jual.edit"),
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        const csv = await exportHargaChannelCsv(client);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="harga-channel.csv"');
        res.send(csv);
      } finally {
        client.release();
      }
    }),
  );

  // READ-ONLY meski POST + menerima CSV: cuma preview (baru/berubah/sama/error)
  // supaya user bisa memeriksa dulu. TIDAK menyimpan apa pun, jadi pakai
  // pool.connect() biasa, BUKAN withTransaction. Penyimpanan sungguhan adalah
  // panggilan TERPISAH dari frontend ke PATCH /menu/harga-channel/batch di
  // atas (dua endpoint ini tidak saling memanggil di sisi backend).
  //
  // Urutan middleware: body parser CSV DULU, baru requirePermission -- sama
  // seperti sales-sync; requirePermission/getAuthUser tidak menyentuh body.
  router.post(
    "/menu/harga-channel/import",
    csvBody(),
    requirePermission("harga_jual.edit"),
    asyncHandler(async (req, res) => {
      const text = ambilCsv(req, res);
      if (text === null) return;
      const client = await pool.connect();
      try {
        res.json(await previewImportHargaChannel(client, text));
      } finally {
        client.release();
      }
    }),
  );

  router.patch(
    "/menu/:kode/harga-jual",
    requirePermission("harga_jual.edit"),
    asyncHandler(async (req, res) => {
      const hargaJual = Number(req.body?.hargaJual);
      if (!Number.isFinite(hargaJual) || hargaJual < 0) {
        res.status(400).json({ error: "Body 'hargaJual' wajib angka >= 0" });
        return;
      }
      const user = getAuthUser(req);
      await withTransaction((client) => setMenuHargaJual(client, req.params.kode, hargaJual, user.id));
      res.json({ kode: req.params.kode, hargaJual });
    }),
  );

  router.patch(
    "/menu/:kode/harga-channel",
    requirePermission("harga_jual.edit"),
    asyncHandler(async (req, res) => {
      const channel = typeof req.body?.channel === "string" ? req.body.channel : "";
      const hargaJual = Number(req.body?.hargaJual);
      if (!channel) {
        res.status(400).json({ error: "Body 'channel' wajib diisi" });
        return;
      }
      if (!Number.isFinite(hargaJual) || hargaJual < 0) {
        res.status(400).json({ error: "Body 'hargaJual' wajib angka >= 0" });
        return;
      }
      const user = getAuthUser(req);
      await withTransaction((client) =>
        upsertHargaChannel(client, { menuKode: req.params.kode, channel, hargaJual, userId: user.id }),
      );
      res.json({ kode: req.params.kode, channel, hargaJual });
    }),
  );

  // Visibilitas per channel pakai permission SENDIRI (menu_visibilitas.edit,
  // OWNER SAJA) -- bukan numpang harga_jual.edit maupun master_menu.edit.
  // Diminta owner eksplisit: menayangkan/menyembunyikan menu di marketplace
  // itu keputusan komersial yang lingkupnya lebih sempit daripada
  // master_menu.edit (yang juga dipegang manajer_ops).
  router.patch(
    "/menu/:kode/channel/:channel/visibilitas",
    requirePermission("menu_visibilitas.edit"),
    asyncHandler(async (req, res) => {
      const aktif = req.body?.aktif;
      if (typeof aktif !== "boolean") {
        res.status(400).json({ error: "Body 'aktif' wajib boolean (true = tayang, false = sembunyikan)" });
        return;
      }
      const user = getAuthUser(req);
      const { kode, channel } = req.params;
      await withTransaction((client) => setVisibilitasChannel(client, kode, channel, aktif, user.id));
      res.json({ kode, channel, aktif });
    }),
  );

  // --- Stok --------------------------------------------------------------

  router.get(
    "/stok",
    requirePermission("stok.lihat", {
      extractLocationIds: (req) => {
        const id = Number(req.query.location);
        return Number.isFinite(id) ? [id] : [];
      },
    }),
    asyncHandler(async (req, res) => {
      const itemKode = String(req.query.item ?? "");
      const locationId = Number(req.query.location);
      if (!itemKode || !Number.isFinite(locationId)) {
        res.status(400).json({ error: "Query param 'item' (kode) dan 'location' (id) wajib diisi" });
        return;
      }
      const client = await pool.connect();
      try {
        const { rows } = await client.query<{ id: number }>(`SELECT id FROM inventory_items WHERE kode = $1`, [
          itemKode,
        ]);
        if (!rows[0]) {
          res.status(404).json({ error: `Item dengan kode "${itemKode}" tidak ditemukan` });
          return;
        }
        const qty = await getCurrentStock(client, rows[0].id, locationId);
        res.json({ itemKode, locationId, qty });
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/transaksi/pembelian",
    requirePermission("pembelian.create", { extractLocationIds: locationIdFromBody }),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) =>
        createPembelian(client, { ...req.body, createdByUserId: user.id }),
      );
      res.status(201).json(result);
    }),
  );

  router.post(
    "/transaksi/produksi",
    requirePermission("produksi.create", { extractLocationIds: locationIdFromBody }),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) =>
        createProduksi(client, { ...req.body, createdByUserId: user.id }),
      );
      res.status(201).json(result);
    }),
  );

  router.post(
    "/transaksi/penjualan",
    requirePermission("penjualan.create", { extractLocationIds: locationIdFromBody }),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) =>
        createPenjualan(client, { ...req.body, createdByUserId: user.id }),
      );
      res.status(201).json(result);
    }),
  );

  // --- Transfer (2 tahap: kirim -> terima) --------------------------------

  router.post(
    "/transaksi/transfer",
    requirePermission("transfer.kirim", { extractLocationIds: (req) => [Number(req.body?.locationAsalId)] }),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) =>
        createTransferKirim(client, { ...req.body, createdByUserId: user.id }),
      );
      res.status(201).json(result);
    }),
  );

  router.post(
    "/transaksi/transfer/:id/terima",
    requirePermission("transfer.terima"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const transferId = Number(req.params.id);

      // Lingkup lokasi untuk "terima" ditentukan oleh location_tujuan_id
      // transfer yang SUDAH ADA di database, bukan dari body request (body
      // cuma berisi qty diterima) -- jadi dicek manual di sini, bukan lewat
      // extractLocationIds generik (yang cuma baca body/query, tidak query DB).
      if (!user.allLocations) {
        const client = await pool.connect();
        try {
          const { rows } = await client.query<{ location_tujuan_id: number }>(
            `SELECT location_tujuan_id FROM inventory_transaksi_transfer WHERE id = $1`,
            [transferId],
          );
          if (!rows[0]) {
            res.status(404).json({ error: `Transfer id ${transferId} tidak ditemukan` });
            return;
          }
          if (!user.locationIds.includes(rows[0].location_tujuan_id)) {
            res.status(403).json({
              error: `Role "${user.role}" cuma boleh menerima transfer yang tujuannya lokasi sendiri`,
            });
            return;
          }
        } finally {
          client.release();
        }
      }

      const result = await withTransaction((client) =>
        createTransferTerima(client, { transferId, baris: req.body?.baris ?? [], receivedByUserId: user.id }),
      );
      res.json(result);
    }),
  );

  router.get(
    "/transaksi/transfer/dalam-perjalanan",
    requirePermission("stok.lihat", {
      extractLocationIds: (req) => {
        const ids: number[] = [];
        const asal = Number(req.query.locationAsal);
        const tujuan = Number(req.query.locationTujuan);
        if (Number.isFinite(asal)) ids.push(asal);
        if (Number.isFinite(tujuan)) ids.push(tujuan);
        return ids;
      },
    }),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        const asal = Number(req.query.locationAsal);
        const tujuan = Number(req.query.locationTujuan);
        const rows = await getDalamPerjalanan(client, {
          locationAsalId: Number.isFinite(asal) ? asal : undefined,
          locationTujuanId: Number.isFinite(tujuan) ? tujuan : undefined,
        });
        res.json(rows);
      } finally {
        client.release();
      }
    }),
  );

  // --- Permintaan transfer (tahap sebelum transfer kirim) ----------------
  // Outlet mengajukan permintaan ke CK; CK memenuhinya lewat
  // POST /transaksi/transfer yang sudah ada (body {..., permintaanId}) --
  // lihat domain/permintaan-transfer.ts & createTransferKirim di stok.ts.

  const PERMINTAAN_STATUSES = new Set(["diminta", "dipenuhi", "dibatalkan"]);

  router.post(
    "/transaksi/permintaan-transfer",
    // Staf BOLEH mengajukan (cuma mengajukan, tidak memindahkan stok) --
    // beda dari transfer.kirim yang staf tidak boleh sama sekali.
    requirePermission("permintaan_transfer.create", {
      extractLocationIds: (req) => {
        const id = Number(req.body?.locationTujuanId);
        return Number.isFinite(id) ? [id] : [];
      },
    }),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) =>
        createPermintaanTransfer(client, { ...req.body, createdByUserId: user.id }),
      );
      res.status(201).json(result);
    }),
  );

  router.get(
    "/transaksi/permintaan-transfer",
    requirePermission("permintaan_transfer.lihat", {
      extractLocationIds: (req) => {
        const id = Number(req.query.lokasi);
        return Number.isFinite(id) ? [id] : [];
      },
    }),
    asyncHandler(async (req, res) => {
      const statusParam = req.query.status;
      if (statusParam !== undefined && !PERMINTAAN_STATUSES.has(String(statusParam))) {
        res
          .status(400)
          .json({ error: `Query param 'status' harus salah satu dari: ${[...PERMINTAAN_STATUSES].join(", ")}` });
        return;
      }
      const locationParam = Number(req.query.lokasi);
      const client = await pool.connect();
      try {
        const rows = await listPermintaanTransfer(client, {
          locationId: Number.isFinite(locationParam) ? locationParam : undefined,
          status: statusParam as PermintaanTransferStatus | undefined,
        });
        res.json(rows);
      } finally {
        client.release();
      }
    }),
  );

  router.patch(
    "/transaksi/permintaan-transfer/:id/batalkan",
    requirePermission("permintaan_transfer.create"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const id = Number(req.params.id);

      // Lingkup lokasi untuk supervisor/staf dicek terhadap location_tujuan_id
      // permintaan yang SUDAH ADA di database (body/query cuma berisi :id) --
      // pola manual sama seperti POST /transaksi/transfer/:id/terima.
      if (!user.allLocations) {
        const client = await pool.connect();
        try {
          const { rows } = await client.query<{ location_tujuan_id: number }>(
            `SELECT location_tujuan_id FROM inventory_permintaan_transfer WHERE id = $1`,
            [id],
          );
          if (!rows[0]) {
            res.status(404).json({ error: `Permintaan transfer id ${id} tidak ditemukan` });
            return;
          }
          if (!user.locationIds.includes(rows[0].location_tujuan_id)) {
            res.status(403).json({
              error: `Role "${user.role}" cuma boleh membatalkan permintaan yang diajukan lokasi sendiri`,
            });
            return;
          }
        } finally {
          client.release();
        }
      }

      const result = await withTransaction((client) => batalkanPermintaan(client, { id, userId: user.id }));
      res.json(result);
    }),
  );

  // --- Laporan harian ------------------------------------------------------

  router.get(
    "/laporan/harian",
    requirePermission("laporan_harian.lihat", {
      extractLocationIds: (req) => {
        const id = Number(req.query.lokasi);
        return Number.isFinite(id) ? [id] : [];
      },
    }),
    asyncHandler(async (req, res) => {
      const locationId = Number(req.query.lokasi);
      const tanggal = req.query.tanggal;
      if (!Number.isFinite(locationId) || typeof tanggal !== "string" || !tanggal) {
        res.status(400).json({ error: "Query param 'lokasi' (id) dan 'tanggal' wajib diisi" });
        return;
      }
      const client = await pool.connect();
      try {
        const result = await getLaporanHarian(client, { locationId, tanggal });
        res.json(result);
      } finally {
        client.release();
      }
    }),
  );

  // --- Detail transaksi penjualan (per baris) -----------------------------
  // Permission DIPAKAI ULANG dari GET /laporan/harian (laporan_harian.lihat):
  // sama-sama "lihat laporan penjualan", yang beda cuma bentuk tampilannya
  // (detail per baris vs ringkasan harian) -- bukan kategori akses baru, jadi
  // tidak dibuat action sendiri. locationScope-nya ikut sama (supervisor
  // 'own', staf tidak boleh sama sekali).
  //
  // extractLocationIds di sini CUMA menolak ?lokasi= di luar wewenang role;
  // pembatasan "walau ?lokasi= tidak dikirim" ditegakkan di domain layer
  // (getDetailTransaksiPenjualan menerima `user`) -- lihat doc fungsinya.

  router.get(
    "/transaksi/penjualan",
    requirePermission("laporan_harian.lihat", {
      extractLocationIds: (req) => {
        const id = Number(req.query.lokasi);
        return Number.isFinite(id) ? [id] : [];
      },
    }),
    asyncHandler(async (req, res) => {
      const tanggalMulai = optionalTanggal(req.query.tanggal_mulai);
      const tanggalSelesai = optionalTanggal(req.query.tanggal_selesai);
      if (tanggalMulai === INVALID_TANGGAL || tanggalSelesai === INVALID_TANGGAL) {
        res.status(400).json({ error: "Query param 'tanggal_mulai'/'tanggal_selesai' harus format YYYY-MM-DD" });
        return;
      }
      const lokasiId = Number(req.query.lokasi);
      const client = await pool.connect();
      try {
        const user = getAuthUser(req);
        const rows = await getDetailTransaksiPenjualan(client, user, {
          tanggalMulai,
          tanggalSelesai,
          channel: optionalString(req.query.channel),
          kodeMenu: optionalString(req.query.kode_menu),
          lokasiId: Number.isFinite(lokasiId) ? lokasiId : undefined,
        });
        res.json(rows);
      } finally {
        client.release();
      }
    }),
  );

  // --- Analitik (owner/manajer_ops saja) ----------------------------------
  // Permission SENDIRI (analitik.lihat) dengan daftar role paling sempit di
  // antara endpoint laporan: owner + manajer_ops SAJA, tanpa supervisor/staf
  // (diminta owner eksplisit) -- karena itu tidak numpang
  // laporan_harian.lihat yang juga dipegang supervisor.
  //
  // Konsekuensinya kedua role pemakai pasti `allLocations`, jadi TIDAK perlu
  // extractLocationIds maupun penegakan lingkup lokasi di domain layer
  // (beda dari GET /transaksi/penjualan di atas): ?lokasi= di sini murni
  // filter "persempit ke satu lokasi".
  //
  // Dua-duanya read-only murni (tidak menulis apa pun), jadi pakai
  // pool.connect() + release() di finally, bukan withTransaction.

  router.get(
    "/analitik/penjualan",
    requirePermission("analitik.lihat"),
    asyncHandler(async (req, res) => {
      const periode = optionalTanggal(req.query.periode);
      if (periode === INVALID_TANGGAL) {
        res.status(400).json({ error: "Query param 'periode' harus format YYYY-MM-DD" });
        return;
      }
      const lokasiId = Number(req.query.lokasi);
      const client = await pool.connect();
      try {
        const result = await getAnalitikPenjualan(client, {
          periode,
          lokasiId: Number.isFinite(lokasiId) ? lokasiId : undefined,
        });
        res.json(result);
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/analitik/operasional",
    requirePermission("analitik.lihat"),
    asyncHandler(async (req, res) => {
      const periode = optionalTanggal(req.query.periode);
      if (periode === INVALID_TANGGAL) {
        res.status(400).json({ error: "Query param 'periode' harus format YYYY-MM-DD" });
        return;
      }
      const lokasiId = Number(req.query.lokasi);
      const client = await pool.connect();
      try {
        const result = await getAnalitikOperasional(client, {
          periode,
          lokasiId: Number.isFinite(lokasiId) ? lokasiId : undefined,
        });
        res.json(result);
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/transaksi/mutasi-lain",
    requirePermission("mutasi_lain.create", { extractLocationIds: locationIdFromBody }),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      if (!req.body?.alasan) {
        res.status(400).json({ error: "Body 'alasan' wajib diisi" });
        return;
      }
      // `jenis` juga divalidasi di createMutasiLain (domain layer) -- dicek di
      // sini supaya jawabannya 400 dengan pesan jelas, bukan 500 dari error
      // domain yang tidak dipetakan (pola sama dengan 'alasan' di atas).
      if (!req.body?.jenis || !JENIS_MUTASI_LAIN_VALID.includes(req.body.jenis)) {
        res.status(400).json({
          error: `Body 'jenis' wajib diisi dan harus salah satu dari: ${JENIS_MUTASI_LAIN_VALID.join(", ")}`,
        });
        return;
      }
      const result = await withTransaction((client) =>
        createMutasiLain(client, { ...req.body, createdByUserId: user.id }),
      );
      res.status(201).json(result);
    }),
  );

  // --- Opname (2 tahap: input draft -> keputusan) -------------------------

  router.post(
    "/transaksi/opname",
    requirePermission("opname.input", { extractLocationIds: locationIdFromBody }),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) =>
        createOpname(client, { ...req.body, createdByUserId: user.id }),
      );
      res.status(201).json(result);
    }),
  );

  router.post(
    "/transaksi/opname/:id/keputusan",
    requirePermission("opname.approve"),
    asyncHandler(async (req, res) => {
      const decision = req.body?.decision;
      if (decision !== "setuju" && decision !== "tolak") {
        res.status(400).json({ error: "Body 'decision' wajib 'setuju' atau 'tolak'" });
        return;
      }
      const user = getAuthUser(req);
      const result = await withTransaction((client) =>
        decideOpname(client, { opnameId: Number(req.params.id), decision, decidedByUserId: user.id }),
      );
      res.json(result);
    }),
  );

  const OPNAME_STATUSES = new Set(["draft", "disetujui", "ditolak"]);

  router.get(
    "/transaksi/opname",
    // Sama seperti opname.approve (owner/manajer_ops) -- daftar ini dipakai
    // untuk antrian persetujuan, jadi izinnya disamakan, bukan pakai
    // stok.lihat yang juga bisa diakses supervisor/staf.
    requirePermission("opname.approve"),
    asyncHandler(async (req, res) => {
      const statusParam = req.query.status;
      if (statusParam !== undefined && !OPNAME_STATUSES.has(String(statusParam))) {
        res.status(400).json({ error: `Query param 'status' harus salah satu dari: ${[...OPNAME_STATUSES].join(", ")}` });
        return;
      }
      const locationParam = Number(req.query.location);
      const client = await pool.connect();
      try {
        const rows = await listOpname(client, {
          status: statusParam as "draft" | "disetujui" | "ditolak" | undefined,
          locationId: Number.isFinite(locationParam) ? locationParam : undefined,
        });
        res.json(rows);
      } finally {
        client.release();
      }
    }),
  );

  // --- Master item & resep produksi (owner/manajer_ops) -------------------

  // Keempat role manusia boleh akses (sama seperti /items/:kode/hpp dan
  // /menu/:kode/hpp) -- bukan cuma owner/manajer_ops -- karena dipakai juga
  // oleh ItemPicker di form transaksi (pembelian/produksi/opname) yang bisa
  // diisi supervisor. hargaMaster (field cost-sensitif) di-strip untuk role
  // tanpa permission hpp.lihat_harga, field lain (kode/nama/satuan/status)
  // bukan data harga jadi tetap tampil semua role.
  // Gate master_item.lihat: lihat alasan lengkapnya di blok komentar HPP di atas.
  router.get(
    "/items",
    requirePermission("master_item.lihat"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const client = await pool.connect();
      try {
        const items = await listItems(client);
        if (!hasPermission(user, "hpp.lihat_harga")) {
          res.json(items.map(({ hargaMaster, ...rest }) => rest));
          return;
        }
        res.json(items);
      } finally {
        client.release();
      }
    }),
  );

  // GET /menu: sama seperti GET /items & GET /items/:kode/hpp, GET /menu/:kode/hpp
  // di atas -- di-gate master_menu.lihat dengan populasi KEEMPAT role manusia,
  // karena halaman Menu & HPP (MenuHppPage.tsx) dipakai semua role itu, bukan
  // cuma owner/manajer_ops. Tidak ada field sensitif (harga/HPP) di response
  // list ini (cuma status pending/ok) jadi tidak perlu strip apa pun
  // berdasarkan permission hpp.lihat_harga.
  router.get(
    "/menu",
    requirePermission("master_menu.lihat"),
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        res.json(await listMenu(client));
      } finally {
        client.release();
      }
    }),
  );

  // POST /menu pakai permission SENDIRI (master_menu.edit), bukan numpang
  // master_item.edit: menu (produk jual) entitas master yang beda dari item
  // (bahan baku/packaging), dan permission di modul ini memang granular
  // per-entitas (master_item.edit, resep.edit, harga_jual.edit, dst).
  // Roles-nya sama dengan master_item.edit/resep.edit: owner & manajer_ops.
  router.post(
    "/menu",
    requirePermission("master_menu.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) => createMenu(client, req.body, user.id));
      res.status(201).json(result);
    }),
  );

  // Duplikat menu (header + baris resep) -- permission sama dengan POST /menu
  // (master_menu.edit): hasilnya memang "menu baru", cuma isinya disalin.
  router.post(
    "/menu/:kode/duplikat",
    requirePermission("master_menu.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) => duplicateMenu(client, req.params.kode, req.body, user.id));
      res.status(201).json(result);
    }),
  );

  router.post(
    "/items",
    requirePermission("master_item.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) => createItem(client, req.body, user.id));
      res.status(201).json(result);
    }),
  );

  router.patch(
    "/items/:kode",
    requirePermission("master_item.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      await withTransaction((client) => updateItem(client, req.params.kode, req.body, user.id));
      res.json({ kode: req.params.kode });
    }),
  );

  router.patch(
    "/items/:kode/nonaktifkan",
    requirePermission("master_item.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      await withTransaction((client) => deactivateItem(client, req.params.kode, user.id));
      res.json({ kode: req.params.kode, isActive: false });
    }),
  );

  // --- Min stok per lokasi (reorder alert) -------------------------------
  // PUT (upsert ambang batas) dibatasi owner/manajer_ops lewat master_item.edit
  // -- tidak ada locationScope: kedua role ini allLocations=true, sama seperti
  // endpoint master_item.edit lainnya.
  // GET (lihat ambang batas) pakai permission TERPISAH min_stok.lihat, dibuka
  // untuk semua role login -- StokPage.tsx memanggil GET /min-stok untuk SEMUA
  // role begitu filter lokasi dipilih (hitung status menipis/habis via
  // computeStatus), bukan cuma owner/manajer_ops. Pola view-vs-edit yang sama
  // dipakai di GET /resep-produksi vs POST /resep-produksi.

  router.put(
    "/min-stok",
    requirePermission("master_item.edit"),
    asyncHandler(async (req, res) => {
      const itemKode = String(req.body?.itemKode ?? "");
      const locationId = Number(req.body?.locationId);
      const minStok = Number(req.body?.minStok);
      if (!itemKode || !Number.isFinite(locationId)) {
        res.status(400).json({ error: "Body 'itemKode' dan 'locationId' wajib diisi" });
        return;
      }
      const user = getAuthUser(req);
      const result = await withTransaction((client) =>
        upsertMinStok(client, { itemKode, locationId, minStok, userId: user.id }),
      );
      res.json(result);
    }),
  );

  router.get(
    "/min-stok",
    requirePermission("min_stok.lihat"),
    asyncHandler(async (req, res) => {
      const locationId = Number(req.query.location);
      if (!Number.isFinite(locationId)) {
        res.status(400).json({ error: "Query param 'location' (id) wajib diisi" });
        return;
      }
      const client = await pool.connect();
      try {
        res.json(await listMinStokByLocation(client, locationId));
      } finally {
        client.release();
      }
    }),
  );

  // --- Master kategori & satuan (dropdown form item, owner/manajer_ops) ---

  router.get(
    "/kategori",
    requirePermission("master_item.edit"),
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        res.json(await listKategori(client));
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/kategori",
    requirePermission("master_item.edit"),
    asyncHandler(async (req, res) => {
      const name = String(req.body?.name ?? "").trim();
      if (!name) {
        res.status(400).json({ error: "Body 'name' wajib diisi" });
        return;
      }
      const user = getAuthUser(req);
      const result = await withTransaction((client) => createKategori(client, name, user.id));
      res.status(201).json(result);
    }),
  );

  router.patch(
    "/kategori/:id",
    requirePermission("master_item.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      await withTransaction((client) => updateKategori(client, Number(req.params.id), req.body, user.id));
      res.json({ id: Number(req.params.id) });
    }),
  );

  router.get(
    "/satuan",
    requirePermission("master_item.edit"),
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        res.json(await listSatuan(client));
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/satuan",
    requirePermission("master_item.edit"),
    asyncHandler(async (req, res) => {
      const name = String(req.body?.name ?? "").trim();
      if (!name) {
        res.status(400).json({ error: "Body 'name' wajib diisi" });
        return;
      }
      const user = getAuthUser(req);
      const result = await withTransaction((client) => createSatuan(client, name, user.id));
      res.status(201).json(result);
    }),
  );

  router.patch(
    "/satuan/:id",
    requirePermission("master_item.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      await withTransaction((client) => updateSatuan(client, Number(req.params.id), req.body, user.id));
      res.json({ id: Number(req.params.id) });
    }),
  );

  // --- Master kategori MENU (dropdown form menu) --------------------------
  // Permission DIPAKAI ULANG dari POST /menu (master_menu.edit, owner +
  // manajer_ops) -- kategori menu bagian dari pengelolaan katalog menu, bukan
  // kategori akses baru, jadi tidak dibuat action sendiri. Beda dari
  // /kategori & /satuan di atas yang pakai master_item.edit karena itu
  // referensi untuk ITEM.

  router.get(
    "/kategori-menu",
    requirePermission("master_menu.edit"),
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        res.json(await listKategoriMenu(client));
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/kategori-menu",
    requirePermission("master_menu.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) => createKategoriMenu(client, req.body, user.id));
      res.status(201).json(result);
    }),
  );

  router.patch(
    "/kategori-menu/:id",
    requirePermission("master_menu.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      await withTransaction((client) => updateKategoriMenu(client, Number(req.params.id), req.body, user.id));
      res.json({ id: Number(req.params.id) });
    }),
  );

  // GET /resep-produksi (list): sama seperti GET /items & GET /menu di atas
  // -- di-gate resep_produksi.lihat dengan populasi KEEMPAT role manusia.
  // Dipakai bukan cuma ResepProduksiTab.tsx (halaman Master,
  // owner/manajer_ops saja via tombol edit yang masih di-gate resep.edit),
  // tapi juga ProduksiForm.tsx (form transaksi Produksi, dipakai juga oleh
  // supervisor -- lihat permission POST /transaksi/produksi di module.json).
  // Response list ini (kode, outputItemKode, outputItemName, yieldQty,
  // yieldUnit, isActive) tidak mengandung data harga/cost, cuma identitas
  // resep + yield, sama levelnya dengan GET /items & GET /menu. Detail baris
  // bahan (GET /resep-produksi/:kode) TETAP di-gate resep.edit karena berisi
  // komposisi bahan+qty yang lebih sensitif/proprietary.
  router.get(
    "/resep-produksi",
    requirePermission("resep_produksi.lihat"),
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        res.json(await listResepProduksi(client));
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/resep-produksi/:kode",
    requirePermission("resep.edit"),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        res.json(await getResepProduksiBaris(client, req.params.kode));
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/resep-produksi",
    requirePermission("resep.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const result = await withTransaction((client) => createResepProduksi(client, req.body, user.id));
      res.status(201).json(result);
    }),
  );

  router.patch(
    "/resep-produksi/:kode",
    requirePermission("resep.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      await withTransaction((client) => updateResepProduksi(client, req.params.kode, req.body, user.id));
      res.json({ kode: req.params.kode });
    }),
  );

  router.patch(
    "/resep-produksi/:kode/nonaktifkan",
    requirePermission("resep.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      await withTransaction((client) => deactivateResepProduksi(client, req.params.kode, user.id));
      res.json({ kode: req.params.kode, isActive: false });
    }),
  );

  router.get(
    "/menu/:kode/resep",
    requirePermission("resep.edit"),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        res.json(await getMenuResep(client, req.params.kode));
      } finally {
        client.release();
      }
    }),
  );

  router.patch(
    "/menu/:kode/resep",
    requirePermission("resep.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      await withTransaction((client) => updateMenuResep(client, req.params.kode, req.body?.baris ?? [], user.id));
      res.json({ kode: req.params.kode });
    }),
  );

  router.patch(
    "/menu/:kode/nonaktifkan",
    requirePermission("resep.edit"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      await withTransaction((client) => deactivateMenu(client, req.params.kode, user.id));
      res.json({ kode: req.params.kode, isActive: false });
    }),
  );

  // --- Pengaturan (owner saja) --------------------------------------------

  router.get(
    "/pengaturan/hpp-metode",
    requirePermission("pengaturan.manage"),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        res.json({ metode: await getHppDefaultMethod(client) });
      } finally {
        client.release();
      }
    }),
  );

  router.patch(
    "/pengaturan/hpp-metode",
    requirePermission("pengaturan.manage"),
    asyncHandler(async (req, res) => {
      const metode = req.body?.metode;
      if (metode !== "harga_master" && metode !== "harga_beli_terakhir") {
        res.status(400).json({ error: "Body 'metode' wajib 'harga_master' atau 'harga_beli_terakhir'" });
        return;
      }
      await withTransaction((client) => setHppDefaultMethod(client, metode));
      res.json({ metode });
    }),
  );

  router.get(
    "/pengaturan/target-food-cost",
    requirePermission("pengaturan.manage"),
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        res.json({ targetFoodCostPersen: await getTargetFoodCostPersen(client) });
      } finally {
        client.release();
      }
    }),
  );

  router.patch(
    "/pengaturan/target-food-cost",
    requirePermission("pengaturan.manage"),
    asyncHandler(async (req, res) => {
      const targetFoodCostPersen = Number(req.body?.targetFoodCostPersen);
      await withTransaction((client) => setTargetFoodCostPersen(client, targetFoodCostPersen));
      res.json({ targetFoodCostPersen });
    }),
  );

  router.post(
    "/lokasi",
    requirePermission("pengaturan.manage"),
    asyncHandler(async (req, res) => {
      const result = await withTransaction((client) => createLokasi(client, req.body));
      res.status(201).json(result);
    }),
  );

  router.patch(
    "/lokasi/:id",
    requirePermission("pengaturan.manage"),
    asyncHandler(async (req, res) => {
      await withTransaction((client) => updateLokasi(client, Number(req.params.id), req.body));
      res.json({ id: Number(req.params.id) });
    }),
  );

  router.post(
    "/channel",
    requirePermission("pengaturan.manage"),
    asyncHandler(async (req, res) => {
      const result = await withTransaction((client) => createChannel(client, req.body?.name));
      res.status(201).json(result);
    }),
  );

  router.patch(
    "/channel/:id",
    requirePermission("pengaturan.manage"),
    asyncHandler(async (req, res) => {
      await withTransaction((client) => updateChannel(client, Number(req.params.id), req.body));
      res.json({ id: Number(req.params.id) });
    }),
  );

  // Error handler khusus router ini: error bisnis dari domain layer (Error
  // biasa, bukan bug tak terduga) dipetakan ke status HTTP yang wajar --
  // "tidak ditemukan" -> 404, validasi lain (konversi kosong, baris kosong,
  // dll) -> 400. Bukan 500, supaya jelas ini kesalahan input/data, bukan
  // bug server.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan";
    const status = /tidak ditemukan/i.test(message) ? 404 : 400;
    res.status(status).json({ error: message });
  });

  return router;
}
