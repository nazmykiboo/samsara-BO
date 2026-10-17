import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import { importBiayaPlatform, importLogPenjualan, importRawMajoo, importTransaksi } from "./import-csv.js";
import { withRollback } from "./test-helpers.js";

/**
 * Test keempat fungsi import CSV modul sales-sync, LANGSUNG di domain layer
 * (satu `PoolClient` di dalam `withRollback`) -- keempatnya murni SQL di satu
 * koneksi, tidak memanggil HTTP/modul lain sama sekali, jadi tidak punya
 * kendala lintas-transaksi seperti `apps/api/src/sales-sync-proses.test.ts`
 * (yang WAJIB lewat server HTTP sungguhan karena menyentuh modul Inventory
 * lintas proses). Semua yang ditulis test ini selalu di-ROLLBACK.
 *
 * Fokus utama: TIGA kategori hasil upsert (`dibuat`/`diperbarui`/`dilewati`)
 * yang dibedakan lewat trik `xmax` + klausa `WHERE ... IS DISTINCT FROM`, dan
 * KUNCI UNIK tiap tabel (tidak ditebak -- diambil dari constraint di
 * `db/migrations/0001_create_sales_sync_tables.sql` dan komentar di
 * `import-csv.ts`):
 *   - salessync_log_penjualan   -> UNIQUE (unique_key)
 *   - salessync_transaksi       -> UNIQUE (source_id, platform_order_number)
 *   - salessync_raw_majoo       -> PRIMARY KEY (id), id asli dari Majoo
 *   - salessync_biaya_platform  -> UNIQUE (id_platform), NULL tidak pernah dedup
 *
 * Semua fixture memakai prefix `TEST-IMP-` supaya tidak mungkin bertabrakan
 * dengan baris arsip asli (19.519 log penjualan, 11.689 transaksi, 5.645 raw
 * Majoo, 168 biaya platform) maupun dengan fixture test lain.
 */

after(() => pool.end());

const PREFIX = "TEST-IMP-";
/** Platform fiktif -- sengaja BUKAN 'Shopee'/'GoFood' dst supaya tidak nyampur ke data asli. */
const PLATFORM = `${PREFIX}PLATFORM`;
/** id raw Majoo fiktif, jauh di atas id asli mana pun di arsip. */
const MAJOO_ID_DASAR = 9_900_000_000;

// ---------------------------------------------------------------------------
// Helper CSV & query
// ---------------------------------------------------------------------------

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Susun teks CSV dari header + daftar nilai per kolom (quoting otomatis). */
function buatCsv(header: readonly string[], barisNilai: ReadonlyArray<Record<string, string>>): string {
  const baris = barisNilai.map((nilai) => header.map((kolom) => nilai[kolom] ?? ""));
  return [[...header], ...baris].map((r) => r.map(csvField).join(",")).join("\n") + "\n";
}

async function hitung(client: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await client.query<{ n: string }>(sql, params);
  return Number(rows[0].n);
}

// ---------------------------------------------------------------------------
// 1. importLogPenjualan
// ---------------------------------------------------------------------------

const HEADER_LOG = [
  "transaction_date",
  "transaction_time",
  "platform",
  "order_id",
  "item_name",
  "menu_id",
  "quantity",
  "item_type",
  "parent_item",
  "unique_key",
  "inv_status",
] as const;

function barisLog(nomor: number, ubah: Record<string, string> = {}): Record<string, string> {
  return {
    transaction_date: "7/22/2026",
    transaction_time: "6:16",
    platform: PLATFORM,
    order_id: `${PREFIX}ORDER-${nomor}`,
    item_name: `Item Uji ${nomor}`,
    menu_id: `${PREFIX}EXT-${nomor}`,
    quantity: String(nomor),
    item_type: "menu",
    parent_item: "",
    unique_key: `${PREFIX}KEY-${nomor}`,
    inv_status: "OK",
    ...ubah,
  };
}

const hitungLog = (client: PoolClient) =>
  hitung(client, `SELECT count(*)::text AS n FROM salessync_log_penjualan WHERE unique_key LIKE $1`, [`${PREFIX}%`]);

