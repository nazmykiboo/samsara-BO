import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool, writeAuditLog, type AuthUser } from "@samsara/core";
import { createPenjualan } from "./stok.js";
import { DEFAULT_LIMIT_DETAIL_PENJUALAN, getDetailTransaksiPenjualan } from "./laporan.js";
import { locationId, outletLocationId, withRollback } from "./test-helpers.js";

after(() => pool.end());

function fakeUser(role: AuthUser["role"], locationIds: number[] = []): AuthUser {
  return {
    id: 1,
    username: "test",
    role,
    allLocations: role === "owner" || role === "manajer_ops",
    locationIds,
    // Tidak relevan di domain layer (cuma dibandingkan oleh middleware
    // requireAuth saat request HTTP masuk) -- 0 = baseline user baru.
    tokenVersion: 0,
    wajibGantiKredensial: false,
  };
}

/**
 * `createPenjualan` mendeklarasikan `headerId: number` TAPI driver pg
 * mengembalikan kolom BIGINT sebagai STRING JS (jebakan yang sama dicatat di
 * docs/architecture-decisions.md § 16.7 dan di komentar getLaporanHarian) --
 * sedangkan `getDetailTransaksiPenjualan` sengaja sudah mengonversi ke
 * Number. Dinormalkan di sini supaya perbandingan `===` antara id hasil
 * insert dan id hasil query tidak diam-diam selalu false; perilaku
 * `createPenjualan` sendiri TIDAK disentuh (bukan scope tugas ini).
 */
async function buatPenjualan(
  client: PoolClient,
  input: Parameters<typeof createPenjualan>[1],
): Promise<number> {
  const { headerId } = await createPenjualan(client, input);
  return Number(headerId);
}

/**
 * `locationId()` di test-helpers mengembalikan id BIGINT apa adanya dari
 * driver pg, jadi STRING -- sedangkan di produksi `AuthUser.locationIds`
 * sudah berupa number (core/src/auth/users.ts mengonversinya) dan router
 * mengirim `Number(req.query.lokasi)`. Dinormalkan supaya test memakai tipe
 * yang sama dengan jalur produksi.
 */
async function lokasi(client: PoolClient, entitas: string): Promise<number> {
  return Number(await locationId(client, entitas));
}

/**
 * Tanggal relatif terhadap CURRENT_DATE DATABASE (bukan jam proses Node) --
 * `getDetailTransaksiPenjualan` menghitung default rentangnya dari
 * CURRENT_DATE juga, jadi keduanya harus pakai acuan "hari ini" yang sama.
 */
async function tanggalRelatif(client: PoolClient, offsetHari: number): Promise<string> {
  const { rows } = await client.query<{ t: string }>(
    `SELECT to_char(CURRENT_DATE + $1::int, 'YYYY-MM-DD') AS t`,
    [offsetHari],
  );
  return rows[0].t;
}

/**
 * Banyak test di bawah memakai nilai `sumber` khusus milik test itu sendiri
 * sebagai penyaring. Kolom `sumber` memang TEXT bebas tanpa FK ke
 * `inventory_sales_channel` (lihat migrasi 0011), jadi ini sah -- dan perlu,
 * supaya hasil test tidak tercampur transaksi penjualan sungguhan yang
 * mungkin sudah ada di database dev (termasuk supaya barisnya tidak
 * terpotong LIMIT default).
 */
function channelTest(nama: string): string {
  return `UJI-${nama}`;
}

test("getDetailTransaksiPenjualan: satu objek per BARIS menu, bukan per header", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const tanggal = await tanggalRelatif(client, 0);
    const sumber = channelTest("PER-BARIS");

    const headerId = await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      noReferensi: "ORD-PER-BARIS",
      tanggal,
      baris: [
        { menuKode: "M-001", qty: 2 },
        { menuKode: "M-002", qty: 3 },
      ],
    });

    const { rows } = await getDetailTransaksiPenjualan(client, fakeUser("owner"), { channel: sumber });

    assert.equal(rows.length, 2, "satu transaksi dengan 2 baris menu harus jadi 2 objek di response");
    assert.ok(
      rows.every((r) => r.headerId === headerId),
      "kedua baris harus menunjuk headerId transaksi yang sama",
    );

    const m001 = rows.find((r) => r.menuKode === "M-001");
    const m002 = rows.find((r) => r.menuKode === "M-002");
    assert.ok(m001, "menu M-001 harus muncul sebagai baris sendiri");
    assert.ok(m002, "menu M-002 harus muncul sebagai baris sendiri");
    assert.equal(m001.qty, 2);
    assert.equal(m002.qty, 3);

    // Info header ikut di setiap baris (biar bisa ditampilkan tabel datar).
    assert.equal(m001.tanggal, tanggal);
    assert.equal(m001.lokasiId, outlet);
    assert.ok(m001.lokasiNama.length > 0, "lokasiNama harus terisi dari JOIN ke core_locations");
    assert.equal(m001.sumber, sumber);
    assert.equal(m001.noReferensi, "ORD-PER-BARIS");
    assert.equal(m001.menuNama, "Bubur Polos");
    assert.equal(m001.sumberPencatatan, "manual");
  });
});

