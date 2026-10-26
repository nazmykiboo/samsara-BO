import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@samsara/core";
import {
  createMutasiLain,
  createOpname,
  createPembelian,
  createPenjualan,
  createTransferKirim,
  createTransferTerima,
  decideOpname,
  getCurrentStock,
  getDalamPerjalanan,
  listOpname,
} from "./stok.js";
import { locationId, outletLocationId, vendorIdPembelianUmum, withRollback } from "./test-helpers.js";

after(() => pool.end());

async function itemId(client: import("pg").PoolClient, kode: string): Promise<number> {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM inventory_items WHERE kode = $1`, [kode]);
  if (!rows[0]) throw new Error(`fixture item "${kode}" tidak ditemukan`);
  return rows[0].id;
}

test("createPembelian: konversi satuan beli ke satuan resep otomatis", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const before = await getCurrentStock(client, await itemId(client, "BB-001"), ck);

    const result = await createPembelian(client, {
      locationId: ck,
      vendorId: await vendorIdPembelianUmum(client),
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyBeli: 2, satuanBeli: "kg", hargaSatuan: 12000 }],
    });

    // BB-001: purchase_to_recipe_factor 1000 (1 kg = 1000 gr) -> 2 kg = 2000 gr
    assert.equal(result.baris[0].qtyRecipeUnit, 2000);

    const after = await getCurrentStock(client, await itemId(client, "BB-001"), ck);
    assert.equal(after - before, 2000, "stok bertambah persis sejumlah qty_recipe_unit hasil konversi");
  });
});

test("createPembelian: TANPA vendorId ditolak 400 dengan pesan jelas, vendor seed \"Pembelian Umum\" bisa dipakai", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    await assert.rejects(
      () =>
        // @ts-expect-error -- sengaja menghilangkan vendorId untuk menguji validasi wajibnya
        createPembelian(client, {
          locationId: ck,
          tanggal: "2026-09-29",
          baris: [{ itemKode: "BB-001", qtyBeli: 1, satuanBeli: "kg", hargaSatuan: 10000 }],
        }),
      /vendor wajib dipilih/i,
    );

    // Vendor seed dari migrasi 0031 memang dibuat supaya bisa dipakai di sini.
    const result = await createPembelian(client, {
      locationId: ck,
      vendorId: await vendorIdPembelianUmum(client),
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyBeli: 1, satuanBeli: "kg", hargaSatuan: 10000 }],
    });
    assert.ok(result.headerId > 0, "vendor seed \"Pembelian Umum (pasar/warung)\" valid dipakai pembelian");
  });
});

test("createPembelian: item pending_data tanpa konversi satuan ditolak, bukan diproses dengan angka salah", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const vendorId = await vendorIdPembelianUmum(client);
    await assert.rejects(
      () =>
        createPembelian(client, {
          locationId: ck,
          vendorId,
          tanggal: "2026-09-29",
          baris: [{ itemKode: "OP-006", qtyBeli: 1, satuanBeli: "pcs", hargaSatuan: 10000 }], // Sapu, pending_data
        }),
      /konversi satuan/i,
    );
  });
});

test("createTransferKirim: stok lokasi asal langsung berkurang, TAPI belum masuk stok lokasi manapun (dalam perjalanan)", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const outlet = await outletLocationId(client);
    const bubur = await itemId(client, "BB-001");

    const stokCkBefore = await getCurrentStock(client, bubur, ck);
    const stokOutletBefore = await getCurrentStock(client, bubur, outlet);

    const kirim = await createTransferKirim(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyKirim: 100, unit: "gr" }],
    });

    const stokCkAfter = await getCurrentStock(client, bubur, ck);
    const stokOutletAfter = await getCurrentStock(client, bubur, outlet);
    assert.equal(stokCkBefore - stokCkAfter, 100, "lokasi asal langsung berkurang sejumlah qty_kirim");
    assert.equal(stokOutletAfter, stokOutletBefore, "lokasi tujuan BELUM bertambah -- masih 'dalam perjalanan'");

    const dalamPerjalanan = await getDalamPerjalanan(client, { locationAsalId: ck });
    const baris = dalamPerjalanan.find((r) => r.transferId === kirim.headerId);
    assert.ok(baris, "transfer yang baru dikirim harus muncul di dalam-perjalanan");
    assert.equal(baris?.qtyKirim, 100);
  });
});

test("createTransferTerima: susut = qty_kirim - qty_terima tercatat saat terima, stok tujuan bertambah qty_terima", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const outlet = await outletLocationId(client);
    const bubur = await itemId(client, "BB-001");

    const kirim = await createTransferKirim(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyKirim: 100, unit: "gr" }],
    });

    const stokOutletBefore = await getCurrentStock(client, bubur, outlet);

    const terima = await createTransferTerima(client, {
      transferId: kirim.headerId,
      baris: [{ itemKode: "BB-001", qtyTerima: 90 }],
    });

    assert.equal(terima.baris[0].susut, 10, "susut = 100 - 90");

    const stokOutletAfter = await getCurrentStock(client, bubur, outlet);
    assert.equal(stokOutletAfter - stokOutletBefore, 90, "stok tujuan bertambah qty_terima, bukan qty_kirim");

    const dalamPerjalananSetelahTerima = await getDalamPerjalanan(client, { locationAsalId: ck });
    assert.equal(
      dalamPerjalananSetelahTerima.find((r) => r.transferId === kirim.headerId),
      undefined,
      "transfer yang sudah diterima tidak lagi tercatat 'dalam perjalanan'",
    );
  });
});

test("createTransferTerima: transfer yang sudah diterima tidak bisa diterima ulang", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const outlet = await outletLocationId(client);

    const kirim = await createTransferKirim(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyKirim: 10, unit: "gr" }],
    });
    await createTransferTerima(client, { transferId: kirim.headerId, baris: [{ itemKode: "BB-001", qtyTerima: 10 }] });

    await assert.rejects(
      () => createTransferTerima(client, { transferId: kirim.headerId, baris: [{ itemKode: "BB-001", qtyTerima: 10 }] }),
      /sudah diterima/i,
    );
  });
});

test("createTransferKirim: antar entitas terdeteksi otomatis, harga transfer default = HPP item di lokasi asal (Skema A), dihitung saat kirim", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const outlet = await outletLocationId(client);

    const result = await createTransferKirim(client, {
      locationAsalId: ck,
      locationTujuanId: outlet,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyKirim: 50, unit: "gr" }],
    });

    assert.equal(result.antarEntitas, true, "Central Kitchen dan outlet manapun (outletLocationId mengecualikan samsara_ck) beda entitas");
    assert.equal(result.baris[0].hargaTransferPerSatuan, 3.35, "default Skema A = harga_master item (BB-001)");
  });
});

test("createTransferKirim: transfer dalam entitas yang sama TIDAK ditandai antar_entitas", async () => {
  await withRollback(async (client) => {
    const outlet1 = await outletLocationId(client);
    // Lokasi kedua dibuat dengan entitas SAMA PERSIS seperti outlet1 (dibaca
    // dinamis, BUKAN hardcode "samsara_outlet") supaya kasus non-antar-entitas
    // benar-benar teruji terlepas dari apa pun entitas outlet dev saat ini.
    const { rows: entitasRows } = await client.query<{ entitas: string }>(
      `SELECT entitas FROM core_locations WHERE id = $1`,
      [outlet1],
    );
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO core_locations (name, entitas, is_active) VALUES ('Outlet Kedua (test)', $1, true) RETURNING id`,
      [entitasRows[0].entitas],
    );
    const outlet2 = rows[0].id;

    const result = await createTransferKirim(client, {
      locationAsalId: outlet1,
      locationTujuanId: outlet2,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyKirim: 10, unit: "gr" }],
    });

    assert.equal(result.antarEntitas, false);
    assert.equal(result.baris[0].hargaTransferPerSatuan, null, "tidak antar entitas -> tidak perlu harga transfer default");
  });
});

