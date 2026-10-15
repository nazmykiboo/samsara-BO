import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import { listBelumDiproses } from "./belum-diproses.js";
import { withRollback } from "./test-helpers.js";

/**
 * Test `listBelumDiproses`, LANGSUNG di domain layer (satu `PoolClient` di
 * dalam `withRollback`) -- fungsinya murni satu SELECT di satu koneksi, tidak
 * memanggil HTTP/modul lain.
 *
 * Baris fixture di-INSERT lewat SQL mentah (BUKAN lewat `importLogPenjualan`)
 * karena `inv_status` dan `processed_at` perlu dikendalikan per baris, dan
 * `processed_at` SENGAJA tidak bisa diset lewat jalur import.
 *
 * Platform fixture SENGAJA fiktif (`TEST-BD-...`) supaya tidak pernah
 * bertabrakan dengan 19.519 baris arsip log Burnas asli di database dev --
 * SEMUA assertion disaring ke platform fiktif ini, tidak ada satu pun
 * assertion yang bergantung pada isi/jumlah arsip asli (walau `withRollback`
 * sudah menjamin tidak ada yang tersimpan).
 */

after(() => pool.end());

const PLATFORM = "TEST-BD-PLATFORM";
/** Platform kedua, untuk membuktikan urutan sekunder ORDER BY platform. */
const PLATFORM_B = "TEST-BD-PLATFORM-B";

// ---------------------------------------------------------------------------
// Helper fixture
// ---------------------------------------------------------------------------

let nomorKey = 0;

interface InputLog {
  tanggal: string;
  orderId: string;
  itemName: string;
  menuId?: string | null;
  quantity?: number;
  invStatus?: string;
  processedAt?: string | null;
  platform?: string;
}

/** Satu baris arsip log penjualan sintetis dengan inv_status & processed_at terkendali. */
async function insertLog(client: PoolClient, input: InputLog): Promise<void> {
  nomorKey += 1;
  await client.query(
    `INSERT INTO salessync_log_penjualan
       (transaction_date, transaction_time, platform, order_id, item_name, menu_id, quantity,
        item_type, parent_item, unique_key, inv_status, processed_at)
     VALUES ($1, '12:00:00', $2, $3, $4, $5, $6, 'menu', NULL, $7, $8, $9)`,
    [
      input.tanggal,
      input.platform ?? PLATFORM,
      input.orderId,
      input.itemName,
      input.menuId === undefined ? `TEST-BD-EXT-${nomorKey}` : input.menuId,
      input.quantity ?? 1,
      `TEST-BD-KEY-${nomorKey}`,
      input.invStatus ?? "OK",
      input.processedAt ?? null,
    ],
  );
}

/** Hanya baris milik platform fixture -- arsip asli tidak pernah ikut diperiksa. */
function milikFixture<T extends { platform: string }>(rows: T[]): T[] {
  return rows.filter((r) => r.platform === PLATFORM || r.platform === PLATFORM_B);
}

// ---------------------------------------------------------------------------
// Kriteria baris: HANYA inv_status='OK' AND processed_at IS NULL
// ---------------------------------------------------------------------------

test("listBelumDiproses: HANYA baris inv_status='OK' DAN processed_at IS NULL yang muncul", async () => {
  await withRollback(async (client) => {
    // (1) Yang HARUS muncul.
    await insertLog(client, { tanggal: "2026-07-01", orderId: "TEST-BD-ORD-MUNCUL", itemName: "Harus Muncul" });
    // (2) inv_status SKIP-HISTORIS, processed_at masih NULL -> TIDAK muncul.
    await insertLog(client, {
      tanggal: "2026-07-01",
      orderId: "TEST-BD-ORD-SKIP",
      itemName: "Historis",
      invStatus: "SKIP-HISTORIS",
    });
    // (3) inv_status OK tapi processed_at SUDAH terisi -> TIDAK muncul
    //     (sudah jadi transaksi Penjualan, sudah pengaruh stok).
    await insertLog(client, {
      tanggal: "2026-07-01",
      orderId: "TEST-BD-ORD-SUDAH",
      itemName: "Sudah Diproses",
      processedAt: "2026-07-02T03:00:00Z",
    });
    // (4) Dua-duanya tidak memenuhi -> TIDAK muncul.
    await insertLog(client, {
      tanggal: "2026-07-01",
      orderId: "TEST-BD-ORD-SKIP-SUDAH",
      itemName: "Historis & Diproses",
      invStatus: "SKIP-HISTORIS",
      processedAt: "2026-07-02T03:00:00Z",
    });

    const hasil = milikFixture(await listBelumDiproses(client, {}));

    assert.deepEqual(
      hasil.map((r) => r.orderId),
      ["TEST-BD-ORD-MUNCUL"],
      "baris SKIP-HISTORIS maupun yang processed_at-nya terisi tidak ikut",
    );
  });
});