test("getDetailTransaksiPenjualan: ikut membawa snapshot HPP (hppSaatTransaksi/hppSumber, migrasi 0028) per baris", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const tanggal = await tanggalRelatif(client, 0);
    const sumber = channelTest("SNAPSHOT-HPP");

    const headerId = await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      tanggal,
      baris: [{ menuKode: "M-001", qty: 2 }],
    });

    // Angka pembanding diambil LANGSUNG dari tabel (bukan dihardcode) --
    // tujuan test ini adalah memastikan getDetailTransaksiPenjualan MEMBAWA
    // nilai yang sudah disimpan createPenjualan, bukan menghitung ulang.
    const { rows: mentah } = await client.query<{
      hpp_saat_transaksi: string | null;
      hpp_sumber: "snapshot_asli" | "snapshot_estimasi" | null;
    }>(`SELECT hpp_saat_transaksi, hpp_sumber FROM inventory_transaksi_penjualan_baris WHERE header_id = $1`, [
      headerId,
    ]);
    assert.equal(mentah[0].hpp_sumber, "snapshot_asli");

    const { rows } = await getDetailTransaksiPenjualan(client, fakeUser("owner"), { channel: sumber });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hppSumber, "snapshot_asli");
    assert.equal(
      rows[0].hppSaatTransaksi,
      mentah[0].hpp_saat_transaksi === null ? null : Number(mentah[0].hpp_saat_transaksi),
    );
  });
});

test("getDetailTransaksiPenjualan: filter rentang tanggal (BETWEEN, batas ikut terhitung)", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const sumber = channelTest("RENTANG");

    const sebelum = await tanggalRelatif(client, -11);
    const batasAwal = await tanggalRelatif(client, -10);
    const tengah = await tanggalRelatif(client, -5);
    const batasAkhir = await tanggalRelatif(client, -1);
    const sesudah = await tanggalRelatif(client, 0);

    const ids: Record<string, number> = {};
    for (const tanggal of [sebelum, batasAwal, tengah, batasAkhir, sesudah]) {
      ids[tanggal] = await buatPenjualan(client, {
        locationId: outlet,
        sumber,
        tanggal,
        baris: [{ menuKode: "M-001", qty: 1 }],
      });
    }

    const { rows } = await getDetailTransaksiPenjualan(client, fakeUser("owner"), {
      channel: sumber,
      tanggalMulai: batasAwal,
      tanggalSelesai: batasAkhir,
    });
    const ditemukan = rows.map((r) => r.headerId);

    assert.ok(ditemukan.includes(ids[batasAwal]), "tanggal_mulai termasuk (BETWEEN inklusif)");
    assert.ok(ditemukan.includes(ids[tengah]), "tanggal di tengah rentang termasuk");
    assert.ok(ditemukan.includes(ids[batasAkhir]), "tanggal_selesai termasuk (BETWEEN inklusif)");
    assert.ok(!ditemukan.includes(ids[sebelum]), "tanggal sebelum rentang tidak boleh ikut");
    assert.ok(!ditemukan.includes(ids[sesudah]), "tanggal setelah rentang tidak boleh ikut");

    // Terbaru dulu (ORDER BY tanggal DESC).
    assert.deepEqual(
      rows.map((r) => r.tanggal),
      [batasAkhir, tengah, batasAwal],
    );
  });
});