// ---------------------------------------------------------------------------
// Mutasi lain: `jenis` wajib (migrasi 0026)
// ---------------------------------------------------------------------------

test("createMutasiLain: 'jenis' valid tersimpan, 'alasan' tetap tersimpan terpisah (dua kolom berdampingan)", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const bubur = await itemId(client, "BB-001");
    const before = await getCurrentStock(client, bubur, ck);

    const { headerId } = await createMutasiLain(client, {
      locationId: ck,
      jenis: "waste_rusak",
      alasan: "tumpah saat dipindah",
      tanggal: "2026-10-15",
      baris: [{ itemKode: "BB-001", qtyChange: -25 }],
    });

    const { rows } = await client.query<{ jenis: string | null; alasan: string }>(
      `SELECT jenis, alasan FROM inventory_transaksi_mutasi_lain WHERE id = $1`,
      [headerId],
    );
    assert.equal(rows[0].jenis, "waste_rusak", "kategori terstruktur tersimpan di kolom jenis");
    assert.equal(rows[0].alasan, "tumpah saat dipindah", "catatan bebas TETAP tersimpan di kolom alasan, tidak digantikan");

    const after = await getCurrentStock(client, bubur, ck);
    assert.equal(after - before, -25, "stok tetap berubah sesuai qty_change");
  });
});

