import "./env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { pool, buildRegistry, buildServer, hashPassword, hashPin } from "@samsara/core";
import { modules } from "./modules.js";

/**
 * Tahap 1B "Tutup kebocoran field biaya" -- test PERMANEN yang memindai
 * respons SETIAP endpoint di daftar di bawah, per role, mencari field
 * terkait biaya yang HARUS sudah di-strip untuk supervisor/staf (lihat
 * `hasPermission(user, "hpp.lihat_harga")` di `modules/inventory/src/api/router.ts`).
 *
 * Daftar endpoint ini DITULIS MANUAL (repo belum punya infra auto-discover
 * endpoint dari module.json untuk keperluan test, lihat riset Tahap 1) --
 * TAMBAHKAN BARIS BARU DI SINI kalau ada endpoint baru yang mengembalikan
 * data biaya, supaya cakupan permanen ini tidak basi.
 */

const PORT_SHIM_TIDAK_DIPAKAI = true; // dokumentasi: file ini TIDAK memanggil adaJadwalKeDepanViaApi, jadi tidak perlu *-test-port.ts shim.
void PORT_SHIM_TIDAK_DIPAKAI;

let server: Server;
let baseUrl: string;

const testUserIds: number[] = [];
const transferHeaderIds: number[] = [];
const pembelianHeaderIds: number[] = [];
const penjualanHeaderIds: number[] = [];

let ownerToken: string;
let supervisorToken: string;
let stafToken: string;
let kitchenId: number;
let outletId: number;
let vendorUmumId: number;
let menuM001Id: number;
let itemBB001Id: number;

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<T>(sql, params);
    return rows;
  } finally {
    client.release();
  }
}

async function getJson(path: string, token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

async function postJson(path: string, body: unknown, token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Nama field (lowercase) yang HARUS TIDAK PERNAH muncul di respons untuk role tanpa `hpp.lihat_harga`.
 * Exact-match (bukan substring) -- supaya "hargaJual" (harga JUAL, sengaja tetap tampil) tidak ikut tertangkap. */
const FIELD_BIAYA_TERLARANG = new Set([
  "hpp",
  "hppsaattransaksi",
  "hppsumber",
  "hppperporsi",
  "hpp_per_porsi",
  "hargasatuan",
  "harga_satuan",
  "hargatransferpersatuan",
  "harga_transfer_per_satuan",
  "hargadasar",
  "harga_dasar",
  "hargalama",
  "harga_lama",
  "hargabaru",
  "harga_baru",
  "peringatanharga",
  "peringatan_harga",
  "nilai",
  "margin",
  "foodcostpct",
  "food_cost_pct",
  "cogs",
  "cost",
  "hargaterakhir",
  "harga_terakhir",
]);

function cariFieldBiaya(value: unknown, path = "$"): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => cariFieldBiaya(v, `${path}[${i}]`));
  }
  const hasil: string[] = [];
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (FIELD_BIAYA_TERLARANG.has(key.toLowerCase())) hasil.push(`${path}.${key}`);
    hasil.push(...cariFieldBiaya(val, `${path}.${key}`));
  }
  return hasil;
}

function assertNoCostFields(body: unknown, context: string): void {
  const found = cariFieldBiaya(body);
  assert.deepEqual(found, [], `${context}: field biaya bocor di: ${found.join(", ")}`);
}