test("getDetailTransaksiPenjualan: tanpa param tanggal -> default 30 hari terakhir", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const sumber = channelTest("DEFAULT-30-HARI");

    const hariIni = await tanggalRelatif(client, 0);
    const batas30 = await tanggalRelatif(client, -30);
    const lewatBatas = await tanggalRelatif(client, -31);
    const jauhLewat = await tanggalRelatif(client, -40);

    const ids: Record<string, number> = {};
    for (const tanggal of [hariIni, batas30, lewatBatas, jauhLewat]) {
      ids[tanggal] = await buatPenjualan(client, {
        locationId: outlet,
        sumber,
        tanggal,
        baris: [{ menuKode: "M-001", qty: 1 }],
      });
    }

    const { rows } = await getDetailTransaksiPenjualan(client, fakeUser("owner"), { channel: sumber });
    const ditemukan = rows.map((r) => r.headerId);

    assert.ok(ditemukan.includes(ids[hariIni]), "transaksi hari ini harus ikut di rentang default");
    assert.ok(ditemukan.includes(ids[batas30]), "tepat 30 hari lalu masih di dalam rentang default");
    assert.ok(!ditemukan.includes(ids[lewatBatas]), "31 hari lalu sudah di luar rentang default");
    assert.ok(!ditemukan.includes(ids[jauhLewat]), "40 hari lalu sudah di luar rentang default");
  });
});

test("getDetailTransaksiPenjualan: cuma tanggal_mulai diisi -> sisi selesai = hari ini", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const sumber = channelTest("MULAI-SAJA");

    const mulai = await tanggalRelatif(client, -60);
    const sebelumMulai = await tanggalRelatif(client, -61);
    const hariIni = await tanggalRelatif(client, 0);

    const ids: Record<string, number> = {};
    for (const tanggal of [sebelumMulai, mulai, hariIni]) {
      ids[tanggal] = await buatPenjualan(client, {
        locationId: outlet,
        sumber,
        tanggal,
        baris: [{ menuKode: "M-001", qty: 1 }],
      });
    }

    const { rows } = await getDetailTransaksiPenjualan(client, fakeUser("owner"), { channel: sumber, tanggalMulai: mulai });
    const ditemukan = rows.map((r) => r.headerId);

    assert.ok(ditemukan.includes(ids[mulai]), "tanggal_mulai yang diisi dipakai apa adanya (bukan diganti 30 hari)");
    assert.ok(ditemukan.includes(ids[hariIni]), "sisi selesai yang kosong dipakai hari ini");
    assert.ok(!ditemukan.includes(ids[sebelumMulai]), "sebelum tanggal_mulai tetap di luar rentang");
  });
});

test("getDetailTransaksiPenjualan: cuma tanggal_selesai diisi -> sisi mulai = 30 hari sebelumnya", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const sumber = channelTest("SELESAI-SAJA");

    const selesai = await tanggalRelatif(client, -10);
    const didalam = await tanggalRelatif(client, -40); // tepat 30 hari sebelum `selesai` = batas bawah
    const diluar = await tanggalRelatif(client, -41);
    const sesudahSelesai = await tanggalRelatif(client, -9);

    const ids: Record<string, number> = {};
    for (const tanggal of [diluar, didalam, selesai, sesudahSelesai]) {
      ids[tanggal] = await buatPenjualan(client, {
        locationId: outlet,
        sumber,
        tanggal,
        baris: [{ menuKode: "M-001", qty: 1 }],
      });
    }

    const { rows } = await getDetailTransaksiPenjualan(client, fakeUser("owner"), {
      channel: sumber,
      tanggalSelesai: selesai,
    });
    const ditemukan = rows.map((r) => r.headerId);

    assert.ok(ditemukan.includes(ids[selesai]), "tanggal_selesai yang diisi dipakai apa adanya");
    assert.ok(ditemukan.includes(ids[didalam]), "batas bawah = tanggal_selesai - 30 hari, inklusif");
    assert.ok(!ditemukan.includes(ids[diluar]), "lebih dari 30 hari sebelum tanggal_selesai tidak ikut");
    assert.ok(!ditemukan.includes(ids[sesudahSelesai]), "setelah tanggal_selesai tidak ikut walau masih < hari ini");
  });
});