test("createMutasiLain: tanpa 'jenis' DITOLAK dengan pesan yang menyebut daftar nilai valid", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    await assert.rejects(
      () =>
        // @ts-expect-error -- memang menguji input tanpa `jenis` (kontrak baru: wajib)
        createMutasiLain(client, {
          locationId: ck,
          alasan: "lupa pilih jenis",
          tanggal: "2026-10-15",
          baris: [{ itemKode: "BB-001", qtyChange: -1 }],
        }),
      (err: Error) => {
        assert.match(err.message, /Jenis mutasi wajib dipilih/i);
        assert.match(err.message, /waste_rusak/);
        assert.match(err.message, /retur_supplier/);
        return true;
      },
    );
  });
});

test("createMutasiLain: 'jenis' di luar 6 nilai valid DITOLAK (tidak sampai ke constraint Postgres)", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    await assert.rejects(
      () =>
        createMutasiLain(client, {
          locationId: ck,
          // @ts-expect-error -- memang menguji nilai di luar daftar
          jenis: "waste",
          alasan: "typo jenis",
          tanggal: "2026-10-15",
          baris: [{ itemKode: "BB-001", qtyChange: -1 }],
        }),
      /Jenis mutasi wajib dipilih dan harus salah satu dari/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Mutasi lain: `koreksi_tambah` + konsistensi `jenis` vs tanda qty (migrasi 0027)
// ---------------------------------------------------------------------------

test("createMutasiLain: jenis 'koreksi_tambah' dengan semua qty POSITIF tersimpan dan menambah stok", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const bubur = await itemId(client, "BB-001");
    const before = await getCurrentStock(client, bubur, ck);

    const { headerId } = await createMutasiLain(client, {
      locationId: ck,
      jenis: "koreksi_tambah",
      alasan: "stok awal saat mulai pakai sistem",
      tanggal: "2026-10-15",
      baris: [
        { itemKode: "BB-001", qtyChange: 500 },
        { itemKode: "BB-001", qtyChange: 100 },
      ],
    });

    const { rows } = await client.query<{ jenis: string | null; alasan: string }>(
      `SELECT jenis, alasan FROM inventory_transaksi_mutasi_lain WHERE id = $1`,
      [headerId],
    );
    assert.equal(rows[0].jenis, "koreksi_tambah", "kategori baru migrasi 0027 lolos CHECK constraint & tersimpan");
    assert.equal(rows[0].alasan, "stok awal saat mulai pakai sistem");

    const after = await getCurrentStock(client, bubur, ck);
    assert.equal(after - before, 600, "stok BERTAMBAH sejumlah total qty_change positif");
  });
});

test("createMutasiLain: jenis 'koreksi_tambah' dengan qty NEGATIF DITOLAK (arah tidak cocok)", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    await assert.rejects(
      () =>
        createMutasiLain(client, {
          locationId: ck,
          jenis: "koreksi_tambah",
          alasan: "salah pilih jenis, ini sebenarnya waste",
          tanggal: "2026-10-15",
          baris: [{ itemKode: "BB-001", qtyChange: -10 }],
        }),
      (err: Error) => {
        assert.match(err.message, /koreksi_tambah/);
        assert.match(err.message, /semua baris qty harus positif/i);
        return true;
      },
    );
  });
});

