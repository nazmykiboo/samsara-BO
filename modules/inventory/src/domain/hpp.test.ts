import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import { getItemCostReport, getMenuHppReport, resolveItemCost } from "./hpp.js";
import { withRollback } from "./test-helpers.js";

after(() => pool.end());

function closeTo(actual: number, expected: number, tolerance = 0.5) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Diharapkan ${actual} dekat dengan ${expected} (toleransi ±${tolerance})`,
  );
}

/**
 * Bikin 1 item bahan_baku + 1 menu dengan 1 baris resep (qty 1) yang pakai
 * item itu -- HPP menu = `hargaMaster` PERSIS. Dipakai untuk tes yang cuma
 * butuh "menu dengan HPP terhitung", bukan angka HPP yang spesifik (pola
 * sama seperti `buatMenuDenganHpp` di harga-channel.test.ts).
 */
async function buatMenuSederhana(client: PoolClient, kodeMenu: string, hargaMaster: number): Promise<void> {
  const kodeItem = `${kodeMenu}-ITEM`;
  const { rows: itemRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_items (kode, name, type, recipe_unit, harga_master, is_active)
     VALUES ($1, $2, 'bahan_baku', 'gram', $3, true) RETURNING id`,
    [kodeItem, `Item ${kodeMenu}`, hargaMaster],
  );
  const { rows: menuRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_menu (kode, name, is_active) VALUES ($1, $2, true) RETURNING id`,
    [kodeMenu, `Menu ${kodeMenu}`],
  );
  await client.query(`INSERT INTO inventory_menu_resep_baris (menu_id, item_id, qty, unit) VALUES ($1, $2, 1, 'gram')`, [
    menuRows[0].id,
    itemRows[0].id,
  ]);
}

/**
 * Replika TERISOLASI dari komposisi "Bubur Polos" (M-001) yang dicocokkan ke
 * hasil verifikasi Tahap 2/9 (total 2494.62) -- SENGAJA pakai item/menu kode
 * `TEST-HPP-*` sendiri, BUKAN menu M-001 yang asli. M-001 adalah menu
 * PRODUKSI yang resepnya aktif diedit lewat aplikasi oleh pengguna sungguhan
 * (lihat insiden 2026-10-05: baris OP-005 sempat hilang dari resep M-001
 * lalu item baru PK-015 ditambahkan -- keduanya perubahan sah pengguna, tapi
 * bikin tes yang hardcode angka HPP terhadap M-001 jadi rapuh/flaky setiap
 * kali resep menu itu berubah di dunia nyata). Replika di sini membekukan
 * komposisi yang SUDAH diverifikasi cocok dengan spreadsheet sumber supaya
 * tes tetap jadi regression-check yang valid untuk logika kalkulasi
 * (resolveItemCost rekursif setengah_jadi + penjumlahan multi-baris),
 * tanpa bergantung ke data menu produksi yang bisa berubah kapan saja.
 */
async function buatMenuBuburPolosTiruan(client: PoolClient): Promise<void> {
  const item = async (kode: string, type: string, hargaMaster: number | null, unit = "gram") => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO inventory_items (kode, name, type, recipe_unit, harga_master, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [kode, `Tiruan ${kode}`, type, unit, hargaMaster],
    );
    return rows[0].id;
  };

  const bb = await item("TEST-HPP-BB", "bahan_baku", 3.35);
  const pk1 = await item("TEST-HPP-PK1", "packaging", 940, "pcs");
  const pk2 = await item("TEST-HPP-PK2", "packaging", 120, "pcs");
  const pk3 = await item("TEST-HPP-PK3", "packaging", 65, "lembar");
  const op = await item("TEST-HPP-OP", "operasional", 50, "pcs");

  // SJ: setengah_jadi, cost/unit dihitung rekursif dari resep produksinya
  // sendiri (yield 700 gr dari 2 bahan) -- persis pola Chili oil (SJ-003)
  // yang diverifikasi Tahap 2, cost/unit = (59.59*100 + 18.75*750) / 700
  // = 28.602142857...
  const sjBahan1 = await item("TEST-HPP-SJBB1", "bahan_baku", 59.59);
  const sjBahan2 = await item("TEST-HPP-SJBB2", "bahan_baku", 18.75, "ml");
  const sj = await item("TEST-HPP-SJ", "setengah_jadi", null);
  const { rows: resepRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_resep_produksi (kode, output_item_id, yield_qty, yield_unit) VALUES ($1, $2, 700, 'gram') RETURNING id`,
    ["TEST-HPP-RP-SJ", sj],
  );
  await client.query(
    `INSERT INTO inventory_resep_produksi_baris (resep_id, bahan_item_id, qty, unit) VALUES ($1, $2, 100, 'gram'), ($1, $3, 750, 'ml')`,
    [resepRows[0].id, sjBahan1, sjBahan2],
  );

  const { rows: menuRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_menu (kode, name, is_active) VALUES ('TEST-HPP-M01', 'Menu Tiruan Bubur Polos', true) RETURNING id`,
  );
  const baris: Array<[number, number, string]> = [
    [bb, 300, "gram"],
    [pk1, 1, "pcs"],
    [pk2, 1, "pcs"],
    [pk3, 1, "lembar"],
    [op, 1, "pcs"],
    [sj, 11, "gram"],
  ];
  for (const [itemId, qty, unit] of baris) {
    await client.query(`INSERT INTO inventory_menu_resep_baris (menu_id, item_id, qty, unit) VALUES ($1, $2, $3, $4)`, [
      menuRows[0].id,
      itemId,
      qty,
      unit,
    ]);
  }
}

/**
 * Replika TERISOLASI "paket = rollup 2 menu dasar" -- dibangun dari 2 menu
 * dasar tiruan (lewat `buatMenuSederhana`, HPP masing-masing PERSIS
 * `hargaMaster`-nya) lalu dirangkai jadi 1 menu paket lewat
 * `inventory_paket_menu_baris`. Sengaja TIDAK memakai menu paket produksi
 * asli (mis. "Saraf-an Sehat"/M-034) karena menu itu dirangkai dari
 * komponen (M-004, M-029) yang harga_master-nya aktif diedit pengguna
 * sungguhan lewat aplikasi (mis. BB-023 Susu evaporasi diubah 13.92 -> 28.00
 * pada 2026-10-12) -- perubahan sah di dunia nyata, tapi bikin tes yang
 * hardcode angka HPP terhadap M-034 jadi rapuh/flaky. Mengembalikan HPP
 * paket yang DIHARAPKAN (dihitung manual dari harga_master item tiruan di
 * sini, bukan angka hasil observasi dari data asli).
 */
async function buatPaketMenuTiruan(client: PoolClient): Promise<{ expectedHpp: number }> {
  const hargaA = 2000;
  const hargaB = 3000;
  const qtyA = 1;
  const qtyB = 2;

  await buatMenuSederhana(client, "TEST-HPP-PAKET-A", hargaA);
  await buatMenuSederhana(client, "TEST-HPP-PAKET-B", hargaB);

  const { rows: menuARows } = await client.query<{ id: number }>(
    `SELECT id FROM inventory_menu WHERE kode = 'TEST-HPP-PAKET-A'`,
  );
  const { rows: menuBRows } = await client.query<{ id: number }>(
    `SELECT id FROM inventory_menu WHERE kode = 'TEST-HPP-PAKET-B'`,
  );
  const { rows: paketRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_menu (kode, name, is_active) VALUES ('TEST-HPP-PAKET', 'Paket Tiruan A+B', true) RETURNING id`,
  );

  await client.query(
    `INSERT INTO inventory_paket_menu_baris (paket_menu_id, item_menu_id, qty)
     VALUES ($1, $2, $4), ($1, $3, $5)`,
    [paketRows[0].id, menuARows[0].id, menuBRows[0].id, qtyA, qtyB],
  );

  return { expectedHpp: hargaA * qtyA + hargaB * qtyB };
}

