import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@samsara/core";
import {
  createKategori,
  createKategoriMenu,
  createSatuan,
  kategoriExists,
  kategoriMenuAktifExists,
  listKategori,
  listKategoriMenu,
  listSatuan,
  satuanExists,
  updateKategori,
  updateKategoriMenu,
  updateSatuan,
} from "./referensi.js";
import { createItem } from "./master.js";
import { withRollback } from "./test-helpers.js";

after(() => pool.end());

test("listKategori/listSatuan: seed dari migrasi 0019 sudah ada (kategori & satuan item existing tetap valid)", async () => {
  await withRollback(async (client) => {
    const kategori = await listKategori(client);
    assert.ok(kategori.some((k) => k.name === "Bubur & Karbo"));
    assert.ok(kategori.length >= 10);

    const satuan = await listSatuan(client);
    assert.ok(satuan.some((s) => s.name === "gr"));
    assert.ok(satuan.some((s) => s.name === "pcs"));
    assert.ok(satuan.length >= 26);
  });
});

test("createKategori + kategoriExists: kategori baru langsung valid dipakai", async () => {
  await withRollback(async (client) => {
    assert.equal(await kategoriExists(client, "Kategori Uji Referensi"), false);
    await createKategori(client, "Kategori Uji Referensi", 1);
    assert.equal(await kategoriExists(client, "Kategori Uji Referensi"), true);
  });
});

test("updateKategori: nonaktifkan kategori -> kategoriExists jadi false lagi (item lama tidak otomatis tervalidasi ulang)", async () => {
  await withRollback(async (client) => {
    const { id } = await createKategori(client, "Kategori Dinonaktifkan");
    assert.equal(await kategoriExists(client, "Kategori Dinonaktifkan"), true);

    await updateKategori(client, id, { isActive: false });
    assert.equal(await kategoriExists(client, "Kategori Dinonaktifkan"), false, "kategori nonaktif tidak boleh lolos validasi item baru");
  });
});

test("updateKategori: rename kategori item CASCADE ke inventory_items.category, unik tanpa besar/kecil & spasi tepi, dicatat ke audit log termasuk penanda item_terdampak (2026-10-30)", async () => {
  await withRollback(async (client) => {
    const { id: idLama } = await createKategori(client, "Kategori Rename Lama");
    const { id: idLain } = await createKategori(client, "Kategori Rename Lain");
    await createItem(client, {
      kode: "TEST-REF-001",
      name: "Item Pakai Kategori Rename",
      type: "bahan_baku",
      recipeUnit: "gr",
      category: "Kategori Rename Lama",
    });

    await updateKategori(client, idLama, { name: "Kategori Rename Baru" });

    const { rows: itemRows } = await client.query<{ category: string }>(
      `SELECT category FROM inventory_items WHERE kode = 'TEST-REF-001'`,
    );
    assert.equal(itemRows[0].category, "Kategori Rename Baru", "cascade: category item ikut berubah");

    const { rows: auditRows } = await client.query<{ field_name: string }>(
      `SELECT field_name FROM core_audit_log WHERE table_name = 'inventory_kategori_item' AND record_id = $1 ORDER BY id DESC LIMIT 2`,
      [idLama],
    );
    assert.ok(
      auditRows.some((r) => r.field_name === "item_terdampak"),
      "ada entri audit penanda item_terdampak terpisah",
    );

    await assert.rejects(
      () => updateKategori(client, idLama, { name: "  KATEGORI rename LAIN  " }),
      /sudah dipakai kategori item lain/i,
    );
    void idLain;
  });
});

test("updateKategoriMenu: rename nama unik tanpa besar/kecil & spasi tepi, TIDAK perlu cascade (kategori_id FK proper) (2026-10-30)", async () => {
  await withRollback(async (client) => {
    const { id: idA } = await createKategoriMenu(client, { kode: "RNA", nama: "Kategori Menu Rename A" });
    await createKategoriMenu(client, { kode: "RNB", nama: "Kategori Menu Rename B" });

    await updateKategoriMenu(client, idA, { nama: "Kategori Menu Rename A Baru" });
    const { rows } = await client.query<{ nama: string }>(`SELECT nama FROM inventory_kategori_menu WHERE id = $1`, [idA]);
    assert.equal(rows[0].nama, "Kategori Menu Rename A Baru");

    await assert.rejects(
      () => updateKategoriMenu(client, idA, { nama: "  kategori MENU rename B  " }),
      /sudah dipakai kategori menu lain/i,
    );
  });
});

test("createSatuan + satuanExists: satuan baru langsung valid dipakai", async () => {
  await withRollback(async (client) => {
    assert.equal(await satuanExists(client, "krat"), false);
    await createSatuan(client, "krat", 1);
    assert.equal(await satuanExists(client, "krat"), true);
  });
});

test("updateSatuan: ganti nama satuan tercatat, nama lama tidak lagi valid", async () => {
  await withRollback(async (client) => {
    const { id } = await createSatuan(client, "nama-lama");
    await updateSatuan(client, id, { name: "nama-baru" });

    assert.equal(await satuanExists(client, "nama-lama"), false);
    assert.equal(await satuanExists(client, "nama-baru"), true);
  });
});

// ---------------------------------------------------------------------------
// Kategori menu (inventory_kategori_menu, migrasi 0024)
// ---------------------------------------------------------------------------