test("createMutasiLain: jenis pengurangan ('waste_rusak') dengan qty POSITIF DITOLAK, pesannya mengarahkan ke koreksi_tambah", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const bubur = await itemId(client, "BB-001");
    const before = await getCurrentStock(client, bubur, ck);

    await assert.rejects(
      () =>
        createMutasiLain(client, {
          locationId: ck,
          jenis: "waste_rusak",
          alasan: "mau menambah stok tapi pilih jenis waste",
          tanggal: "2026-10-15",
          baris: [{ itemKode: "BB-001", qtyChange: 10 }],
        }),
      (err: Error) => {
        assert.match(err.message, /waste_rusak/);
        assert.match(err.message, /semua baris qty harus negatif/i);
        assert.match(err.message, /koreksi_tambah/, "pesan harus mengarahkan ke jenis yang benar");
        return true;
      },
    );

    const after = await getCurrentStock(client, bubur, ck);
    assert.equal(after, before, "ditolak sebelum INSERT -- stok tidak berubah sama sekali");
  });
});

// Baris bertanda CAMPURAN tidak punya pengecekan "mixed sign" tersendiri di
// createMutasiLain: `jenis` cuma satu nilai per header, jadi apa pun jenis yang
// dipilih, salah satu dari dua pengecekan arah pasti melanggar. Dua test di
// bawah membuktikan itu untuk kedua sisi (jenis pengurangan & penambahan).
test("createMutasiLain: baris bertanda CAMPURAN dengan jenis 'koreksi_tambah' DITOLAK (baris negatifnya melanggar)", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    await assert.rejects(
      () =>
        createMutasiLain(client, {
          locationId: ck,
          jenis: "koreksi_tambah",
          alasan: "campur tambah & kurang dalam satu entri",
          tanggal: "2026-10-15",
          baris: [
            { itemKode: "BB-001", qtyChange: 5 },
            { itemKode: "BB-005", qtyChange: -3 },
          ],
        }),
      (err: Error) => {
        assert.match(err.message, /koreksi_tambah/);
        assert.match(err.message, /semua baris qty harus positif/i, "ditolak karena ada baris NEGATIF");
        return true;
      },
    );
  });
});

test("createMutasiLain: baris bertanda CAMPURAN dengan jenis 'waste_rusak' DITOLAK (baris positifnya melanggar)", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    await assert.rejects(
      () =>
        createMutasiLain(client, {
          locationId: ck,
          jenis: "waste_rusak",
          alasan: "campur tambah & kurang dalam satu entri",
          tanggal: "2026-10-15",
          baris: [
            { itemKode: "BB-001", qtyChange: 5 },
            { itemKode: "BB-005", qtyChange: -3 },
          ],
        }),
      (err: Error) => {
        assert.match(err.message, /waste_rusak/);
        assert.match(err.message, /semua baris qty harus negatif/i, "ditolak karena ada baris POSITIF");
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Penjualan: kolom `jam` opsional (migrasi 0026)
// ---------------------------------------------------------------------------

test("createPenjualan: 'jam' yang diisi tersimpan di kolom jam", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);

    const { headerId } = await createPenjualan(client, {
      locationId: outlet,
      sumber: "Offline",
      tanggal: "2026-10-15",
      jam: "19:45",
      baris: [{ menuKode: "M-001", qty: 1 }],
    });

    const { rows } = await client.query<{ jam: string | null }>(
      `SELECT to_char(jam, 'HH24:MI:SS') AS jam FROM inventory_transaksi_penjualan WHERE id = $1`,
      [headerId],
    );
    assert.equal(rows[0].jam, "19:45:00", "'HH:MM' disimpan sebagai TIME, detik jadi 00");
  });
});

test("createPenjualan: tanpa 'jam' -> kolom jam NULL, bukan error", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);

    const { headerId } = await createPenjualan(client, {
      locationId: outlet,
      sumber: "Offline",
      tanggal: "2026-10-15",
      baris: [{ menuKode: "M-001", qty: 1 }],
    });

    const { rows } = await client.query<{ jam: string | null }>(
      `SELECT jam FROM inventory_transaksi_penjualan WHERE id = $1`,
      [headerId],
    );
    assert.equal(rows[0].jam, null, "jam opsional -> NULL, transaksi tetap tercatat");
  });
});

// ---------------------------------------------------------------------------
// Penjualan: snapshot HPP per baris (hpp_saat_transaksi/hpp_sumber, migrasi
// 0028) -- dihitung OTOMATIS di createPenjualan, lihat doc fungsinya.
// ---------------------------------------------------------------------------

