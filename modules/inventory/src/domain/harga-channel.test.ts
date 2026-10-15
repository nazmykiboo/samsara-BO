import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import {
  batchUpsertHargaChannel,
  exportHargaChannelCsv,
  getRekomendasiHarga,
  previewImportHargaChannel,
  setVisibilitasChannel,
  upsertHargaChannel,
} from "./harga-channel.js";
import { getMenuHppReport } from "./hpp.js";
import { withRollback } from "./test-helpers.js";

after(() => pool.end());

function closeTo(actual: number, expected: number, tolerance = 0.5) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Diharapkan ${actual} dekat dengan ${expected} (toleransi ±${tolerance})`,
  );
}

/**
 * Bikin 1 item bahan_baku (harga_master = `hargaMaster`) + 1 menu dengan
 * 1 baris resep (qty 1) yang pakai item itu -- jadi HPP menu = `hargaMaster`
 * PERSIS, tanpa bergantung ke data seed yang bisa berubah. Dipakai buat
 * mencocokkan angka test case owner (HPP 6543) secara eksak.
 */
async function buatMenuDenganHpp(client: PoolClient, kodeMenu: string, hargaMaster: number): Promise<void> {
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

test("upsertHargaChannel: insert baru tercatat ke core_audit_log (oldValue null)", async () => {
  await withRollback(async (client) => {
    // Menu test terisolasi (bukan menu produksi asli) -- supaya "oldValue
    // null" di bawah TIDAK bergantung pada menu itu belum pernah diisi
    // harga channel oleh siapa pun di luar transaksi tes ini. Lihat catatan
    // insiden 2026-10-05 di hpp.test.ts (menu M-001 aktif diedit pengguna
    // sungguhan, bikin tes yang pakai kode menu asli jadi rapuh).
    await buatMenuDenganHpp(client, "TEST-HC-M03", 5000);
    await upsertHargaChannel(client, { menuKode: "TEST-HC-M03", channel: "ShopeeFood", hargaJual: 18000, userId: 1 });

    const { rows } = await client.query<{ harga_jual: string; diubah_oleh: string | null }>(
      `SELECT harga_jual, diubah_oleh FROM inventory_menu_harga_channel WHERE kode_menu = 'TEST-HC-M03' AND channel = 'ShopeeFood'`,
    );
    assert.equal(Number(rows[0].harga_jual), 18000);
    assert.equal(Number(rows[0].diubah_oleh), 1);

    const { rows: auditRows } = await client.query<{ old_value: string | null; new_value: string | null }>(
      `SELECT old_value, new_value FROM core_audit_log
       WHERE table_name = 'inventory_menu_harga_channel' AND field_name = 'harga_jual'
       ORDER BY id DESC LIMIT 1`,
    );
    assert.equal(auditRows[0].old_value, null);
    assert.equal(auditRows[0].new_value, "18000");
  });
});

test("upsertHargaChannel: update baris yang sudah ada tercatat dengan oldValue lama", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-HC-M04", 5000);
    await upsertHargaChannel(client, { menuKode: "TEST-HC-M04", channel: "ShopeeFood", hargaJual: 18000, userId: 1 });
    await upsertHargaChannel(client, { menuKode: "TEST-HC-M04", channel: "ShopeeFood", hargaJual: 19500, userId: 1 });

    const { rows } = await client.query<{ harga_jual: string }>(
      `SELECT harga_jual FROM inventory_menu_harga_channel WHERE kode_menu = 'TEST-HC-M04' AND channel = 'ShopeeFood'`,
    );
    assert.equal(Number(rows[0].harga_jual), 19500);

    const { rows: auditRows } = await client.query<{ old_value: string | null; new_value: string | null }>(
      `SELECT old_value, new_value FROM core_audit_log
       WHERE table_name = 'inventory_menu_harga_channel' AND field_name = 'harga_jual'
       ORDER BY id DESC LIMIT 1`,
    );
    assert.equal(auditRows[0].old_value, "18000");
    assert.equal(auditRows[0].new_value, "19500");
  });
});

test("upsertHargaChannel: channel tidak aktif/tidak ada ditolak (400 di router, Error di sini)", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-HC-M05", 5000);
    await assert.rejects(
      upsertHargaChannel(client, { menuKode: "TEST-HC-M05", channel: "Website-Tidak-Ada", hargaJual: 10000 }),
      /bukan channel penjualan aktif/i,
    );
  });
});

test("upsertHargaChannel: menu tidak ditemukan ditolak (404 di router, Error di sini)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      upsertHargaChannel(client, { menuKode: "M-TIDAK-ADA", channel: "Offline", hargaJual: 10000 }),
      /tidak ditemukan/i,
    );
  });
});

test("getRekomendasiHarga: HPP 6543, target 30% -> hargaDasar 21810, ShopeeFood/GrabFood 27263, GoFood 28513, Offline 21810 (dibulatkan ke rupiah penuh -- lihat roundRupiah)", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-HC-M01", 6543);

    const result = await getRekomendasiHarga(client, "TEST-HC-M01", 30, "harga_master");
    assert.equal(result.hppPerPorsi, 6543);
    assert.equal(result.hargaDasar, 21810);

    const byChannel = (name: string) => result.rekomendasi.find((r) => r.channel === name)!;
    // 27262.5 dan 28512.5 dibulatkan ke rupiah penuh (Math.round, bulat ke atas
    // untuk .5) -- rupiah tidak pakai sub-unit, dan ini juga yang membuat hasil
    // rekomendasi langsung valid dipakai input harga (step=1) tanpa penyesuaian.
    assert.equal(byChannel("ShopeeFood").hargaJual, 27263);
    assert.equal(byChannel("GrabFood").hargaJual, 27263);
    assert.equal(byChannel("GoFood").hargaJual, 28513);
    assert.equal(byChannel("Offline").hargaJual, 21810);
  });
});

test("getRekomendasiHarga: target diambil dari pengaturan global kalau tidak diisi eksplisit (dites lewat parameter langsung di sini, override di router)", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-HC-M02", 3000);
    // Router yang membaca default dari inventory_settings -- di level domain
    // ini cukup pastikan target berapa pun yang dikirim konsisten dipakai.
    const result = await getRekomendasiHarga(client, "TEST-HC-M02", 30, "harga_master");
    closeTo(result.hargaDasar as number, 10000, 0.01);
  });
});

test("getRekomendasiHarga: menu pending_data -> hppPerPorsi/hargaDasar null, rekomendasi []", async () => {
  await withRollback(async (client) => {
    const result = await getRekomendasiHarga(client, "M-031", 30, "harga_master"); // Es Teler Raja, pakai Mutiara (pending_data)
    assert.equal(result.hppPerPorsi, null);
    assert.equal(result.hargaDasar, null);
    assert.deepEqual(result.rekomendasi, []);
  });
});

// ---------------------------------------------------------------------------
// Edit harga massal per channel: batch simpan (ATOMIK), export CSV, preview
// import CSV.
// ---------------------------------------------------------------------------

test("batchUpsertHargaChannel: beberapa baris sekaligus (beda menu & beda channel) tersimpan semua", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-HC-B01", 5000);
    await buatMenuDenganHpp(client, "TEST-HC-B02", 5000);
    // Baris yang menimpa harga yang sudah ada ikut diuji (bukan cuma insert baru).
    await upsertHargaChannel(client, { menuKode: "TEST-HC-B02", channel: "Offline", hargaJual: 15000, userId: 1 });

    await batchUpsertHargaChannel(
      client,
      [
        { kodeMenu: "TEST-HC-B01", channel: "Offline", hargaJual: 18000 },
        { kodeMenu: "TEST-HC-B01", channel: "GoFood", hargaJual: 25000 },
        { kodeMenu: "TEST-HC-B02", channel: "Offline", hargaJual: 16500 },
      ],
      1,
    );

    const { rows } = await client.query<{ kode_menu: string; channel: string; harga_jual: string }>(
      `SELECT kode_menu, channel, harga_jual FROM inventory_menu_harga_channel
       WHERE kode_menu IN ('TEST-HC-B01', 'TEST-HC-B02') ORDER BY kode_menu, channel`,
    );
    assert.equal(rows.length, 3, "2 insert baru + 1 update (bukan baris baru) = 3 baris");
    assert.deepEqual(
      rows.map((r) => [r.kode_menu, r.channel, Number(r.harga_jual)]),
      [
        ["TEST-HC-B01", "GoFood", 25000],
        ["TEST-HC-B01", "Offline", 18000],
        ["TEST-HC-B02", "Offline", 16500],
      ],
    );
  });
});

test("batchUpsertHargaChannel: body 'baris' kosong/bukan array ditolak", async () => {
  await withRollback(async (client) => {
    await assert.rejects(batchUpsertHargaChannel(client, []), /tidak boleh kosong/i);
    await assert.rejects(
      batchUpsertHargaChannel(client, undefined as unknown as []),
      /wajib berupa array/i,
    );
  });
});

test("batchUpsertHargaChannel: ATOMIK SUNGGUHAN -- satu baris gagal (channel nonaktif) membatalkan SELURUH batch", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-HC-B03", 5000);
    await buatMenuDenganHpp(client, "TEST-HC-B04", 5000);

    // Jumlah audit log harga channel SEBELUM batch -- dipakai sebagai acuan,
    // bukan angka absolut, karena core_audit_log di DB dev sudah berisi
    // riwayat perubahan harga sungguhan dari luar tes ini.
    const jumlahAudit = async (): Promise<number> => {
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*) FROM core_audit_log WHERE table_name = 'inventory_menu_harga_channel'`,
      );
      return Number(rows[0].count);
    };
    const auditSebelum = await jumlahAudit();

    // SAVEPOINT ini MENIRU batas transaksi SATU REQUEST di router
    // (withTransaction: BEGIN ... ROLLBACK begitu ada exception) -- satu
    // savepoint untuk SELURUH batch, BUKAN pola savepoint-per-baris ala
    // sales-sync (yang justru membiarkan baris lain tetap tersimpan).
    await client.query("SAVEPOINT satu_request");

    await assert.rejects(
      batchUpsertHargaChannel(
        client,
        [
          { kodeMenu: "TEST-HC-B03", channel: "Offline", hargaJual: 18000 },
          { kodeMenu: "TEST-HC-B04", channel: "GoFood", hargaJual: 25000 },
          { kodeMenu: "TEST-HC-B04", channel: "Website-Tidak-Ada", hargaJual: 30000 },
        ],
        1,
      ),
      /Baris ke-3 \(TEST-HC-B04 \/ Website-Tidak-Ada\).*bukan channel penjualan aktif/i,
    );

    // Dicek DUA tahap supaya buktinya tidak ambigu:
    // 1) Sebelum ROLLBACK, baris 1 & 2 MEMANG sudah tertulis di dalam
    //    transaksi -- jadi "tidak tersimpan" di tahap 2 benar-benar efek
    //    rollback, bukan karena upsert-nya kebetulan tidak pernah jalan.
    const { rows: sebelumRollback } = await client.query<{ kode_menu: string }>(
      `SELECT kode_menu FROM inventory_menu_harga_channel WHERE kode_menu IN ('TEST-HC-B03', 'TEST-HC-B04')`,
    );
    assert.equal(sebelumRollback.length, 2, "baris sebelum baris yang gagal sempat tertulis di dalam transaksi");
    assert.equal(await jumlahAudit(), auditSebelum + 2, "2 baris yang sempat sukses juga sempat menulis audit log");

    await client.query("ROLLBACK TO SAVEPOINT satu_request");

    // 2) Setelah batas transaksi request dibatalkan: TIDAK ADA satu pun baris
    //    batch yang tersimpan (all-or-nothing).
    const { rows: sesudahRollback } = await client.query<{ kode_menu: string }>(
      `SELECT kode_menu FROM inventory_menu_harga_channel WHERE kode_menu IN ('TEST-HC-B03', 'TEST-HC-B04')`,
    );
    assert.equal(sesudahRollback.length, 0, "satu baris gagal -> SEMUA baris batch hilang, termasuk yang sempat sukses");

    // Audit log dari baris yang sempat sukses juga ikut hilang.
    assert.equal(await jumlahAudit(), auditSebelum, "audit log baris yang sempat sukses ikut ter-rollback");
  });
});

