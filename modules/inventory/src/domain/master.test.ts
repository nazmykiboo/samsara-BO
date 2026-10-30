import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@samsara/core";
import {
  createItem,
  createMenu,
  createResepProduksi,
  deactivateItem,
  deactivateMenu,
  deactivateResepProduksi,
  duplicateMenu,
  getMenuResep,
  getResepProduksiBaris,
  listItems,
  listMenu,
  listResepProduksi,
  updateItem,
  updateMenu,
  updateMenuResep,
  updateResepProduksi,
} from "./master.js";
import { createKategori, createKategoriMenu, createSatuan, updateKategoriMenu } from "./referensi.js";
import { getMenuHppReport } from "./hpp.js";
import { locationId, outletLocationId, withRollback } from "./test-helpers.js";

after(() => pool.end());

test("createItem: item baru tersimpan dengan status sesuai kelengkapan data", async () => {
  await withRollback(async (client) => {
    const lengkap = await createItem(client, {
      kode: "TEST-001",
      name: "Test Item Lengkap",
      type: "bahan_baku",
      recipeUnit: "gr",
      purchaseUnit: "kg",
      purchaseToRecipeFactor: 1000,
      hargaMaster: 10000,
    });
    const { rows } = await client.query<{ status: string }>(`SELECT status FROM inventory_items WHERE id = $1`, [
      lengkap.id,
    ]);
    assert.equal(rows[0].status, "active");

    const belumLengkap = await createItem(client, {
      kode: "TEST-002",
      name: "Test Item Belum Lengkap",
      type: "bahan_baku",
      recipeUnit: "gr",
    });
    const { rows: rows2 } = await client.query<{ status: string }>(`SELECT status FROM inventory_items WHERE id = $1`, [
      belumLengkap.id,
    ]);
    assert.equal(rows2[0].status, "pending_data");
  });
});

test("listItems: item yang baru dibuat langsung muncul di daftar (regresi: dulu tidak ada endpoint list sama sekali, UI pakai data contoh statis)", async () => {
  await withRollback(async (client) => {
    await createItem(client, {
      kode: "TEST-020",
      name: "Test Item Baru Untuk List",
      type: "packaging",
      recipeUnit: "pcs",
    });

    const items = await listItems(client);
    const found = items.find((i) => i.kode === "TEST-020");
    assert.ok(found, "item yang baru dibuat harus muncul di listItems");
    assert.equal(found?.status, "pending_data");
    assert.equal(found?.isActive, true);
  });
});

test("listItems: item nonaktif TETAP muncul di daftar (bukan hilang) -- caller/UI yang memutuskan ditampilkan dengan badge atau difilter", async () => {
  await withRollback(async (client) => {
    await createItem(client, {
      kode: "TEST-021",
      name: "Test Item Nonaktif Untuk List",
      type: "packaging",
      recipeUnit: "pcs",
    });
    await deactivateItem(client, "TEST-021");

    const items = await listItems(client);
    const found = items.find((i) => i.kode === "TEST-021");
    assert.ok(found, "item nonaktif harus tetap muncul di listItems");
    assert.equal(found?.isActive, false);
  });
});

test("createItem: ditolak kalau kategori/satuan resep/satuan beli bukan dari master (bukan sekadar teks bebas lagi)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () =>
        createItem(client, {
          kode: "TEST-010",
          name: "Test Kategori Salah",
          type: "bahan_baku",
          category: "Kategori Ngarang Bebas",
          recipeUnit: "gr",
        }),
      /kategori.*tidak ada di master kategori/i,
    );

    await assert.rejects(
      () =>
        createItem(client, {
          kode: "TEST-011",
          name: "Test Satuan Resep Salah",
          type: "bahan_baku",
          recipeUnit: "satuan-ngarang",
        }),
      /satuan.*tidak ada di master satuan/i,
    );

    await assert.rejects(
      () =>
        createItem(client, {
          kode: "TEST-012",
          name: "Test Satuan Beli Salah",
          type: "bahan_baku",
          recipeUnit: "gr",
          purchaseUnit: "satuan-ngarang",
        }),
      /satuan.*tidak ada di master satuan/i,
    );
  });
});

test("createItem: berhasil setelah kategori/satuan baru ditambahkan lewat master kategori/satuan", async () => {
  await withRollback(async (client) => {
    await createKategori(client, "Kategori Baru Uji");
    await createSatuan(client, "satuan-baru-uji");

    const item = await createItem(client, {
      kode: "TEST-013",
      name: "Test Kategori Satuan Baru",
      type: "bahan_baku",
      category: "Kategori Baru Uji",
      recipeUnit: "satuan-baru-uji",
    });
    const { rows } = await client.query<{ category: string; recipe_unit: string }>(
      `SELECT category, recipe_unit FROM inventory_items WHERE id = $1`,
      [item.id],
    );
    assert.equal(rows[0].category, "Kategori Baru Uji");
    assert.equal(rows[0].recipe_unit, "satuan-baru-uji");
  });
});