test("importLogPenjualan: CSV baru -> dibuat; import ULANG identik -> dilewati (bukan diperbarui, tanpa baris dobel); satu nilai berubah -> diperbarui", async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_LOG, [barisLog(1), barisLog(2), barisLog(3)]);

    const pertama = await importLogPenjualan(client, csv);
    assert.deepEqual(pertama, { dibuat: 3, diperbarui: 0, dilewati: 0, errors: [] });
    assert.equal(await hitungLog(client), 3);

    // Pembuktian nilai benar-benar masuk sesuai konversi format sumber.
    const { rows } = await client.query<{
      transaction_date: string;
      transaction_time: string;
      quantity: number;
      parent_item: string | null;
    }>(
      `SELECT transaction_date, transaction_time, quantity, parent_item
       FROM salessync_log_penjualan WHERE unique_key = $1`,
      [`${PREFIX}KEY-2`],
    );
    assert.equal(rows[0].transaction_date, "2026-07-22", "M/D/YYYY -> YYYY-MM-DD tanpa pergeseran timezone");
    assert.equal(rows[0].transaction_time, "06:16:00", "H:MM -> HH:MM:00");
    assert.equal(rows[0].quantity, 2);
    assert.equal(rows[0].parent_item, null, "kolom opsional kosong disimpan NULL, bukan string kosong");

    // Import ULANG file yang SAMA PERSIS: tidak ada yang berubah -> dilewati.
    const kedua = await importLogPenjualan(client, csv);
    assert.deepEqual(kedua, { dibuat: 0, diperbarui: 0, dilewati: 3, errors: [] });
    assert.equal(await hitungLog(client), 3, "import ulang file identik TIDAK boleh menambah baris");

    // Import ULANG dengan SATU nilai berbeda (quantity) pada unique_key yang sama.
    const csvUbah = buatCsv(HEADER_LOG, [barisLog(1), barisLog(2, { quantity: "99" }), barisLog(3)]);
    const ketiga = await importLogPenjualan(client, csvUbah);
    assert.deepEqual(ketiga, { dibuat: 0, diperbarui: 1, dilewati: 2, errors: [] });
    assert.equal(await hitungLog(client), 3, "baris dengan unique_key sama di-UPDATE, bukan di-INSERT lagi");

    const quantity = await hitung(
      client,
      `SELECT quantity::text AS n FROM salessync_log_penjualan WHERE unique_key = $1`,
      [`${PREFIX}KEY-2`],
    );
    assert.equal(quantity, 99, "nilai di database benar-benar berubah ke nilai baru");
  });
});

test("importLogPenjualan: satu baris tidak valid di tengah dicatat di errors[] dengan nomor baris benar, dua baris lain TETAP masuk", async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_LOG, [
      barisLog(1),
      barisLog(2, { quantity: "dua" }), // baris data ke-2 -> rusak
      barisLog(3),
    ]);

    const hasil = await importLogPenjualan(client, csv);

    assert.equal(hasil.dibuat, 2, "baris baik tetap tersimpan");
    assert.equal(hasil.diperbarui, 0);
    assert.equal(hasil.dilewati, 0);
    assert.equal(hasil.errors.length, 1);
    assert.equal(hasil.errors[0].baris, 2, "nomor baris DATA (1-based, header tidak dihitung)");
    assert.match(hasil.errors[0].pesan, /quantity/);

    assert.equal(await hitungLog(client), 2);
    assert.equal(
      await hitung(client, `SELECT count(*)::text AS n FROM salessync_log_penjualan WHERE unique_key = $1`, [
        `${PREFIX}KEY-2`,
      ]),
      0,
      "baris rusak tidak tersimpan",
    );
  });
});

test("importLogPenjualan: error dari DATABASE (quantity di luar rentang INTEGER) juga tidak menggagalkan baris lain -- SAVEPOINT per baris bekerja", async () => {
  await withRollback(async (client) => {
    // Lolos validasi JS (Number.isInteger true) tapi DITOLAK Postgres karena
    // kolom quantity bertipe INTEGER -- satu-satunya cara menguji jalur
    // ROLLBACK TO SAVEPOINT, bukan jalur validasi di `buat()`.
    const csv = buatCsv(HEADER_LOG, [barisLog(1), barisLog(2, { quantity: "9999999999999" }), barisLog(3)]);

    const hasil = await importLogPenjualan(client, csv);

    assert.equal(hasil.errors.length, 1);
    assert.equal(hasil.errors[0].baris, 2);
    assert.equal(hasil.dibuat, 2, "baris SESUDAH baris yang gagal di database tetap tersimpan");
    assert.equal(await hitungLog(client), 2);

    // Kalau SAVEPOINT tidak dipakai, transaksi sudah ter-abort dan query di
    // bawah ini akan ikut gagal ("current transaction is aborted").
    assert.equal(await hitung(client, `SELECT 1::text AS n`), 1, "transaksi masih hidup setelah error baris");
  });
});

