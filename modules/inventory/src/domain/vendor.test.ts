import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@samsara/core";
import {
  catatHargaManual,
  createVendor,
  getAmbangKenaikanHargaPersen,
  getHargaTerakhir,
  laporkanSupplierLama,
  listKatalogByVendor,
  listRiwayatHarga,
  listVendor,
  listVendorUntukItem,
  updateVendor,
} from "./vendor.js";
import { createPembelian } from "./stok.js";
import { locationId, withRollback } from "./test-helpers.js";

after(() => pool.end());

const PREFIX = "TEST-VENDOR-";

test("createVendor + listVendor: dibuat, muncul di daftar, pencarian ILIKE case-insensitive", async () => {
  await withRollback(async (client) => {
    const { id } = await createVendor(client, { name: `${PREFIX}Toko Bahan Segar` });
    const semua = await listVendor(client);
    assert.ok(semua.some((v) => v.id === id));

    const hasilCari = await listVendor(client, "bahan segar");
    assert.ok(hasilCari.some((v) => v.id === id), "pencarian ILIKE harus cocok tanpa peduli huruf besar/kecil");

    const tidakCocok = await listVendor(client, `${PREFIX}tidak-ada-vendor-begini`);
    assert.equal(tidakCocok.length, 0);
  });
});

test("createVendor: nama kosong ditolak", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() => createVendor(client, { name: "   " }), /nama vendor wajib/i);
  });
});

test("updateVendor: ubah kontak + nonaktifkan, field lain tidak ikut berubah", async () => {
  await withRollback(async (client) => {
    const { id } = await createVendor(client, {
      name: `${PREFIX}Toko Update`,
      kontakNama: "Budi",
      telepon: "0812",
    });
    await updateVendor(client, id, { telepon: "0899", isActive: false });

    const [vendor] = await listVendor(client, `${PREFIX}Toko Update`);
    assert.equal(vendor.kontakNama, "Budi", "field yang tidak dikirim tetap nilai lama");
    assert.equal(vendor.telepon, "0899");
    assert.equal(vendor.isActive, false);
  });
});

test("updateVendor: id tidak ada -> error", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() => updateVendor(client, 999999999, { name: "apa saja" }), /tidak ditemukan/i);
  });
});

test("catatHargaManual + listKatalogByVendor + listRiwayatHarga: upsert katalog, riwayat selalu bertambah (tidak pernah overwrite)", async () => {
  await withRollback(async (client) => {
    const { id: vendorId } = await createVendor(client, { name: `${PREFIX}Toko Katalog` });

    await catatHargaManual(client, vendorId, "BB-001", 15000);
    let katalog = await listKatalogByVendor(client, vendorId);
    assert.equal(katalog.length, 1);
    assert.equal(katalog[0].itemKode, "BB-001");
    assert.equal(katalog[0].hargaTerakhir, 15000);

    // Catat lagi dengan harga BEDA -- katalog harus jadi harga TERBARU,
    // tapi riwayat harus punya KEDUA titik (tidak menimpa).
    await catatHargaManual(client, vendorId, "BB-001", 16500);
    katalog = await listKatalogByVendor(client, vendorId);
    assert.equal(katalog.length, 1, "katalog tetap SATU baris per vendor+item (upsert, bukan insert baru)");
    assert.equal(katalog[0].hargaTerakhir, 16500);

    const riwayat = await listRiwayatHarga(client, vendorId, "BB-001");
    assert.equal(riwayat.length, 2, "riwayat TIDAK PERNAH ditimpa, selalu bertambah");
    assert.equal(riwayat[0].harga, 16500, "terbaru dulu (ORDER BY dicatat_pada DESC)");
    assert.equal(riwayat[1].harga, 15000);
    assert.equal(riwayat[0].sumber, "manual");
  });
});

test("catatHargaManual: item tidak ditemukan -> error; harga negatif -> error", async () => {
  await withRollback(async (client) => {
    const { id: vendorId } = await createVendor(client, { name: `${PREFIX}Toko Validasi` });
    await assert.rejects(
      () => catatHargaManual(client, vendorId, "KODE-TIDAK-ADA", 1000),
      /tidak ditemukan/i,
    );
    await assert.rejects(() => catatHargaManual(client, vendorId, "BB-001", -500), /angka >= 0/i);
  });
});

test("listVendorUntukItem (pencarian barang ke vendor): urut harga termurah dulu, lintas vendor", async () => {
  await withRollback(async (client) => {
    const { id: vendorMahal } = await createVendor(client, { name: `${PREFIX}Vendor Mahal` });
    const { id: vendorMurah } = await createVendor(client, { name: `${PREFIX}Vendor Murah` });
    await catatHargaManual(client, vendorMahal, "BB-002", 20000);
    await catatHargaManual(client, vendorMurah, "BB-002", 12000);

    const hasil = await listVendorUntukItem(client, "BB-002");
    const hanyaTest = hasil.filter((v) => v.vendorId === vendorMahal || v.vendorId === vendorMurah);
    assert.equal(hanyaTest.length, 2);
    assert.equal(hanyaTest[0].vendorId, vendorMurah, "termurah dulu");
    assert.equal(hanyaTest[0].hargaTerakhir, 12000);
    assert.equal(hanyaTest[1].vendorId, vendorMahal);
  });
});