test("updateItem: recipeUnit bisa diubah (sebelumnya tidak didukung) dan tetap divalidasi ke master satuan", async () => {
  await withRollback(async (client) => {
    const { id } = await createItem(client, {
      kode: "TEST-014",
      name: "Test Update RecipeUnit",
      type: "bahan_baku",
      recipeUnit: "gr",
    });

    await updateItem(client, "TEST-014", { recipeUnit: "kg" });
    const { rows } = await client.query<{ recipe_unit: string }>(`SELECT recipe_unit FROM inventory_items WHERE id = $1`, [
      id,
    ]);
    assert.equal(rows[0].recipe_unit, "kg");

    await assert.rejects(() => updateItem(client, "TEST-014", { recipeUnit: "satuan-tidak-ada" }), /tidak ada di master satuan/i);
  });
});

test("updateItem: name bisa diubah (rename, kode TETAP), unik tanpa besar/kecil & spasi tepi, dicatat ke audit log (2026-10-30)", async () => {
  await withRollback(async (client) => {
    await createItem(client, { kode: "TEST-015", name: "Nama Lama Rename", type: "bahan_baku", recipeUnit: "gr" });
    await createItem(client, { kode: "TEST-016", name: "Item Lain Rename", type: "bahan_baku", recipeUnit: "gr" });

    await updateItem(client, "TEST-015", { name: "Nama Baru Rename" });
    const { rows } = await client.query<{ name: string; kode: string }>(
      `SELECT name, kode FROM inventory_items WHERE kode = 'TEST-015'`,
    );
    assert.equal(rows[0].name, "Nama Baru Rename");
    assert.equal(rows[0].kode, "TEST-015", "kode TIDAK berubah");

    const { rows: auditRows } = await client.query<{ field_name: string; old_value: string; new_value: string }>(
      `SELECT field_name, old_value, new_value FROM core_audit_log WHERE table_name = 'inventory_items' AND field_name = 'name' ORDER BY id DESC LIMIT 1`,
    );
    assert.equal(auditRows[0].old_value, "Nama Lama Rename");
    assert.equal(auditRows[0].new_value, "Nama Baru Rename");

    // Case-insensitive + spasi tepi dianggap SAMA sebagai nama sendiri -- rename ke variasi
    // kapitalisasi/spasi dari nama SENDIRI tidak boleh ditolak (bukan "bentrok dengan item lain").
    await updateItem(client, "TEST-015", { name: "  nama baru rename  " });

    // Tapi bentrok dengan nama item LAIN (case/spasi apa pun) tetap ditolak, pesan jelas.
    await assert.rejects(
      () => updateItem(client, "TEST-015", { name: "  ITEM lain RENAME  " }),
      /sudah dipakai item lain/i,
    );

    await assert.rejects(() => updateItem(client, "TEST-015", { name: "   " }), /tidak boleh kosong/i);
  });
});

test("updateMenu: rename menu, kode TETAP, unik tanpa besar/kecil & spasi tepi, dicatat ke audit log (2026-10-30)", async () => {
  await withRollback(async (client) => {
    await createMenu(client, { kode: "TEST-MENU-RENAME-1", name: "Menu Lama Rename" });
    await createMenu(client, { kode: "TEST-MENU-RENAME-2", name: "Menu Lain Rename" });

    await updateMenu(client, "TEST-MENU-RENAME-1", { name: "Menu Baru Rename" });
    const { rows } = await client.query<{ name: string; kode: string }>(
      `SELECT name, kode FROM inventory_menu WHERE kode = 'TEST-MENU-RENAME-1'`,
    );
    assert.equal(rows[0].name, "Menu Baru Rename");
    assert.equal(rows[0].kode, "TEST-MENU-RENAME-1");

    const { rows: auditRows } = await client.query<{ old_value: string; new_value: string }>(
      `SELECT old_value, new_value FROM core_audit_log WHERE table_name = 'inventory_menu' AND field_name = 'name' ORDER BY id DESC LIMIT 1`,
    );
    assert.equal(auditRows[0].old_value, "Menu Lama Rename");
    assert.equal(auditRows[0].new_value, "Menu Baru Rename");

    await assert.rejects(
      () => updateMenu(client, "TEST-MENU-RENAME-1", { name: "  menu LAIN rename  " }),
      /sudah dipakai menu lain/i,
    );

    await assert.rejects(() => updateMenu(client, "TEST-MENU-RENAME-1", { name: "" }), /tidak boleh kosong/i);
    await assert.rejects(
      () => updateMenu(client, "TEST-MENU-TIDAK-ADA", { name: "apa saja" }),
      /tidak ditemukan/i,
    );
  });
});