test("listKategoriMenu: seed 10 kategori dari migrasi 0024 ada dan URUT urutan_tampil (bukan alfabetis), lengkap dengan kode", async () => {
  await withRollback(async (client) => {
    const kategori = await listKategoriMenu(client);
    assert.ok(kategori.length >= 10, "10 kategori seed dari nilai kategori_menu lama");

    const buryam = kategori.find((k) => k.nama === "Buryam");
    assert.ok(buryam, "kategori seed 'Buryam' ada");
    assert.equal(buryam?.kode, "BURYAM", "kode kategori dipakai frontend sebagai prefix saran kode menu");
    assert.equal(buryam?.aktif, true);

    // "Paket Hemat" sengaja berkode PAHE (bukan PAKETHEMAT) -- lihat catatan di migrasi 0024.
    assert.equal(kategori.find((k) => k.nama === "Paket Hemat")?.kode, "PAHE");

    const urutan = kategori.map((k) => k.urutanTampil);
    assert.deepEqual(urutan, [...urutan].sort((a, b) => a - b), "hasil terurut berdasarkan urutan_tampil");
  });
});

test("createKategoriMenu: kategori baru tersimpan lengkap (kode/nama/urutanTampil), aktif default true, dicatat ke audit log", async () => {
  await withRollback(async (client) => {
    const { id } = await createKategoriMenu(
      client,
      { kode: "TESTREFKAT", nama: "Test Kategori Menu Referensi", urutanTampil: 42 },
      1,
    );

    const daftar = await listKategoriMenu(client);
    const found = daftar.find((k) => k.id === id);
    assert.ok(found, "kategori yang baru dibuat langsung muncul di listKategoriMenu");
    assert.equal(found?.kode, "TESTREFKAT");
    assert.equal(found?.nama, "Test Kategori Menu Referensi");
    assert.equal(found?.urutanTampil, 42);
    assert.equal(found?.aktif, true, "aktif default true");
    assert.equal(await kategoriMenuAktifExists(client, id), true);

    const { rows } = await client.query<{ field_name: string; user_id: string }>(
      `SELECT field_name, user_id FROM core_audit_log WHERE table_name = 'inventory_kategori_menu' AND record_id = $1`,
      [id],
    );
    const entry = rows.find((r) => r.field_name === "created");
    assert.ok(entry, "pembuatan kategori menu tercatat di audit log");
    assert.equal(Number(entry?.user_id), 1);
  });
});

test("createKategoriMenu: urutanTampil opsional (default 0), kode/nama kosong ditolak sebelum menyentuh database", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () => createKategoriMenu(client, { kode: "   ", nama: "Test Kategori Tanpa Kode" }),
      /kode kategori menu wajib diisi/i,
    );
    await assert.rejects(
      () => createKategoriMenu(client, { kode: "TESTREFKAT2", nama: "  " }),
      /nama kategori menu wajib diisi/i,
    );

    // Transaksi TIDAK abort (validasi sebelum query), insert berikutnya jalan.
    const { id } = await createKategoriMenu(client, { kode: "TESTREFKAT2", nama: "Test Kategori Default Urutan" });
    const found = (await listKategoriMenu(client)).find((k) => k.id === id);
    assert.equal(found?.urutanTampil, 0, "urutanTampil default 0 kalau tidak dikirim");
  });
});

test("createKategoriMenu: kode duplikat ditolak constraint UNIQUE database (tidak ada pengecekan manual)", async () => {
  // Unique violation MENGABORT transaksi -- tidak boleh ada query lain setelahnya.
  await withRollback(async (client) => {
    await assert.rejects(
      () => createKategoriMenu(client, { kode: "BURYAM", nama: "Test Kategori Kode Duplikat" }),
      /duplicate key|unique/i,
    );
  });
});

test("createKategoriMenu: nama duplikat ditolak constraint UNIQUE database", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () => createKategoriMenu(client, { kode: "TESTREFKAT3", nama: "Buryam" }),
      /duplicate key|unique/i,
    );
  });
});

test("updateKategoriMenu: ubah nama/urutan/aktif, perubahan per field dicatat ke audit log; kategori nonaktif tidak lolos validasi menu baru", async () => {
  await withRollback(async (client) => {
    const { id } = await createKategoriMenu(client, {
      kode: "TESTREFUPD",
      nama: "Test Kategori Sebelum Ubah",
      urutanTampil: 50,
    });

    await updateKategoriMenu(client, id, { nama: "Test Kategori Sesudah Ubah", urutanTampil: 51, aktif: false }, 1);

    const found = (await listKategoriMenu(client)).find((k) => k.id === id);
    assert.equal(found?.nama, "Test Kategori Sesudah Ubah");
    assert.equal(found?.urutanTampil, 51);
    assert.equal(found?.aktif, false);
    assert.equal(found?.kode, "TESTREFUPD", "field yang tidak dikirim tidak berubah");
    assert.equal(
      await kategoriMenuAktifExists(client, id),
      false,
      "kategori nonaktif tidak boleh lolos validasi createMenu",
    );

    const { rows } = await client.query<{ field_name: string }>(
      `SELECT field_name FROM core_audit_log WHERE table_name = 'inventory_kategori_menu' AND record_id = $1`,
      [id],
    );
    const fields = rows.map((r) => r.field_name);
    assert.ok(fields.includes("nama"));
    assert.ok(fields.includes("urutan_tampil"));
    assert.ok(fields.includes("aktif"));
    assert.equal(fields.includes("kode"), false, "field yang nilainya tidak berubah tidak ditulis ke audit log");
  });
});

test("updateKategoriMenu: id tidak ada -> error 'tidak ditemukan' (404 di router)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() => updateKategoriMenu(client, 99999999, { nama: "Apa Saja" }), /tidak ditemukan/i);
  });
});

test("kategoriMenuAktifExists: id yang tidak ada -> false (bukan error)", async () => {
  await withRollback(async (client) => {
    assert.equal(await kategoriMenuAktifExists(client, 99999999), false);
  });
});
