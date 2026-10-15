import "./sales-sync-test-port.js"; // WAJIB baris import pertama, lihat komentar di filenya
import "./env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { pool, buildRegistry, buildServer, hashPassword } from "@samsara/core";
import { modules } from "./modules.js";

/**
 * Test alur POST /api/sales-sync/proses (arsip log penjualan -> transaksi
 * Penjualan Inventory) lewat server HTTP SUNGGUHAN.
 *
 * KENAPA BUKAN POLA `withRollback` seperti test domain layer di
 * modules/inventory/src/domain/*.test.ts dan modules/hr/src/domain/*.test.ts:
 * `prosesSinkronisasi` (modules/sales-sync/src/domain/proses.ts) SENGAJA
 * mengelola transaksinya sendiri (satu `pool.connect()` per order) dan
 * memanggil modul Inventory lewat HTTP sungguhan (`createPenjualanViaApi`),
 * yang di sisi server membuka DAN COMMIT transaksinya sendiri di koneksi pool
 * yang BERBEDA. Postgres tidak membagi visibilitas data antar transaksi yang
 * belum commit, jadi data fixture yang disiapkan di dalam satu transaksi
 * `withRollback` TIDAK AKAN TERLIHAT oleh panggilan HTTP itu -- alurnya secara
 * teknis tidak mungkin dibungkus satu transaksi yang di-rollback di akhir.
 *
 * Karena itu test ini mengikuti pola `apps/api/src/auth.test.ts` (yang punya
 * kendala sama: test lewat HTTP, bukan domain layer murni): server HTTP
 * sungguhan, COMMIT sungguhan ke database dev, dan PEMBERSIHAN EKSPLISIT lewat
 * `try/finally` di tiap test + hook `after()` di level suite.
 *
 * DATA UJI SENGAJA SINTETIS, bukan baris arsip yang sudah ada: 19.519 baris di
 * `salessync_log_penjualan` adalah data Burnas ASLI yang sengaja disimpan
 * (docs/architecture-decisions.md § 19.1) dan TIDAK BOLEH disentuh rutinitas
 * test. Semua baris buatan test ini memakai prefix `TEST-SS-` pada
 * `order_id`/`menu_id`/`unique_key` supaya gampang dilacak dan dibersihkan.
 * `platform` dan `kode_menu` tetap nilai NYATA ('Shopee' yang sudah ter-seed ke
 * channel 'ShopeeFood', dan menu 'M-001') supaya jalur kode yang diuji sama
 * persis dengan jalur produksi.
 *
 * TANGGAL ORDER SINTETIS SENGAJA DI TAHUN 2099: cek `tanggal < tanggalMulai` di
 * proses.ts dilakukan PALING AWAL untuk SEMUA order yang `inv_status='OK' AND
 * processed_at IS NULL` -- termasuk ~1300 order asli di arsip. Dengan
 * `tanggalMulai` 2099 (lihat TANGGAL_MULAI), seluruh order asli pasti masuk
 * jalur "dilewati sebelum tanggal mulai" yang TIDAK menyentuh stok dan TIDAK
 * menandai processed_at, apa pun status pemetaan itemnya saat ini. Jadi test
 * ini tidak pernah bisa memicu transaksi Penjualan dari data asli, bahkan kalau
 * nanti ada yang memetakan item-item asli itu.
 */

const PORT = 4319;
const PREFIX = "TEST-SS-";
/** Nilai platform NYATA yang sudah ter-seed di salessync_platform_channel_map -> 'ShopeeFood'. */
const PLATFORM = "Shopee";
const CHANNEL_INTERNAL = "ShopeeFood";
/** Menu Inventory nyata yang resepnya valid (bukan paket) -- dipakai sebagai target pemetaan. */
const KODE_MENU = "M-001";
const TANGGAL_MULAI = "2099-06-01";
const TANGGAL_SEBELUM_MULAI = "2020-01-01";
const TANGGAL_SESUDAH_MULAI = "2099-12-31";
/** Jam default baris log sintetis (nilai netral, tidak ikut diuji). */
const JAM_DEFAULT = "12:00:00";
/**
 * Jam order sintetis yang SENGAJA bukan jam bulat dan bukan JAM_DEFAULT:
 * dipakai untuk membuktikan `salessync_log_penjualan.transaction_time` diteruskan
 * APA ADANYA ke `inventory_transaksi_penjualan.jam` (bukan jam proses sync,
 * bukan nilai default, bukan "sekadar tidak NULL").
 */