test("updateItem: perubahan harga_master ditulis ke core_audit_log", async () => {
  await withRollback(async (client) => {
    const { id } = await createItem(client, {
      kode: "TEST-003",
      name: "Test Item Audit",
      type: "bahan_baku",
      recipeUnit: "gr",
      purchaseUnit: "kg",
      purchaseToRecipeFactor: 1000,
      hargaMaster: 10000,
    });

    await updateItem(client, "TEST-003", { hargaMaster: 12000 }, 1);

    const { rows } = await client.query<{ field_name: string; old_value: string; new_value: string; user_id: number }>(
      `SELECT field_name, old_value, new_value, user_id FROM core_audit_log WHERE table_name = 'inventory_items' AND record_id = $1`,
      [id],
    );
    const entry = rows.find((r) => r.field_name === "harga_master");
    assert.ok(entry, "audit log untuk harga_master harus ada");
    assert.equal(Number(entry?.old_value), 10000);
    assert.equal(Number(entry?.new_value), 12000);
    assert.equal(Number(entry?.user_id), 1);
  });
});

test("updateItem: tidak menulis audit log kalau nilai numerik sebenarnya sama (beda representasi string vs angka)", async () => {
  await withRollback(async (client) => {
    const { id } = await createItem(client, {
      kode: "TEST-004",
      name: "Test Item No-op",
      type: "bahan_baku",
      recipeUnit: "gr",
      purchaseUnit: "kg",
      purchaseToRecipeFactor: 1000,
      hargaMaster: 14.2,
    });

    await updateItem(client, "TEST-004", { hargaMaster: 14.2 }, 1);

    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM core_audit_log WHERE table_name = 'inventory_items' AND record_id = $1 AND field_name = 'harga_master'`,
      [id],
    );
    assert.equal(Number(rows[0].count), 0, "nilai tidak berubah -> tidak ada baris audit log baru");
  });
});

test("deactivateItem: ditolak kalau item masih dipakai resep/menu AKTIF, daftar resepnya ditampilkan", async () => {
  await withRollback(async (client) => {
    // BB-001 "Bubur" dipakai di banyak menu resep aktif (mis. Bubur Polos).
    await assert.rejects(() => deactivateItem(client, "BB-001", 1), (err: Error) => {
      assert.match(err.message, /menu/i);
      assert.match(err.message, /M-0/); // menyebutkan kode menu
      return true;
    });

    const { rows } = await client.query<{ is_active: boolean }>(`SELECT is_active FROM inventory_items WHERE kode = 'BB-001'`);
    assert.equal(rows[0].is_active, true, "item TIDAK jadi nonaktif setelah ditolak");
  });
});

test("deactivateItem: berhasil untuk item yang tidak dipakai resep/menu apa pun", async () => {
  await withRollback(async (client) => {
    await createItem(client, {
      kode: "TEST-005",
      name: "Test Item Tidak Dipakai",
      type: "bahan_baku",
      recipeUnit: "gr",
    });

    await deactivateItem(client, "TEST-005", 1);

    const { rows } = await client.query<{ is_active: boolean }>(`SELECT is_active FROM inventory_items WHERE kode = 'TEST-005'`);
    assert.equal(rows[0].is_active, false);
  });
});

test("createResepProduksi: trigger 1-level tetap berlaku (bahan setengah_jadi ditolak)", async () => {
  await withRollback(async (client) => {
    const output = await createItem(client, {
      kode: "TEST-006",
      name: "Test Output Resep",
      type: "setengah_jadi",
      recipeUnit: "gr",
    });

    await assert.rejects(
      () =>
        createResepProduksi(client, {
          kode: "TEST-RP-001",
          outputItemKode: "TEST-006",
          baris: [{ bahanItemKode: "SJ-003", qty: 10, unit: "gr" }], // Chili oil = setengah_jadi, harus ditolak
        }),
      /bahan_baku\/packaging/i,
    );

    void output;
  });
});

test("createResepProduksi + updateResepProduksi: ganti baris bahan, yield_qty berubah tercatat di audit log", async () => {
  await withRollback(async (client) => {
    await createItem(client, {
      kode: "TEST-007",
      name: "Test Output Resep 2",
      type: "setengah_jadi",
      recipeUnit: "gr",
    });

    const resep = await createResepProduksi(client, {
      kode: "TEST-RP-002",
      outputItemKode: "TEST-007",
      yieldQty: 100,
      yieldUnit: "gr",
      baris: [{ bahanItemKode: "BB-001", qty: 50, unit: "gr" }],
    });

    await updateResepProduksi(
      client,
      "TEST-RP-002",
      { yieldQty: 120, baris: [{ bahanItemKode: "BB-001", qty: 60, unit: "gr" }] },
      1,
    );

    const { rows: barisRows } = await client.query<{ qty: string }>(
      `SELECT qty FROM inventory_resep_produksi_baris WHERE resep_id = $1`,
      [resep.id],
    );
    assert.equal(barisRows.length, 1, "baris lama diganti, bukan ditambah");
    assert.equal(Number(barisRows[0].qty), 60);

    const { rows: auditRows } = await client.query<{ field_name: string }>(
      `SELECT field_name FROM core_audit_log WHERE table_name = 'inventory_resep_produksi' AND record_id = $1`,
      [resep.id],
    );
    assert.ok(auditRows.some((r) => r.field_name === "yield_qty"));
    assert.ok(auditRows.some((r) => r.field_name === "baris"));
  });
});

// ---------------------------------------------------------------------------
// Menu (header) -- createMenu. Sebelum ada fungsi ini, menu cuma bisa masuk
// lewat SQL mentah di migrasi seed.
//
// KONTRAK BERUBAH di migrasi 0024: `kategoriMenu` (teks bebas) diganti
// `kategoriId` (FK ke inventory_kategori_menu), dan kolom deprecated
// inventory_menu.kategori_menu TIDAK PERNAH lagi ditulis -- test di bawah
// ikut membuktikan kolom itu tetap NULL untuk menu baru.
// ---------------------------------------------------------------------------

test("createMenu: menu baru tersimpan dengan kategori_id (BUKAN kolom deprecated kategori_menu), isActive default true", async () => {
  await withRollback(async (client) => {
    const { id: kategoriId } = await createKategoriMenu(client, {
      kode: "TESTKAT",
      nama: "Test Kategori Menu CreateMenu",
      urutanTampil: 99,
    });

    const lengkap = await createMenu(client, {
      kode: "TEST-MENU-100",
      name: "Test Menu Baru Lengkap",
      kategoriId,
    });
    const { rows } = await client.query<{
      kode: string;
      name: string;
      kategori_id: string | null;
      kategori_menu: string | null;
      is_active: boolean;
      harga_jual: string | null;
    }>(`SELECT kode, name, kategori_id, kategori_menu, is_active, harga_jual FROM inventory_menu WHERE id = $1`, [
      lengkap.id,
    ]);
    assert.equal(rows[0].kode, "TEST-MENU-100");
    assert.equal(rows[0].name, "Test Menu Baru Lengkap");
    assert.equal(Number(rows[0].kategori_id), kategoriId, "kategori sekarang FK ke inventory_kategori_menu");
    assert.equal(
      rows[0].kategori_menu,
      null,
      "kolom kategori_menu DEPRECATED (migrasi 0024) -- tidak boleh ditulis lagi oleh kode baru",
    );
    assert.equal(rows[0].is_active, true, "isActive default true kalau tidak dikirim");
    assert.equal(rows[0].harga_jual, null, "harga_jual (legacy) tidak disentuh endpoint ini");

    // Tanpa kategoriId sama sekali -> boleh, tersimpan NULL (menu bisa
    // dibuat dulu, dikategorikan belakangan).
    const minimal = await createMenu(client, { kode: "TEST-MENU-101", name: "Test Menu Baru Minimal" });
    const { rows: rows2 } = await client.query<{ kategori_id: string | null; is_active: boolean }>(
      `SELECT kategori_id, is_active FROM inventory_menu WHERE id = $1`,
      [minimal.id],
    );
    assert.equal(rows2[0].kategori_id, null);
    assert.equal(rows2[0].is_active, true);

    // isActive bisa dikirim eksplisit false (mis. menu disiapkan dulu, belum dijual).
    const nonaktif = await createMenu(client, {
      kode: "TEST-MENU-102",
      name: "Test Menu Baru Nonaktif",
      isActive: false,
    });
    const { rows: rows3 } = await client.query<{ is_active: boolean }>(
      `SELECT is_active FROM inventory_menu WHERE id = $1`,
      [nonaktif.id],
    );
    assert.equal(rows3[0].is_active, false);
  });
});

test("createMenu: pembuatan menu dicatat ke core_audit_log (field 'created')", async () => {
  await withRollback(async (client) => {
    const { id } = await createMenu(client, { kode: "TEST-MENU-103", name: "Test Menu Audit Created" }, 1);

    const { rows } = await client.query<{ field_name: string; user_id: string }>(
      `SELECT field_name, user_id FROM core_audit_log WHERE table_name = 'inventory_menu' AND record_id = $1`,
      [id],
    );
    const entry = rows.find((r) => r.field_name === "created");
    assert.ok(entry, "pembuatan menu tercatat di audit log");
    assert.equal(Number(entry?.user_id), 1);
  });
});

test("createMenu: menu baru langsung muncul di listMenu dengan status 'pending_data' (resep belum diisi)", async () => {
  await withRollback(async (client) => {
    await createMenu(client, { kode: "TEST-MENU-104", name: "Test Menu Baru Untuk List" });

    const menu = await listMenu(client);
    const found = menu.find((m) => m.kode === "TEST-MENU-104");
    assert.ok(found, "menu yang baru dibuat harus muncul di listMenu");
    assert.equal(found?.isActive, true);
    assert.equal(found?.status, "pending_data", "menu baru belum punya baris resep -> HPP belum bisa dihitung");
  });
});

test("createMenu: kode duplikat ditolak constraint UNIQUE database (tidak ada pengecekan manual, sama seperti createItem)", async () => {
  // assert.rejects ini MENGABORT transaksi (unique violation Postgres), jadi
  // tidak boleh ada query lain setelahnya di blok withRollback yang sama.
  await withRollback(async (client) => {
    await createMenu(client, { kode: "TEST-MENU-105", name: "Test Menu Kode Duplikat A" });
    await assert.rejects(
      () => createMenu(client, { kode: "TEST-MENU-105", name: "Test Menu Kode Duplikat B" }),
      /duplicate key|unique/i,
    );
  });
});

test("createMenu: nama duplikat ditolak constraint UNIQUE database (nama menu wajib unik)", async () => {
  await withRollback(async (client) => {
    await createMenu(client, { kode: "TEST-MENU-106", name: "Test Menu Nama Duplikat" });
    await assert.rejects(
      () => createMenu(client, { kode: "TEST-MENU-107", name: "Test Menu Nama Duplikat" }),
      /duplicate key|unique/i,
    );
  });
});

test("createMenu: kode/name kosong ditolak sebelum menyentuh database", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() => createMenu(client, { kode: "   ", name: "Test Menu Tanpa Kode" }), /kode menu wajib diisi/i);
    await assert.rejects(() => createMenu(client, { kode: "TEST-MENU-108", name: "" }), /nama menu wajib diisi/i);

    // Transaksi TIDAK abort (validasi terjadi sebelum query), jadi insert
    // berikutnya di blok yang sama masih jalan.
    const { id } = await createMenu(client, { kode: "TEST-MENU-108", name: "Test Menu Setelah Validasi" });
    assert.ok(id > 0);
  });
});

test("createMenu: kategoriId yang tidak ada ATAU nonaktif ditolak sebelum menyentuh inventory_menu", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () => createMenu(client, { kode: "TEST-MENU-110", name: "Test Menu Kategori Ngawur", kategoriId: 99999999 }),
      /tidak ditemukan atau nonaktif/i,
    );

    const { id: kategoriId } = await createKategoriMenu(client, {
      kode: "TESTKATOFF",
      nama: "Test Kategori Menu Nonaktif",
    });
    await updateKategoriMenu(client, kategoriId, { aktif: false });

    await assert.rejects(
      () => createMenu(client, { kode: "TEST-MENU-111", name: "Test Menu Kategori Nonaktif", kategoriId }),
      /tidak ditemukan atau nonaktif/i,
    );

    // Validasi terjadi SEBELUM query INSERT, jadi transaksi tidak abort dan
    // menu lain masih bisa dibuat di blok yang sama.
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM inventory_menu WHERE kode IN ('TEST-MENU-110', 'TEST-MENU-111')`,
    );
    assert.equal(Number(rows[0].count), 0, "tidak ada menu yang terbuat saat kategori ditolak");
  });
});