test("importLogPenjualan: processed_at yang SUDAH terisi TIDAK ter-reset oleh import ulang (identik maupun berubah)", async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_LOG, [barisLog(1)]);
    assert.equal((await importLogPenjualan(client, csv)).dibuat, 1);

    // Simulasi baris yang sudah diproses jadi transaksi Penjualan Inventory.
    await client.query(`UPDATE salessync_log_penjualan SET processed_at = now() WHERE unique_key = $1`, [
      `${PREFIX}KEY-1`,
    ]);
    const { rows: awal } = await client.query<{ processed_at: Date | null }>(
      `SELECT processed_at FROM salessync_log_penjualan WHERE unique_key = $1`,
      [`${PREFIX}KEY-1`],
    );
    const stempel = awal[0].processed_at;
    assert.ok(stempel instanceof Date, "prasyarat: processed_at terisi");

    // (a) import ulang file IDENTIK -> dilewati, processed_at tidak disentuh.
    assert.equal((await importLogPenjualan(client, csv)).dilewati, 1);
    const { rows: setelahIdentik } = await client.query<{ processed_at: Date | null }>(
      `SELECT processed_at FROM salessync_log_penjualan WHERE unique_key = $1`,
      [`${PREFIX}KEY-1`],
    );
    assert.deepEqual(setelahIdentik[0].processed_at, stempel, "import ulang identik tidak mereset processed_at");

    // (b) import ulang dengan NILAI BERBEDA -> diperbarui, processed_at TETAP.
    // Ini jaminan "re-import file yang sama/terkoreksi tidak mereset status
    // sudah-diproses": kalau assertion ini gagal, itu REGRESI di SQL_LOG
    // (processed_at ikut masuk SET atau ikut di IS DISTINCT FROM), bukan test
    // yang perlu disesuaikan.
    const csvUbah = buatCsv(HEADER_LOG, [barisLog(1, { quantity: "7", item_name: "Item Uji 1 (nama baru)" })]);
    assert.equal((await importLogPenjualan(client, csvUbah)).diperbarui, 1);
    const { rows: setelahUbah } = await client.query<{ processed_at: Date | null; quantity: number }>(
      `SELECT processed_at, quantity FROM salessync_log_penjualan WHERE unique_key = $1`,
      [`${PREFIX}KEY-1`],
    );
    assert.equal(setelahUbah[0].quantity, 7, "kolom lain memang ikut ter-update");
    assert.deepEqual(setelahUbah[0].processed_at, stempel, "processed_at TETAP, tidak ter-reset ke NULL");
  });
});

test("importLogPenjualan: antrian pemetaan item terisi otomatis di akhir import (memanggil syncItemMappingFromLog)", async () => {
  await withRollback(async (client) => {
    const sebelum = await hitung(
      client,
      `SELECT count(*)::text AS n FROM salessync_item_mapping WHERE platform = $1`,
      [PLATFORM],
    );
    assert.equal(sebelum, 0, "prasyarat: platform fiktif ini belum punya baris pemetaan");

    await importLogPenjualan(client, buatCsv(HEADER_LOG, [barisLog(1), barisLog(2)]));

    const { rows } = await client.query<{ kode_eksternal: string; nama_eksternal: string; status: string; kode_menu: string | null }>(
      `SELECT kode_eksternal, nama_eksternal, status, kode_menu
       FROM salessync_item_mapping WHERE platform = $1 ORDER BY kode_eksternal`,
      [PLATFORM],
    );
    assert.equal(rows.length, 2, "tiap kode eksternal baru dari log langsung masuk antrian pemetaan");
    assert.equal(rows[0].kode_eksternal, `${PREFIX}EXT-1`);
    assert.equal(rows[0].nama_eksternal, "Item Uji 1");
    assert.equal(rows[0].status, "belum_dipetakan");
    assert.equal(rows[0].kode_menu, null);
  });
});

test("importLogPenjualan: header CSV tidak lengkap ditolak sebelum menyentuh data apa pun", async () => {
  await withRollback(async (client) => {
    const header = HEADER_LOG.filter((k) => k !== "inv_status" && k !== "menu_id");
    await assert.rejects(
      () => importLogPenjualan(client, buatCsv(header, [barisLog(1)])),
      /Header CSV tidak lengkap.*menu_id.*inv_status/s,
    );
    assert.equal(await hitungLog(client), 0);
  });
});

test('importLogPenjualan: transaction_date/transaction_time format ISO ("gaya Postgres") diterima SAMA seperti M/D/YYYY ("gaya Google Sheet")', async () => {
  // Sumber log_penjualan bisa berupa ekspor Postgres (tanggal ISO) atau
  // Google Sheet (M/D/YYYY) -- lihat docs/integrasi-n8n.md. Keduanya harus
  // menghasilkan nilai tersimpan yang IDENTIK.
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_LOG, [
      barisLog(1, { transaction_date: "2026-07-22", transaction_time: "06:16:00" }),
    ]);
    assert.deepEqual(await importLogPenjualan(client, csv), { dibuat: 1, diperbarui: 0, dilewati: 0, errors: [] });

    const { rows } = await client.query<{ transaction_date: string; transaction_time: string }>(
      `SELECT transaction_date, transaction_time FROM salessync_log_penjualan WHERE unique_key = $1`,
      [`${PREFIX}KEY-1`],
    );
    assert.equal(rows[0].transaction_date, "2026-07-22");
    assert.equal(rows[0].transaction_time, "06:16:00");
  });
});