const JAM_ORDER_SESUDAH = "19:47:23";

let server: Server;
let baseUrl: string;
let token: string;
let testUserId: number;

let defaultLocationId: number;
let namaMenu: string;
let menuId: number;
/** Baris resep menu KODE_MENU, dibaca dari DB (bukan ditebak) -- dasar perhitungan pengurangan stok. */
let resepMenu: Array<{ itemId: number; kode: string; qty: number }> = [];

// Baseline tabel yang disentuh test ini, dicatat di before() dan dibuktikan
// kembali ke angka yang sama di after().
let baselineLogTotal: number;
let baselineLogProcessed: number;
let baselineLedger: number;
let baselineAuditCreatedVia: number;

// ---------------------------------------------------------------------------
// Helper database
// ---------------------------------------------------------------------------

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<T>(sql, params);
    return rows;
  } finally {
    client.release();
  }
}

async function countOf(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await query<{ n: string }>(sql, params);
  return Number(rows[0].n);
}

/** Saldo stok item di lokasi tujuan sinkronisasi = SUM(qty_change) di ledger (stok tidak pernah disimpan sebagai angka). */
async function saldoLedger(itemId: number): Promise<number> {
  const rows = await query<{ total: string }>(
    `SELECT COALESCE(SUM(qty_change), 0)::text AS total
     FROM inventory_stock_ledger WHERE item_id = $1 AND location_id = $2`,
    [itemId, defaultLocationId],
  );
  return Number(rows[0].total);
}

/**
 * Satu baris arsip log penjualan sintetis. `item_type` 'menu' dan `inv_status`
 * 'OK' -- cuma baris OK yang pernah diproses /proses.
 *
 * `jam` opsional (default JAM_DEFAULT) -- diisi eksplisit di test yang
 * membuktikan `transaction_time` arsip sampai ke `inventory_transaksi_penjualan.jam`.
 */
async function insertBarisLog(input: {
  orderId: string;
  tanggal: string;
  jam?: string;
  itemName: string;
  menuIdEksternal: string;
  quantity: number;
}): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO salessync_log_penjualan
       (transaction_date, transaction_time, platform, order_id, item_name, menu_id, quantity,
        item_type, parent_item, unique_key, inv_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'menu', NULL, $8, 'OK')
     RETURNING id`,
    [
      input.tanggal,
      input.jam ?? JAM_DEFAULT,
      PLATFORM,
      input.orderId,
      input.itemName,
      input.menuIdEksternal,
      input.quantity,
      `${input.orderId}|${input.menuIdEksternal}`,
    ],
  );
  return rows[0].id;
}

/**
 * Hapus SEMUA jejak yang dibuat test ini (kecuali user fixture, dibereskan di
 * after()). Idempoten -- dipanggil di `finally` tiap test DAN di after().
 * Urutan penting: ledger & audit log direferensikan lewat reference_id/record_id
 * (bukan FK), jadi harus dihapus sebelum header transaksinya hilang.
 */
async function bersihkanArtefakTest(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows: headers } = await client.query<{ id: string }>(
      `SELECT id FROM inventory_transaksi_penjualan WHERE no_referensi LIKE $1`,
      [`${PREFIX}%`],
    );
    const headerIds = headers.map((r) => r.id);
    if (headerIds.length > 0) {
      await client.query(
        `DELETE FROM inventory_stock_ledger
         WHERE reference_table = 'inventory_transaksi_penjualan' AND reference_id = ANY($1::bigint[])`,
        [headerIds],
      );
      await client.query(
        `DELETE FROM core_audit_log
         WHERE table_name = 'inventory_transaksi_penjualan' AND record_id = ANY($1::bigint[])`,
        [headerIds],
      );
      // _baris ikut terhapus otomatis (FK ON DELETE CASCADE ke header).
      await client.query(`DELETE FROM inventory_transaksi_penjualan WHERE id = ANY($1::bigint[])`, [headerIds]);
    }
    await client.query(`DELETE FROM salessync_item_mapping WHERE kode_eksternal LIKE $1`, [`${PREFIX}%`]);
    await client.query(`DELETE FROM salessync_log_penjualan WHERE order_id LIKE $1`, [`${PREFIX}%`]);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Helper HTTP
// ---------------------------------------------------------------------------

interface ItemMappingResponse {
  id: string;
  platform: string;
  kodeEksternal: string;
  namaEksternal: string;
  kodeMenu: string | null;
  status: string;
}

async function getItemMapping(status?: string): Promise<ItemMappingResponse[]> {
  const url = status
    ? `${baseUrl}/api/sales-sync/item-mapping?status=${encodeURIComponent(status)}`
    : `${baseUrl}/api/sales-sync/item-mapping`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200, "GET /item-mapping harus 200");
  return (await res.json()) as ItemMappingResponse[];
}

async function patchItemMapping(id: string, kodeMenu: string): Promise<{ status: number; body: ItemMappingResponse }> {
  const res = await fetch(`${baseUrl}/api/sales-sync/item-mapping/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ kodeMenu }),
  });
  return { status: res.status, body: (await res.json()) as ItemMappingResponse };
}