test("batchUpsertHargaChannel: menu tidak ada di baris tengah juga membatalkan seluruh batch", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-HC-B05", 5000);
    await client.query("SAVEPOINT satu_request");

    await assert.rejects(
      batchUpsertHargaChannel(
        client,
        [
          { kodeMenu: "TEST-HC-B05", channel: "Offline", hargaJual: 18000 },
          { kodeMenu: "M-TIDAK-ADA", channel: "Offline", hargaJual: 19000 },
          { kodeMenu: "TEST-HC-B05", channel: "GoFood", hargaJual: 25000 },
        ],
        1,
      ),
      /Baris ke-2 \(M-TIDAK-ADA \/ Offline\).*tidak ditemukan/i,
    );

    await client.query("ROLLBACK TO SAVEPOINT satu_request");

    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM inventory_menu_harga_channel WHERE kode_menu = 'TEST-HC-B05'`,
    );
    assert.equal(Number(rows[0].count), 0, "baris ke-1 yang valid pun tidak tersimpan");
  });
});

/** Semua channel penjualan AKTIF di DB (seed: Offline, GrabFood, GoFood, ShopeeFood). */
async function channelAktif(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT name FROM inventory_sales_channel WHERE is_active = true ORDER BY name`,
  );
  return rows.map((r) => r.name);
}

