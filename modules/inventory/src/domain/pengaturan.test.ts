import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool, type AuthUser } from "@samsara/core";
import {
  getHppDefaultMethod,
  getTargetFoodCostPersen,
  resolveHppMethod,
  setHppDefaultMethod,
  setTargetFoodCostPersen,
} from "./pengaturan.js";
import { withRollback } from "./test-helpers.js";

after(() => pool.end());

function fakeUser(role: AuthUser["role"]): AuthUser {
  // `tokenVersion` tidak relevan di domain layer (cuma dipakai middleware
  // requireAuth saat request HTTP masuk) -- 0 = baseline user baru.
  return {
    id: 1,
    username: "test",
    role,
    allLocations: role === "owner" || role === "manajer_ops",
    locationIds: [],
    tokenVersion: 0,
    wajibGantiKredensial: false,
  };
}

test("resolveHppMethod: role owner/manajer_ops boleh override lewat query param", async () => {
  await withRollback(async (client) => {
    assert.equal(await resolveHppMethod(client, fakeUser("owner"), "harga_beli_terakhir"), "harga_beli_terakhir");
    assert.equal(await resolveHppMethod(client, fakeUser("manajer_ops"), "harga_beli_terakhir"), "harga_beli_terakhir");
  });
});

test("resolveHppMethod: role supervisor/staf SELALU pakai default global, query param diabaikan", async () => {
  await withRollback(async (client) => {
    assert.equal(await resolveHppMethod(client, fakeUser("supervisor"), "harga_beli_terakhir"), "harga_master");
    assert.equal(await resolveHppMethod(client, fakeUser("staf"), "harga_beli_terakhir"), "harga_master");
  });
});

test("setHppDefaultMethod: mengubah default global berlaku untuk semua role (owner tanpa override pun ikut default baru)", async () => {
  await withRollback(async (client) => {
    await setHppDefaultMethod(client, "harga_beli_terakhir");
    assert.equal(await getHppDefaultMethod(client), "harga_beli_terakhir");

    // Owner TANPA query param -> ikut default global yang baru.
    assert.equal(await resolveHppMethod(client, fakeUser("owner"), undefined), "harga_beli_terakhir");
    // Staf tetap ikut default global (yang sekarang sudah beda dari sebelumnya).
    assert.equal(await resolveHppMethod(client, fakeUser("staf"), "harga_master"), "harga_beli_terakhir");
  });
});

// Nilai `target_food_cost_persen` adalah pengaturan GLOBAL yang bisa sudah
// diubah di database dev (commit di luar withRollback), jadi test di bawah
// TIDAK mengasumsikan seed default tertentu (mis. 30) -- baca nilai awal
// dulu, lalu assert perubahan relatif terhadap itu. Pola sama dengan
// `kandidatBelumTersinkron` di modules/sales-sync/src/domain/item-mapping.test.ts.
test("getTargetFoodCostPersen/setTargetFoodCostPersen: nilai tersimpan & bisa diubah", async () => {
  await withRollback(async (client) => {
    const awal = await getTargetFoodCostPersen(client);
    assert.ok(awal > 0 && awal <= 100, "nilai awal harus valid, apa pun seed-nya di database dev");

    const baru = awal === 25 ? 40 : 25;
    await setTargetFoodCostPersen(client, baru);
    assert.equal(await getTargetFoodCostPersen(client), baru);
  });
});

test("setTargetFoodCostPersen: nilai <=0 atau >100 ditolak (dipetakan ke 400 oleh error handler router)", async () => {
  await withRollback(async (client) => {
    const awal = await getTargetFoodCostPersen(client);

    await assert.rejects(setTargetFoodCostPersen(client, 0), /targetFoodCostPersen/);
    await assert.rejects(setTargetFoodCostPersen(client, 150), /targetFoodCostPersen/);
    await assert.rejects(setTargetFoodCostPersen(client, Number.NaN), /targetFoodCostPersen/);

    // Nilai yang valid tetap TIDAK berubah setelah percobaan yang ditolak di atas.
    assert.equal(await getTargetFoodCostPersen(client), awal);
  });
});