test("listBelumDiproses: isi tiap objek response sesuai kolom log (termasuk menuId NULL dibiarkan null)", async () => {
  await withRollback(async (client) => {
    await insertLog(client, {
      tanggal: "2026-07-05",
      orderId: "TEST-BD-ORD-ISI",
      itemName: "Bubur Ayam Komplit",
      menuId: "TEST-BD-EXT-ISI",
      quantity: 3,
    });
    // Baris tanpa kode eksternal TETAP muncul (ini daftar arsip, bukan antrian
    // pemetaan) -- menuId-nya null.
    await insertLog(client, {
      tanggal: "2026-07-05",
      orderId: "TEST-BD-ORD-NOKODE",
      itemName: "Item Tanpa Kode",
      menuId: null,
      quantity: 2,
    });

    const hasil = milikFixture(await listBelumDiproses(client, {}));
    assert.equal(hasil.length, 2);

    const isi = hasil.find((r) => r.orderId === "TEST-BD-ORD-ISI");
    assert.ok(isi);
    assert.deepEqual(isi, {
      platform: PLATFORM,
      orderId: "TEST-BD-ORD-ISI",
      tanggal: "2026-07-05",
      menuId: "TEST-BD-EXT-ISI",
      itemName: "Bubur Ayam Komplit",
      quantity: 3,
    });
    // Tanggal kalender dikembalikan sebagai STRING (to_char), bukan objek Date.
    assert.equal(typeof isi.tanggal, "string");

    const noKode = hasil.find((r) => r.orderId === "TEST-BD-ORD-NOKODE");
    assert.ok(noKode);
    assert.equal(noKode.menuId, null, "baris tanpa kode eksternal tetap muncul dengan menuId null");
    assert.equal(noKode.quantity, 2);
  });
});

// ---------------------------------------------------------------------------
// Filter tanggal (KEDUANYA opsional)
// ---------------------------------------------------------------------------

/** Fixture 4 tanggal berbeda, satu baris per tanggal, semuanya belum diproses. */
async function siapkanFixtureTanggal(client: PoolClient): Promise<void> {
  await insertLog(client, { tanggal: "2026-05-10", orderId: "TEST-BD-ORD-0510", itemName: "Mei" });
  await insertLog(client, { tanggal: "2026-06-15", orderId: "TEST-BD-ORD-0615", itemName: "Juni" });
  await insertLog(client, { tanggal: "2026-07-20", orderId: "TEST-BD-ORD-0720", itemName: "Juli" });
  await insertLog(client, { tanggal: "2026-08-25", orderId: "TEST-BD-ORD-0825", itemName: "Agustus" });
}

test("listBelumDiproses tanpa filter: SEMUA baris belum-diproses dikembalikan, tanpa batas tanggal", async () => {
  await withRollback(async (client) => {
    await siapkanFixtureTanggal(client);
    // Baris yang sangat tua -- pembuktian bahwa TIDAK ada default jendela
    // waktu (beda dari GET /transaksi/penjualan Inventory yang default 30 hari).
    await insertLog(client, { tanggal: "2023-01-02", orderId: "TEST-BD-ORD-TUA", itemName: "Sangat Tua" });

    const hasil = milikFixture(await listBelumDiproses(client, {}));

    assert.deepEqual(
      hasil.map((r) => r.tanggal),
      ["2026-08-25", "2026-07-20", "2026-06-15", "2026-05-10", "2023-01-02"],
      "5 baris, urut transaction_date DESC, baris 2023 pun tetap ikut",
    );
  });
});

test("listBelumDiproses: tanggalMulai menyaring baris SEBELUMNYA (inklusif di tanggal batas)", async () => {
  await withRollback(async (client) => {
    await siapkanFixtureTanggal(client);

    const hasil = milikFixture(await listBelumDiproses(client, { tanggalMulai: "2026-06-15" }));

    assert.deepEqual(
      hasil.map((r) => r.tanggal),
      ["2026-08-25", "2026-07-20", "2026-06-15"],
      "tanggal batas IKUT (>=), baris 2026-05-10 tersaring keluar",
    );
  });
});

test("listBelumDiproses: tanggalSelesai menyaring baris SESUDAHNYA (inklusif di tanggal batas)", async () => {
  await withRollback(async (client) => {
    await siapkanFixtureTanggal(client);

    const hasil = milikFixture(await listBelumDiproses(client, { tanggalSelesai: "2026-07-20" }));

    assert.deepEqual(
      hasil.map((r) => r.tanggal),
      ["2026-07-20", "2026-06-15", "2026-05-10"],
      "tanggal batas IKUT (<=), baris 2026-08-25 tersaring keluar",
    );
  });
});

test("listBelumDiproses: tanggalMulai + tanggalSelesai bersamaan = rentang tertutup", async () => {
  await withRollback(async (client) => {
    await siapkanFixtureTanggal(client);

    const hasil = milikFixture(
      await listBelumDiproses(client, { tanggalMulai: "2026-06-15", tanggalSelesai: "2026-07-20" }),
    );

    assert.deepEqual(
      hasil.map((r) => r.tanggal),
      ["2026-07-20", "2026-06-15"],
      "hanya baris di dalam rentang, kedua ujungnya ikut",
    );

    // Rentang yang tidak memuat satu baris fixture pun -> daftar kosong, bukan error.
    const kosong = milikFixture(
      await listBelumDiproses(client, { tanggalMulai: "2026-09-01", tanggalSelesai: "2026-09-30" }),
    );
    assert.deepEqual(kosong, []);
  });
});