test("exportHargaChannelCsv: CROSS JOIN semua menu aktif x channel aktif, termasuk kombinasi yang belum pernah diisi harga", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-HC-EXP1", 5000);
    await buatMenuDenganHpp(client, "TEST-HC-EXP2", 5000);
    await upsertHargaChannel(client, { menuKode: "TEST-HC-EXP1", channel: "GoFood", hargaJual: 25000, userId: 1 });

    const csv = await exportHargaChannelCsv(client);
    const lines = csv.trimEnd().split("\n");
    assert.equal(lines[0], "kode_menu,channel,harga_jual");

    const channels = await channelAktif(client);
    const barisMenu = (kode: string) => lines.filter((l) => l.startsWith(`${kode},`));

    // Satu baris per channel aktif untuk SETIAP menu aktif, walau harganya kosong.
    assert.equal(barisMenu("TEST-HC-EXP1").length, channels.length);
    assert.equal(barisMenu("TEST-HC-EXP2").length, channels.length);
    assert.deepEqual(
      barisMenu("TEST-HC-EXP2").map((l) => l.split(",")[1]),
      channels,
      "urut per channel (ORDER BY kode_menu, channel) dan lengkap semua channel aktif",
    );

    // Yang sudah diisi keluar angkanya (dinormalkan dari NUMERIC '25000.00'),
    // yang belum diisi keluar KOSONG (bukan 0).
    assert.ok(barisMenu("TEST-HC-EXP1").includes("TEST-HC-EXP1,GoFood,25000"));
    assert.ok(barisMenu("TEST-HC-EXP1").includes("TEST-HC-EXP1,Offline,"));
    assert.ok(
      barisMenu("TEST-HC-EXP2").every((l) => l.endsWith(",")),
      "menu yang belum pernah diisi harga: semua channel-nya kosong",
    );

    // Menu NONAKTIF tidak ikut diekspor.
    await client.query(`UPDATE inventory_menu SET is_active = false WHERE kode = 'TEST-HC-EXP2'`);
    const csvTanpaNonaktif = await exportHargaChannelCsv(client);
    assert.equal(
      csvTanpaNonaktif.split("\n").filter((l) => l.startsWith("TEST-HC-EXP2,")).length,
      0,
      "menu nonaktif tidak muncul di CSV",
    );
  });
});