// ---------------------------------------------------------------------------
// 2. importTransaksi
// ---------------------------------------------------------------------------

const HEADER_TRANSAKSI = [
  "platform",
  "platform_order_number",
  "platform_transaction_id",
  "order_time",
  "settled_time",
  "status",
  "gross_amount",
  "total_fees",
  "net_revenue",
  "currency",
  "source",
  "source_id",
  "raw_payload",
] as const;

function barisTransaksi(nomor: number, ubah: Record<string, string> = {}): Record<string, string> {
  return {
    platform: PLATFORM,
    platform_order_number: `${PREFIX}ORD-${nomor}`,
    platform_transaction_id: `${PREFIX}TRX-${nomor}`,
    order_time: "2026-07-25T13:30:00+07:00",
    settled_time: "",
    status: "SETTLED",
    // Format sumber: berkutip dengan pemisah ribuan koma.
    gross_amount: "29,600",
    total_fees: "3,000",
    net_revenue: "26,600",
    currency: "IDR",
    source: "email",
    source_id: `${PREFIX}SRC-${nomor}`,
    raw_payload: `{"order":"${PREFIX}ORD-${nomor}","fees":[1000,2000]}`,
    ...ubah,
  };
}

const hitungTransaksi = (client: PoolClient) =>
  hitung(client, `SELECT count(*)::text AS n FROM salessync_transaksi WHERE source_id LIKE $1`, [`${PREFIX}%`]);

test("importTransaksi: dibuat -> dilewati (import ulang identik) -> diperbarui (gross_amount berubah), kunci upsert (source_id, platform_order_number)", async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_TRANSAKSI, [barisTransaksi(1), barisTransaksi(2)]);

    assert.deepEqual(await importTransaksi(client, csv), { dibuat: 2, diperbarui: 0, dilewati: 0, errors: [] });
    assert.equal(await hitungTransaksi(client), 2);

    const { rows } = await client.query<{ gross_amount: string; settled_time: Date | null; raw_payload: unknown }>(
      `SELECT gross_amount, settled_time, raw_payload FROM salessync_transaksi
       WHERE source_id = $1 AND platform_order_number = $2`,
      [`${PREFIX}SRC-1`, `${PREFIX}ORD-1`],
    );
    assert.equal(
      Number(rows[0].gross_amount),
      29600,
      'pemisah ribuan koma dibuang sebelum parseFloat (bukan 29 dari parseFloat("29,600"))',
    );
    assert.equal(rows[0].settled_time, null);
    assert.deepEqual(rows[0].raw_payload, { order: `${PREFIX}ORD-1`, fees: [1000, 2000] }, "JSON berkutip masuk utuh");

    assert.deepEqual(await importTransaksi(client, csv), { dibuat: 0, diperbarui: 0, dilewati: 2, errors: [] });
    assert.equal(await hitungTransaksi(client), 2, "import ulang identik tidak menambah baris");

    const csvUbah = buatCsv(HEADER_TRANSAKSI, [barisTransaksi(1, { gross_amount: "31,000" }), barisTransaksi(2)]);
    assert.deepEqual(await importTransaksi(client, csvUbah), { dibuat: 0, diperbarui: 1, dilewati: 1, errors: [] });
    assert.equal(await hitungTransaksi(client), 2);
    assert.equal(
      await hitung(
        client,
        `SELECT gross_amount::text AS n FROM salessync_transaksi WHERE source_id = $1 AND platform_order_number = $2`,
        [`${PREFIX}SRC-1`, `${PREFIX}ORD-1`],
      ),
      31000,
      "nilai berubah ke nilai baru",
    );
  });
});

test("importTransaksi: source_id SAMA dengan platform_order_number BEDA -> KEDUANYA ter-insert (kunci upsert kombinasi keduanya, bukan source_id sendirian)", async () => {
  await withRollback(async (client) => {
    // Kasus nyata: satu email laporan harian (satu source_id) berisi banyak
    // order sebagai baris terpisah. Lihat COMMENT ON COLUMN
    // salessync_transaksi.source_id -- kalau kunci upsert "disederhanakan"
    // balik ke source_id saja, baris kedua akan MENIMPA baris pertama dan
    // assertion di bawah gagal. Itu REGRESI, bukan test yang perlu diubah.
    const sourceId = `${PREFIX}SRC-SATU-LAPORAN`;
    const csv = buatCsv(HEADER_TRANSAKSI, [
      barisTransaksi(1, { source_id: sourceId, platform_order_number: `${PREFIX}ORD-A` }),
      barisTransaksi(2, { source_id: sourceId, platform_order_number: `${PREFIX}ORD-B` }),
    ]);

    const hasil = await importTransaksi(client, csv);
    assert.deepEqual(hasil, { dibuat: 2, diperbarui: 0, dilewati: 0, errors: [] });

    const { rows } = await client.query<{ platform_order_number: string }>(
      `SELECT platform_order_number FROM salessync_transaksi WHERE source_id = $1 ORDER BY platform_order_number`,
      [sourceId],
    );
    assert.equal(rows.length, 2, "dua order dalam satu source_id harus jadi DUA baris, tidak saling menimpa");
    assert.deepEqual(
      rows.map((r) => r.platform_order_number),
      [`${PREFIX}ORD-A`, `${PREFIX}ORD-B`],
    );

    // Import ulang persis -> keduanya dilewati (dedup tetap jalan per kombinasi).
    assert.deepEqual(await importTransaksi(client, csv), { dibuat: 0, diperbarui: 0, dilewati: 2, errors: [] });
    assert.equal(await hitungTransaksi(client), 2);
  });
});