interface HasilProsesResponse {
  transaksiDibuat: number;
  barisDiproses: number;
  dilewatiSebelumTanggalMulai: Array<{ platform: string; orderId: string; tanggal: string }>;
  dilewatiBelumTerpetakan: Array<{ platform: string; orderId: string; tanggal: string }>;
  channelTidakDikenal: Array<{ platform: string; orderId: string; tanggal: string }>;
  gagal: Array<{ platform: string; orderId: string; tanggal: string; pesan: string }>;
}

async function postProses(tanggalMulai: string): Promise<{ status: number; body: HasilProsesResponse }> {
  const res = await fetch(`${baseUrl}/api/sales-sync/proses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tanggalMulai }),
  });
  return { status: res.status, body: (await res.json()) as HasilProsesResponse };
}

/**
 * Masukkan kode eksternal ke antrian pemetaan lalu petakan ke `kodeMenu` --
 * persis dua langkah yang dilakukan UI (GET /item-mapping menyegarkan antrian
 * dari arsip log, PATCH /item-mapping/:id menetapkan menunya).
 */
async function petakanLewatApi(kodeEksternal: string, kodeMenu: string): Promise<ItemMappingResponse> {
  const antrian = await getItemMapping("belum_dipetakan");
  const baris = antrian.find((m) => m.kodeEksternal === kodeEksternal && m.platform === PLATFORM);
  assert.ok(baris, `kode eksternal "${kodeEksternal}" harus muncul di antrian belum_dipetakan`);
  const hasil = await patchItemMapping(baris.id, kodeMenu);
  assert.equal(hasil.status, 200, "PATCH pemetaan harus 200");
  return hasil.body;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

before(async () => {
  // Pembersihan defensif: kalau run sebelumnya mati di tengah (Ctrl+C), sisa
  // artefaknya dibuang dulu supaya baseline di bawah bersih.
  await bersihkanArtefakTest();

  baselineLogTotal = await countOf(`SELECT count(*)::text AS n FROM salessync_log_penjualan`);
  baselineLogProcessed = await countOf(
    `SELECT count(*)::text AS n FROM salessync_log_penjualan WHERE processed_at IS NOT NULL`,
  );
  baselineLedger = await countOf(`SELECT count(*)::text AS n FROM inventory_stock_ledger`);
  baselineAuditCreatedVia = await countOf(
    `SELECT count(*)::text AS n FROM core_audit_log WHERE field_name = 'created_via'`,
  );

  const settings = await query<{ value: string }>(
    `SELECT value FROM salessync_settings WHERE key = 'default_location_id'`,
  );
  assert.ok(settings[0], "salessync_settings.default_location_id wajib ada (jalankan migrasi dulu)");
  defaultLocationId = Number(settings[0].value);

  const menu = await query<{ id: string; name: string }>(`SELECT id, name FROM inventory_menu WHERE kode = $1`, [
    KODE_MENU,
  ]);
  assert.ok(menu[0], `fixture menu "${KODE_MENU}" tidak ditemukan`);
  menuId = Number(menu[0].id);
  namaMenu = menu[0].name;

  const baris = await query<{ item_id: string; kode: string; qty: string }>(
    `SELECT b.item_id, i.kode, b.qty
     FROM inventory_menu_resep_baris b
     JOIN inventory_items i ON i.id = b.item_id
     WHERE b.menu_id = $1`,
    [menuId],
  );
  resepMenu = baris.map((r) => ({ itemId: Number(r.item_id), kode: r.kode, qty: Number(r.qty) }));
  assert.ok(resepMenu.length > 0, `menu ${KODE_MENU} harus punya baris resep untuk bisa diuji pengurangan stoknya`);
  // Paket menu memecah pemakaian ke komponen -- perhitungan ekspektasi di test
  // ini mengasumsikan menu biasa, jadi asumsinya dibuat eksplisit di sini.
  const paket = await countOf(`SELECT count(*)::text AS n FROM inventory_paket_menu_baris WHERE paket_menu_id = $1`, [
    menuId,
  ]);
  assert.equal(paket, 0, `${KODE_MENU} diasumsikan BUKAN paket menu`);

  const ordered = buildRegistry(modules);
  const enabled = ordered.filter((m) => m.manifest.enabled);
  const app = buildServer(ordered, enabled);
  // Port TETAP (bukan listen(0) seperti auth.test.ts): harus cocok dengan
  // BASE_URL yang sudah ter-capture di internal-api.ts, lihat
  // ./sales-sync-test-port.ts.
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${PORT}`;

  // Role manajer_ops (bukan owner): punya sales_sync.manage DAN penjualan.create
  // tanpa batasan lokasi, DAN tidak kena test "owner terakhir yang aktif" di
  // auth.test.ts yang menonaktifkan semua owner sementara -- `node --test`
  // menjalankan file test secara paralel, jadi fixture di sini sengaja dipilih
  // yang tidak bisa diganggu file test lain.
  const username = `test_ss_proses_${Date.now()}`;
  const client = await pool.connect();
  try {
    const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = 'manajer_ops'`);
    const passwordHash = await hashPassword("rahasia123");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO core_users (username, name, password_hash, role_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [username, passwordHash, roleRows[0].id],
    );
    // BIGINT dikembalikan driver `pg` sebagai STRING -- di-cast eksplisit di
    // sini supaya perbandingan angka di assertion di bawah tidak palsu-gagal.
    testUserId = Number(rows[0].id);
  } finally {
    client.release();
  }

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "rahasia123" }),
  });
  assert.equal(loginRes.status, 200, "login fixture manajer_ops harus berhasil");
  token = ((await loginRes.json()) as { token: string }).token;
});

/**
 * Pembersihan + PEMBUKTIAN data asli tidak tersentuh (ini "test ke-4" yang
 * diminta: dijalankan sebagai hook, bukan test terpisah, supaya tetap jalan
 * walau ada assertion yang gagal di tengah).
 */
after(async () => {
  try {
    await bersihkanArtefakTest();

    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM core_login_attempts WHERE user_id = $1`, [testUserId]);
      await client.query(`DELETE FROM core_user_lokasi WHERE user_id = $1`, [testUserId]);
      await client.query(`DELETE FROM core_users WHERE id = $1`, [testUserId]);
    } finally {
      client.release();
    }

    const sisaLog = await countOf(`SELECT count(*)::text AS n FROM salessync_log_penjualan WHERE order_id LIKE $1`, [
      `${PREFIX}%`,
    ]);
    assert.equal(sisaLog, 0, "tidak boleh ada baris log sintetis yang tertinggal");

    const sisaPemetaan = await countOf(
      `SELECT count(*)::text AS n FROM salessync_item_mapping WHERE kode_eksternal LIKE $1`,
      [`${PREFIX}%`],
    );
    assert.equal(sisaPemetaan, 0, "tidak boleh ada baris pemetaan sintetis yang tertinggal");

    const sisaPenjualan = await countOf(
      `SELECT count(*)::text AS n FROM inventory_transaksi_penjualan WHERE no_referensi LIKE $1`,
      [`${PREFIX}%`],
    );
    assert.equal(sisaPenjualan, 0, "tidak boleh ada transaksi Penjualan sintetis yang tertinggal");

    // Inti pembuktian: arsip 19.519 baris data Burnas asli harus kembali PERSIS
    // seperti sebelum test (tidak ada baris tersisa DAN tidak ada baris asli
    // yang hilang/ikut ditandai processed_at).
    const logTotal = await countOf(`SELECT count(*)::text AS n FROM salessync_log_penjualan`);
    assert.equal(logTotal, baselineLogTotal, "jumlah baris salessync_log_penjualan harus kembali ke angka baseline");
    const logProcessed = await countOf(
      `SELECT count(*)::text AS n FROM salessync_log_penjualan WHERE processed_at IS NOT NULL`,
    );
    assert.equal(
      logProcessed,
      baselineLogProcessed,
      "tidak boleh ada baris arsip ASLI yang ikut ditandai processed_at oleh test ini",
    );

    const ledgerTotal = await countOf(`SELECT count(*)::text AS n FROM inventory_stock_ledger`);
    assert.equal(ledgerTotal, baselineLedger, "inventory_stock_ledger harus kembali ke jumlah baris baseline");
    const auditTotal = await countOf(
      `SELECT count(*)::text AS n FROM core_audit_log WHERE field_name = 'created_via'`,
    );
    assert.equal(auditTotal, baselineAuditCreatedVia, "core_audit_log 'created_via' harus kembali ke baseline");
  } finally {
    server.close();
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// Test 1 -- "Terima semua yang cocok"
// ---------------------------------------------------------------------------

test('"Terima semua yang cocok": item yang namanya sama persis dengan menu Samsara terpetakan tanpa error', async () => {
  const kodeEksternal = `${PREFIX}EXT-COCOK`;
  try {
    // item_name SAMA PERSIS dengan nama menu KODE_MENU (dibaca dari DB di before(), bukan ditebak).
    await insertBarisLog({
      orderId: `${PREFIX}ORDER-COCOK`,
      tanggal: TANGGAL_SEBELUM_MULAI,
      itemName: namaMenu,
      menuIdEksternal: kodeEksternal,
      quantity: 1,
    });

    // Antrian pemetaan TIDAK diisi manual -- GET /item-mapping yang menurunkannya dari arsip log.
    const antrian = await getItemMapping("belum_dipetakan");
    const baris = antrian.find((m) => m.kodeEksternal === kodeEksternal);
    assert.ok(baris, "kode eksternal baru dari arsip log muncul otomatis di antrian belum_dipetakan");
    assert.equal(baris.status, "belum_dipetakan");
    assert.equal(baris.platform, PLATFORM);
    assert.equal(baris.namaEksternal, namaMenu);
    assert.equal(baris.kodeMenu, null);

    // Simulasi logika "saran pasti" di UI (apps/web/src/pages/sales-sync/
    // ItemBelumDipetakanSection.tsx): nama menu SAMA PERSIS (abaikan
    // besar/kecil + spasi ujung) dan hanya kalau kandidatnya TEPAT SATU.
    const menuList = (await (
      await fetch(`${baseUrl}/api/inventory/menu`, { headers: { Authorization: `Bearer ${token}` } })
    ).json()) as Array<{ kode: string | null; name: string }>;
    const kandidat = menuList.filter(
      (m) => m.name.trim().toLowerCase() === baris.namaEksternal.trim().toLowerCase(),
    );
    assert.equal(kandidat.length, 1, "nama item sintetis harus cocok ke TEPAT SATU menu (saran pasti)");
    assert.equal(kandidat[0].kode, KODE_MENU);

    // "Terima semua yang cocok" = SATU PATCH per item cocok (tidak ada endpoint borongan).
    const hasil = await patchItemMapping(baris.id, kandidat[0].kode!);
    assert.equal(hasil.status, 200, "PATCH pemetaan untuk item yang cocok berhasil, tanpa error");
    assert.equal(hasil.body.status, "dipetakan");
    assert.equal(hasil.body.kodeMenu, KODE_MENU);
    assert.equal(hasil.body.kodeEksternal, kodeEksternal);

    // Dibuktikan juga di database, bukan cuma dari response.
    const db = await query<{ status: string; kode_menu: string | null; dipetakan_oleh: string | null }>(
      `SELECT status, kode_menu, dipetakan_oleh FROM salessync_item_mapping WHERE id = $1`,
      [baris.id],
    );
    assert.equal(db[0].status, "dipetakan");
    assert.equal(db[0].kode_menu, KODE_MENU);
    assert.equal(Number(db[0].dipetakan_oleh), testUserId, "tercatat siapa yang memetakan");

    // Item yang sudah dipetakan hilang dari antrian "belum_dipetakan".
    const antrianSetelah = await getItemMapping("belum_dipetakan");
    assert.equal(
      antrianSetelah.some((m) => m.kodeEksternal === kodeEksternal),
      false,
      "item yang sudah dipetakan tidak muncul lagi di antrian belum_dipetakan",
    );
  } finally {
    await bersihkanArtefakTest();
  }
});

// ---------------------------------------------------------------------------
// Test 2 & 3 -- pengaman tanggalMulai (satu panggilan /proses, dua sisi)
// ---------------------------------------------------------------------------

test("POST /proses + tanggalMulai: order SEBELUM tanggal tidak menyentuh stok & processed_at tetap NULL, order SESUDAH tanggal jadi transaksi Penjualan sungguhan", async () => {
  const kodeEksternal = `${PREFIX}EXT-PROSES`;
  const orderSebelum = `${PREFIX}ORDER-SEBELUM`;
  const orderSesudah = `${PREFIX}ORDER-SESUDAH`;
  const QTY_SESUDAH = 2;

  try {
    const idSebelum = await insertBarisLog({
      orderId: orderSebelum,
      tanggal: TANGGAL_SEBELUM_MULAI,
      itemName: namaMenu,
      menuIdEksternal: kodeEksternal,
      quantity: 3,
    });
    const idSesudah = await insertBarisLog({
      orderId: orderSesudah,
      tanggal: TANGGAL_SESUDAH_MULAI,
      jam: JAM_ORDER_SESUDAH,
      itemName: namaMenu,
      menuIdEksternal: kodeEksternal,
      quantity: QTY_SESUDAH,
    });

    // Kedua order pakai kode eksternal yang sama -> satu pemetaan cukup.
    const pemetaan = await petakanLewatApi(kodeEksternal, KODE_MENU);
    assert.equal(pemetaan.status, "dipetakan");

    // Baseline stok tiap bahan resep SEBELUM proses (dari ledger, bukan kolom stok).
    const saldoSebelum = new Map<number, number>();
    for (const r of resepMenu) saldoSebelum.set(r.itemId, await saldoLedger(r.itemId));

    const { status, body: hasil } = await postProses(TANGGAL_MULAI);
    assert.equal(status, 200, "POST /proses harus 200");

    // --- Sisi 1: order SEBELUM tanggalMulai ---------------------------------
    const dilewati = hasil.dilewatiSebelumTanggalMulai.find((o) => o.orderId === orderSebelum);
    assert.ok(dilewati, "order sebelum tanggalMulai dilaporkan di dilewatiSebelumTanggalMulai");
    assert.equal(dilewati.platform, PLATFORM);
    assert.equal(dilewati.tanggal, TANGGAL_SEBELUM_MULAI);

    // Perilaku yang WAJIB dijaga (beda dari rancangan lama): processed_at TETAP
    // NULL untuk order yang dilewati karena tanggal, supaya order itu bisa
    // ditangkap lagi di panggilan /proses berikutnya dengan tanggalMulai lebih
    // awal. Kalau assertion ini gagal karena processed_at terisi, itu REGRESI
    // di proses.ts -- jangan disesuaikan di test.
    const rowSebelum = await query<{ processed_at: Date | null }>(
      `SELECT processed_at FROM salessync_log_penjualan WHERE id = $1`,
      [idSebelum],
    );
    assert.equal(rowSebelum[0].processed_at, null, "processed_at order sebelum tanggalMulai HARUS tetap NULL");

    const penjualanSebelum = await countOf(
      `SELECT count(*)::text AS n FROM inventory_transaksi_penjualan WHERE no_referensi = $1`,
      [orderSebelum],
    );
    assert.equal(penjualanSebelum, 0, "order sebelum tanggalMulai TIDAK membuat transaksi Penjualan");

    // --- Sisi 2: order SESUDAH tanggalMulai ---------------------------------
    // Tepat 1, bukan ">= 1": seluruh order ASLI di arsip bertanggal jauh
    // sebelum TANGGAL_MULAI (2099), jadi angka ini sekaligus membuktikan tidak
    // ada satu pun order asli yang ikut diproses oleh test ini.
    assert.equal(hasil.transaksiDibuat, 1, "tepat 1 transaksi dibuat (hanya order sintetis sesudah tanggalMulai)");
    assert.equal(hasil.barisDiproses, 1, "tepat 1 baris log yang diproses");
    assert.deepEqual(hasil.gagal, [], "tidak ada order yang gagal");
    assert.equal(
      hasil.dilewatiBelumTerpetakan.some((o) => o.orderId.startsWith(PREFIX)),
      false,
      "order sintetis sudah terpetakan, tidak boleh masuk dilewatiBelumTerpetakan",
    );

    const rowSesudah = await query<{ processed_at: Date | null }>(
      `SELECT processed_at FROM salessync_log_penjualan WHERE id = $1`,
      [idSesudah],
    );
    assert.ok(rowSesudah[0].processed_at !== null, "processed_at order sesudah tanggalMulai TERISI");

    const header = await query<{
      id: string;
      sumber: string;
      location_id: string;
      tanggal: Date;
      jam: string | null;
      dibuat_oleh: string | null;
    }>(
      `SELECT id, sumber, location_id, tanggal, jam, dibuat_oleh
       FROM inventory_transaksi_penjualan WHERE no_referensi = $1`,
      [orderSesudah],
    );
    assert.equal(header.length, 1, "ada TEPAT SATU transaksi Penjualan dengan no_referensi = order_id sintetis");
    const headerId = Number(header[0].id);
    assert.equal(header[0].sumber, CHANNEL_INTERNAL, "sumber transaksi = channel internal hasil pemetaan platform");
    assert.equal(Number(header[0].location_id), defaultLocationId, "lokasi dari salessync_settings.default_location_id");

    // Jam order ASLI ikut terbawa ke Inventory (fitur "heatmap jam ramai"):
    // nilainya dibandingkan PERSIS, bukan cuma "tidak NULL", supaya kalau nanti
    // ada yang mengisinya dengan jam proses sync (now()) test ini gagal.
    assert.equal(
      header[0].jam,
      JAM_ORDER_SESUDAH,
      "inventory_transaksi_penjualan.jam = transaction_time baris log arsip, bukan jam proses sync",
    );
    // Dibandingkan juga langsung ke nilai di arsip (bukan cuma ke konstanta
    // test), supaya terbukti jalurnya memang arsip -> Inventory.
    const jamArsip = await query<{ transaction_time: string }>(
      `SELECT transaction_time FROM salessync_log_penjualan WHERE id = $1`,
      [idSesudah],
    );
    assert.equal(header[0].jam, jamArsip[0].transaction_time, "jam transaksi Inventory identik dengan arsip sumbernya");

    const barisTransaksi = await query<{ menu_id: string; qty: string }>(
      `SELECT menu_id, qty FROM inventory_transaksi_penjualan_baris WHERE header_id = $1`,
      [headerId],
    );
    assert.equal(barisTransaksi.length, 1);
    assert.equal(Number(barisTransaksi[0].menu_id), menuId, `baris transaksi menunjuk menu ${KODE_MENU}`);
    assert.equal(Number(barisTransaksi[0].qty), QTY_SESUDAH, "qty baris transaksi = quantity dari baris log");

    // Pembuktian stok SUNGGUHAN: tiap bahan resep berkurang persis
    // (qty resep x qty order), dan ada baris ledger 'penjualan' negatif yang
    // menunjuk ke transaksi ini.
    for (const r of resepMenu) {
      const diharapkan = -(r.qty * QTY_SESUDAH);
      const saldoSetelah = await saldoLedger(r.itemId);
      assert.equal(
        saldoSetelah - saldoSebelum.get(r.itemId)!,
        diharapkan,
        `stok ${r.kode} berkurang ${Math.abs(diharapkan)} (resep ${r.qty} x qty ${QTY_SESUDAH})`,
      );

      const ledger = await query<{ transaction_type: string; qty_change: string }>(
        `SELECT transaction_type, qty_change FROM inventory_stock_ledger
         WHERE reference_table = 'inventory_transaksi_penjualan' AND reference_id = $1
           AND item_id = $2 AND location_id = $3`,
        [headerId, r.itemId, defaultLocationId],
      );
      assert.equal(ledger.length, 1, `ada tepat 1 baris ledger untuk ${r.kode} dari transaksi ini`);
      assert.equal(ledger[0].transaction_type, "penjualan");
      assert.equal(Number(ledger[0].qty_change), diharapkan, `qty_change ${r.kode} NEGATIF sesuai resep x qty`);
    }

    // Jejak audit "transaksi ini lahir dari sales-sync, bukan input kasir".
    const audit = await query<{ user_id: string | null; new_value: string | null; old_value: string | null }>(
      `SELECT user_id, new_value, old_value FROM core_audit_log
       WHERE table_name = 'inventory_transaksi_penjualan' AND record_id = $1 AND field_name = 'created_via'`,
      [headerId],
    );
    assert.equal(audit.length, 1, "tepat 1 baris core_audit_log created_via untuk transaksi yang baru dibuat");
    assert.equal(audit[0].new_value, "sales-sync");
    assert.equal(audit[0].old_value, null);
    assert.equal(Number(audit[0].user_id), testUserId, "audit log mencatat user pemicu proses");

    // Arsip asli tidak ikut tertandai: hanya 1 baris (sintetis) yang processed_at-nya terisi.
    const processedTotal = await countOf(
      `SELECT count(*)::text AS n FROM salessync_log_penjualan WHERE processed_at IS NOT NULL`,
    );
    assert.equal(
      processedTotal,
      baselineLogProcessed + 1,
      "hanya baris log SINTETIS yang ditandai processed_at -- arsip asli tidak tersentuh",
    );
  } finally {
    await bersihkanArtefakTest();
  }
});

// ---------------------------------------------------------------------------
// Pelengkap: tanggalMulai wajib (pengaman cutover) -- murni validasi, tanpa efek data
// ---------------------------------------------------------------------------

test("POST /proses tanpa tanggalMulai ditolak 400 sebelum menyentuh data apa pun", async () => {
  const res = await fetch(`${baseUrl}/api/sales-sync/proses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /tanggal mulai/i);

  const salahFormat = await fetch(`${baseUrl}/api/sales-sync/proses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tanggalMulai: "01/01/2099" }),
  });
  assert.equal(salahFormat.status, 400, "format selain YYYY-MM-DD juga ditolak");

  const processed = await countOf(
    `SELECT count(*)::text AS n FROM salessync_log_penjualan WHERE processed_at IS NOT NULL`,
  );
  assert.equal(processed, baselineLogProcessed, "request yang ditolak tidak menandai baris log apa pun");
});