test("previewImportHargaChannel: mendeteksi baru/berubah/sama/error per baris dan TIDAK menulis apa pun ke DB", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-HC-IMP1", 5000);
    await upsertHargaChannel(client, { menuKode: "TEST-HC-IMP1", channel: "Offline", hargaJual: 18000, userId: 1 });
    await upsertHargaChannel(client, { menuKode: "TEST-HC-IMP1", channel: "GrabFood", hargaJual: 20000, userId: 1 });

    // Foto kondisi DB SEBELUM preview, untuk dibandingkan setelahnya.
    const snapshot = async () => {
      const { rows } = await client.query<{ data: string }>(
        `SELECT coalesce(string_agg(kode_menu || '|' || channel || '|' || harga_jual, ',' ORDER BY kode_menu, channel), '') AS data
         FROM inventory_menu_harga_channel`,
      );
      const { rows: audit } = await client.query<{ count: string }>(`SELECT count(*) FROM core_audit_log`);
      return `${rows[0].data} :: ${audit[0].count}`;
    };
    const sebelum = await snapshot();

    const csv = [
      "kode_menu,channel,harga_jual",
      "TEST-HC-IMP1,Offline,18000", // 1: sama (nilainya identik)
      "TEST-HC-IMP1,GrabFood,22000", // 2: berubah (20000 -> 22000)
      "TEST-HC-IMP1,GoFood,25000", // 3: baru (belum pernah diisi)
      "M-TIDAK-ADA,Offline,10000", // 4: error -- menu tidak ada
      "TEST-HC-IMP1,Website-Tidak-Ada,10000", // 5: error -- channel bukan channel aktif
      "TEST-HC-IMP1,ShopeeFood,abc", // 6: error -- bukan angka
      "TEST-HC-IMP1,ShopeeFood,0", // 7: error -- 0 tidak dianggap harga valid di import massal
      "TEST-HC-IMP1,ShopeeFood,", // 8: error -- kolom harga kosong
      ",Offline,10000", // 9: error -- kode_menu kosong
    ].join("\n");

    const hasil = await previewImportHargaChannel(client, csv);

    assert.equal(hasil.length, 9, "SEMUA baris data diproses, termasuk yang error (tidak berhenti di baris pertama yang salah)");
    assert.deepEqual(
      hasil.map((h) => [h.baris, h.status]),
      [
        [1, "sama"],
        [2, "berubah"],
        [3, "baru"],
        [4, "error"],
        [5, "error"],
        [6, "error"],
        [7, "error"],
        [8, "error"],
        [9, "error"],
      ],
      "nomor baris dihitung dari baris DATA pertama (header tidak dihitung)",
    );

    assert.deepEqual(hasil[0], {
      baris: 1,
      kodeMenu: "TEST-HC-IMP1",
      channel: "Offline",
      hargaLama: 18000,
      hargaBaru: 18000,
      status: "sama",
    });
    assert.equal(hasil[1].hargaLama, 20000);
    assert.equal(hasil[1].hargaBaru, 22000);
    assert.equal(hasil[2].hargaLama, null, "status 'baru' -> hargaLama null");
    assert.equal(hasil[2].hargaBaru, 25000);

    assert.match(hasil[3].pesan ?? "", /tidak ditemukan/i);
    assert.match(hasil[4].pesan ?? "", /bukan channel penjualan aktif/i);
    assert.match(hasil[5].pesan ?? "", /bukan angka positif/i);
    assert.match(hasil[6].pesan ?? "", /bukan angka positif/i);
    assert.match(hasil[7].pesan ?? "", /harga_jual kosong/i);
    assert.match(hasil[8].pesan ?? "", /kode_menu kosong/i);

    // INTI test ini: preview READ-ONLY -- isi tabel harga & audit log persis sama.
    assert.equal(await snapshot(), sebelum, "previewImportHargaChannel tidak boleh menulis/mengubah apa pun");
  });
});

