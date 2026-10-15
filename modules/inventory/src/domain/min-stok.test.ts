import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@samsara/core";
import { listMinStokByLocation, upsertMinStok } from "./min-stok.js";
import { locationId, withRollback } from "./test-helpers.js";

after(() => pool.end());

test("upsertMinStok: item+lokasi baru -> insert, audit log old_value null", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");

    const result = await upsertMinStok(client, { itemKode: "BB-001", locationId: ck, minStok: 500, userId: 1 });
    assert.equal(result.itemKode, "BB-001");
    assert.equal(result.locationId, ck);
    assert.equal(result.minStok, 500);

    const { rows } = await client.query(
      `SELECT min_stok, diubah_oleh, diubah_at FROM inventory_min_stok_lokasi WHERE id = $1`,
      [result.id],
    );
    assert.equal(Number(rows[0].min_stok), 500);
    assert.equal(Number(rows[0].diubah_oleh), 1);
    assert.ok(rows[0].diubah_at);

    const { rows: audit } = await client.query(
      `SELECT old_value, new_value, user_id FROM core_audit_log
       WHERE table_name = 'inventory_min_stok_lokasi' AND record_id = $1 AND field_name = 'min_stok'`,
      [result.id],
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0].old_value, null);
    assert.equal(audit[0].new_value, "500");
    assert.equal(Number(audit[0].user_id), 1);
  });
});

test("upsertMinStok: item+lokasi yang sudah ada -> update (ON CONFLICT), bukan baris baru; audit log old_value terisi", async () => {
  await withRollback(async (client) => {
    const outlet = await locationId(client, "samsara_outlet");

    const first = await upsertMinStok(client, { itemKode: "BB-002", locationId: outlet, minStok: 100, userId: 1 });
    const second = await upsertMinStok(client, { itemKode: "BB-002", locationId: outlet, minStok: 250, userId: 1 });

    assert.equal(second.id, first.id, "upsert kedua harus update baris yang sama, bukan bikin baris baru");
    assert.equal(second.minStok, 250);

    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM inventory_min_stok_lokasi WHERE id = $1`, [
      first.id,
    ]);
    assert.equal(rows[0].n, 1);

    const { rows: current } = await client.query(
      `SELECT min_stok, diubah_oleh FROM inventory_min_stok_lokasi WHERE id = $1`,
      [first.id],
    );
    assert.equal(Number(current[0].min_stok), 250);
    assert.equal(Number(current[0].diubah_oleh), 1);

    const { rows: audit } = await client.query(
      `SELECT old_value, new_value, user_id FROM core_audit_log
       WHERE table_name = 'inventory_min_stok_lokasi' AND record_id = $1 AND field_name = 'min_stok'
       ORDER BY id`,
      [first.id],
    );
    assert.equal(audit.length, 2, "satu entri audit untuk insert, satu lagi untuk update");
    assert.equal(audit[0].old_value, null);
    assert.equal(audit[0].new_value, "100");
    assert.equal(audit[1].old_value, "100");
    assert.equal(audit[1].new_value, "250");
    assert.equal(Number(audit[1].user_id), 1);
  });
});

test("upsertMinStok: min_stok negatif ditolak", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    await assert.rejects(
      () => upsertMinStok(client, { itemKode: "BB-001", locationId: ck, minStok: -1, userId: 1 }),
      />= 0/,
    );
  });
});

test("upsertMinStok: item tidak ditemukan -> error", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    await assert.rejects(
      () => upsertMinStok(client, { itemKode: "ITEM-TIDAK-ADA", locationId: ck, minStok: 10 }),
      /tidak ditemukan/,
    );
  });
});

test("listMinStokByLocation: cuma baris milik lokasi yang diminta, tidak bocor dari lokasi lain", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const outlet = await locationId(client, "samsara_outlet");

    await upsertMinStok(client, { itemKode: "BB-001", locationId: ck, minStok: 500, userId: 1 });
    await upsertMinStok(client, { itemKode: "BB-002", locationId: ck, minStok: 300, userId: 1 });
    await upsertMinStok(client, { itemKode: "BB-003", locationId: outlet, minStok: 50, userId: 1 });

    // Dicek lewat item spesifik yang dibuat test ini (bukan total panjang
    // array) -- lokasi CK bisa saja sudah punya baris min_stok lain dari
    // data sungguhan (mis. owner yang sudah pakai fitur ini), jadi jumlah
    // total TIDAK boleh diasumsikan cuma milik test ini.
    const ckRows = await listMinStokByLocation(client, ck);
    assert.ok(ckRows.some((r) => r.itemKode === "BB-001" && r.minStok === 500));
    assert.ok(ckRows.some((r) => r.itemKode === "BB-002" && r.minStok === 300));
    assert.ok(!ckRows.some((r) => r.itemKode === "BB-003"), "baris lokasi outlet tidak boleh ikut di daftar CK");

    const outletRows = await listMinStokByLocation(client, outlet);
    assert.ok(outletRows.some((r) => r.itemKode === "BB-003" && r.minStok === 50));
    assert.ok(
      !outletRows.some((r) => r.itemKode === "BB-001" || r.itemKode === "BB-002"),
      "baris lokasi CK tidak boleh ikut di daftar outlet",
    );
  });
});