/**
 * Item bahan_baku + menu dengan 1 baris resep (qty 1) yang pakai item itu --
 * HPP menu = `hargaMaster` PERSIS (pola sama dengan `buatMenuSederhana` di
 * hpp.test.ts). `hargaMaster` boleh `null` untuk memaksa status pending_data.
 */
async function buatMenuDenganHarga(
  client: import("pg").PoolClient,
  kodeMenu: string,
  hargaMaster: number | null,
): Promise<void> {
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

async function bacaSnapshotHppBaris(
  client: import("pg").PoolClient,
  headerId: number,
): Promise<Array<{ hpp_saat_transaksi: string | null; hpp_sumber: string | null }>> {
  const { rows } = await client.query<{ hpp_saat_transaksi: string | null; hpp_sumber: string | null }>(
    `SELECT hpp_saat_transaksi, hpp_sumber FROM inventory_transaksi_penjualan_baris WHERE header_id = $1`,
    [headerId],
  );
  return rows;
}

test("createPenjualan: baris baru otomatis dapat snapshot HPP ('snapshot_asli') sesuai method HPP aktif", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    await buatMenuDenganHarga(client, "TEST-STOK-HPP-01", 1234.5);

    const { headerId } = await createPenjualan(client, {
      locationId: outlet,
      sumber: "Offline",
      tanggal: "2026-10-15",
      baris: [{ menuKode: "TEST-STOK-HPP-01", qty: 3 }],
    });

    const [baris] = await bacaSnapshotHppBaris(client, headerId);
    assert.equal(baris.hpp_sumber, "snapshot_asli");
    assert.equal(Number(baris.hpp_saat_transaksi), 1234.5, "hpp_saat_transaksi = HPP per porsi, bukan dikali qty terjual");
  });
});

test("createPenjualan: hpp_saat_transaksi TETAP (tidak ikut berubah) walau harga_master item diubah SETELAH transaksi dibuat", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    await buatMenuDenganHarga(client, "TEST-STOK-HPP-02", 1000);

    const { headerId } = await createPenjualan(client, {
      locationId: outlet,
      sumber: "Offline",
      tanggal: "2026-10-15",
      baris: [{ menuKode: "TEST-STOK-HPP-02", qty: 1 }],
    });

    const [sebelum] = await bacaSnapshotHppBaris(client, headerId);
    assert.equal(Number(sebelum.hpp_saat_transaksi), 1000);

    await client.query(`UPDATE inventory_items SET harga_master = 9999 WHERE kode = 'TEST-STOK-HPP-02-ITEM'`);

    const [sesudah] = await bacaSnapshotHppBaris(client, headerId);
    assert.equal(
      Number(sesudah.hpp_saat_transaksi),
      1000,
      "snapshot historis TIDAK ikut berubah walau harga_master terkini berubah",
    );
    assert.equal(sesudah.hpp_sumber, "snapshot_asli");
  });
});

test("createPenjualan: menu yang bergantung ke item pending_data -> hpp_saat_transaksi NULL TAPI hpp_sumber tetap 'snapshot_asli' (bukan NULL/estimasi)", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    await buatMenuDenganHarga(client, "TEST-STOK-HPP-03", null); // harga_master kosong -> pending_data

    const { headerId } = await createPenjualan(client, {
      locationId: outlet,
      sumber: "Offline",
      tanggal: "2026-10-15",
      baris: [{ menuKode: "TEST-STOK-HPP-03", qty: 1 }],
    });

    const [baris] = await bacaSnapshotHppBaris(client, headerId);
    assert.equal(baris.hpp_saat_transaksi, null, "HPP tidak bisa dihitung saat itu -> NULL");
    assert.equal(
      baris.hpp_sumber,
      "snapshot_asli",
      "TETAP snapshot_asli -- genuinely dihitung PERSIS saat itu, bukan backfill (beda makna dari snapshot_estimasi)",
    );
  });
});

test("createOpname: status draft, qty_sistem snapshot, TAPI stok BELUM berubah sampai disetujui", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const bubur = await itemId(client, "BB-001");

    const before = await getCurrentStock(client, bubur, ck);
    const qtyFisik = before + 7;

    const result = await createOpname(client, {
      locationId: ck,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyFisik }],
    });

    assert.equal(result.status, "draft");
    assert.equal(result.baris[0].qtySistem, before);
    assert.equal(result.baris[0].selisih, 7);

    const stokSetelahInput = await getCurrentStock(client, bubur, ck);
    assert.equal(stokSetelahInput, before, "input hitungan draft TIDAK mengubah stok");
  });
});