/**
 * Menu tiruan yang bergantung ke item `pending_data` TERISOLASI (bukan
 * SJ-008/Mutiara asli) -- item baru dengan `harga_master = NULL`, supaya
 * status pending genuinely dari fixture sendiri, tidak ikut berubah kalau
 * data Mutiara di aplikasi produksi dilengkapi/diubah owner di masa depan.
 */
async function buatMenuDenganItemPendingTiruan(client: PoolClient, kodeMenu: string): Promise<void> {
  const kodeItem = `${kodeMenu}-ITEM`;
  const { rows: itemRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_items (kode, name, type, recipe_unit, harga_master, is_active)
     VALUES ($1, $2, 'bahan_baku', 'gram', NULL, true) RETURNING id`,
    [kodeItem, `Item Pending Tiruan ${kodeMenu}`],
  );
  const { rows: menuRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_menu (kode, name, is_active) VALUES ($1, $2, true) RETURNING id`,
    [kodeMenu, `Menu ${kodeMenu}`],
  );
  await client.query(`INSERT INTO inventory_menu_resep_baris (menu_id, item_id, qty, unit) VALUES ($1, $2, 1, 'gram')`, [
    menuRows[0].id,
    itemRows[0].id,
  ]);
}

test("resolveItemCost: bahan_baku biasa baca harga_master langsung", async () => {
  await withRollback(async (client) => {
    const { rows } = await client.query<{ id: number }>(`SELECT id FROM inventory_items WHERE kode = 'BB-001'`);
    const result = await resolveItemCost(client, rows[0].id, "harga_master");
    assert.equal(result.pending, false);
    closeTo(result.cost as number, 3.35, 0.01);
  });
});