test("importTransaksi: baris dengan angka tidak valid masuk errors[] tanpa menggagalkan baris lain", async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_TRANSAKSI, [
      barisTransaksi(1),
      barisTransaksi(2, { gross_amount: "bukan-angka" }),
      barisTransaksi(3),
    ]);

    const hasil = await importTransaksi(client, csv);

    assert.equal(hasil.dibuat, 2);
    assert.equal(hasil.errors.length, 1);
    assert.equal(hasil.errors[0].baris, 2);
    assert.match(hasil.errors[0].pesan, /gross_amount/);
    assert.equal(await hitungTransaksi(client), 2);
  });
});

test("importTransaksi: raw_payload yang bukan JSON valid disimpan NULL dan barisnya TETAP diproses", async () => {
  await withRollback(async (client) => {
    const hasil = await importTransaksi(
      client,
      buatCsv(HEADER_TRANSAKSI, [barisTransaksi(1, { raw_payload: "{ini bukan json" })]),
    );
    assert.deepEqual(hasil, { dibuat: 1, diperbarui: 0, dilewati: 0, errors: [] });

    const { rows } = await client.query<{ raw_payload: unknown; net_revenue: string }>(
      `SELECT raw_payload, net_revenue FROM salessync_transaksi WHERE source_id = $1`,
      [`${PREFIX}SRC-1`],
    );
    assert.equal(rows[0].raw_payload, null, "kolom pendukung gagal parse -> NULL, bukan error baris");
    assert.equal(Number(rows[0].net_revenue), 26600, "angka-angka utama tetap tersimpan");
  });
});

test('importTransaksi: order_time format "M/D/YYYY H:MM:SS" (gaya Google Sheet) diterima SAMA seperti ISO+offset (gaya Postgres)', async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_TRANSAKSI, [
      barisTransaksi(1, { order_time: "7/25/2026 13:30:00" }),
    ]);
    assert.deepEqual(await importTransaksi(client, csv), { dibuat: 1, diperbarui: 0, dilewati: 0, errors: [] });

    const { rows } = await client.query<{ jam_lokal: string }>(
      `SELECT to_char(order_time AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') AS jam_lokal
       FROM salessync_transaksi WHERE source_id = $1`,
      [`${PREFIX}SRC-1`],
    );
    assert.equal(rows[0].jam_lokal, "2026-07-25 13:30:00", '"7/25/2026 13:30:00" ditafsir sebagai jam lokal WIB');
  });
});

// ---------------------------------------------------------------------------
// 3. importRawMajoo
// ---------------------------------------------------------------------------

const HEADER_MAJOO = [
  "id",
  "transaction_no",
  "transaction_date",
  "payment_date",
  "order_type_name",
  "payment_method_name",
  "payment_cashier_name",
  "total_sales",
  "receivables",
  "total_discount_amount",
  "refund_amount",
  "is_paid",
  "outlet_id",
  "hasMore",
  "nextPage",
  "_empty",
  "refund_id",
  "refund_no",
  "refund_date",
  "refund_reason",
] as const;

function barisMajoo(nomor: number, ubah: Record<string, string> = {}): Record<string, string> {
  return {
    id: String(MAJOO_ID_DASAR + nomor),
    transaction_no: `${PREFIX}TRXNO-${nomor}`,
    transaction_date: "2025-12-15T15:12:22Z",
    payment_date: "2025-12-15T15:12:30Z",
    order_type_name: "Dine In",
    payment_method_name: "Cash",
    payment_cashier_name: "Kasir Uji",
    total_sales: "50000",
    receivables: "0",
    total_discount_amount: "0",
    refund_amount: "0",
    is_paid: "1",
    outlet_id: `${PREFIX}OUTLET`,
    hasMore: "",
    nextPage: "",
    _empty: "",
    refund_id: "",
    refund_no: "",
    refund_date: "",
    refund_reason: "",
    ...ubah,
  };
}