test("createMenu: lokasiIds SEBAGIAN -> baris pengecualian (aktif=false) cuma untuk lokasi yang TIDAK disebut", async () => {
  await withRollback(async (client) => {
    const ckId = Number(await locationId(client, "samsara_ck"));
    const outletId = Number(await outletLocationId(client));

    // Menu cuma tayang di outlet -> CK harus dapat baris pengecualian.
    const { id: menuId } = await createMenu(client, {
      kode: "TEST-MENU-120",
      name: "Test Menu Cuma Outlet",
      lokasiIds: [outletId],
    });

    const { rows } = await client.query<{ lokasi_id: string; aktif: boolean }>(
      `SELECT lokasi_id, aktif FROM inventory_menu_lokasi WHERE menu_id = $1`,
      [menuId],
    );
    assert.equal(rows.length, 1, "cuma lokasi yang TIDAK disebut yang dapat baris");
    assert.equal(Number(rows[0].lokasi_id), ckId, "lokasi yang di-exclude adalah CK (tidak ada di lokasiIds)");
    assert.equal(rows[0].aktif, false, "baris pengecualian artinya menu DISEMBUNYIKAN di lokasi itu");

    const { rows: outletRows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM inventory_menu_lokasi WHERE menu_id = $1 AND lokasi_id = $2`,
      [menuId, outletId],
    );
    assert.equal(
      Number(outletRows[0].count),
      0,
      "lokasi yang DISEBUT di lokasiIds TIDAK boleh punya baris (absen = tayang)",
    );
  });
});

test("createMenu: lokasiIds kosong/tidak dikirim DAN lokasiIds berisi semua lokasi -> sama-sama tanpa baris inventory_menu_lokasi", async () => {
  await withRollback(async (client) => {
    const ckId = Number(await locationId(client, "samsara_ck"));
    const outletId = Number(await outletLocationId(client));

    const tanpaParam = await createMenu(client, { kode: "TEST-MENU-121", name: "Test Menu Semua Lokasi Default" });
    const semuaLokasi = await createMenu(client, {
      kode: "TEST-MENU-122",
      name: "Test Menu Semua Lokasi Eksplisit",
      lokasiIds: [ckId, outletId],
    });
    const arrayKosong = await createMenu(client, {
      kode: "TEST-MENU-123",
      name: "Test Menu Lokasi Array Kosong",
      lokasiIds: [],
    });

    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM inventory_menu_lokasi WHERE menu_id = ANY($1)`,
      [[tanpaParam.id, semuaLokasi.id, arrayKosong.id]],
    );
    assert.equal(
      Number(rows[0].count),
      0,
      "default 'tayang di semua lokasi' TIDAK menulis baris apa pun (optimisasi: hasilnya identik)",
    );
  });
});