test("previewImportHargaChannel: header CSV tanpa kolom wajib ditolak (400 di router)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      previewImportHargaChannel(client, "kode_menu,harga_jual\nTEST,18000"),
      /harus punya kolom/i,
    );
    await assert.rejects(previewImportHargaChannel(client, ""), /CSV kosong/i);
  });
});

test("previewImportHargaChannel: CSV hasil exportHargaChannelCsv bisa dibaca balik (baris yang sudah ada harganya -> 'sama')", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-HC-IMP2", 5000);
    await upsertHargaChannel(client, { menuKode: "TEST-HC-IMP2", channel: "GoFood", hargaJual: 25000, userId: 1 });

    const csv = await exportHargaChannelCsv(client);
    const hasil = await previewImportHargaChannel(client, csv);

    const gofood = hasil.find((h) => h.kodeMenu === "TEST-HC-IMP2" && h.channel === "GoFood");
    assert.equal(gofood?.status, "sama", "harga yang baru diekspor dibaca balik sebagai tidak berubah");
    // Kombinasi yang di CSV ekspornya memang KOSONG muncul sebagai error
    // "harga_jual kosong" -- itu disengaja (lebih baik kelihatan daripada
    // diam-diam dilewati); frontend memang membuang baris error sebelum
    // memanggil PATCH /menu/harga-channel/batch.
    const offline = hasil.find((h) => h.kodeMenu === "TEST-HC-IMP2" && h.channel === "Offline");
    assert.equal(offline?.status, "error");
    assert.match(offline?.pesan ?? "", /harga_jual kosong/i);
  });
});