const hitungMajoo = (client: PoolClient) =>
  hitung(client, `SELECT count(*)::text AS n FROM salessync_raw_majoo WHERE transaction_no LIKE $1`, [`${PREFIX}%`]);

test("importRawMajoo: dibuat -> dilewati -> diperbarui dengan kunci upsert (id) dari id asli Majoo", async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_MAJOO, [barisMajoo(1), barisMajoo(2), barisMajoo(3)]);

    assert.deepEqual(await importRawMajoo(client, csv), { dibuat: 3, diperbarui: 0, dilewati: 0, errors: [] });
    assert.equal(await hitungMajoo(client), 3);

    const { rows } = await client.query<{ id: string; is_paid: boolean; has_more: string | null; empty_field: string | null; total_sales: string }>(
      `SELECT id, is_paid, has_more, empty_field, total_sales FROM salessync_raw_majoo WHERE id = $1`,
      [MAJOO_ID_DASAR + 1],
    );
    assert.equal(Number(rows[0].id), MAJOO_ID_DASAR + 1, "id dipakai apa adanya dari sumber, bukan identity");
    assert.equal(rows[0].is_paid, true, 'is_paid "1" -> true');
    assert.equal(rows[0].has_more, null, "kolom metadata pagination kosong -> NULL");
    assert.equal(rows[0].empty_field, null, "kolom sumber _empty dipetakan ke empty_field");
    assert.equal(Number(rows[0].total_sales), 50000, "angka sumber ini POLOS (tanpa pemisah ribuan)");

    assert.deepEqual(await importRawMajoo(client, csv), { dibuat: 0, diperbarui: 0, dilewati: 3, errors: [] });
    assert.equal(await hitungMajoo(client), 3, "import ulang identik tidak menambah baris");

    const csvUbah = buatCsv(HEADER_MAJOO, [
      barisMajoo(1),
      barisMajoo(2, { total_sales: "75500", is_paid: "0" }),
      barisMajoo(3),
    ]);
    assert.deepEqual(await importRawMajoo(client, csvUbah), { dibuat: 0, diperbarui: 1, dilewati: 2, errors: [] });
    assert.equal(await hitungMajoo(client), 3);

    const { rows: setelah } = await client.query<{ total_sales: string; is_paid: boolean }>(
      `SELECT total_sales, is_paid FROM salessync_raw_majoo WHERE id = $1`,
      [MAJOO_ID_DASAR + 2],
    );
    assert.equal(Number(setelah[0].total_sales), 75500, "nilai berubah ke nilai baru");
    assert.equal(setelah[0].is_paid, false);
  });
});

test("importRawMajoo: id bukan angka masuk errors[] dengan nomor baris benar, baris lain tetap tersimpan", async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_MAJOO, [barisMajoo(1), barisMajoo(2, { id: "bukan-angka" }), barisMajoo(3)]);

    const hasil = await importRawMajoo(client, csv);

    assert.equal(hasil.dibuat, 2);
    assert.equal(hasil.errors.length, 1);
    assert.equal(hasil.errors[0].baris, 2);
    assert.match(hasil.errors[0].pesan, /"id"/);
    assert.equal(await hitungMajoo(client), 2);
    assert.equal(
      await hitung(client, `SELECT count(*)::text AS n FROM salessync_raw_majoo WHERE transaction_no = $1`, [
        `${PREFIX}TRXNO-2`,
      ]),
      0,
    );
  });
});

test("importRawMajoo: kolom waktu berakhiran Z diperlakukan sebagai jam lokal Asia/Jakarta, BUKAN UTC asli", async () => {
  // Sumber Majoo selalu menulis "...15:12:22Z" tapi label itu salah -- angka
  // jamnya sebenarnya SUDAH WIB (dikonfirmasi lintas 5539 order sungguhan,
  // lihat docs/architecture-decisions.md § 24). Hasil tersimpan harus
  // menunjukkan jam dinding 15:12:22 saat dibaca di zona Asia/Jakarta -- KALAU
  // "Z" dipercaya sebagai UTC asli (bug lama), hasilnya akan 22:12:22 (+7 jam).
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_MAJOO, [barisMajoo(1)]);
    await importRawMajoo(client, csv);

    const { rows } = await client.query<{ jam_lokal: string; refund_date: string | null }>(
      `SELECT to_char(transaction_date AT TIME ZONE 'Asia/Jakarta', 'HH24:MI:SS') AS jam_lokal, refund_date
       FROM salessync_raw_majoo WHERE id = $1`,
      [MAJOO_ID_DASAR + 1],
    );
    assert.equal(rows[0].jam_lokal, "15:12:22", 'sumber "2025-12-15T15:12:22Z" -> 15:12:22 WIB, bukan 22:12:22');
    assert.equal(rows[0].refund_date, null, "refund_date kosong di sumber tetap NULL, tidak ikut diproses waktu");
  });
});

