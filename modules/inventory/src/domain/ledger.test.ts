import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool, type AuthUser } from "@samsara/core";
import { createMutasiLain, createPembelian } from "./stok.js";
import { getKartuStok, getRiwayatSemuaJenis } from "./ledger.js";
import { kitchenLocationId, outletLocationId, vendorIdPembelianUmum, withRollback } from "./test-helpers.js";

after(() => pool.end());

function fakeUser(role: AuthUser["role"], locationIds: number[] = []): AuthUser {
  return {
    id: 1,
    username: "test",
    role,
    allLocations: role === "owner" || role === "manajer_ops",
    locationIds,
    tokenVersion: 0,
    wajibGantiKredensial: false,
  };
}

test("getKartuStok: urutan terbaru dulu, saldo berjalan benar, hargaPerSatuan HANYA di baris pembelian", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const vendor = await vendorIdPembelianUmum(client);

    await createPembelian(client, {
      locationId: ck,
      vendorId: vendor,
      tanggal: "2026-11-10",
      baris: [{ itemKode: "BB-001", qtyBeli: 10, satuanBeli: "kg", hargaSatuan: 15000 }],
      createdByUserId: 1,
    });

    await createMutasiLain(client, {
      locationId: ck,
      jenis: "waste_rusak",
      alasan: "QA kartu stok",
      tanggal: "2026-11-11",
      baris: [{ itemKode: "BB-001", qty: 500 }],
    });

    const hasil = await getKartuStok(client, fakeUser("owner"), {
      itemKode: "BB-001",
      locationId: ck,
      tanggalMulai: "2026-11-01",
      tanggalSelesai: "2026-11-30",
    });

    assert.ok(hasil.rows.length >= 2);
    const [terbaru, sebelumnya] = hasil.rows;
    assert.equal(terbaru.jenis, "mutasi_lain", "urutan terbaru dulu (DESC)");
    assert.equal(sebelumnya.jenis, "pembelian");
    assert.equal(sebelumnya.hargaPerSatuan, 15000, "pembelian HARUS bawa hargaPerSatuan");
    assert.equal(terbaru.hargaPerSatuan, null, "mutasi_lain TIDAK punya hargaPerSatuan");
    assert.match(sebelumnya.referensi, /^Pembelian/);
    assert.match(terbaru.referensi, /^Mutasi lain \(waste_rusak\)/);
    // saldo baris mutasi_lain = saldo baris pembelian + qtyChange mutasi_lain
    assert.equal(terbaru.saldo, sebelumnya.saldo + terbaru.qtyChange);
  });
});

test("getKartuStok: saldo TETAP BENAR walau jendela tanggal mulai di TENGAH histori (bukan delta dalam jendela)", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const vendor = await vendorIdPembelianUmum(client);

    // Baris LAMA (di LUAR jendela yang nanti diminta) menambah stok dulu.
    await createPembelian(client, {
      locationId: ck,
      vendorId: vendor,
      tanggal: "2026-10-01",
      baris: [{ itemKode: "BB-002", qtyBeli: 20, satuanBeli: "kg", hargaSatuan: 10000 }],
      createdByUserId: 1,
    });

    // Baris BARU (di DALAM jendela) sedikit saja.
    await createMutasiLain(client, {
      locationId: ck,
      jenis: "waste_rusak",
      alasan: "QA jendela",
      tanggal: "2026-11-12",
      baris: [{ itemKode: "BB-002", qty: 1 }],
    });

    const hasil = await getKartuStok(client, fakeUser("owner"), {
      itemKode: "BB-002",
      locationId: ck,
      tanggalMulai: "2026-11-01", // SETELAH baris pembelian Okt
      tanggalSelesai: "2026-11-30",
    });

    assert.equal(hasil.rows.length, 1, "baris Oktober di luar jendela, tidak ikut tampil");
    // saldo baris yang tampil harus tetap mencerminkan SELURUH histori
    // (20000 gr dari kg*1000 pembelian - 1 dari mutasi), BUKAN cuma -1.
    assert.ok(hasil.rows[0].saldo > 1000, "saldo harus mengikutsertakan histori SEBELUM jendela");
  });
});

test("getKartuStok: role location-scoped (supervisor) di luar lokasinya -> kosong (bukan error/bocor)", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);

    const hasil = await getKartuStok(client, fakeUser("supervisor", [outlet]), {
      itemKode: "BB-001",
      locationId: ck,
      tanggalMulai: "2026-01-01",
      tanggalSelesai: "2026-12-31",
    });
    assert.deepEqual(hasil, { rows: [], total: 0 });
  });
});

test("getRiwayatSemuaJenis: filter ?jenis= cuma mengembalikan jenis itu, lintas item", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const vendor = await vendorIdPembelianUmum(client);

    await createPembelian(client, {
      locationId: ck,
      vendorId: vendor,
      tanggal: "2026-11-13",
      baris: [{ itemKode: "BB-003", qtyBeli: 5, satuanBeli: "kg", hargaSatuan: 20000 }],
      createdByUserId: 1,
    });
    await createMutasiLain(client, {
      locationId: ck,
      jenis: "waste_rusak",
      alasan: "QA riwayat semua jenis",
      tanggal: "2026-11-13",
      baris: [{ itemKode: "BB-003", qty: 2 }],
    });

    const hasilSemua = await getRiwayatSemuaJenis(client, fakeUser("owner"), {
      tanggalMulai: "2026-11-01",
      tanggalSelesai: "2026-11-30",
    });
    assert.ok(hasilSemua.rows.some((r) => r.jenis === "pembelian"));
    assert.ok(hasilSemua.rows.some((r) => r.jenis === "mutasi_lain"));

    const hasilPembelianSaja = await getRiwayatSemuaJenis(client, fakeUser("owner"), {
      tanggalMulai: "2026-11-01",
      tanggalSelesai: "2026-11-30",
      jenis: "pembelian",
    });
    assert.ok(hasilPembelianSaja.rows.length > 0);
    assert.ok(hasilPembelianSaja.rows.every((r) => r.jenis === "pembelian"));
  });
});

test("getRiwayatSemuaJenis: supervisor TETAP dibatasi ke lokasinya sendiri walau locationId tidak dikirim", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);
    const vendor = await vendorIdPembelianUmum(client);

    await createPembelian(client, {
      locationId: ck,
      vendorId: vendor,
      tanggal: "2026-11-14",
      baris: [{ itemKode: "BB-004", qtyBeli: 3, satuanBeli: "kg", hargaSatuan: 12000 }],
      createdByUserId: 1,
    });

    const hasil = await getRiwayatSemuaJenis(client, fakeUser("supervisor", [outlet]), {
      tanggalMulai: "2026-11-01",
      tanggalSelesai: "2026-11-30",
    });
    assert.ok(
      hasil.rows.every((r) => r.locationId === outlet),
      "supervisor cuma boleh lihat lokasinya sendiri (outlet), tidak boleh bocor baris CK",
    );
  });
});