// ---------------------------------------------------------------------------
// duplicateMenu
// ---------------------------------------------------------------------------

test("duplicateMenu: baris resep menu sumber tersalin persis ke menu baru (sumber tidak berubah)", async () => {
  await withRollback(async (client) => {
    await createMenu(client, { kode: "TEST-MENU-130", name: "Test Menu Sumber Duplikat" });
    await updateMenuResep(client, "TEST-MENU-130", [
      { itemKode: "BB-001", qty: 10, unit: "gr" },
      { itemKode: "BB-002", qty: 5, unit: "gr" },
    ]);

    const { id: kategoriId } = await createKategoriMenu(client, {
      kode: "TESTKATDUP",
      nama: "Test Kategori Menu Duplikat",
    });
    const baru = await duplicateMenu(client, "TEST-MENU-130", {
      kodeBaru: "TEST-MENU-131",
      nameBaru: "Test Menu Hasil Duplikat",
      kategoriId,
    });
    assert.ok(baru.id > 0);

    const barisBaru = await getMenuResep(client, "TEST-MENU-131");
    const barisSumber = await getMenuResep(client, "TEST-MENU-130");
    assert.deepEqual(barisBaru, barisSumber, "baris resep hasil duplikat identik dengan sumbernya");
    assert.equal(barisBaru.length, 2);

    const { rows } = await client.query<{ kategori_id: string | null; name: string }>(
      `SELECT kategori_id, name FROM inventory_menu WHERE id = $1`,
      [baru.id],
    );
    assert.equal(rows[0].name, "Test Menu Hasil Duplikat");
    assert.equal(
      Number(rows[0].kategori_id),
      kategoriId,
      "kategori menu baru diambil dari body duplikat, bukan dari menu sumber",
    );
  });
});