test("getDetailTransaksiPenjualan: filter channel cocok PERSIS ke kolom sumber (case-sensitive)", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const tanggal = await tanggalRelatif(client, 0);

    // Nilai channel sungguhan dari inventory_sales_channel (migrasi 0011).
    const offlineId = await buatPenjualan(client, {
      locationId: outlet,
      sumber: "Offline",
      tanggal,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });
    const grabId = await buatPenjualan(client, {
      locationId: outlet,
      sumber: "GrabFood",
      tanggal,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });

    const user = fakeUser("owner");
    const { rows: hanyaOffline } = await getDetailTransaksiPenjualan(client, user, {
      channel: "Offline",
      tanggalMulai: tanggal,
      tanggalSelesai: tanggal,
    });
    const idsOffline = hanyaOffline.map((r) => r.headerId);
    assert.ok(idsOffline.includes(offlineId));
    assert.ok(!idsOffline.includes(grabId), "transaksi GrabFood tidak boleh ikut saat filter 'Offline'");
    assert.ok(
      hanyaOffline.every((r) => r.sumber === "Offline"),
      "semua baris hasil harus bersumber channel yang difilter",
    );

    const { rows: hanyaGrab } = await getDetailTransaksiPenjualan(client, user, {
      channel: "GrabFood",
      tanggalMulai: tanggal,
      tanggalSelesai: tanggal,
    });
    const idsGrab = hanyaGrab.map((r) => r.headerId);
    assert.ok(idsGrab.includes(grabId));
    assert.ok(!idsGrab.includes(offlineId));

    // Case-sensitive: 'offline' (huruf kecil) BUKAN 'Offline'.
    const { rows: salahCasing } = await getDetailTransaksiPenjualan(client, user, {
      channel: "offline",
      tanggalMulai: tanggal,
      tanggalSelesai: tanggal,
    });
    assert.ok(
      !salahCasing.map((r) => r.headerId).includes(offlineId),
      "filter channel tidak case-insensitive -- 'offline' tidak cocok ke 'Offline'",
    );
  });
});

test("getDetailTransaksiPenjualan: filter kode_menu memilih TRANSAKSI yang mengandung menu itu -- SELURUH baris transaksi itu ikut, header lain tidak bocor", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const tanggal = await tanggalRelatif(client, 0);
    const sumber = channelTest("KODE-MENU");

    const campurId = await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      tanggal,
      baris: [
        { menuKode: "M-001", qty: 1 },
        { menuKode: "M-002", qty: 4 },
      ],
    });
    const lainId = await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      tanggal,
      baris: [{ menuKode: "M-003", qty: 7 }],
    });

    const { rows } = await getDetailTransaksiPenjualan(client, fakeUser("owner"), { channel: sumber, kodeMenu: "M-002" });

    // Paginasi 2026-10-30 per TRANSAKSI (bukan baris menu, lihat laporan.ts) mengubah
    // perilaku ini SENGAJA: kodeMenu sekarang memilih TRANSAKSI mana yang ikut, lalu
    // SELURUH baris transaksi itu dikembalikan -- bukan cuma baris yang cocok. Ini lebih
    // benar untuk tampilan "satu kartu = satu order": menyembunyikan M-001 dari order yang
    // sama akan membuat order itu terlihat cuma berisi 1 menu padahal sebenarnya 2.
    assert.equal(rows.length, 2, "SELURUH baris transaksi campurId ikut (M-001 dan M-002), bukan cuma yang cocok filter");
    assert.ok(rows.every((r) => r.headerId === campurId));
    assert.deepEqual(
      rows.map((r) => r.menuKode).sort(),
      ["M-001", "M-002"],
      "M-001 ikut terbawa karena satu transaksi dengan M-002 yang jadi target filter",
    );
    assert.ok(!rows.map((r) => r.headerId).includes(lainId), "transaksi lain yang tidak punya M-002 tidak ikut sama sekali");
  });
});

test("getDetailTransaksiPenjualan: sumberPencatatan 'sinkronisasi' kalau ada jejak audit log created_via=sales-sync, 'manual' kalau tidak", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const tanggal = await tanggalRelatif(client, 0);
    const sumber = channelTest("SUMBER-PENCATATAN");

    const manualId = await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      tanggal,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });
    const sinkronId = await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      tanggal,
      baris: [
        { menuKode: "M-001", qty: 1 },
        { menuKode: "M-002", qty: 1 },
      ],
    });

    // Jejak yang ditulis modul sales-sync (lihat modules/sales-sync/src/domain/proses.ts).
    await writeAuditLog(client, {
      userId: null,
      tableName: "inventory_transaksi_penjualan",
      recordId: sinkronId,
      fieldName: "created_via",
      oldValue: null,
      newValue: "sales-sync",
    });

    // Jejak audit log LAIN di header manual tidak boleh ikut dihitung
    // sebagai sinkronisasi (field_name DAN new_value harus cocok dua-duanya).
    await writeAuditLog(client, {
      userId: null,
      tableName: "inventory_transaksi_penjualan",
      recordId: manualId,
      fieldName: "catatan",
      oldValue: null,
      newValue: "sales-sync",
    });

    const { rows } = await getDetailTransaksiPenjualan(client, fakeUser("owner"), { channel: sumber });

    const barisManual = rows.filter((r) => r.headerId === manualId);
    const barisSinkron = rows.filter((r) => r.headerId === sinkronId);

    assert.equal(barisManual.length, 1);
    assert.equal(barisManual[0].sumberPencatatan, "manual");

    assert.equal(barisSinkron.length, 2);
    assert.ok(
      barisSinkron.every((r) => r.sumberPencatatan === "sinkronisasi"),
      "SEMUA baris dari header yang punya jejak sales-sync ditandai 'sinkronisasi'",
    );
  });
});