test("importRawMajoo: refund_date (opsional) juga diperlakukan sebagai jam lokal kalau diisi", async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_MAJOO, [
      barisMajoo(1, { refund_id: `${PREFIX}RF-1`, refund_date: "2026-01-10T09:30:00Z", refund_reason: "Salah input" }),
    ]);
    await importRawMajoo(client, csv);

    const { rows } = await client.query<{ jam_lokal: string }>(
      `SELECT to_char(refund_date AT TIME ZONE 'Asia/Jakarta', 'HH24:MI:SS') AS jam_lokal
       FROM salessync_raw_majoo WHERE id = $1`,
      [MAJOO_ID_DASAR + 1],
    );
    assert.equal(rows[0].jam_lokal, "09:30:00", 'sumber "2026-01-10T09:30:00Z" -> 09:30:00 WIB, bukan 16:30:00');
  });
});

test('importRawMajoo: angka "polos" (total_sales dkk.) TETAP benar walau sumber menuliskannya dengan pemisah ribuan koma (gaya Google Sheet)', async () => {
  // Bug nyata yang pernah ditemukan: parseFloat("-1,000") diam-diam = -1
  // (bukan error, bukan -1000) kalau koma tidak dibuang dulu. Sumber Majoo
  // asli tidak pernah berkoma, tapi ekspor lewat Google Sheet BISA menambah
  // koma -- harus tetap benar, bukan cuma "tidak error".
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_MAJOO, [
      barisMajoo(1, {
        transaction_date: "12/15/2025 15:12:22",
        total_sales: "50,000",
        receivables: "-1,000",
      }),
    ]);
    assert.deepEqual(await importRawMajoo(client, csv), { dibuat: 1, diperbarui: 0, dilewati: 0, errors: [] });

    const { rows } = await client.query<{ total_sales: string; receivables: string; jam_lokal: string }>(
      `SELECT total_sales, receivables,
              to_char(transaction_date AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') AS jam_lokal
       FROM salessync_raw_majoo WHERE id = $1`,
      [MAJOO_ID_DASAR + 1],
    );
    assert.equal(Number(rows[0].total_sales), 50000, 'bukan 50 dari parseFloat("50,000")');
    assert.equal(Number(rows[0].receivables), -1000, 'bukan -1 dari parseFloat("-1,000")');
    assert.equal(rows[0].jam_lokal, "2025-12-15 15:12:22", '"12/15/2025 15:12:22" (gaya Sheet) = jam lokal WIB');
  });
});

// ---------------------------------------------------------------------------
// 4. importBiayaPlatform
// ---------------------------------------------------------------------------

const HEADER_BIAYA = [
  "tanggal_closing",
  "platform",
  "kategori_biaya",
  "deskripsi",
  "transaction_type_raw",
  "amount",
  "amount_raw",
  "reference_id",
  "id_platform",
  "create_time",
  "synced_at",
] as const;

function barisBiaya(nomor: number, ubah: Record<string, string> = {}): Record<string, string> {
  return {
    tanggal_closing: "2026-08-04",
    platform: PLATFORM,
    kategori_biaya: "iklan",
    deskripsi: "Iklan dengan potongan harian",
    // Sengaja angka-sebagai-string: kolom ini TEXT, campuran angka & teks bebas.
    transaction_type_raw: "3",
    amount: "15000",
    amount_raw: "15000.1234",
    reference_id: `${PREFIX}REF-${nomor}`,
    id_platform: `${PREFIX}IDP-${nomor}`,
    create_time: "2026-08-04 10:15:00",
    synced_at: "2026-08-05T01:00:00Z",
    ...ubah,
  };
}

const hitungBiaya = (client: PoolClient) =>
  hitung(client, `SELECT count(*)::text AS n FROM salessync_biaya_platform WHERE reference_id LIKE $1`, [
    `${PREFIX}%`,
  ]);

test("importBiayaPlatform: dibuat -> dilewati -> diperbarui dengan kunci upsert (id_platform)", async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_BIAYA, [barisBiaya(1), barisBiaya(2)]);

    assert.deepEqual(await importBiayaPlatform(client, csv), { dibuat: 2, diperbarui: 0, dilewati: 0, errors: [] });
    assert.equal(await hitungBiaya(client), 2);

    const { rows } = await client.query<{ transaction_type_raw: string | null; amount: string; amount_raw: string }>(
      `SELECT transaction_type_raw, amount, amount_raw FROM salessync_biaya_platform WHERE id_platform = $1`,
      [`${PREFIX}IDP-1`],
    );
    assert.equal(rows[0].transaction_type_raw, "3", "disimpan sebagai STRING apa adanya");
    assert.equal(Number(rows[0].amount), 15000);
    assert.equal(Number(rows[0].amount_raw), 15000.1234, "amount_raw NUMERIC(18,4) tidak dibulatkan");

    assert.deepEqual(await importBiayaPlatform(client, csv), { dibuat: 0, diperbarui: 0, dilewati: 2, errors: [] });
    assert.equal(await hitungBiaya(client), 2, "import ulang identik tidak menambah baris");

    const csvUbah = buatCsv(HEADER_BIAYA, [barisBiaya(1, { amount: "17500" }), barisBiaya(2)]);
    assert.deepEqual(await importBiayaPlatform(client, csvUbah), { dibuat: 0, diperbarui: 1, dilewati: 1, errors: [] });
    assert.equal(await hitungBiaya(client), 2);
    assert.equal(
      await hitung(client, `SELECT amount::text AS n FROM salessync_biaya_platform WHERE id_platform = $1`, [
        `${PREFIX}IDP-1`,
      ]),
      17500,
      "nilai berubah ke nilai baru",
    );
  });
});