test("duplicateMenu: menu sumber TANPA resep tetap bisa diduplikat (menu baru kosong, bukan error)", async () => {
  await withRollback(async (client) => {
    await createMenu(client, { kode: "TEST-MENU-132", name: "Test Menu Sumber Tanpa Resep" });

    const baru = await duplicateMenu(client, "TEST-MENU-132", {
      kodeBaru: "TEST-MENU-133",
      nameBaru: "Test Menu Duplikat Tanpa Resep",
    });
    assert.ok(baru.id > 0);

    assert.deepEqual(await getMenuResep(client, "TEST-MENU-133"), [], "menu baru dibuat kosong");

    const menu = await listMenu(client);
    assert.equal(
      menu.find((m) => m.kode === "TEST-MENU-133")?.status,
      "pending_data",
      "menu hasil duplikat tanpa resep statusnya pending_data, sama seperti menu baru biasa",
    );
  });
});

test("duplicateMenu: menu sumber tidak ada -> error 'Menu sumber ... tidak ditemukan' (404 di router)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () => duplicateMenu(client, "TIDAK-ADA", { kodeBaru: "TEST-MENU-134", nameBaru: "Test Menu Duplikat Gagal" }),
      /menu sumber .* tidak ditemukan/i,
    );

    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM inventory_menu WHERE kode = 'TEST-MENU-134'`,
    );
    assert.equal(Number(rows[0].count), 0, "menu baru tidak dibuat kalau sumbernya tidak ada");
  });
});

test("duplicateMenu: lokasiIds sebagian diteruskan ke createMenu (semantik pengecualian tetap berlaku untuk hasil duplikat)", async () => {
  await withRollback(async (client) => {
    const ckId = Number(await locationId(client, "samsara_ck"));
    const outletId = Number(await outletLocationId(client));

    await createMenu(client, { kode: "TEST-MENU-135", name: "Test Menu Sumber Lokasi" });
    await updateMenuResep(client, "TEST-MENU-135", [{ itemKode: "BB-001", qty: 7, unit: "gr" }]);

    const baru = await duplicateMenu(client, "TEST-MENU-135", {
      kodeBaru: "TEST-MENU-136",
      nameBaru: "Test Menu Duplikat Cuma CK",
      lokasiIds: [ckId],
    });

    const { rows } = await client.query<{ lokasi_id: string; aktif: boolean }>(
      `SELECT lokasi_id, aktif FROM inventory_menu_lokasi WHERE menu_id = $1`,
      [baru.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].lokasi_id), outletId);
    assert.equal(rows[0].aktif, false);
  });
});

// ---------------------------------------------------------------------------
// Resep menu
// ---------------------------------------------------------------------------

async function insertTestMenu(client: import("pg").PoolClient, kode: string, name: string): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_menu (kode, name) VALUES ($1, $2) RETURNING id`,
    [kode, name],
  );
  return rows[0].id;
}

