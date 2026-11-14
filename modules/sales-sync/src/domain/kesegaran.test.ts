import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import { getKesegaranSumber, setAmbangSegarManual } from "./kesegaran.js";
import { withRollback } from "./test-helpers.js";

after(() => pool.end());

async function insertRawMajoo(client: PoolClient, id: number, createdAt: string): Promise<void> {
  await client.query(
    `INSERT INTO salessync_raw_majoo
       (id, transaction_no, transaction_date, total_sales, receivables, total_discount_amount, refund_amount, is_paid, outlet_id, created_at)
     VALUES ($1, $2, now(), 10000, 10000, 0, 0, true, 'QA-OUTLET', $3::timestamptz)`,
    [id, `QA-TRX-${id}`, createdAt],
  );
}

async function insertLogPenjualan(client: PoolClient, orderId: string, platform: string, createdAt: string): Promise<void> {
  await client.query(
    `INSERT INTO salessync_log_penjualan
       (transaction_date, transaction_time, platform, order_id, item_name, quantity, item_type, unique_key, inv_status, created_at)
     VALUES (current_date, '12:00:00', $1, $2, 'Item QA Kesegaran', 1, 'menu', $2, 'OK', $3::timestamptz)`,
    [platform, orderId, createdAt],
  );
}

test("getKesegaranSumber: sumber TANPA baris sama sekali -> merah=true, ambangJam null, terakhirMasuk null", async () => {
  await withRollback(async (client) => {
    const hasil = await getKesegaranSumber(client);
    const majooRefund = hasil.find((s) => s.key === "majoo_refund");
    assert.ok(majooRefund);
    assert.equal(majooRefund!.terakhirMasuk, null);
    assert.equal(majooRefund!.ambangJam, null);
    assert.equal(majooRefund!.merah, true, "0 baris sama sekali -> HARUS merah (ini kasus raw-majoo di production)");
  });
});

test("getKesegaranSumber: baris berkala rapi + baris terakhir baru -> tidak merah (hijau)", async () => {
  await withRollback(async (client) => {
    const sekarang = Date.now();
    for (let i = 4; i >= 0; i--) {
      const jamLalu = i === 0 ? 0.05 : i * 24; // 96,72,48,24,~0 jam lalu
      const ts = new Date(sekarang - jamLalu * 3600000).toISOString();
      await insertRawMajoo(client, 9_810_000_000 + i, ts);
    }
    const hasil = await getKesegaranSumber(client);
    const rawMajoo = hasil.find((s) => s.key === "raw_majoo");
    assert.ok(rawMajoo);
    assert.ok(rawMajoo!.ambangJam !== null, "5 baris di jendela 7 hari -> ambang otomatis HARUS bisa dihitung");
    assert.equal(rawMajoo!.ambangDiatasManual, false);
    assert.equal(rawMajoo!.merah, false, "baris terakhir baru saja, jauh di bawah ambang -> hijau");
  });
});

test("getKesegaranSumber: baris berkala rapi TAPI baris terakhir sudah lama (lewat ambang) -> merah", async () => {
  await withRollback(async (client) => {
    const sekarang = Date.now();
    // SEMUA baris 15-20 hari lalu -- di luar jendela rata-rata 7 hari sama
    // sekali (bukan cuma "baris terakhir lama", tapi baseline-nya sendiri
    // tidak punya data apa pun di jendela 7 hari terakhir).
    for (let i = 20; i >= 15; i--) {
      const ts = new Date(sekarang - i * 24 * 3600000).toISOString();
      await insertLogPenjualan(client, `QA-KESEGARAN-${i}`, "GoFood", ts);
    }
    const hasil = await getKesegaranSumber(client);
    const gofood = hasil.find((s) => s.key === "gofood");
    assert.ok(gofood);
    // Baris-baris di atas semuanya > 7 hari lalu -> jendela rata-rata 7 hari
    // kosong -> ambang tidak bisa dihitung -> merah otomatis (bukan hijau).
    assert.equal(gofood!.ambangJam, null, "semua baris di luar jendela 7 hari -> tidak ada baseline");
    assert.equal(gofood!.merah, true);
  });
});

test("setAmbangSegarManual: override tersimpan dan dipakai (ambangDiatasManual=true), null menghapus override", async () => {
  await withRollback(async (client) => {
    await setAmbangSegarManual(client, "gofood", 12);
    let hasil = await getKesegaranSumber(client);
    let gofood = hasil.find((s) => s.key === "gofood")!;
    assert.equal(gofood.ambangJam, 12);
    assert.equal(gofood.ambangDiatasManual, true);

    await setAmbangSegarManual(client, "gofood", null);
    hasil = await getKesegaranSumber(client);
    gofood = hasil.find((s) => s.key === "gofood")!;
    assert.equal(gofood.ambangDiatasManual, false, "override dihapus -> balik ke hitung otomatis");
  });
});

test("setAmbangSegarManual: sumber tidak dikenal ditolak, angka <= 0 ditolak", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() => setAmbangSegarManual(client, "sumber-ngarang", 5), /tidak dikenal/i);
    await assert.rejects(() => setAmbangSegarManual(client, "gofood", 0), /lebih dari 0/i);
    await assert.rejects(() => setAmbangSegarManual(client, "gofood", -5), /lebih dari 0/i);
  });
});