test("getDetailTransaksiPenjualan: kolom jam ikut dibawa (terisi atau null)", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const tanggal = await tanggalRelatif(client, 0);
    const sumber = channelTest("JAM");

    const idDenganJam = await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      tanggal,
      jam: "14:30",
      baris: [{ menuKode: "M-001", qty: 1 }],
    });
    const idTanpaJam = await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      tanggal,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });

    const { rows } = await getDetailTransaksiPenjualan(client, fakeUser("owner"), { channel: sumber });
    const barisDenganJam = rows.find((r) => r.headerId === idDenganJam);
    const barisTanpaJam = rows.find((r) => r.headerId === idTanpaJam);

    assert.ok(barisDenganJam?.jam?.startsWith("14:30"), "jam yang diisi harus ikut terbawa (format HH:MM:SS)");
    assert.equal(barisTanpaJam?.jam, null, "jam yang tidak diisi harus null, bukan dikira-kira dari created_at");
  });
});

test("getDetailTransaksiPenjualan: role non-allLocations dipaksa ke lokasi sendiri walau lokasiId tidak dikirim", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const ck = await lokasi(client, "samsara_ck");
    const tanggal = await tanggalRelatif(client, 0);
    const sumber = channelTest("LOKASI-SCOPE");

    const diOutlet = await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      tanggal,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });
    const diCk = await buatPenjualan(client, {
      locationId: ck,
      sumber,
      tanggal,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });

    // owner: semua lokasi kelihatan.
    const semua = (await getDetailTransaksiPenjualan(client, fakeUser("owner"), { channel: sumber })).rows.map(
      (r) => r.headerId,
    );
    assert.ok(semua.includes(diOutlet), "owner harus lihat transaksi outlet");
    assert.ok(semua.includes(diCk), "owner harus lihat transaksi CK");

    // supervisor lokasi outlet, TANPA mengirim lokasiId -> tetap cuma outlet.
    const supervisor = fakeUser("supervisor", [outlet]);
    const idsSupervisor = (await getDetailTransaksiPenjualan(client, supervisor, { channel: sumber })).rows.map(
      (r) => r.headerId,
    );
    assert.ok(idsSupervisor.includes(diOutlet));
    assert.ok(!idsSupervisor.includes(diCk), "transaksi lokasi lain tidak boleh bocor ke role lokasi-scoped");

    // lokasiId lokasi orang lain DIABAIKAN (bukan ditolak), hasil tetap lokasi sendiri.
    const idsDipaksa = (await getDetailTransaksiPenjualan(client, supervisor, { channel: sumber, lokasiId: ck })).rows.map(
      (r) => r.headerId,
    );
    assert.ok(!idsDipaksa.includes(diCk));
    assert.ok(idsDipaksa.includes(diOutlet));

    // Role lokasi-scoped tanpa lokasi yang ditugaskan: tidak lihat apa pun.
    const { rows: tanpaLokasi } = await getDetailTransaksiPenjualan(client, fakeUser("supervisor", []), { channel: sumber });
    assert.equal(tanpaLokasi.length, 0);
  });
});

test("getDetailTransaksiPenjualan: owner boleh mempersempit ke satu lokasi lewat lokasiId", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const ck = await lokasi(client, "samsara_ck");
    const tanggal = await tanggalRelatif(client, 0);
    const sumber = channelTest("LOKASI-OWNER");

    const diOutlet = await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      tanggal,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });
    const diCk = await buatPenjualan(client, {
      locationId: ck,
      sumber,
      tanggal,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });

    const ids = (await getDetailTransaksiPenjualan(client, fakeUser("owner"), { channel: sumber, lokasiId: ck })).rows.map(
      (r) => r.headerId,
    );
    assert.ok(ids.includes(diCk));
    assert.ok(!ids.includes(diOutlet));
  });
});

