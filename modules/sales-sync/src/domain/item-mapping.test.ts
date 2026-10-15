import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import { listItemMapping, setItemMapping, syncItemMappingFromLog } from "./item-mapping.js";
import { withRollback } from "./test-helpers.js";

/**
 * Test pemetaan item eksternal -> menu internal, LANGSUNG di domain layer
 * (satu `PoolClient` di dalam `withRollback`) -- ketiga fungsi di
 * `item-mapping.ts` murni SQL di satu koneksi, tidak memanggil HTTP/modul lain.
 *
 * Baris log fixture di-INSERT lewat SQL mentah (BUKAN lewat
 * `importLogPenjualan`) supaya test ini benar-benar cuma menguji fungsi
 * pemetaan: `created_at` dan `inv_status` perlu dikendalikan per baris, dan
 * itu tidak mungkin dilakukan lewat jalur import.
 *
 * Platform fixture SENGAJA fiktif (`TEST-IM-...`) supaya tidak pernah
 * bertabrakan dengan 195 baris pemetaan dan 19.519 baris arsip log asli yang
 * ada di database dev -- semua assertion juga dibatasi ke platform fiktif ini,
 * bukan ke jumlah total baris tabel.
 */

after(() => pool.end());

const PLATFORM = "TEST-IM-PLATFORM";
/**
 * `setItemMapping` SENGAJA tidak memvalidasi kodeMenu terhadap inventory_menu
 * (lihat komentar fungsinya -- validasi terjadi implisit saat /proses memanggil
 * API Inventory), jadi string bebas memang cukup di sini.
 */
const KODE_MENU = "TEST-KODE-APAPUN";

// ---------------------------------------------------------------------------
// Helper fixture
// ---------------------------------------------------------------------------

let nomorKey = 0;

/** Satu baris arsip log penjualan sintetis dengan created_at & inv_status terkendali. */
async function insertLog(
  client: PoolClient,
  input: { menuId: string | null; itemName: string; createdAt: string; invStatus?: string },
): Promise<void> {
  nomorKey += 1;
  await client.query(
    `INSERT INTO salessync_log_penjualan
       (transaction_date, transaction_time, platform, order_id, item_name, menu_id, quantity,
        item_type, parent_item, unique_key, inv_status, created_at)
     VALUES ('2026-07-22', '12:00:00', $1, $2, $3, $4, 1, 'menu', NULL, $2, $5, $6)`,
    [
      PLATFORM,
      `TEST-IM-KEY-${nomorKey}`,
      input.itemName,
      input.menuId,
      input.invStatus ?? "OK",
      input.createdAt,
    ],
  );
}

interface BarisPemetaan {
  id: string;
  kode_eksternal: string;
  nama_eksternal: string;
  kode_menu: string | null;
  status: string;
  dipetakan_oleh: string | null;
  dipetakan_pada: Date | null;
}

/** Baris pemetaan milik platform fixture, dibaca langsung dari tabel. */
async function pemetaanFixture(client: PoolClient): Promise<BarisPemetaan[]> {
  const { rows } = await client.query<BarisPemetaan>(
    `SELECT id, kode_eksternal, nama_eksternal, kode_menu, status, dipetakan_oleh, dipetakan_pada
     FROM salessync_item_mapping WHERE platform = $1 ORDER BY kode_eksternal`,
    [PLATFORM],
  );
  return rows;
}

/**
 * Jumlah kombinasi (platform, menu_id) di SELURUH arsip log yang belum punya
 * baris pemetaan -- dipakai untuk memeriksa nilai balik `syncItemMappingFromLog`
 * tanpa menghardcode asumsi "arsip asli sudah tersinkron penuh".
 */