test("updateMenuResep: mengubah qty bahan langsung mengubah HPP menu itu (tanpa langkah tambahan)", async () => {
  await withRollback(async (client) => {
    await insertTestMenu(client, "TEST-MENU-001", "Test Menu HPP");

    await updateMenuResep(client, "TEST-MENU-001", [{ itemKode: "BB-001", qty: 10, unit: "gr" }], 1);
    const hppSebelum = await getMenuHppReport(client, "TEST-MENU-001", "harga_master");
    assert.equal(hppSebelum.status, "ok");
    // BB-001 (Bubur) harga_master = 3.35/gr -> 10 * 3.35 = 33.5
    assert.equal(hppSebelum.hpp_per_porsi, 33.5);

    await updateMenuResep(client, "TEST-MENU-001", [{ itemKode: "BB-001", qty: 20, unit: "gr" }], 1);
    const hppSesudah = await getMenuHppReport(client, "TEST-MENU-001", "harga_master");
    assert.equal(hppSesudah.hpp_per_porsi, 67, "HPP berubah proporsional begitu qty bahan diubah, tanpa langkah lain");

    const { rows: barisRows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM inventory_menu_resep_baris WHERE menu_id = (SELECT id FROM inventory_menu WHERE kode = 'TEST-MENU-001')`,
    );
    assert.equal(Number(barisRows[0].count), 1, "baris lama diganti, bukan ditambah/ditumpuk");
  });
});

test("updateMenuResep: perubahan baris dicatat ke core_audit_log", async () => {
  await withRollback(async (client) => {
    const menuId = await insertTestMenu(client, "TEST-MENU-002", "Test Menu Audit");
    await updateMenuResep(client, "TEST-MENU-002", [{ itemKode: "BB-001", qty: 5, unit: "gr" }], 1);

    const { rows } = await client.query<{ field_name: string; user_id: string }>(
      `SELECT field_name, user_id FROM core_audit_log WHERE table_name = 'inventory_menu' AND record_id = $1`,
      [menuId],
    );
    const entry = rows.find((r) => r.field_name === "baris");
    assert.ok(entry, "perubahan baris resep menu tercatat di audit log");
    assert.equal(Number(entry?.user_id), 1);
  });
});

test("deactivateMenu: ditolak kalau menu masih ada di paket AKTIF, daftar paketnya ditampilkan", async () => {
  await withRollback(async (client) => {
    // M-002 "Bubur Original" dipakai di beberapa paket aktif (PaHe Ber-2 Pagi, dkk).
    await assert.rejects(() => deactivateMenu(client, "M-002", 1), (err: Error) => {
      assert.match(err.message, /paket/i);
      assert.match(err.message, /M-0/);
      return true;
    });

    const { rows } = await client.query<{ is_active: boolean }>(`SELECT is_active FROM inventory_menu WHERE kode = 'M-002'`);
    assert.equal(rows[0].is_active, true, "menu TIDAK jadi nonaktif setelah ditolak");
  });
});

test("deactivateMenu: berhasil untuk menu yang bukan komponen paket manapun", async () => {
  await withRollback(async (client) => {
    await insertTestMenu(client, "TEST-MENU-003", "Test Menu Tidak Dipakai Paket");

    await deactivateMenu(client, "TEST-MENU-003", 1);

    const { rows } = await client.query<{ is_active: boolean }>(`SELECT is_active FROM inventory_menu WHERE kode = 'TEST-MENU-003'`);
    assert.equal(rows[0].is_active, false);
  });
});

// ---------------------------------------------------------------------------
// listMenu / getMenuResep (regresi: endpoint GET belum pernah ada, UI pakai
// MOCK_MENU/MOCK_MENU_RESEP_BARIS statis -- lihat listItems di atas untuk
// bug yang sama persis sebelumnya)
// ---------------------------------------------------------------------------

test("listMenu: resep menu yang baru diisi langsung muncul di daftar dengan status 'ok'", async () => {
  await withRollback(async (client) => {
    await insertTestMenu(client, "TEST-MENU-010", "Test Menu Untuk List");
    await updateMenuResep(client, "TEST-MENU-010", [{ itemKode: "BB-001", qty: 10, unit: "gr" }], 1);

    const menu = await listMenu(client);
    const found = menu.find((m) => m.kode === "TEST-MENU-010");
    assert.ok(found, "menu yang baru dibuat harus muncul di listMenu");
    assert.equal(found?.isActive, true);
    assert.equal(found?.status, "ok");
  });
});

test("listMenu: menu tanpa resep diberi status 'pending_data', dan menu nonaktif TETAP muncul (bukan hilang)", async () => {
  await withRollback(async (client) => {
    await insertTestMenu(client, "TEST-MENU-011", "Test Menu Tanpa Resep");
    await deactivateMenu(client, "TEST-MENU-011", 1);

    const menu = await listMenu(client);
    const found = menu.find((m) => m.kode === "TEST-MENU-011");
    assert.ok(found, "menu nonaktif harus tetap muncul di listMenu");
    assert.equal(found?.isActive, false);
    assert.equal(found?.status, "pending_data", "menu tanpa baris resep tidak bisa dihitung HPP-nya");
  });
});

test("listMenu: mengembalikan kategoriId + NAMA kategori dari tabel referensi (bahan saran kode menu otomatis di frontend)", async () => {
  await withRollback(async (client) => {
    const { id: kategoriId } = await createKategoriMenu(client, {
      kode: "TESTKATLIST",
      nama: "Test Kategori Menu List",
      urutanTampil: 98,
    });
    await createMenu(client, { kode: "TEST-MENU-140", name: "Test Menu List Kategori", kategoriId });
    await createMenu(client, { kode: "TEST-MENU-141", name: "Test Menu List Tanpa Kategori" });

    const menu = await listMenu(client);
    const berkategori = menu.find((m) => m.kode === "TEST-MENU-140");
    assert.equal(berkategori?.kategoriId, kategoriId);
    assert.equal(berkategori?.kategori, "Test Kategori Menu List", "nama kategori dibaca dari inventory_kategori_menu");

    const tanpaKategori = menu.find((m) => m.kode === "TEST-MENU-141");
    assert.equal(tanpaKategori?.kategoriId, null);
    assert.equal(tanpaKategori?.kategori, null);

    // Menu seed existing (kategori_menu lama sudah dimigrasikan ke
    // kategori_id oleh 0024) juga harus ikut terbaca kategorinya.
    const seed = menu.find((m) => m.kode === "M-002");
    assert.ok(seed?.kategoriId, "menu seed existing punya kategori_id hasil migrasi 0024");
    assert.ok(seed?.kategori, "nama kategori menu seed existing tetap terbaca");
  });
});

test("getMenuResep: baris yang baru diset lewat updateMenuResep langsung muncul", async () => {
  await withRollback(async (client) => {
    await insertTestMenu(client, "TEST-MENU-012", "Test Menu GetResep");
    await updateMenuResep(client, "TEST-MENU-012", [{ itemKode: "BB-001", qty: 15, unit: "gr" }], 1);

    const baris = await getMenuResep(client, "TEST-MENU-012");
    assert.equal(baris.length, 1);
    assert.equal(baris[0].itemKode, "BB-001");
    assert.equal(baris[0].qty, 15);
    assert.equal(baris[0].unit, "gr");
  });
});

test("getMenuResep: 404 (error 'tidak ditemukan') kalau kode menu tidak ada", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() => getMenuResep(client, "TIDAK-ADA"), /tidak ditemukan/i);
  });
});

// ---------------------------------------------------------------------------
// listResepProduksi / getResepProduksiBaris
// ---------------------------------------------------------------------------

test("listResepProduksi: resep produksi yang baru dibuat langsung muncul di daftar", async () => {
  await withRollback(async (client) => {
    await createItem(client, {
      kode: "TEST-030",
      name: "Test Output Resep List",
      type: "setengah_jadi",
      recipeUnit: "gr",
    });
    await createResepProduksi(client, {
      kode: "TEST-RP-030",
      outputItemKode: "TEST-030",
      yieldQty: 100,
      yieldUnit: "gr",
      baris: [{ bahanItemKode: "BB-001", qty: 50, unit: "gr" }],
    });

    const resep = await listResepProduksi(client);
    const found = resep.find((r) => r.kode === "TEST-RP-030");
    assert.ok(found, "resep produksi yang baru dibuat harus muncul di listResepProduksi");
    assert.equal(found?.outputItemKode, "TEST-030");
    assert.equal(found?.yieldQty, 100);
    assert.equal(found?.yieldUnit, "gr");
    assert.equal(found?.isActive, true);
  });
});

test("listResepProduksi: resep nonaktif TETAP muncul di daftar (bukan hilang)", async () => {
  await withRollback(async (client) => {
    await createItem(client, {
      kode: "TEST-031",
      name: "Test Output Resep Nonaktif",
      type: "setengah_jadi",
      recipeUnit: "gr",
    });
    await createResepProduksi(client, {
      kode: "TEST-RP-031",
      outputItemKode: "TEST-031",
      baris: [{ bahanItemKode: "BB-001", qty: 10, unit: "gr" }],
    });
    await deactivateResepProduksi(client, "TEST-RP-031", 1);

    const resep = await listResepProduksi(client);
    const found = resep.find((r) => r.kode === "TEST-RP-031");
    assert.ok(found, "resep produksi nonaktif harus tetap muncul di listResepProduksi");
    assert.equal(found?.isActive, false);
  });
});

test("getResepProduksiBaris: baris bahan yang baru dibuat langsung muncul", async () => {
  await withRollback(async (client) => {
    await createItem(client, {
      kode: "TEST-032",
      name: "Test Output Resep Baris",
      type: "setengah_jadi",
      recipeUnit: "gr",
    });
    await createResepProduksi(client, {
      kode: "TEST-RP-032",
      outputItemKode: "TEST-032",
      baris: [{ bahanItemKode: "BB-001", qty: 25, unit: "gr" }],
    });

    const baris = await getResepProduksiBaris(client, "TEST-RP-032");
    assert.equal(baris.length, 1);
    assert.equal(baris[0].bahanItemKode, "BB-001");
    assert.equal(baris[0].qty, 25);
    assert.equal(baris[0].unit, "gr");
  });
});

test("getResepProduksiBaris: 404 (error 'tidak ditemukan') kalau kode resep tidak ada", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() => getResepProduksiBaris(client, "TIDAK-ADA"), /tidak ditemukan/i);
  });
});