test("getHargaTerakhir: null kalau belum pernah dicatat, terisi setelah catatHargaManual", async () => {
  await withRollback(async (client) => {
    const { id: vendorId } = await createVendor(client, { name: `${PREFIX}Toko Harga Terakhir` });
    assert.equal(await getHargaTerakhir(client, vendorId, "BB-003"), null);

    await catatHargaManual(client, vendorId, "BB-003", 9000);
    assert.equal(await getHargaTerakhir(client, vendorId, "BB-003"), 9000);
  });
});

test("getAmbangKenaikanHargaPersen: default 10 dari seed migrasi 0030", async () => {
  await withRollback(async (client) => {
    assert.equal(await getAmbangKenaikanHargaPersen(client), 10);
  });
});

test("laporkanSupplierLama: HANYA baris dengan vendor_id NULL, dikelompokkan per teks supplier, TIDAK digabung/dinormalisasi", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const supplierUnik = `${PREFIX}Toko Lama ${Date.now()}`;

    await createPembelian(client, {
      locationId: ck,
      supplier: supplierUnik,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyBeli: 1, satuanBeli: "kg", hargaSatuan: 10000 }],
    });
    await createPembelian(client, {
      locationId: ck,
      supplier: supplierUnik,
      tanggal: "2026-09-30",
      baris: [{ itemKode: "BB-001", qtyBeli: 1, satuanBeli: "kg", hargaSatuan: 10000 }],
    });

    const laporan = await laporkanSupplierLama(client);
    const baris = laporan.find((l) => l.supplier === supplierUnik);
    assert.ok(baris, "supplier teks (vendor_id NULL) harus muncul di laporan");
    assert.equal(baris!.jumlahPembelian, 2, "2 pembelian supplier yang SAMA PERSIS tetap 1 baris laporan, count=2");
  });
});

test("createPembelian dengan vendorId: katalog + riwayat harga ter-update otomatis, TIDAK ada peringatan kalau kenaikan di bawah ambang", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const { id: vendorId } = await createVendor(client, { name: `${PREFIX}Vendor Pembelian Normal` });
    await catatHargaManual(client, vendorId, "BB-001", 10000);

    // Kenaikan 5% (di bawah ambang 10%) -- TIDAK boleh ada peringatan.
    const result = await createPembelian(client, {
      locationId: ck,
      vendorId,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyBeli: 1, satuanBeli: "kg", hargaSatuan: 10500 }],
    });
    assert.deepEqual(result.peringatanHarga, []);

    const katalog = await listKatalogByVendor(client, vendorId);
    assert.equal(katalog[0].hargaTerakhir, 10500, "katalog ter-update ke harga pembelian TERBARU");

    const riwayat = await listRiwayatHarga(client, vendorId, "BB-001");
    assert.equal(riwayat.length, 2, "riwayat manual (seed awal) + riwayat dari pembelian ini");
    assert.equal(riwayat[0].sumber, "pembelian");
  });
});

test("createPembelian dengan vendorId: peringatan MUNCUL kalau kenaikan di ATAS ambang, berisi persen+harga lama+harga baru yang benar", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const { id: vendorId } = await createVendor(client, { name: `${PREFIX}Vendor Pembelian Naik` });
    await catatHargaManual(client, vendorId, "BB-002", 10000);

    // Kenaikan 25% (di atas ambang 10%).
    const result = await createPembelian(client, {
      locationId: ck,
      vendorId,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-002", qtyBeli: 1, satuanBeli: "kg", hargaSatuan: 12500 }],
    });
    assert.equal(result.peringatanHarga.length, 1);
    assert.equal(result.peringatanHarga[0].itemKode, "BB-002");
    assert.equal(result.peringatanHarga[0].hargaLama, 10000);
    assert.equal(result.peringatanHarga[0].hargaBaru, 12500);
    assert.equal(result.peringatanHarga[0].persenKenaikan, 25);
  });
});

test("createPembelian dengan vendorId TAPI item BELUM PERNAH ada di katalog -- tidak ada harga lama untuk dibandingkan, jadi TIDAK ada peringatan (bukan error)", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const { id: vendorId } = await createVendor(client, { name: `${PREFIX}Vendor Item Baru` });

    const result = await createPembelian(client, {
      locationId: ck,
      vendorId,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-004", qtyBeli: 1, satuanBeli: "kg", hargaSatuan: 999999 }],
    });
    assert.deepEqual(result.peringatanHarga, []);

    const katalog = await listKatalogByVendor(client, vendorId);
    assert.equal(katalog[0].hargaTerakhir, 999999, "katalog tetap terbuat walau sebelumnya belum ada entri sama sekali");
  });
});

test("createPembelian TANPA vendorId: katalog vendor TIDAK tersentuh sama sekali (backward compatible)", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const { id: vendorId } = await createVendor(client, { name: `${PREFIX}Vendor Tidak Dipakai` });

    await createPembelian(client, {
      locationId: ck,
      supplier: "Toko Lain (teks bebas, bukan vendor ini)",
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyBeli: 1, satuanBeli: "kg", hargaSatuan: 11000 }],
    });

    const katalog = await listKatalogByVendor(client, vendorId);
    assert.equal(katalog.length, 0, "vendor yang tidak direferensikan di pembelian ini tetap kosong katalognya");
  });
});