test("resolveItemCost: item setengah_jadi dihitung rekursif dari resep produksi (cocok verifikasi Tahap 2)", async () => {
  await withRollback(async (client) => {
    const report = await getItemCostReport(client, "SJ-003", "harga_master");
    assert.equal(report.status, "ok");
    closeTo(report.cost_per_recipe_unit as number, 28.602143, 0.01);
  });
});

test("resolveItemCost: item pending_data (yield resep kosong) mengembalikan pending, bukan error", async () => {
  await withRollback(async (client) => {
    const report = await getItemCostReport(client, "SJ-008", "harga_master"); // Mutiara, RP-008 yield belum diisi
    assert.equal(report.status, "pending_data");
    assert.equal(report.cost_per_recipe_unit, null);
  });
});

test("getMenuHppReport: menu dasar cocok dengan hasil verifikasi Tahap 2/9 (replika Bubur Polos, setelah koreksi OP-005)", async () => {
  await withRollback(async (client) => {
    await buatMenuBuburPolosTiruan(client);
    const report = await getMenuHppReport(client, "TEST-HPP-M01", "harga_master");
    assert.equal(report.status, "ok");
    closeTo(report.hpp_per_porsi as number, 2494.62, 0.5);
  });
});

test("getMenuHppReport: paket = rollup komponen (data tiruan terisolasi, bukan menu produksi asli)", async () => {
  await withRollback(async (client) => {
    const { expectedHpp } = await buatPaketMenuTiruan(client);
    const report = await getMenuHppReport(client, "TEST-HPP-PAKET", "harga_master");
    assert.equal(report.status, "ok");
    closeTo(report.hpp_per_porsi as number, expectedHpp, 0.5);
  });
});

test("getMenuHppReport: menu yang bergantung ke item pending_data (Mutiara) tampilkan status pending_data, bukan error", async () => {
  await withRollback(async (client) => {
    const report = await getMenuHppReport(client, "M-031", "harga_master"); // Es Teler Raja, pakai Mutiara
    assert.equal(report.status, "pending_data");
    assert.equal(report.hpp_per_porsi, null);
    assert.equal(report.food_cost_pct, null);
    assert.equal(report.margin, null);
  });
});