test("importBiayaPlatform: baris TANPA id_platform selalu 'dibuat' walau file yang sama diimport dua kali (NULL tidak pernah di-dedup -- SENGAJA, bukan bug)", async () => {
  await withRollback(async (client) => {
    // Lihat COMMENT ON COLUMN salessync_biaya_platform.id_platform: UNIQUE
    // constraint plain di Postgres tidak pernah menganggap NULL sama dengan
    // NULL lain, jadi baris historis tanpa id platform memang tidak bisa
    // di-dedup. Kode memakai INSERT polos (tanpa ON CONFLICT) untuk baris ini.
    const csv = buatCsv(HEADER_BIAYA, [
      barisBiaya(1, { id_platform: "", reference_id: `${PREFIX}REF-NULLID` }),
      barisBiaya(2, { id_platform: "", reference_id: `${PREFIX}REF-NULLID` }),
    ]);

    assert.deepEqual(await importBiayaPlatform(client, csv), { dibuat: 2, diperbarui: 0, dilewati: 0, errors: [] });

    const keduaKali = await importBiayaPlatform(client, csv);
    assert.deepEqual(
      keduaKali,
      { dibuat: 2, diperbarui: 0, dilewati: 0, errors: [] },
      "import KEDUA juga 'dibuat' -- tidak ada yang dilewati/diperbarui",
    );

    assert.equal(
      await hitung(client, `SELECT count(*)::text AS n FROM salessync_biaya_platform WHERE reference_id = $1`, [
        `${PREFIX}REF-NULLID`,
      ]),
      4,
      "2 baris x 2 import = 4 baris; duplikasi ini konsekuensi struktur sumber data",
    );
    assert.equal(
      await hitung(
        client,
        `SELECT count(*)::text AS n FROM salessync_biaya_platform WHERE reference_id = $1 AND id_platform IS NULL`,
        [`${PREFIX}REF-NULLID`],
      ),
      4,
      "id_platform kosong disimpan NULL, bukan string kosong",
    );
  });
});

test("importBiayaPlatform: amount tidak valid masuk errors[] tanpa menggagalkan baris lain", async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_BIAYA, [
      barisBiaya(1),
      barisBiaya(2, { amount: "Rp15.000" }),
      barisBiaya(3),
    ]);

    const hasil = await importBiayaPlatform(client, csv);

    assert.equal(hasil.dibuat, 2);
    assert.equal(hasil.errors.length, 1);
    assert.equal(hasil.errors[0].baris, 2);
    assert.match(hasil.errors[0].pesan, /amount/);
    assert.equal(await hitungBiaya(client), 2);
  });
});

test('importBiayaPlatform: tanggal M/D/YYYY dan angka berkoma ribuan (gaya Google Sheet) diterima dan BENAR, bukan sekadar lolos tanpa error', async () => {
  await withRollback(async (client) => {
    const csv = buatCsv(HEADER_BIAYA, [
      barisBiaya(1, {
        tanggal_closing: "8/4/2026",
        create_time: "8/4/2026 10:15:00",
        synced_at: "8/5/2026 01:00:00",
        amount: "-1,000",
      }),
    ]);
    assert.deepEqual(await importBiayaPlatform(client, csv), { dibuat: 1, diperbarui: 0, dilewati: 0, errors: [] });

    const { rows } = await client.query<{ tanggal: string; amount: string; jam_create: string }>(
      `SELECT to_char(tanggal_closing AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS tanggal, amount::text AS amount,
              to_char(create_time AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') AS jam_create
       FROM salessync_biaya_platform WHERE id_platform = $1`,
      [`${PREFIX}IDP-1`],
    );
    assert.equal(rows[0].tanggal, "2026-08-04", '"8/4/2026" (gaya Sheet) = tanggal lokal WIB yang sama');
    assert.equal(Number(rows[0].amount), -1000, 'bukan -1 dari parseFloat("-1,000")');
    assert.equal(rows[0].jam_create, "2026-08-04 10:15:00");
  });
});