// ---------------------------------------------------------------------------
// Visibilitas per channel (inventory_menu_channel_visibilitas, migrasi 0024)
// SENGAJA terpisah dari harga: tabel beda, fungsi beda, dan test di bawah
// membuktikan toggle visibilitas TIDAK menyentuh harga jual sama sekali.
// ---------------------------------------------------------------------------

test("setVisibilitasChannel: default (belum ada baris) = TAYANG; sembunyikan lalu tayangkan ulang terbaca di channels[].isVisible", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-VIS-M01", 5000);

    const awal = await getMenuHppReport(client, "TEST-VIS-M01", "harga_master");
    assert.ok(
      awal.channels.every((c) => c.isVisible),
      "tanpa baris pengecualian, SEMUA channel aktif dianggap tayang (absen = true)",
    );

    await setVisibilitasChannel(client, "TEST-VIS-M01", "GoFood", false, 1);
    const sesudah = await getMenuHppReport(client, "TEST-VIS-M01", "harga_master");
    assert.equal(sesudah.channels.find((c) => c.channel === "GoFood")?.isVisible, false);
    assert.ok(
      sesudah.channels.filter((c) => c.channel !== "GoFood").every((c) => c.isVisible),
      "channel lain TIDAK terpengaruh",
    );

    await setVisibilitasChannel(client, "TEST-VIS-M01", "GoFood", true, 1);
    const tayangLagi = await getMenuHppReport(client, "TEST-VIS-M01", "harga_master");
    assert.equal(
      tayangLagi.channels.find((c) => c.channel === "GoFood")?.isVisible,
      true,
      "aktif=true eksplisit sama artinya dengan tidak ada baris",
    );

    // Barisnya tetap disimpan (bukan dihapus) sebagai jejak diubah_oleh/diubah_pada.
    const { rows } = await client.query<{ aktif: boolean; diubah_oleh: string | null }>(
      `SELECT aktif, diubah_oleh FROM inventory_menu_channel_visibilitas
       WHERE kode_menu = 'TEST-VIS-M01' AND channel = 'GoFood'`,
    );
    assert.equal(rows.length, 1, "upsert, bukan insert berulang");
    assert.equal(rows[0].aktif, true);
    assert.equal(Number(rows[0].diubah_oleh), 1);
  });
});