test("listBelumDiproses: filter tanggal TIDAK melonggarkan kriteria inv_status/processed_at", async () => {
  await withRollback(async (client) => {
    await insertLog(client, { tanggal: "2026-07-10", orderId: "TEST-BD-ORD-RANGE-OK", itemName: "Belum Diproses" });
    await insertLog(client, {
      tanggal: "2026-07-10",
      orderId: "TEST-BD-ORD-RANGE-SKIP",
      itemName: "Historis",
      invStatus: "SKIP-HISTORIS",
    });
    await insertLog(client, {
      tanggal: "2026-07-10",
      orderId: "TEST-BD-ORD-RANGE-SUDAH",
      itemName: "Sudah Diproses",
      processedAt: "2026-07-11T03:00:00Z",
    });

    const hasil = milikFixture(
      await listBelumDiproses(client, { tanggalMulai: "2026-07-01", tanggalSelesai: "2026-07-31" }),
    );

    assert.deepEqual(
      hasil.map((r) => r.orderId),
      ["TEST-BD-ORD-RANGE-OK"],
      "ketiga baris ada di dalam rentang, tapi hanya yang OK + belum diproses yang muncul",
    );
  });
});

// ---------------------------------------------------------------------------
// Bentuk response: FLAT per baris, BUKAN per order
// ---------------------------------------------------------------------------

test("listBelumDiproses: response PER BARIS, bukan per order -- satu order dengan 2 baris menu = 2 objek", async () => {
  await withRollback(async (client) => {
    const ORDER = "TEST-BD-ORD-DUABARIS";
    await insertLog(client, {
      tanggal: "2026-07-12",
      orderId: ORDER,
      itemName: "Bubur Ayam Original",
      menuId: "TEST-BD-EXT-BUBUR",
      quantity: 2,
    });
    await insertLog(client, {
      tanggal: "2026-07-12",
      orderId: ORDER,
      itemName: "Es Teler",
      menuId: "TEST-BD-EXT-TELER",
      quantity: 1,
    });

    const hasil = milikFixture(await listBelumDiproses(client, {}));

    assert.equal(hasil.length, 2, "satu order 2 baris menu -> 2 objek response (TIDAK dikelompokkan per order)");
    assert.equal(
      hasil.every((r) => r.orderId === ORDER && r.tanggal === "2026-07-12"),
      true,
      "kedua objek membawa identitas order yang sama",
    );
    // Tiap baris membawa menu & qty-nya sendiri, tidak digabung/dijumlahkan.
    const perItem = hasil.map((r) => `${r.menuId}:${r.quantity}`).sort();
    assert.deepEqual(perItem, ["TEST-BD-EXT-BUBUR:2", "TEST-BD-EXT-TELER:1"]);
  });
});

test("listBelumDiproses: urutan ORDER BY transaction_date DESC, platform, order_id", async () => {
  await withRollback(async (client) => {
    // Tanggal lebih baru untuk PLATFORM_B -> harus di ATAS walau nama
    // platform-nya lebih besar secara alfabet (tanggal adalah kunci PERTAMA).
    await insertLog(client, {
      tanggal: "2026-07-20",
      orderId: "TEST-BD-ORD-B1",
      itemName: "B Baru",
      platform: PLATFORM_B,
    });
    // Satu tanggal, dua platform, order_id sengaja dibuat urutannya terbalik
    // dari urutan insert supaya bukan sekadar urutan fisik tabel.
    await insertLog(client, {
      tanggal: "2026-07-15",
      orderId: "TEST-BD-ORD-Z",
      itemName: "A Z",
      platform: PLATFORM,
    });
    await insertLog(client, {
      tanggal: "2026-07-15",
      orderId: "TEST-BD-ORD-A",
      itemName: "A A",
      platform: PLATFORM,
    });
    await insertLog(client, {
      tanggal: "2026-07-15",
      orderId: "TEST-BD-ORD-B0",
      itemName: "B pada tanggal sama",
      platform: PLATFORM_B,
    });

    const hasil = milikFixture(await listBelumDiproses(client, {}));

    assert.deepEqual(
      hasil.map((r) => `${r.tanggal}|${r.platform}|${r.orderId}`),
      [
        `2026-07-20|${PLATFORM_B}|TEST-BD-ORD-B1`,
        `2026-07-15|${PLATFORM}|TEST-BD-ORD-A`,
        `2026-07-15|${PLATFORM}|TEST-BD-ORD-Z`,
        `2026-07-15|${PLATFORM_B}|TEST-BD-ORD-B0`,
      ],
      "tanggal DESC dulu, lalu platform ASC, lalu order_id ASC",
    );
  });
});
