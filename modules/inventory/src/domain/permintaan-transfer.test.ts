import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@samsara/core";
import { createPembelian, createTransferKirim } from "./stok.js";
import {
  batalkanPermintaan,
  createPermintaanTransfer,
  getLayarCk,
  listPermintaanTransfer,
  tolakPermintaan,
} from "./permintaan-transfer.js";
import { kitchenLocationId, outletLocationId, vendorIdPembelianUmum, withRollback } from "./test-helpers.js";

after(() => pool.end());

test("createPermintaanTransfer: multi-item satu pengajuan -> semua baris berbagi kelompokId", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);

    const res = await createPermintaanTransfer(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggalDiminta: "2026-11-15",
      dibutuhkanSebelumTanggal: "2026-11-16",
      dibutuhkanSebelumShift: "pagi",
      baris: [
        { itemKode: "BB-001", qtyDiminta: 10 },
        { itemKode: "BB-002", qtyDiminta: 5 },
      ],
    });

    assert.equal(res.baris.length, 2);
    assert.equal(res.baris[0].kode, `PT-${String(res.baris[0].headerId).padStart(6, "0")}`);
    assert.equal(res.kelompokId, res.baris[0].headerId, "kelompokId = id baris pertama");
    assert.equal(res.baris[1].headerId !== res.baris[0].headerId, true, "tetap 2 baris terpisah (1 baris = 1 item)");

    const daftar = await listPermintaanTransfer(client, { locationId: ck });
    const b1 = daftar.find((d) => d.id === res.baris[0].headerId)!;
    const b2 = daftar.find((d) => d.id === res.baris[1].headerId)!;
    assert.equal(b1.kelompokId, res.kelompokId);
    assert.equal(b2.kelompokId, res.kelompokId, "baris kedua ikut kelompokId baris pertama");
    assert.equal(b1.dibutuhkanSebelumTanggal, "2026-11-16");
    assert.equal(b1.dibutuhkanSebelumShift, "pagi");
  });
});

test("createPermintaanTransfer: satu item saja -> kelompokId = id-nya sendiri", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);
    const res = await createPermintaanTransfer(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggalDiminta: "2026-11-15",
      baris: [{ itemKode: "BB-001", qtyDiminta: 1 }],
    });
    assert.equal(res.kelompokId, res.baris[0].headerId);
  });
});

test("createPermintaanTransfer: validasi -- qty <= 0 ditolak, lokasi sama ditolak, shift tidak valid ditolak, baris kosong ditolak", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);

    await assert.rejects(
      () =>
        createPermintaanTransfer(client, {
          locationAsalId: ck,
          locationTujuanId: outlet,
          tanggalDiminta: "2026-11-15",
          baris: [{ itemKode: "BB-001", qtyDiminta: 0 }],
        }),
      /lebih besar dari 0/i,
    );
    await assert.rejects(
      () =>
        createPermintaanTransfer(client, {
          locationAsalId: ck,
          locationTujuanId: ck,
          tanggalDiminta: "2026-11-15",
          baris: [{ itemKode: "BB-001", qtyDiminta: 1 }],
        }),
      /tidak boleh sama/i,
    );
    await assert.rejects(
      () =>
        createPermintaanTransfer(client, {
          locationAsalId: ck,
          locationTujuanId: outlet,
          tanggalDiminta: "2026-11-15",
          // @ts-expect-error -- sengaja menguji nilai di luar enum
          dibutuhkanSebelumShift: "subuh",
          baris: [{ itemKode: "BB-001", qtyDiminta: 1 }],
        }),
      /dibutuhkanSebelumShift harus/i,
    );
    await assert.rejects(
      () =>
        createPermintaanTransfer(client, {
          locationAsalId: ck,
          locationTujuanId: outlet,
          tanggalDiminta: "2026-11-15",
          baris: [],
        }),
      /minimal 1 item/i,
    );
  });
});