before(async () => {
  const ordered = buildRegistry(modules);
  const enabled = ordered.filter((m) => m.manifest.enabled);
  const app = buildServer(ordered, enabled);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  const client = await pool.connect();
  try {
    const { rows: kitchenRows } = await client.query<{ id: number }>(
      `SELECT id FROM core_locations WHERE tipe = 'kitchen' AND is_active = true LIMIT 1`,
    );
    const { rows: outletRows } = await client.query<{ id: number }>(
      `SELECT id FROM core_locations WHERE tipe = 'outlet' AND is_active = true LIMIT 1`,
    );
    kitchenId = Number(kitchenRows[0].id);
    outletId = Number(outletRows[0].id);

    const { rows: vendorRows } = await client.query<{ id: number }>(
      `SELECT id FROM inventory_vendor WHERE name = 'Pembelian Umum (pasar/warung)'`,
    );
    vendorUmumId = Number(vendorRows[0].id);

    const { rows: menuRows } = await client.query<{ id: number }>(`SELECT id FROM inventory_menu WHERE kode = 'M-001'`);
    menuM001Id = Number(menuRows[0].id);

    const { rows: itemRows } = await client.query<{ id: number }>(`SELECT id FROM inventory_items WHERE kode = 'BB-001'`);
    itemBB001Id = Number(itemRows[0].id);

    const { rows: ownerRole } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = 'owner'`);
    const { rows: supervisorRole } = await client.query<{ id: number }>(
      `SELECT id FROM core_roles WHERE name = 'supervisor'`,
    );
    const { rows: stafRole } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = 'staf'`);
    const passwordHash = await hashPassword("rahasia123");

    const ownerUsername = `test_costleak_owner_${Date.now()}`;
    const { rows: ownerRows } = await client.query<{ id: number }>(
      `INSERT INTO core_users (username, name, password_hash, role_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [ownerUsername, passwordHash, ownerRole[0].id],
    );
    testUserIds.push(Number(ownerRows[0].id));

    // Supervisor ditetapkan ke KEDUA lokasi (kitchen + outlet) supaya tidak
    // ketolak scope lokasi ("own") -- fokus test ini adalah field biaya,
    // bukan scope lokasi (sudah ditest terpisah di tempat lain).
    const supervisorUsername = `test_costleak_sup_${Date.now()}`;
    const { rows: supervisorRows } = await client.query<{ id: number }>(
      `INSERT INTO core_users (username, name, password_hash, role_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [supervisorUsername, passwordHash, supervisorRole[0].id],
    );
    const supervisorUserId = Number(supervisorRows[0].id);
    testUserIds.push(supervisorUserId);
    await client.query(`INSERT INTO core_user_lokasi (user_id, location_id) VALUES ($1, $2), ($1, $3)`, [
      supervisorUserId,
      kitchenId,
      outletId,
    ]);

    const pinHash = await hashPin("123456");
    const stafUsername = `test_costleak_staf_${Date.now()}`;
    const { rows: stafRows } = await client.query<{ id: number }>(
      `INSERT INTO core_users (username, name, pin_hash, role_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [stafUsername, pinHash, stafRole[0].id],
    );
    testUserIds.push(Number(stafRows[0].id));

    const loginOwner = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: ownerUsername, password: "rahasia123" }),
    });
    ownerToken = ((await loginOwner.json()) as { token: string }).token;

    const loginSupervisor = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: supervisorUsername, password: "rahasia123" }),
    });
    supervisorToken = ((await loginSupervisor.json()) as { token: string }).token;

    const loginStaf = await fetch(`${baseUrl}/api/auth/login-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: Number(stafRows[0].id), pin: "123456" }),
    });
    stafToken = ((await loginStaf.json()) as { token: string }).token;
  } finally {
    client.release();
  }
});