async function kandidatBelumTersinkron(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM (
       SELECT DISTINCT l.platform, l.menu_id
       FROM salessync_log_penjualan l
       WHERE l.menu_id IS NOT NULL AND l.menu_id <> ''
         AND NOT EXISTS (
           SELECT 1 FROM salessync_item_mapping m
           WHERE m.platform = l.platform AND m.kode_eksternal = l.menu_id
         )
     ) t`,
  );
  return Number(rows[0].n);
}

/** User yang sudah ada (dipetakan_oleh FK ke core_users) -- tidak membuat user baru. */
async function userIdYangAda(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ id: string }>(`SELECT id FROM core_users ORDER BY id LIMIT 1`);
  assert.ok(rows[0], "butuh minimal satu baris core_users (jalankan migrasi & seed owner dulu)");
  return Number(rows[0].id);
}

// ---------------------------------------------------------------------------
// syncItemMappingFromLog
// ---------------------------------------------------------------------------

test("syncItemMappingFromLog: satu baris antrian per kombinasi (platform, menu_id) UNIK, nama_eksternal diambil dari baris log TERBARU", async () => {
  await withRollback(async (client) => {
    // (PLATFORM, EXT-1) muncul 3x dengan item_name & created_at berbeda ->
    // tetap harus jadi SATU baris antrian, dengan nama dari created_at terbaru.
    await insertLog(client, { menuId: "TEST-IM-EXT-1", itemName: "Nama Paling Lama", createdAt: "2026-01-01T00:00:00Z" });
    await insertLog(client, { menuId: "TEST-IM-EXT-1", itemName: "Nama Tengah", createdAt: "2026-02-01T00:00:00Z" });
    await insertLog(client, { menuId: "TEST-IM-EXT-1", itemName: "Nama Paling Baru", createdAt: "2026-03-01T00:00:00Z" });
    // (PLATFORM, EXT-2) muncul 2x dengan nama berbeda.
    await insertLog(client, { menuId: "TEST-IM-EXT-2", itemName: "Dua Versi Lama", createdAt: "2026-01-15T00:00:00Z" });
    await insertLog(client, { menuId: "TEST-IM-EXT-2", itemName: "Dua Versi Baru", createdAt: "2026-04-10T00:00:00Z" });
    // (PLATFORM, EXT-3) muncul sekali.
    await insertLog(client, { menuId: "TEST-IM-EXT-3", itemName: "Tiga", createdAt: "2026-02-20T00:00:00Z" });

    const diharapkan = await kandidatBelumTersinkron(client);
    const ditambahkan = await syncItemMappingFromLog(client);
    assert.equal(ditambahkan, diharapkan, "nilai balik = jumlah kombinasi (platform, menu_id) yang belum ada");

    const baris = await pemetaanFixture(client);
    assert.equal(baris.length, 3, "6 baris log -> 3 baris antrian (jumlah kombinasi UNIK, bukan jumlah baris log)");
    assert.deepEqual(
      baris.map((b) => b.kode_eksternal),
      ["TEST-IM-EXT-1", "TEST-IM-EXT-2", "TEST-IM-EXT-3"],
    );

    // Inti pembuktian DISTINCT ON + ORDER BY created_at DESC.
    assert.equal(baris[0].nama_eksternal, "Nama Paling Baru", "nama item dari baris log created_at PALING BARU");
    assert.equal(baris[1].nama_eksternal, "Dua Versi Baru");
    assert.equal(baris[2].nama_eksternal, "Tiga");

    for (const b of baris) {
      assert.equal(b.status, "belum_dipetakan");
      assert.equal(b.kode_menu, null);
      assert.equal(b.dipetakan_oleh, null);
      assert.equal(b.dipetakan_pada, null);
    }
  });
});

test("syncItemMappingFromLog: baris log dengan menu_id NULL atau string kosong TIDAK masuk antrian pemetaan", async () => {
  await withRollback(async (client) => {
    await insertLog(client, { menuId: null, itemName: "Item Tanpa Kode", createdAt: "2026-01-01T00:00:00Z" });
    await insertLog(client, { menuId: "", itemName: "Item Kode Kosong", createdAt: "2026-01-02T00:00:00Z" });
    await insertLog(client, { menuId: "TEST-IM-EXT-ADA", itemName: "Item Berkode", createdAt: "2026-01-03T00:00:00Z" });

    await syncItemMappingFromLog(client);

    const baris = await pemetaanFixture(client);
    assert.equal(baris.length, 1, "hanya baris log yang punya menu_id yang jadi kandidat pemetaan");
    assert.equal(baris[0].kode_eksternal, "TEST-IM-EXT-ADA");
  });
});

test("syncItemMappingFromLog: idempoten dan TIDAK menimpa pemetaan yang sudah dikerjakan manusia (ON CONFLICT DO NOTHING)", async () => {
  await withRollback(async (client) => {
    const userId = await userIdYangAda(client);

    await insertLog(client, { menuId: "TEST-IM-EXT-MANUAL", itemName: "Nama Saat Dipetakan", createdAt: "2026-01-01T00:00:00Z" });
    await insertLog(client, { menuId: "TEST-IM-EXT-LAIN", itemName: "Baris Pembanding", createdAt: "2026-01-01T00:00:00Z" });
    await syncItemMappingFromLog(client);

    const awal = await pemetaanFixture(client);
    assert.equal(awal.length, 2);
    const barisManual = awal.find((b) => b.kode_eksternal === "TEST-IM-EXT-MANUAL");
    assert.ok(barisManual);

    // Manusia memetakan baris itu.
    const dipetakan = await setItemMapping(client, Number(barisManual.id), KODE_MENU, userId);
    assert.equal(dipetakan.status, "dipetakan");

    // Lalu datang baris log BARU untuk kombinasi (platform, menu_id) yang SAMA
    // dengan item_name yang BERBEDA & lebih baru (nama item di platform
    // berubah) -- sync berikutnya tidak boleh menyentuh baris itu sama sekali.
    await insertLog(client, {
      menuId: "TEST-IM-EXT-MANUAL",
      itemName: "Nama Baru Dari Platform",
      createdAt: "2026-09-09T00:00:00Z",
    });

    const ditambahkanLagi = await syncItemMappingFromLog(client);
    assert.equal(ditambahkanLagi, 0, "idempoten: tidak ada baris antrian baru");

    const setelah = await pemetaanFixture(client);
    assert.equal(setelah.length, 2, "jumlah baris antrian tidak berubah");

    const manualSetelah = setelah.find((b) => b.kode_eksternal === "TEST-IM-EXT-MANUAL");
    assert.ok(manualSetelah);
    assert.equal(manualSetelah.id, barisManual.id, "baris yang sama, bukan baris baru");
    assert.equal(manualSetelah.status, "dipetakan", "status hasil kerja manusia TETAP");
    assert.equal(manualSetelah.kode_menu, KODE_MENU, "kode_menu TETAP");
    assert.equal(
      manualSetelah.nama_eksternal,
      "Nama Saat Dipetakan",
      "nama_eksternal TIDAK tertimpa item_name baru dari log terbaru",
    );
    assert.equal(Number(manualSetelah.dipetakan_oleh), userId, "jejak siapa yang memetakan tidak hilang");
  });
});

// ---------------------------------------------------------------------------
// listItemMapping
// ---------------------------------------------------------------------------

/**
 * Fixture bersama untuk test filter: dua kode eksternal yang KEDUANYA ada di
 * tabel dengan status `belum_dipetakan`, tapi beda asal baris lognya:
 *   - EXT-SKIP-ONLY : SEMUA baris lognya inv_status 'SKIP-HISTORIS'
 *   - EXT-ADA-OK    : punya minimal SATU baris log inv_status 'OK'
 */
async function siapkanFixtureFilter(client: PoolClient): Promise<BarisPemetaan[]> {
  await insertLog(client, {
    menuId: "TEST-IM-EXT-SKIP-ONLY",
    itemName: "Item Historis",
    createdAt: "2026-01-01T00:00:00Z",
    invStatus: "SKIP-HISTORIS",
  });
  await insertLog(client, {
    menuId: "TEST-IM-EXT-SKIP-ONLY",
    itemName: "Item Historis",
    createdAt: "2026-01-02T00:00:00Z",
    invStatus: "SKIP-HISTORIS",
  });
  await insertLog(client, {
    menuId: "TEST-IM-EXT-ADA-OK",
    itemName: "Item Aktif",
    createdAt: "2026-01-01T00:00:00Z",
    invStatus: "SKIP-HISTORIS",
  });
  await insertLog(client, {
    menuId: "TEST-IM-EXT-ADA-OK",
    itemName: "Item Aktif",
    createdAt: "2026-01-02T00:00:00Z",
    invStatus: "OK",
  });

  await syncItemMappingFromLog(client);
  const baris = await pemetaanFixture(client);
  assert.equal(baris.length, 2, "prasyarat: KEDUA kode eksternal ada di tabel pemetaan");
  for (const b of baris) assert.equal(b.status, "belum_dipetakan", "prasyarat: keduanya masih belum dipetakan");
  return baris;
}

test("listItemMapping tanpa filter: SEMUA baris dikembalikan, termasuk yang sumber lognya cuma inv_status != 'OK'", async () => {
  await withRollback(async (client) => {
    await siapkanFixtureFilter(client);

    const semua = await listItemMapping(client);
    const milikFixture = semua.filter((m) => m.platform === PLATFORM).map((m) => m.kodeEksternal).sort();
    assert.deepEqual(
      milikFixture,
      ["TEST-IM-EXT-ADA-OK", "TEST-IM-EXT-SKIP-ONLY"],
      "tanpa filter status, filter OK-only TIDAK berlaku",
    );
  });
});

test("listItemMapping status='belum_dipetakan': hanya kode eksternal yang punya minimal satu baris log inv_status='OK'", async () => {
  await withRollback(async (client) => {
    await siapkanFixtureFilter(client);

    const antrian = await listItemMapping(client, "belum_dipetakan");
    const milikFixture = antrian.filter((m) => m.platform === PLATFORM).map((m) => m.kodeEksternal);

    assert.deepEqual(
      milikFixture,
      ["TEST-IM-EXT-ADA-OK"],
      "kode eksternal yang semua baris lognya SKIP-HISTORIS disaring keluar (tidak akan pernah diproses ke Penjualan)",
    );

    // Konfirmasi bahwa yang disaring itu MEMANG ada di tabel -- jadi bedanya
    // murni dari filter, bukan karena barisnya tidak pernah dibuat.
    const semua = await listItemMapping(client);
    assert.ok(
      semua.some((m) => m.platform === PLATFORM && m.kodeEksternal === "TEST-IM-EXT-SKIP-ONLY"),
      "baris yang disaring tetap ada di tabel dengan status belum_dipetakan",
    );
  });
});

test("listItemMapping status='dipetakan': TIDAK terpengaruh filter inv_status -- baris terpetakan tetap muncul walau semua log sumbernya SKIP-HISTORIS", async () => {
  await withRollback(async (client) => {
    const userId = await userIdYangAda(client);
    const baris = await siapkanFixtureFilter(client);

    // Yang dipetakan justru yang SEMUA log sumbernya SKIP-HISTORIS.
    const skipOnly = baris.find((b) => b.kode_eksternal === "TEST-IM-EXT-SKIP-ONLY");
    assert.ok(skipOnly);
    await setItemMapping(client, Number(skipOnly.id), KODE_MENU, userId);

    const terpetakan = await listItemMapping(client, "dipetakan");
    const milikFixture = terpetakan.filter((m) => m.platform === PLATFORM);
    assert.equal(milikFixture.length, 1);
    assert.equal(milikFixture[0].kodeEksternal, "TEST-IM-EXT-SKIP-ONLY");
    assert.equal(milikFixture[0].kodeMenu, KODE_MENU);
    assert.equal(
      terpetakan.every((m) => m.status === "dipetakan"),
      true,
      "filter status mengembalikan HANYA baris berstatus itu",
    );

    // Dan baris itu hilang dari antrian belum_dipetakan.
    const antrian = await listItemMapping(client, "belum_dipetakan");
    assert.equal(
      antrian.some((m) => m.platform === PLATFORM && m.kodeEksternal === "TEST-IM-EXT-SKIP-ONLY"),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// setItemMapping
// ---------------------------------------------------------------------------

test("setItemMapping: kode_menu/status/dipetakan_oleh/dipetakan_pada ter-update, baris LAIN tidak ikut berubah", async () => {
  await withRollback(async (client) => {
    const userId = await userIdYangAda(client);
    await insertLog(client, { menuId: "TEST-IM-EXT-TARGET", itemName: "Target", createdAt: "2026-01-01T00:00:00Z" });
    await insertLog(client, { menuId: "TEST-IM-EXT-UTUH", itemName: "Jangan Disentuh", createdAt: "2026-01-01T00:00:00Z" });
    await syncItemMappingFromLog(client);

    const awal = await pemetaanFixture(client);
    const target = awal.find((b) => b.kode_eksternal === "TEST-IM-EXT-TARGET");
    const utuh = awal.find((b) => b.kode_eksternal === "TEST-IM-EXT-UTUH");
    assert.ok(target && utuh);

    const dipetakanSebelum = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM salessync_item_mapping WHERE status = 'dipetakan'`,
    );

    const hasil = await setItemMapping(client, Number(target.id), KODE_MENU, userId);

    assert.equal(hasil.id, target.id);
    assert.equal(hasil.kodeMenu, KODE_MENU);
    assert.equal(hasil.status, "dipetakan");
    assert.equal(Number(hasil.dipetakanOleh), userId);
    assert.ok(hasil.dipetakanPada instanceof Date, "dipetakan_pada terisi stempel waktu");
    assert.equal(hasil.platform, PLATFORM);
    assert.equal(hasil.kodeEksternal, "TEST-IM-EXT-TARGET");

    // Dibuktikan ulang dari database, bukan cuma dari nilai balik fungsi.
    const setelah = await pemetaanFixture(client);
    const targetDb = setelah.find((b) => b.kode_eksternal === "TEST-IM-EXT-TARGET");
    assert.equal(targetDb?.status, "dipetakan");
    assert.equal(targetDb?.kode_menu, KODE_MENU);

    const utuhDb = setelah.find((b) => b.kode_eksternal === "TEST-IM-EXT-UTUH");
    assert.equal(utuhDb?.status, "belum_dipetakan", "baris lain tidak ikut ter-update");
    assert.equal(utuhDb?.kode_menu, null);
    assert.equal(utuhDb?.dipetakan_oleh, null);
    assert.equal(utuhDb?.dipetakan_pada, null);
    assert.equal(utuhDb?.nama_eksternal, "Jangan Disentuh");

    const dipetakanSesudah = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM salessync_item_mapping WHERE status = 'dipetakan'`,
    );
    assert.equal(
      Number(dipetakanSesudah.rows[0].n) - Number(dipetakanSebelum.rows[0].n),
      1,
      "TEPAT satu baris di SELURUH tabel yang berubah jadi dipetakan",
    );
  });
});

test("setItemMapping: id yang tidak ada melempar error 'tidak ditemukan' (diterjemahkan router jadi 404)", async () => {
  await withRollback(async (client) => {
    const userId = await userIdYangAda(client);
    const { rows } = await client.query<{ id: string }>(
      `SELECT (COALESCE(MAX(id), 0) + 1000)::text AS id FROM salessync_item_mapping`,
    );
    const idTidakAda = Number(rows[0].id);

    await assert.rejects(() => setItemMapping(client, idTidakAda, KODE_MENU, userId), /tidak ditemukan/i);
  });
});