test("getMenuHppReport: food_cost_pct dan margin null kalau harga_jual (channel Offline) belum diisi", async () => {
  await withRollback(async (client) => {
    await buatMenuSederhana(client, "TEST-HPP-M02", 5000);
    const report = await getMenuHppReport(client, "TEST-HPP-M02", "harga_master");
    assert.equal(report.status, "ok", "HPP-nya sendiri harus tetap bisa dihitung");
    assert.equal(report.harga_jual, null);
    assert.equal(report.food_cost_pct, null);
    assert.equal(report.margin, null);
  });
});

test("getMenuHppReport: food_cost_pct dan margin (top-level, legacy) terisi begitu channel Offline ada harganya", async () => {
  await withRollback(async (client) => {
    await buatMenuSederhana(client, "TEST-HPP-M03", 5000);
    await client.query(
      `INSERT INTO inventory_menu_harga_channel (kode_menu, channel, harga_jual) VALUES ('TEST-HPP-M03', 'Offline', 15000)`,
    );
    const report = await getMenuHppReport(client, "TEST-HPP-M03", "harga_master");
    assert.equal(report.status, "ok");
    assert.equal(report.harga_jual, 15000);
    assert.ok(report.margin !== null);
    assert.ok(report.food_cost_pct !== null);
    closeTo(report.margin as number, 15000 - (report.hpp_per_porsi as number), 0.01);
    closeTo(report.food_cost_pct as number, ((report.hpp_per_porsi as number) / 15000) * 100, 0.01);
  });
});

test("getMenuHppReport: channels menampilkan SEMUA channel aktif, yang belum diisi harga tampil 'belum_diisi' tanpa error", async () => {
  await withRollback(async (client) => {
    await buatMenuSederhana(client, "TEST-HPP-M04", 5000);
    await client.query(
      `INSERT INTO inventory_menu_harga_channel (kode_menu, channel, harga_jual) VALUES ('TEST-HPP-M04', 'Offline', 15000)`,
    );
    const report = await getMenuHppReport(client, "TEST-HPP-M04", "harga_master");
    const channelNames = report.channels.map((c) => c.channel).sort();
    assert.deepEqual(channelNames, ["GoFood", "GrabFood", "Offline", "ShopeeFood"]);

    const offline = report.channels.find((c) => c.channel === "Offline")!;
    assert.equal(offline.status, "ok");
    assert.equal(offline.hargaJual, 15000);
    assert.ok(offline.foodCostPct !== null);

    const shopeefood = report.channels.find((c) => c.channel === "ShopeeFood")!;
    assert.equal(shopeefood.status, "belum_diisi");
    assert.equal(shopeefood.hargaJual, null);
    assert.equal(shopeefood.foodCostPct, null);
    assert.equal(shopeefood.markupPct, null);
    assert.equal(shopeefood.marginPct, null);
  });
});

test("getMenuHppReport: menu pending_data -- channel yang sudah diisi harga TETAP tampil hargaJual-nya, cuma pct-nya null (data tiruan terisolasi)", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganItemPendingTiruan(client, "TEST-HPP-PENDING");
    await client.query(
      `INSERT INTO inventory_menu_harga_channel (kode_menu, channel, harga_jual) VALUES ('TEST-HPP-PENDING', 'Offline', 20000)`,
    );
    const report = await getMenuHppReport(client, "TEST-HPP-PENDING", "harga_master");
    assert.equal(report.status, "pending_data");

    const offline = report.channels.find((c) => c.channel === "Offline")!;
    assert.equal(offline.status, "ok", "status 'ok' cuma soal ada/tidaknya harga, bukan status HPP");
    assert.equal(offline.hargaJual, 20000);
    assert.equal(offline.foodCostPct, null, "pct null karena HPP pending");
    assert.equal(offline.markupPct, null);
    assert.equal(offline.marginPct, null);
  });
});