test("getDetailTransaksiPenjualan: LIMIT membatasi jumlah TRANSAKSI (header), bukan baris menu -- satu transaksi tidak pernah terpotong di tengah", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const tanggal = await tanggalRelatif(client, 0);
    const sumber = channelTest("LIMIT");

    // SATU transaksi dengan 3 baris menu: limit: 2 (artinya "2 transaksi")
    // TIDAK BOLEH memotongnya jadi 2 baris -- ini justru kasus yang mau
    // dicegah oleh paginasi per-header (lihat komentar di laporan.ts).
    await buatPenjualan(client, {
      locationId: outlet,
      sumber,
      tanggal,
      baris: [
        { menuKode: "M-001", qty: 1 },
        { menuKode: "M-002", qty: 1 },
        { menuKode: "M-003", qty: 1 },
      ],
    });

    const satuTransaksi = await getDetailTransaksiPenjualan(client, fakeUser("owner"), {
      channel: sumber,
      limit: 2,
    });
    assert.equal(satuTransaksi.rows.length, 3, "1 transaksi dengan 3 baris menu harus utuh 3 baris, bukan terpotong ke 2");
    assert.equal(satuTransaksi.totalTransaksi, 1, "totalTransaksi menghitung TRANSAKSI, bukan baris menu");

    // Tambah transaksi ke-2 & ke-3 -- sekarang limit: 2 beneran membatasi ke
    // 2 TRANSAKSI (bukan 2 baris).
    await buatPenjualan(client, { locationId: outlet, sumber, tanggal, baris: [{ menuKode: "M-001", qty: 1 }] });
    await buatPenjualan(client, { locationId: outlet, sumber, tanggal, baris: [{ menuKode: "M-001", qty: 1 }] });

    const dibatasi = await getDetailTransaksiPenjualan(client, fakeUser("owner"), { channel: sumber, limit: 2 });
    const headerIdsDibatasi = new Set(dibatasi.rows.map((r) => r.headerId));
    assert.equal(headerIdsDibatasi.size, 2, "limit: 2 harus membatasi ke 2 transaksi, apa pun jumlah barisnya");
    assert.equal(dibatasi.totalTransaksi, 3, "totalTransaksi tetap 3 (jumlah SEBENARNYA), tidak ikut terpotong limit");

    // limit di atas batas default tetap di-clamp ke default (tidak bisa
    // dipakai untuk menarik tabel penuh).
    const dipaksaBesar = await getDetailTransaksiPenjualan(client, fakeUser("owner"), {
      channel: sumber,
      limit: 100_000,
    });
    const headerIdsBesar = new Set(dipaksaBesar.rows.map((r) => r.headerId));
    assert.ok(headerIdsBesar.size <= DEFAULT_LIMIT_DETAIL_PENJUALAN);
  });
});

test("getDetailTransaksiPenjualan: offset melompati N transaksi pertama, totalTransaksi tetap utuh", async () => {
  await withRollback(async (client) => {
    const outlet = await outletLocationId(client);
    const tanggal = await tanggalRelatif(client, 0);
    const sumber = channelTest("OFFSET");

    const idAwal: number[] = [];
    for (let i = 0; i < 3; i++) {
      idAwal.push(
        await buatPenjualan(client, { locationId: outlet, sumber, tanggal, baris: [{ menuKode: "M-001", qty: 1 }] }),
      );
    }

    const halamanPertama = await getDetailTransaksiPenjualan(client, fakeUser("owner"), {
      channel: sumber,
      limit: 1,
      offset: 0,
    });
    const halamanKedua = await getDetailTransaksiPenjualan(client, fakeUser("owner"), {
      channel: sumber,
      limit: 1,
      offset: 1,
    });

    assert.equal(halamanPertama.rows.length, 1);
    assert.equal(halamanKedua.rows.length, 1);
    assert.notEqual(
      halamanPertama.rows[0].headerId,
      halamanKedua.rows[0].headerId,
      "offset harus menggeser ke transaksi berikutnya, bukan mengulang yang sama",
    );
    assert.equal(halamanPertama.totalTransaksi, 3);
    assert.equal(halamanKedua.totalTransaksi, 3, "totalTransaksi konsisten di semua halaman, tidak ikut berkurang karena offset");
  });
});