test("decideOpname: 'setuju' memposting selisih ke ledger, tercatat siapa & kapan", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const bubur = await itemId(client, "BB-001");

    const before = await getCurrentStock(client, bubur, ck);
    const qtyFisik = before + 7;
    const draft = await createOpname(client, {
      locationId: ck,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyFisik }],
    });

    const decided = await decideOpname(client, { opnameId: draft.headerId, decision: "setuju", decidedByUserId: 1 });

    assert.equal(decided.status, "disetujui");
    assert.equal(decided.baris[0].diposting, true);

    const after = await getCurrentStock(client, bubur, ck);
    assert.equal(after, qtyFisik, "stok setelah disetujui = qty_fisik yang diinput");

    const { rows } = await client.query<{ diputuskan_oleh: string; diputuskan_at: Date | null }>(
      `SELECT diputuskan_oleh, diputuskan_at FROM inventory_transaksi_opname WHERE id = $1`,
      [draft.headerId],
    );
    assert.equal(Number(rows[0].diputuskan_oleh), 1, "tercatat siapa yang memutuskan");
    assert.ok(rows[0].diputuskan_at !== null, "tercatat kapan diputuskan");
  });
});

test("decideOpname: 'tolak' tidak mengubah stok sama sekali", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const bubur = await itemId(client, "BB-001");

    const before = await getCurrentStock(client, bubur, ck);
    const draft = await createOpname(client, {
      locationId: ck,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyFisik: before + 7 }],
    });

    const decided = await decideOpname(client, { opnameId: draft.headerId, decision: "tolak" });

    assert.equal(decided.status, "ditolak");
    assert.equal(decided.baris[0].diposting, false);

    const after = await getCurrentStock(client, bubur, ck);
    assert.equal(after, before, "opname ditolak -> stok tidak berubah");
  });
});

test("decideOpname: draft yang sudah diputuskan tidak bisa diputuskan ulang", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");
    const draft = await createOpname(client, {
      locationId: ck,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyFisik: 5 }],
    });
    await decideOpname(client, { opnameId: draft.headerId, decision: "setuju" });

    await assert.rejects(
      () => decideOpname(client, { opnameId: draft.headerId, decision: "setuju" }),
      /sudah diputuskan/i,
    );
  });
});

test("listOpname: filter ?status=draft cuma menampilkan yang belum diputuskan, baris berisi item & selisih", async () => {
  await withRollback(async (client) => {
    const ck = await locationId(client, "samsara_ck");

    const draft1 = await createOpname(client, {
      locationId: ck,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyFisik: (await getCurrentStock(client, await itemId(client, "BB-001"), ck)) + 3 }],
    });
    const draft2 = await createOpname(client, {
      locationId: ck,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-002", qtyFisik: (await getCurrentStock(client, await itemId(client, "BB-002"), ck)) - 1 }],
    });
    // Sudah diputuskan -- tidak boleh ikut muncul di status=draft.
    const decided = await createOpname(client, {
      locationId: ck,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-003", qtyFisik: 0 }],
    });
    await decideOpname(client, { opnameId: decided.headerId, decision: "tolak" });

    const drafts = await listOpname(client, { status: "draft" });
    const draftIds = drafts.map((d) => d.headerId);
    assert.ok(draftIds.includes(draft1.headerId));
    assert.ok(draftIds.includes(draft2.headerId));
    assert.ok(!draftIds.includes(decided.headerId), "yang sudah diputuskan tidak boleh muncul di status=draft");

    const found1 = drafts.find((d) => d.headerId === draft1.headerId)!;
    assert.equal(found1.status, "draft");
    assert.equal(found1.locationId, ck);
    assert.equal(found1.baris[0].itemKode, "BB-001");
    assert.equal(found1.baris[0].selisih, 3);

    const ditolak = await listOpname(client, { status: "ditolak" });
    assert.ok(ditolak.some((d) => d.headerId === decided.headerId));
    assert.ok(!ditolak.some((d) => d.headerId === draft1.headerId));

    const semua = await listOpname(client);
    assert.ok(semua.length >= 3, "tanpa filter status, semua status ikut muncul");
  });
});
