import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import { listRefundRange } from "./refund.js";
import { withRollback } from "./test-helpers.js";

after(() => pool.end());

const PREFIX = "TEST-REFUND-";

async function insertLogRefund(
  client: PoolClient,
  opts: { orderId: string; platform?: string; itemName?: string; qty?: number; tanggal: string; jam?: string },
): Promise<void> {
  await client.query(
    `INSERT INTO salessync_log_penjualan
       (transaction_date, transaction_time, platform, order_id, item_name, menu_id, quantity, item_type, parent_item, unique_key, inv_status)
     VALUES ($1, $2, $3, $4, $5, $5, $6, 'refund', '', $7, 'SKIP-REFUND')`,
    [
      opts.tanggal,
      opts.jam ?? "12:00:00",
      opts.platform ?? "GrabFood",
      opts.orderId,
      opts.itemName ?? "Item Refund Uji",
      opts.qty ?? -1,
      `${PREFIX}${opts.orderId}`,
    ],
  );
}

async function insertMajooRefund(
  client: PoolClient,
  opts: { refundId: number; transactionNo: string; refundAmount: number; refundDateWib: string },
): Promise<void> {
  await client.query(
    `INSERT INTO salessync_majoo_refund (refund_id, transaction_no, refund_date, refund_amount)
     VALUES ($1, $2, $3::timestamp AT TIME ZONE 'Asia/Jakarta', $4)`,
    [opts.refundId, opts.transactionNo, opts.refundDateWib, opts.refundAmount],
  );
}

test("listRefundRange: menggabungkan DUA sumber (log_penjualan + majoo_refund) dalam satu daftar, field yang tidak tersedia null", async () => {
  await withRollback(async (client) => {
    await insertLogRefund(client, { orderId: `${PREFIX}ORD-1`, tanggal: "2026-11-07", itemName: "Burket Panas", qty: -1 });
    await insertMajooRefund(client, {
      refundId: 9_700_000_001,
      transactionNo: `${PREFIX}CS-1`,
      refundAmount: 57000,
      refundDateWib: "2026-11-07 10:15:00",
    });

    const hasil = await listRefundRange(client, "2026-11-07", "2026-11-07");
    const dariLog = hasil.find((r) => r.orderId === `${PREFIX}ORD-1`);
    const dariMajoo = hasil.find((r) => r.orderId === `${PREFIX}CS-1`);

    assert.ok(dariLog, "baris dari salessync_log_penjualan harus muncul");
    assert.equal(dariLog!.itemName, "Burket Panas");
    assert.equal(dariLog!.qty, -1);
    assert.equal(dariLog!.refundAmount, null, "log_penjualan TIDAK PERNAH punya nominal Rupiah");

    assert.ok(dariMajoo, "baris dari salessync_majoo_refund harus muncul");
    assert.equal(dariMajoo!.refundAmount, 57000);
    assert.equal(dariMajoo!.itemName, null, "majoo_refund TIDAK PUNYA breakdown item");
    assert.equal(dariMajoo!.qty, null);
    assert.equal(dariMajoo!.platform, "Majoo");
  });
});

test("listRefundRange: batas hari WIB benar untuk refund_date (TIMESTAMPTZ) -- jam dini hari WIB tidak kepotong ke hari sebelumnya", async () => {
  await withRollback(async (client) => {
    // 2026-11-07 00:30 WIB = 2026-11-06 17:30 UTC -- kalau filter salah pakai
    // UTC polos, baris ini akan HILANG dari query tanggal 2026-11-07.
    await insertMajooRefund(client, {
      refundId: 9_700_000_002,
      transactionNo: `${PREFIX}CS-DINIHARI`,
      refundAmount: 10000,
      refundDateWib: "2026-11-07 00:30:00",
    });

    const hasil = await listRefundRange(client, "2026-11-07", "2026-11-07");
    assert.ok(
      hasil.some((r) => r.orderId === `${PREFIX}CS-DINIHARI`),
      "refund jam 00:30 WIB tanggal 7 Nov harus masuk filter tanggal 7 Nov (bukan 6 Nov)",
    );

    const hasilSebelum = await listRefundRange(client, "2026-11-06", "2026-11-06");
    assert.ok(
      !hasilSebelum.some((r) => r.orderId === `${PREFIX}CS-DINIHARI`),
      "refund jam 00:30 WIB tanggal 7 Nov TIDAK boleh ikut masuk filter tanggal 6 Nov",
    );
  });
});

test("listRefundRange: di luar rentang tanggal tidak ikut", async () => {
  await withRollback(async (client) => {
    await insertLogRefund(client, { orderId: `${PREFIX}ORD-LUAR`, tanggal: "2026-10-01" });
    await insertMajooRefund(client, {
      refundId: 9_700_000_003,
      transactionNo: `${PREFIX}CS-LUAR`,
      refundAmount: 5000,
      refundDateWib: "2026-10-01 10:00:00",
    });

    const hasil = await listRefundRange(client, "2026-11-07", "2026-11-07");
    assert.ok(!hasil.some((r) => r.orderId === `${PREFIX}ORD-LUAR` || r.orderId === `${PREFIX}CS-LUAR`));
  });
});