test("setVisibilitasChannel: toggle visibilitas TIDAK mengubah harga_jual menu yang sama (harga & visibilitas benar-benar terpisah)", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-VIS-M02", 5000);
    await upsertHargaChannel(client, { menuKode: "TEST-VIS-M02", channel: "GoFood", hargaJual: 25000, userId: 1 });
    await upsertHargaChannel(client, { menuKode: "TEST-VIS-M02", channel: "Offline", hargaJual: 18000, userId: 1 });

    await setVisibilitasChannel(client, "TEST-VIS-M02", "GoFood", false, 1);

    // 1) Harga per channel (inventory_menu_harga_channel) utuh.
    const { rows: hargaRows } = await client.query<{ channel: string; harga_jual: string }>(
      `SELECT channel, harga_jual FROM inventory_menu_harga_channel WHERE kode_menu = 'TEST-VIS-M02' ORDER BY channel`,
    );
    assert.equal(hargaRows.length, 2, "tidak ada baris harga yang hilang/terbuat");
    assert.equal(Number(hargaRows.find((r) => r.channel === "GoFood")?.harga_jual), 25000);
    assert.equal(Number(hargaRows.find((r) => r.channel === "Offline")?.harga_jual), 18000);

    // 2) Kolom legacy inventory_menu.harga_jual juga tidak disentuh.
    const { rows: menuRows } = await client.query<{ harga_jual: string | null }>(
      `SELECT harga_jual FROM inventory_menu WHERE kode = 'TEST-VIS-M02'`,
    );
    assert.equal(menuRows[0].harga_jual, null, "kolom legacy harga_jual tetap seperti sebelumnya (NULL)");

    // 3) Di report, menu GoFood tetap punya harga walau disembunyikan.
    const report = await getMenuHppReport(client, "TEST-VIS-M02", "harga_master");
    const gofood = report.channels.find((c) => c.channel === "GoFood");
    assert.equal(gofood?.isVisible, false);
    assert.equal(gofood?.hargaJual, 25000, "harga tetap tersimpan walau menu disembunyikan di channel itu");
    assert.equal(gofood?.status, "ok");
  });
});

test("setVisibilitasChannel: perubahan nilai dicatat ke core_audit_log, toggle ke nilai yang sama tidak menambah baris", async () => {
  await withRollback(async (client) => {
    await buatMenuDenganHpp(client, "TEST-VIS-M03", 5000);

    await setVisibilitasChannel(client, "TEST-VIS-M03", "ShopeeFood", false, 1);

    // Difilter per record_id (bukan per table_name saja) supaya tidak
    // bergantung pada isi core_audit_log di luar transaksi tes ini.
    const { rows: barisRows } = await client.query<{ id: number }>(
      `SELECT id FROM inventory_menu_channel_visibilitas WHERE kode_menu = 'TEST-VIS-M03' AND channel = 'ShopeeFood'`,
    );
    const recordId = barisRows[0].id;

    const { rows } = await client.query<{ old_value: string | null; new_value: string | null }>(
      `SELECT old_value, new_value FROM core_audit_log
       WHERE table_name = 'inventory_menu_channel_visibilitas' AND field_name = 'aktif' AND record_id = $1
       ORDER BY id DESC LIMIT 1`,
      [recordId],
    );
    assert.equal(rows[0].old_value, "true", "belum ada baris = menu TAYANG, jadi nilai lama true (bukan null)");
    assert.equal(rows[0].new_value, "false");

    // Set ulang ke nilai yang sama -> tidak ada entri audit baru.
    await setVisibilitasChannel(client, "TEST-VIS-M03", "ShopeeFood", false, 1);
    const { rows: countRows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM core_audit_log
       WHERE table_name = 'inventory_menu_channel_visibilitas' AND field_name = 'aktif' AND record_id = $1`,
      [recordId],
    );
    assert.equal(Number(countRows[0].count), 1, "nilai tidak berubah -> tidak ada baris audit log baru");
  });
});

test("setVisibilitasChannel: menu/channel tidak valid ditolak (pola sama seperti upsertHargaChannel)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      setVisibilitasChannel(client, "M-TIDAK-ADA", "Offline", false),
      /tidak ditemukan/i,
    );
    await buatMenuDenganHpp(client, "TEST-VIS-M04", 5000);
    await assert.rejects(
      setVisibilitasChannel(client, "TEST-VIS-M04", "Website-Tidak-Ada", false),
      /bukan channel penjualan aktif/i,
    );
  });
});