test("listPermintaanTransfer: baris LAMA (tanpa kolom Tahap 1B) tetap tampil, field timeline baru null ('-' di UI)", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);
    // Simulasikan baris "lama" dengan INSERT langsung (TANPA dibutuhkan_sebelum_*/dijawab_*) --
    // migrasi 0034 membiarkan kolom ini NULL untuk baris yang tidak mengisinya.
    const { rows: itemRows } = await client.query<{ id: number }>(`SELECT id FROM inventory_items WHERE kode = 'BB-001'`);
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO inventory_permintaan_transfer (kode, location_asal_id, location_tujuan_id, item_id, qty_diminta, status, tanggal_diminta, kelompok_id)
       VALUES ('PT-QA-LAMA', $1, $2, $3, 5, 'diminta', '2026-01-01', 0) RETURNING id`,
      [ck, outlet, itemRows[0].id],
    );
    await client.query(`UPDATE inventory_permintaan_transfer SET kelompok_id = id WHERE id = $1`, [rows[0].id]);

    const daftar = await listPermintaanTransfer(client, { locationId: ck });
    const lama = daftar.find((d) => d.id === Number(rows[0].id))!;
    assert.ok(lama);
    assert.equal(lama.dibutuhkanSebelumTanggal, null);
    assert.equal(lama.dibutuhkanSebelumShift, null);
    assert.equal(lama.dijawabPada, null);
    assert.equal(lama.dikirimPada, null);
    assert.equal(lama.diterimaPada, null);
    assert.equal(lama.alasanTolak, null);
  });
});

test("tolakPermintaan: status jadi 'ditolak', alasan & dijawab tercatat; tidak bisa ditolak dua kali; alasan kosong ditolak", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);
    const dibuat = await createPermintaanTransfer(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggalDiminta: "2026-11-15",
      baris: [{ itemKode: "BB-001", qtyDiminta: 1 }],
    });
    const id = dibuat.baris[0].headerId;

    await assert.rejects(() => tolakPermintaan(client, { id, alasanTolak: "   " }), /alasan tolak wajib/i);

    const hasil = await tolakPermintaan(client, { id, alasanTolak: "Stok CK sendiri sedang kosong", userId: 1 });
    assert.equal(hasil.status, "ditolak");

    const daftar = await listPermintaanTransfer(client, { locationId: ck });
    const baris = daftar.find((d) => d.id === id)!;
    assert.equal(baris.status, "ditolak");
    assert.equal(baris.alasanTolak, "Stok CK sendiri sedang kosong");
    assert.ok(baris.dijawabPada);

    await assert.rejects(() => tolakPermintaan(client, { id, alasanTolak: "coba lagi" }), /sudah ditolak/i);
  });
});

test("createTransferKirim + permintaanId: qty penuh -> status 'dipenuhi', dijawabPada/dikirimPada terisi", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);
    const dibuat = await createPermintaanTransfer(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggalDiminta: "2026-11-15",
      baris: [{ itemKode: "BB-001", qtyDiminta: 10 }],
    });
    const id = dibuat.baris[0].headerId;

    await createTransferKirim(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggal: "2026-11-15",
      permintaanId: id,
      createdByUserId: 1,
      baris: [{ itemKode: "BB-001", qtyKirim: 10, unit: "gr" }],
    });

    const daftar = await listPermintaanTransfer(client, { locationId: ck });
    const baris = daftar.find((d) => d.id === id)!;
    assert.equal(baris.status, "dipenuhi");
    assert.ok(baris.dijawabPada);
    assert.ok(baris.dikirimPada, "dikirimPada harus terisi dari JOIN ke inventory_transaksi_transfer");
    assert.equal(baris.diterimaPada, null, "belum diterima");
  });
});

test("createTransferKirim + permintaanId: qty KURANG dari diminta -> status 'dipenuhi_sebagian'", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);
    const dibuat = await createPermintaanTransfer(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggalDiminta: "2026-11-15",
      baris: [{ itemKode: "BB-001", qtyDiminta: 10 }],
    });
    const id = dibuat.baris[0].headerId;

    await createTransferKirim(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggal: "2026-11-15",
      permintaanId: id,
      createdByUserId: 1,
      baris: [{ itemKode: "BB-001", qtyKirim: 4, unit: "gr" }],
    });

    const daftar = await listPermintaanTransfer(client, { locationId: ck });
    assert.equal(daftar.find((d) => d.id === id)!.status, "dipenuhi_sebagian");
  });
});

test("getLayarCk: status stok cukup/kurang/habis + saran produksi/beli", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);
    const vendor = await vendorIdPembelianUmum(client);

    // BB-001 (bahan_baku): stok dibuat CUKUP (beli 100) untuk qtyDiminta 10 -> "cukup", saran "beli".
    await createPembelian(client, {
      locationId: ck,
      vendorId: vendor,
      tanggal: "2026-11-14",
      baris: [{ itemKode: "BB-001", qtyBeli: 100, satuanBeli: "kg", hargaSatuan: 9000 }],
      createdByUserId: 1,
    });

    const diminta = await createPermintaanTransfer(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggalDiminta: "2026-11-15",
      baris: [{ itemKode: "BB-001", qtyDiminta: 10 }],
    });

    // SJ-001 (setengah_jadi, kalau ada di seed) -- ambil item setengah_jadi apa saja dari DB
    // supaya test tidak bergantung ke kode spesifik yang mungkin tidak ada di seed ini.
    const { rows: sjRows } = await client.query<{ kode: string }>(
      `SELECT kode FROM inventory_items WHERE type = 'setengah_jadi' AND kode IS NOT NULL LIMIT 1`,
    );

    const layar = await getLayarCk(client, ck);
    const barisBB001 = layar.find((l) => l.id === diminta.baris[0].headerId)!;
    assert.equal(barisBB001.statusStok, "cukup");
    assert.equal(barisBB001.saran, "beli");

    if (sjRows[0]) {
      const dimintaSj = await createPermintaanTransfer(client, {
        locationAsalId: ck,
        locationTujuanId: outlet,
        tanggalDiminta: "2026-11-15",
        baris: [{ itemKode: sjRows[0].kode, qtyDiminta: 999999 }],
      });
      const layar2 = await getLayarCk(client, ck);
      const barisSj = layar2.find((l) => l.id === dimintaSj.baris[0].headerId)!;
      assert.equal(barisSj.saran, "produksi");
      assert.equal(barisSj.statusStok, "habis", "qty diminta sangat besar, stok pasti tidak cukup");
    }
  });
});

test("batalkanPermintaan: masih bekerja seperti sebelumnya (regresi) -- ditolak kalau sudah bukan 'diminta'", async () => {
  await withRollback(async (client) => {
    const ck = await kitchenLocationId(client);
    const outlet = await outletLocationId(client);
    const dibuat = await createPermintaanTransfer(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggalDiminta: "2026-11-15",
      baris: [{ itemKode: "BB-001", qtyDiminta: 1 }],
    });
    const id = dibuat.baris[0].headerId;
    const hasil = await batalkanPermintaan(client, { id });
    assert.equal(hasil.status, "dibatalkan");
    await assert.rejects(() => batalkanPermintaan(client, { id }), /sudah dibatalkan/i);
  });
});