after(async () => {
  try {
    const client = await pool.connect();
    try {
      for (const id of penjualanHeaderIds) {
        await client.query(`DELETE FROM inventory_transaksi_penjualan WHERE id = $1`, [id]);
      }
      for (const id of pembelianHeaderIds) {
        await client.query(`DELETE FROM inventory_transaksi_pembelian WHERE id = $1`, [id]);
      }
      for (const id of transferHeaderIds) {
        await client.query(`DELETE FROM inventory_transaksi_transfer WHERE id = $1`, [id]);
      }
      await client.query(`DELETE FROM core_user_lokasi WHERE user_id = ANY($1::bigint[])`, [testUserIds]);
      await client.query(`DELETE FROM core_login_attempts WHERE user_id = ANY($1::bigint[])`, [testUserIds]);
      await client.query(`DELETE FROM core_users WHERE id = ANY($1::bigint[])`, [testUserIds]);
    } finally {
      client.release();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------
// 1. GET /menu/:kode/rekomendasi-harga
// ---------------------------------------------------------------------------

test("GET /menu/:kode/rekomendasi-harga: hppPerPorsi/hargaDasar bocor ke supervisor DAN staf, tetap tampil untuk owner", async () => {
  const owner = await getJson(`/api/inventory/menu/M-001/rekomendasi-harga`, ownerToken);
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  assert.ok("hppPerPorsi" in (owner.body as object), "owner HARUS tetap melihat hppPerPorsi (kontrol positif)");

  const supervisor = await getJson(`/api/inventory/menu/M-001/rekomendasi-harga`, supervisorToken);
  assert.equal(supervisor.status, 200);
  assertNoCostFields(supervisor.body, "rekomendasi-harga (supervisor)");
  assert.ok(
    "rekomendasi" in (supervisor.body as object),
    "rekomendasi (harga JUAL per channel) HARUS tetap tampil untuk supervisor",
  );

  const staf = await getJson(`/api/inventory/menu/M-001/rekomendasi-harga`, stafToken);
  assert.equal(staf.status, 200);
  assertNoCostFields(staf.body, "rekomendasi-harga (staf)");
});

// ---------------------------------------------------------------------------
// 2. GET /transaksi/transfer/dalam-perjalanan
// ---------------------------------------------------------------------------

test("GET /transaksi/transfer/dalam-perjalanan: hargaTransferPerSatuan/nilai bocor ke supervisor DAN staf, tetap tampil untuk owner", async () => {
  const client = await pool.connect();
  let headerId: number;
  try {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO inventory_transaksi_transfer (location_asal_id, location_tujuan_id, tanggal, status)
       VALUES ($1, $2, CURRENT_DATE, 'dikirim') RETURNING id`,
      [kitchenId, outletId],
    );
    headerId = Number(rows[0].id);
    transferHeaderIds.push(headerId);
    await client.query(
      `INSERT INTO inventory_transaksi_transfer_baris (header_id, item_id, qty_kirim, unit, harga_transfer_per_satuan)
       VALUES ($1, $2, 10, 'gr', 3.35)`,
      [headerId, itemBB001Id],
    );
  } finally {
    client.release();
  }

  const owner = await getJson(`/api/inventory/transaksi/transfer/dalam-perjalanan`, ownerToken);
  assert.equal(owner.status, 200);
  const ownerRow = (owner.body as Array<Record<string, unknown>>).find((r) => Number(r.transferId) === headerId);
  assert.ok(ownerRow && "hargaTransferPerSatuan" in ownerRow, "owner HARUS tetap melihat hargaTransferPerSatuan");

  const supervisor = await getJson(`/api/inventory/transaksi/transfer/dalam-perjalanan`, supervisorToken);
  assert.equal(supervisor.status, 200);
  assertNoCostFields(supervisor.body, "dalam-perjalanan (supervisor)");

  const staf = await getJson(`/api/inventory/transaksi/transfer/dalam-perjalanan`, stafToken);
  assert.equal(staf.status, 200);
  assertNoCostFields(staf.body, "dalam-perjalanan (staf)");
});

// ---------------------------------------------------------------------------
// 3. GET /laporan/harian
// ---------------------------------------------------------------------------

test("GET /laporan/harian: hargaSatuan baris 'masuk' bocor ke supervisor, tetap tampil untuk owner", async () => {
  const tanggal = await query<{ t: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS t`).then((r) => r[0].t);
  const client = await pool.connect();
  let headerId: number;
  try {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO inventory_transaksi_pembelian (location_id, vendor_id, tanggal) VALUES ($1, $2, $3) RETURNING id`,
      [outletId, vendorUmumId, tanggal],
    );
    headerId = Number(rows[0].id);
    pembelianHeaderIds.push(headerId);
    await client.query(
      `INSERT INTO inventory_transaksi_pembelian_baris (header_id, item_id, qty_beli, satuan_beli, harga_satuan, qty_recipe_unit)
       VALUES ($1, $2, 1, 'kg', 3350, 1000)`,
      [headerId, itemBB001Id],
    );
  } finally {
    client.release();
  }

  const owner = await getJson(`/api/inventory/laporan/harian?lokasi=${outletId}&tanggal=${tanggal}`, ownerToken);
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  const ownerMasuk = (owner.body as { masuk: Array<Record<string, unknown>> }).masuk;
  assert.ok(ownerMasuk.some((m) => "hargaSatuan" in m), "owner HARUS tetap melihat hargaSatuan");

  const supervisor = await getJson(`/api/inventory/laporan/harian?lokasi=${outletId}&tanggal=${tanggal}`, supervisorToken);
  assert.equal(supervisor.status, 200);
  assertNoCostFields(supervisor.body, "laporan/harian (supervisor)");
});

// ---------------------------------------------------------------------------
// 4. GET /transaksi/penjualan (Riwayat Transaksi -- leak utama)
// ---------------------------------------------------------------------------

test("GET /transaksi/penjualan: hppSaatTransaksi/hppSumber bocor ke supervisor, tetap tampil untuk owner", async () => {
  const tanggal = await query<{ t: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS t`).then((r) => r[0].t);
  const client = await pool.connect();
  let headerId: number;
  try {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO inventory_transaksi_penjualan (location_id, sumber, tanggal) VALUES ($1, 'Offline', $2) RETURNING id`,
      [outletId, tanggal],
    );
    headerId = Number(rows[0].id);
    penjualanHeaderIds.push(headerId);
    await client.query(
      `INSERT INTO inventory_transaksi_penjualan_baris (header_id, menu_id, qty, hpp_saat_transaksi, hpp_sumber)
       VALUES ($1, $2, 1, 12000, 'snapshot_asli')`,
      [headerId, menuM001Id],
    );
  } finally {
    client.release();
  }

  const owner = await getJson(
    `/api/inventory/transaksi/penjualan?lokasi=${outletId}&tanggal_mulai=${tanggal}&tanggal_selesai=${tanggal}`,
    ownerToken,
  );
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  const ownerRows = (owner.body as { rows: Array<Record<string, unknown>> }).rows;
  assert.ok(ownerRows.some((r) => "hppSaatTransaksi" in r), "owner HARUS tetap melihat hppSaatTransaksi");

  const supervisor = await getJson(
    `/api/inventory/transaksi/penjualan?lokasi=${outletId}&tanggal_mulai=${tanggal}&tanggal_selesai=${tanggal}`,
    supervisorToken,
  );
  assert.equal(supervisor.status, 200, JSON.stringify(supervisor.body));
  assertNoCostFields(supervisor.body, "transaksi/penjualan (supervisor)");
});

// ---------------------------------------------------------------------------
// 5. POST /transaksi/transfer
// ---------------------------------------------------------------------------

test("POST /transaksi/transfer: hargaTransferPerSatuan per baris bocor ke supervisor, tetap tampil untuk owner", async () => {
  const tanggal = await query<{ t: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS t`).then((r) => r[0].t);
  const body = {
    locationAsalId: kitchenId,
    locationTujuanId: outletId,
    tanggal,
    baris: [{ itemKode: "BB-001", qtyKirim: 1, unit: "gr" }],
  };

  const owner = await postJson(`/api/inventory/transaksi/transfer`, body, ownerToken);
  assert.equal(owner.status, 201, JSON.stringify(owner.body));
  transferHeaderIds.push(Number((owner.body as { headerId: number }).headerId));
  assert.ok(
    "hargaTransferPerSatuan" in (owner.body as { baris: Array<Record<string, unknown>> }).baris[0],
    "owner HARUS tetap melihat hargaTransferPerSatuan",
  );

  const supervisor = await postJson(`/api/inventory/transaksi/transfer`, body, supervisorToken);
  assert.equal(supervisor.status, 201, JSON.stringify(supervisor.body));
  transferHeaderIds.push(Number((supervisor.body as { headerId: number }).headerId));
  assertNoCostFields(supervisor.body, "POST transaksi/transfer (supervisor)");
});

// ---------------------------------------------------------------------------
// 6. POST /transaksi/pembelian
// ---------------------------------------------------------------------------

test("POST /transaksi/pembelian: peringatanHarga bocor ke supervisor, tetap tampil untuk owner", async () => {
  const tanggal = await query<{ t: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS t`).then((r) => r[0].t);
  const body = {
    locationId: outletId,
    vendorId: vendorUmumId,
    tanggal,
    baris: [{ itemKode: "BB-001", qtyBeli: 1, satuanBeli: "kg", hargaSatuan: 3350 }],
  };

  const owner = await postJson(`/api/inventory/transaksi/pembelian`, body, ownerToken);
  assert.equal(owner.status, 201, JSON.stringify(owner.body));
  pembelianHeaderIds.push(Number((owner.body as { headerId: number }).headerId));
  assert.ok("peringatanHarga" in (owner.body as object), "owner HARUS tetap melihat peringatanHarga (walau array kosong)");

  const supervisor = await postJson(`/api/inventory/transaksi/pembelian`, body, supervisorToken);
  assert.equal(supervisor.status, 201, JSON.stringify(supervisor.body));
  pembelianHeaderIds.push(Number((supervisor.body as { headerId: number }).headerId));
  assertNoCostFields(supervisor.body, "POST transaksi/pembelian (supervisor)");
});

// ---------------------------------------------------------------------------
// 7. GET /vendor/:id/item/:itemKode/harga-terakhir
// ---------------------------------------------------------------------------

test("GET /vendor/:id/item/:itemKode/harga-terakhir: hargaTerakhir bocor ke supervisor, tetap tampil untuk owner", async () => {
  const owner = await getJson(`/api/inventory/vendor/${vendorUmumId}/item/BB-001/harga-terakhir`, ownerToken);
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  assert.ok("hargaTerakhir" in (owner.body as object), "owner HARUS tetap melihat hargaTerakhir");

  const supervisor = await getJson(`/api/inventory/vendor/${vendorUmumId}/item/BB-001/harga-terakhir`, supervisorToken);
  assert.equal(supervisor.status, 200, JSON.stringify(supervisor.body));
  assertNoCostFields(supervisor.body, "harga-terakhir (supervisor)");
});
