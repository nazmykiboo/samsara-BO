import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import { createMutasiLain, createOpname, decideOpname, createPenjualan } from "./stok.js";
import { getAnalitikOperasional, getAnalitikPenjualan } from "./laporan.js";
import { withRollback } from "./test-helpers.js";

after(() => pool.end());

/**
 * Semua test di bawah memakai LOKASI QA bikinan sendiri (nama ber-prefix
 * "QA-ANALITIK") lalu memanggil fungsi analitik dengan `lokasiId` lokasi itu.
 * Tujuannya isolasi: hasil agregat tidak boleh tercampur transaksi sungguhan
 * yang sudah/akan ada di database dev, supaya angka yang di-assert pasti cuma
 * datang dari data sintetis test ini. Aman karena `withRollback` selalu
 * me-ROLLBACK (termasuk baris core_locations-nya).
 */
async function lokasiQa(client: PoolClient, nama: string, entitas = "samsara_outlet"): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core_locations (name, entitas) VALUES ($1, $2) RETURNING id`,
    [`QA-ANALITIK ${nama}`, entitas],
  );
  // Number(...) WAJIB: driver pg mengembalikan BIGINT sebagai string JS, dan
  // fungsi analitik membandingkan lokasiId hasil query dengan `===`.
  return Number(rows[0].id);
}

/**
 * Senin minggu yang memuat CURRENT_DATE database. Acuan "hari ini" harus
 * DATABASE (bukan jam proses Node) karena itu yang dipakai fungsi analitik
 * saat `periode` tidak diisi -- lihat resolvePeriode di laporan.ts.
 */
async function seninMingguIni(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ t: string }>(
    `SELECT to_char(date_trunc('week', CURRENT_DATE)::date, 'YYYY-MM-DD') AS t`,
  );
  return rows[0].t;
}

/** Geser tanggal kalender "YYYY-MM-DD" di sisi test (Date.UTC murni, tanpa timezone). */
function geser(tanggal: string, hari: number): string {
  const [y, m, d] = tanggal.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + hari);
  return utc.toISOString().slice(0, 10);
}

/** Ambang batas yang sedang AKTIF di database -- test ikut data, bukan menebak angkanya. */
async function ambang(client: PoolClient, kode: string): Promise<number> {
  const { rows } = await client.query<{ ambang_batas: string }>(
    `SELECT ambang_batas FROM inventory_insight_rules WHERE kode = $1 AND aktif = true`,
    [kode],
  );
  assert.ok(rows[0], `Rule "${kode}" harus ada & aktif di inventory_insight_rules (migrasi 0025)`);
  return Number(rows[0].ambang_batas);
}

// ===========================================================================
// getAnalitikPenjualan
// ===========================================================================

test("getAnalitikPenjualan: qty per menu dipisah minggu ini vs minggu lalu, persenPerubahan null kalau minggu lalu 0", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "PENJUALAN-DASAR");
    const senin = await seninMingguIni(client);

    // M-001: 10 porsi minggu lalu -> 5 porsi minggu ini (turun 50%).
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: geser(senin, -5),
      baris: [{ menuKode: "M-001", qty: 10 }],
    });
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: geser(senin, 2),
      baris: [{ menuKode: "M-001", qty: 5 }],
    });
    // M-002: cuma minggu ini (minggu lalu 0) -> persenPerubahan harus null.
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: senin,
      baris: [{ menuKode: "M-002", qty: 3 }],
    });

    const hasil = await getAnalitikPenjualan(client, { lokasiId: lokasi });

    assert.equal(hasil.mingguIni.mulai, senin, "mingguIni.mulai = Senin minggu yang memuat hari ini");
    assert.equal(hasil.mingguIni.selesai, geser(senin, 6));
    assert.equal(hasil.mingguLalu.mulai, geser(senin, -7));
    assert.equal(hasil.mingguLalu.selesai, geser(senin, -1));

    assert.equal(hasil.totalQtyMingguIni, 8, "5 (M-001) + 3 (M-002)");
    assert.equal(hasil.totalQtyMingguLalu, 10, "cuma M-001 yang terjual minggu lalu");

    const m001 = hasil.topProduk.find((p) => p.kodeMenu === "M-001");
    assert.ok(m001);
    assert.equal(m001.qtyMingguIni, 5);
    assert.equal(m001.qtyMingguLalu, 10, "menu yang terjual di dua minggu muncul sebagai SATU baris, bukan dua");
    assert.equal(m001.persenPerubahan, -50);

    const m002 = hasil.topProduk.find((p) => p.kodeMenu === "M-002");
    assert.ok(m002);
    assert.equal(m002.qtyMingguLalu, 0, "minggu tanpa data jadi 0, bukan baris hilang");
    assert.equal(m002.persenPerubahan, null, "persentase dari nol tidak terdefinisi -> null, bukan Infinity");

    // topProduk urut DESC by qty minggu ini.
    assert.deepEqual(
      hasil.topProduk.map((p) => p.kodeMenu),
      ["M-001", "M-002"],
    );
    // bottomProduk urut ASC, dan tetap cuma memuat menu yang ada penjualannya.
    assert.deepEqual(
      hasil.bottomProduk.map((p) => p.kodeMenu),
      ["M-002", "M-001"],
    );
    assert.ok(
      hasil.bottomProduk.every((p) => p.qtyMingguIni > 0 || p.qtyMingguLalu > 0),
      "menu yang 0 porsi di KEDUA minggu tidak boleh masuk daftar mana pun",
    );
  });
});

test("getAnalitikPenjualan: insight turun & naik signifikan muncul sesuai ambang inventory_insight_rules", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "PENJUALAN-INSIGHT");
    const senin = await seninMingguIni(client);
    const ambangTurun = await ambang(client, "turun_signifikan_persen");
    const ambangNaik = await ambang(client, "naik_signifikan_persen");
    assert.equal(ambangTurun, 20, "test ini ditulis untuk ambang default 20% (migrasi 0025)");
    assert.equal(ambangNaik, 20);

    const mingguLalu = geser(senin, -4);
    const mingguIni = geser(senin, 1);

    // M-001 turun 60% (100 -> 40): jauh melewati ambang turun.
    // M-002 naik 50% (20 -> 30): melewati ambang naik.
    // M-003 turun 10% (100 -> 90): DI BAWAH ambang, tidak boleh jadi insight.
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: mingguLalu,
      baris: [
        { menuKode: "M-001", qty: 100 },
        { menuKode: "M-002", qty: 20 },
        { menuKode: "M-003", qty: 100 },
      ],
    });
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: mingguIni,
      baris: [
        { menuKode: "M-001", qty: 40 },
        { menuKode: "M-002", qty: 30 },
        { menuKode: "M-003", qty: 90 },
      ],
    });

    const hasil = await getAnalitikPenjualan(client, { lokasiId: lokasi });

    const turun = hasil.insight.filter((t) => t.includes("turun"));
    const naik = hasil.insight.filter((t) => t.includes("naik"));

    assert.equal(turun.length, 1, "cuma M-001 yang turun melewati ambang");
    assert.equal(turun[0], "Bubur Polos turun 60% dibanding minggu lalu (100 -> 40 porsi).");

    assert.equal(naik.length, 1, "cuma M-002 yang naik melewati ambang");
    assert.equal(naik[0], "Bubur Original naik 50% dibanding minggu lalu (20 -> 30 porsi).");

    assert.ok(
      !hasil.insight.some((t) => t.includes("Bubur Original Jumbo")),
      "M-003 turun 10% (di bawah ambang 20%) tidak boleh memunculkan insight",
    );

    // Urutan: insight turun selalu sebelum insight naik.
    assert.ok(
      hasil.insight.indexOf(turun[0]) < hasil.insight.indexOf(naik[0]),
      "insight turun (perlu ditindak) harus muncul lebih dulu daripada insight naik",
    );
  });
});

test("getAnalitikPenjualan: insight masuk/keluar 5 besar menu terlaris", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "PENJUALAN-TOP5");
    const senin = await seninMingguIni(client);

    // Minggu lalu: 5 besar = M-001..M-005. Minggu ini: M-005 tidak terjual,
    // M-006 masuk menggantikannya (qty di antara M-004 dan M-003).
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: geser(senin, -3),
      baris: [
        { menuKode: "M-001", qty: 50 },
        { menuKode: "M-002", qty: 40 },
        { menuKode: "M-003", qty: 30 },
        { menuKode: "M-004", qty: 20 },
        { menuKode: "M-005", qty: 10 },
      ],
    });
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: geser(senin, 3),
      baris: [
        { menuKode: "M-001", qty: 50 },
        { menuKode: "M-002", qty: 40 },
        { menuKode: "M-003", qty: 30 },
        { menuKode: "M-004", qty: 20 },
        { menuKode: "M-006", qty: 25 },
      ],
    });

    const hasil = await getAnalitikPenjualan(client, { lokasiId: lokasi });

    assert.ok(
      hasil.insight.includes("Burjo Panas masuk ke 5 besar menu terlaris minggu ini."),
      `harus ada insight "masuk ke 5 besar" untuk M-006, dapat: ${JSON.stringify(hasil.insight)}`,
    );
    assert.ok(
      hasil.insight.some((t) => t === "Bubur Oriental Jumbo keluar dari 5 besar menu terlaris."),
      `harus ada insight "keluar dari 5 besar" untuk M-005, dapat: ${JSON.stringify(hasil.insight)}`,
    );
    // M-001..M-004 tetap di papan 5 besar di kedua minggu -> tidak boleh
    // memunculkan insight masuk/keluar sama sekali.
    assert.ok(
      !hasil.insight.some((t) => t.startsWith("Bubur Polos masuk") || t.startsWith("Bubur Polos keluar")),
      "menu yang tetap di 5 besar tidak boleh dilaporkan masuk/keluar",
    );
  });
});

test("getAnalitikPenjualan: data stabil -> insight ARRAY KOSONG (tidak false-positive)", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "PENJUALAN-STABIL");
    const senin = await seninMingguIni(client);

    // Qty IDENTIK di kedua minggu untuk menu yang sama: persenPerubahan 0
    // (tidak melewati ambang turun/naik) dan komposisi 5 besar tidak berubah.
    for (const tanggal of [geser(senin, -4), geser(senin, 2)]) {
      await createPenjualan(client, {
        locationId: lokasi,
        sumber: "Offline",
        tanggal,
        baris: [
          { menuKode: "M-001", qty: 30 },
          { menuKode: "M-002", qty: 12 },
        ],
      });
    }

    const hasil = await getAnalitikPenjualan(client, { lokasiId: lokasi });

    assert.equal(hasil.totalQtyMingguIni, 42);
    assert.equal(hasil.totalQtyMingguLalu, 42);
    assert.equal(hasil.topProduk.length, 2, "angkanya tetap dilaporkan walau tidak ada insight");
    assert.deepEqual(
      hasil.topProduk.map((p) => p.persenPerubahan),
      [0, 0],
    );
    assert.deepEqual(hasil.insight, [], "data stabil tidak boleh menghasilkan insight apa pun");
  });
});

test("getAnalitikPenjualan: filter lokasi memisahkan agregat antar lokasi", async () => {
  await withRollback(async (client) => {
    const lokasiA = await lokasiQa(client, "PENJUALAN-LOKASI-A");
    const lokasiB = await lokasiQa(client, "PENJUALAN-LOKASI-B");
    const senin = await seninMingguIni(client);

    await createPenjualan(client, {
      locationId: lokasiA,
      sumber: "Offline",
      tanggal: senin,
      baris: [{ menuKode: "M-001", qty: 7 }],
    });
    await createPenjualan(client, {
      locationId: lokasiB,
      sumber: "Offline",
      tanggal: senin,
      baris: [{ menuKode: "M-001", qty: 100 }],
    });

    const hanyaA = await getAnalitikPenjualan(client, { lokasiId: lokasiA });
    assert.equal(hanyaA.totalQtyMingguIni, 7, "penjualan lokasi lain tidak boleh ikut terhitung");

    const hanyaB = await getAnalitikPenjualan(client, { lokasiId: lokasiB });
    assert.equal(hanyaB.totalQtyMingguIni, 100);
  });
});

test("getAnalitikPenjualan: heatmapJam mengelompokkan qty per jam + offline/online, SELALU 24 entri", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "PENJUALAN-HEATMAP");
    const senin = await seninMingguIni(client);

    // Jam 12: ramai offline (40 porsi) + sedikit online dari DUA channel
    // delivery berbeda (3 + 2 = 5) -- buktikan GrabFood & ShopeeFood
    // dijumlahkan ke kelompok "online" yang sama, bukan dipisah per channel.
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: geser(senin, 1),
      jam: "12:00",
      baris: [{ menuKode: "M-001", qty: 40 }],
    });
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "GrabFood",
      tanggal: geser(senin, 1),
      // Menit/detik tidak boleh mempengaruhi pengelompokan -- yang dipakai
      // cuma EXTRACT(HOUR), jadi 12:45:30 tetap masuk jam 12.
      jam: "12:45:30",
      baris: [{ menuKode: "M-002", qty: 3 }],
    });
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "ShopeeFood",
      tanggal: geser(senin, 2),
      jam: "12:05",
      baris: [{ menuKode: "M-002", qty: 2 }],
    });
    // Jam 19: cuma online, qty kecil.
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "GoFood",
      tanggal: geser(senin, 2),
      jam: "19:30",
      baris: [{ menuKode: "M-001", qty: 4 }],
    });
    // DUA transaksi TANPA jam (jam NULL, seperti data pra-migrasi 0026 atau
    // input manual yang jamnya tidak diisi kasir).
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: geser(senin, 3),
      jam: undefined,
      baris: [{ menuKode: "M-001", qty: 100 }],
    });
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "GrabFood",
      tanggal: geser(senin, 3),
      baris: [{ menuKode: "M-002", qty: 7 }],
    });

    const hasil = await getAnalitikPenjualan(client, { lokasiId: lokasi });

    assert.equal(hasil.heatmapJam.data.length, 24, "data heatmap SELALU 24 entri walau cuma 2 jam yang ada isinya");
    assert.deepEqual(
      hasil.heatmapJam.data.map((d) => d.jam),
      Array.from({ length: 24 }, (_, i) => i),
      "jam 0..23 BERURUTAN",
    );

    const jam12 = hasil.heatmapJam.data[12];
    assert.equal(jam12.offline, 40, "qty offline jam 12");
    assert.equal(jam12.online, 5, "GrabFood 3 + ShopeeFood 2 digabung ke kelompok online");

    const jam19 = hasil.heatmapJam.data[19];
    assert.equal(jam19.offline, 0, "jam 19 tidak ada penjualan offline -> 0, bukan entri hilang");
    assert.equal(jam19.online, 4);

    // Semua jam lain nol -- termasuk membuktikan qty transaksi TANPA jam (100 +
    // 7 porsi) tidak "nyasar" ke jam mana pun (mis. jam 0).
    for (const d of hasil.heatmapJam.data) {
      if (d.jam === 12 || d.jam === 19) continue;
      assert.equal(d.offline, 0, `jam ${d.jam} harus 0 offline`);
      assert.equal(d.online, 0, `jam ${d.jam} harus 0 online`);
    }

    // Transparansi cakupan: 6 header minggu ini, 4 di antaranya ber-jam.
    assert.equal(hasil.heatmapJam.totalTransaksiMingguIni, 6, "COUNT HEADER (bukan baris menu), termasuk yang jam NULL");
    assert.equal(hasil.heatmapJam.transaksiDenganJam, 4, "cuma header dengan jam IS NOT NULL");

    // Transaksi tanpa jam TETAP terhitung di angka penjualan biasa -- heatmap
    // yang mengabaikannya, bukan laporan qty-nya.
    assert.equal(hasil.totalQtyMingguIni, 40 + 3 + 2 + 4 + 100 + 7);
  });
});

test("getAnalitikPenjualan: heatmapJam scope MINGGU INI saja & nol semua itu kondisi valid (bukan error)", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "PENJUALAN-HEATMAP-SCOPE");
    const senin = await seninMingguIni(client);

    // Satu-satunya transaksi ber-jam ada di MINGGU LALU, qty besar di jam 8.
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: geser(senin, -3),
      jam: "08:00",
      baris: [{ menuKode: "M-001", qty: 500 }],
    });

    const hasil = await getAnalitikPenjualan(client, { lokasiId: lokasi });

    assert.equal(hasil.totalQtyMingguLalu, 500, "prasyarat: transaksinya memang ada, cuma di minggu lalu");
    assert.equal(hasil.heatmapJam.data.length, 24, "24 entri tetap dikirim walau tidak ada data sama sekali");
    assert.deepEqual(
      hasil.heatmapJam.data.filter((d) => d.offline !== 0 || d.online !== 0),
      [],
      "transaksi minggu lalu TIDAK boleh ikut heatmap (scope minggu ini saja)",
    );
    assert.equal(hasil.heatmapJam.totalTransaksiMingguIni, 0, "hitungan header juga discope ke minggu ini");
    assert.equal(hasil.heatmapJam.transaksiDenganJam, 0);
  });
});

test("getAnalitikPenjualan: heatmapJam ikut difilter ?lokasi=", async () => {
  await withRollback(async (client) => {
    const lokasiA = await lokasiQa(client, "HEATMAP-LOKASI-A");
    const lokasiB = await lokasiQa(client, "HEATMAP-LOKASI-B");
    const senin = await seninMingguIni(client);

    await createPenjualan(client, {
      locationId: lokasiA,
      sumber: "Offline",
      tanggal: senin,
      jam: "10:00",
      baris: [{ menuKode: "M-001", qty: 6 }],
    });
    await createPenjualan(client, {
      locationId: lokasiB,
      sumber: "Offline",
      tanggal: senin,
      jam: "10:00",
      baris: [{ menuKode: "M-001", qty: 90 }],
    });

    const hanyaA = await getAnalitikPenjualan(client, { lokasiId: lokasiA });
    assert.equal(hanyaA.heatmapJam.data[10].offline, 6, "penjualan lokasi lain tidak boleh ikut ke heatmap");
    assert.equal(hanyaA.heatmapJam.totalTransaksiMingguIni, 1);
    assert.equal(hanyaA.heatmapJam.transaksiDenganJam, 1);

    const hanyaB = await getAnalitikPenjualan(client, { lokasiId: lokasiB });
    assert.equal(hanyaB.heatmapJam.data[10].offline, 90);
  });
});

// ===========================================================================
// getAnalitikOperasional
// ===========================================================================

/** Harga master item yang dipakai test waste -- nilai rupiah yang diharapkan dihitung dari sini, bukan angka hardcode. */
async function hargaMaster(client: PoolClient, kode: string): Promise<number> {
  const { rows } = await client.query<{ harga_master: string | null }>(
    `SELECT harga_master FROM inventory_items WHERE kode = $1`,
    [kode],
  );
  assert.ok(rows[0], `Item "${kode}" harus ada`);
  assert.ok(rows[0].harga_master !== null, `Item "${kode}" harus punya harga_master untuk test ini`);
  return Number(rows[0].harga_master);
}

test("getAnalitikOperasional: wasteTren 8 titik data, nilai = ABS(qty_change) x harga_master, qty positif tidak dihitung", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "WASTE-NILAI");
    const senin = await seninMingguIni(client);
    const harga = await hargaMaster(client, "BB-005");

    // Minggu ini: 2 pcs waste. Plus satu baris qty_change POSITIF yang HARUS
    // diabaikan -- proxy waste cuma qty_change < 0.
    await createMutasiLain(client, {
      locationId: lokasi,
      jenis: "waste_rusak",
      alasan: "QA waste",
      tanggal: geser(senin, 1),
      baris: [{ itemKode: "BB-005", qtyChange: -2 }],
    });
    // Baris qty POSITIF dengan jenis waste_rusak di-INSERT LANGSUNG, bukan
    // lewat createMutasiLain: sejak migrasi 0027 domain menolak kombinasi itu
    // (jenis pengurangan wajib qty negatif). Yang diuji di sini adalah lapis
    // kedua pengaman, yaitu filter `qty_change < 0` di SQL wasteTren -- harus
    // tetap aman kalau ada baris semacam ini di database (data lama / tulisan
    // manual), bukan cuma karena domain sudah memblokirnya.
    const { rows: koreksiHeader } = await client.query<{ id: string }>(
      `INSERT INTO inventory_transaksi_mutasi_lain (location_id, alasan, tanggal, jenis)
       VALUES ($1, 'QA koreksi tambah (insert langsung)', $2, 'waste_rusak') RETURNING id`,
      [lokasi, geser(senin, 1)],
    );
    await client.query(
      `INSERT INTO inventory_transaksi_mutasi_lain_baris (header_id, item_id, qty_change)
       VALUES ($1, (SELECT id FROM inventory_items WHERE kode = 'BB-005'), 5)`,
      [koreksiHeader[0].id],
    );

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.equal(hasil.wasteTren.length, 8, "jendela tren tetap 8 minggu");
    assert.equal(hasil.wasteTren[7].minggu.mulai, senin, "titik terakhir = minggu periode");
    assert.equal(hasil.wasteTren[0].minggu.mulai, geser(senin, -49), "titik pertama = 7 minggu sebelum minggu periode");

    assert.equal(hasil.wasteTren[7].nilaiTotal, 2 * harga, "nilai waste = ABS(qty_change) x harga_master");
    assert.equal(hasil.wasteTren[7].perLokasi.length, 1, "?lokasi= diisi -> perLokasi cuma 1 entri");
    assert.equal(hasil.wasteTren[7].perLokasi[0].lokasiId, lokasi);
    assert.ok(hasil.wasteTren[7].perLokasi[0].lokasiNama.includes("QA-ANALITIK"));

    assert.equal(hasil.wasteTren[6].nilaiTotal, 0, "minggu tanpa transaksi tetap jadi titik data bernilai 0");
    assert.deepEqual(hasil.wasteTren[6].perLokasi, [], "minggu tanpa transaksi: perLokasi kosong");
  });
});

test("getAnalitikOperasional: wasteTren CUMA jenis waste_rusak + hilang_tidak_diketahui, staff_meal/sampel/retur_supplier TIDAK ikut", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "WASTE-JENIS");
    const senin = await seninMingguIni(client);
    const harga = await hargaMaster(client, "BB-005");

    // Minggu yang SAMA: staff meal qty NEGATIF BESAR (-50) vs waste rusak
    // qty negatif kecil (-1) + hilang 2. Kalau filter jenis bocor, nilainya
    // akan ikut membengkak sejumlah staff meal -- itu yang diuji di sini.
    await createMutasiLain(client, {
      locationId: lokasi,
      jenis: "staff_meal",
      alasan: "QA makan staf",
      tanggal: geser(senin, 1),
      baris: [{ itemKode: "BB-005", qtyChange: -50 }],
    });
    await createMutasiLain(client, {
      locationId: lokasi,
      jenis: "sampel",
      alasan: "QA sampel",
      tanggal: geser(senin, 1),
      baris: [{ itemKode: "BB-005", qtyChange: -20 }],
    });
    await createMutasiLain(client, {
      locationId: lokasi,
      jenis: "retur_supplier",
      alasan: "QA retur",
      tanggal: geser(senin, 2),
      baris: [{ itemKode: "BB-005", qtyChange: -10 }],
    });
    await createMutasiLain(client, {
      locationId: lokasi,
      jenis: "waste_rusak",
      alasan: "QA rusak",
      tanggal: geser(senin, 2),
      baris: [{ itemKode: "BB-005", qtyChange: -1 }],
    });
    await createMutasiLain(client, {
      locationId: lokasi,
      jenis: "hilang_tidak_diketahui",
      alasan: "QA hilang",
      tanggal: geser(senin, 3),
      baris: [{ itemKode: "BB-005", qtyChange: -2 }],
    });

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.equal(
      hasil.wasteTren[7].nilaiTotal,
      3 * harga,
      "cuma 1 pcs waste_rusak + 2 pcs hilang_tidak_diketahui yang dihitung (staff_meal -50, sampel -20, retur -10 diabaikan)",
    );
    assert.equal(hasil.wasteTren[7].perLokasi.length, 1);
    assert.equal(hasil.wasteTren[7].perLokasi[0].nilai, 3 * harga);

    // Baris historis tanpa jenis (jenis IS NULL) juga tidak boleh ikut --
    // tidak bisa dibuat lewat createMutasiLain (jenis wajib), jadi di-INSERT
    // langsung seperti data pra-migrasi 0026.
    const { rows: headerRows } = await client.query<{ id: string }>(
      `INSERT INTO inventory_transaksi_mutasi_lain (location_id, alasan, tanggal, jenis)
       VALUES ($1, 'QA data lama tanpa jenis', $2, NULL) RETURNING id`,
      [lokasi, geser(senin, 3)],
    );
    await client.query(
      `INSERT INTO inventory_transaksi_mutasi_lain_baris (header_id, item_id, qty_change)
       VALUES ($1, (SELECT id FROM inventory_items WHERE kode = 'BB-005'), -99)`,
      [headerRows[0].id],
    );

    const setelahDataLama = await getAnalitikOperasional(client, { lokasiId: lokasi });
    assert.equal(
      setelahDataLama.wasteTren[7].nilaiTotal,
      3 * harga,
      "baris jenis NULL (data pra-migrasi) tidak match IN (...) -> angkanya tidak berubah",
    );
  });
});

test("getAnalitikOperasional: insight waste streak TIDAK muncul kalau yang naik cuma staff_meal", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "WASTE-STREAK-STAFFMEAL");
    const senin = await seninMingguIni(client);
    const n = await ambang(client, "waste_streak_minggu");

    // Pola yang DULU memicu insight (naik 3 minggu berturut-turut), tapi
    // seluruh barisnya staff meal -- sekarang tidak boleh dianggap waste.
    for (let i = 0; i < n; i++) {
      const mingguMulai = geser(senin, -7 * (n - 1 - i));
      await createMutasiLain(client, {
        locationId: lokasi,
        jenis: "staff_meal",
        alasan: "QA staff meal naik",
        tanggal: geser(mingguMulai, 1),
        baris: [{ itemKode: "BB-005", qtyChange: -(i + 1) }],
      });
    }

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.deepEqual(
      hasil.wasteTren.map((w) => w.nilaiTotal),
      new Array(8).fill(0),
      "staff meal tidak menghasilkan nilai waste sama sekali",
    );
    assert.deepEqual(hasil.insight, [], "tidak ada insight waste dari staff meal");
  });
});

test("getAnalitikOperasional: item harga_master NULL (pending_data) dihitung 0, bukan error", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "WASTE-PENDING");
    const senin = await seninMingguIni(client);

    const { rows } = await client.query<{ kode: string }>(
      `SELECT kode FROM inventory_items WHERE harga_master IS NULL LIMIT 1`,
    );
    assert.ok(rows[0], "butuh minimal satu item pending_data (harga_master NULL) di database");

    await createMutasiLain(client, {
      locationId: lokasi,
      jenis: "waste_rusak",
      alasan: "QA waste pending_data",
      tanggal: geser(senin, 1),
      baris: [{ itemKode: rows[0].kode, qtyChange: -4 }],
    });

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.equal(hasil.wasteTren[7].nilaiTotal, 0, "harga belum diisi -> nilai 0");
    assert.equal(
      hasil.wasteTren[7].perLokasi.length,
      1,
      "lokasinya TETAP muncul (punya transaksi minggu itu) walau nilainya 0 -- tidak dibuang",
    );
  });
});

test("getAnalitikOperasional: insight waste streak muncul kalau nilai naik N minggu berturut-turut", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "WASTE-STREAK");
    const senin = await seninMingguIni(client);
    const n = await ambang(client, "waste_streak_minggu");
    assert.equal(n, 3, "test ini ditulis untuk ambang default 3 minggu (migrasi 0025)");
    const harga = await hargaMaster(client, "BB-005");

    // Tiga minggu terakhir NAIK berturut-turut: 1 -> 2 -> 3 pcs.
    for (let i = 0; i < n; i++) {
      const mingguMulai = geser(senin, -7 * (n - 1 - i));
      await createMutasiLain(client, {
        locationId: lokasi,
        jenis: "waste_rusak",
        alasan: "QA waste streak",
        tanggal: geser(mingguMulai, 1),
        baris: [{ itemKode: "BB-005", qtyChange: -(i + 1) }],
      });
    }

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.deepEqual(
      hasil.wasteTren.slice(5).map((w) => w.nilaiTotal),
      [harga, 2 * harga, 3 * harga],
      "tiga titik terakhir harus naik berurutan",
    );
    assert.equal(hasil.insight.length, 1, `dapat: ${JSON.stringify(hasil.insight)}`);
    assert.ok(
      hasil.insight[0].startsWith("Nilai waste di QA-ANALITIK WASTE-STREAK naik 3 minggu berturut-turut (Rp"),
      `teks insight waste streak tidak sesuai: ${hasil.insight[0]}`,
    );
    assert.ok(hasil.insight[0].endsWith(")."));
  });
});

test("getAnalitikOperasional: waste DATAR (tidak naik) tidak memunculkan insight streak", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "WASTE-DATAR");
    const senin = await seninMingguIni(client);

    // Nilai sama tiap minggu -> bukan strictly naik.
    for (let i = 0; i < 4; i++) {
      await createMutasiLain(client, {
        locationId: lokasi,
        jenis: "waste_rusak",
        alasan: "QA waste datar",
        tanggal: geser(geser(senin, -7 * i), 1),
        baris: [{ itemKode: "BB-005", qtyChange: -2 }],
      });
    }

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.ok(
      hasil.wasteTren.slice(5).every((w) => w.nilaiTotal > 0),
      "datanya memang ada (bukan nol), cuma tidak naik",
    );
    assert.deepEqual(hasil.insight, [], "waste konstan tidak boleh dianggap tren naik");
  });
});

test("getAnalitikOperasional: waste naik tapi putus di minggu terakhir -> tidak ada insight", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "WASTE-PUTUS");
    const senin = await seninMingguIni(client);

    // 3 -> 5 -> 1 pcs: dua minggu pertama naik, minggu terakhir turun.
    const qty = [3, 5, 1];
    for (let i = 0; i < qty.length; i++) {
      await createMutasiLain(client, {
        locationId: lokasi,
        jenis: "waste_rusak",
        alasan: "QA waste putus",
        tanggal: geser(geser(senin, -7 * (qty.length - 1 - i)), 1),
        baris: [{ itemKode: "BB-005", qtyChange: -qty[i] }],
      });
    }

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });
    assert.deepEqual(hasil.insight, [], "streak harus putus kalau titik terakhir tidak lebih tinggi");
  });
});

/** Satu siklus opname lengkap: input draft lalu DISETUJUI (status 'disetujui' = selisih sudah masuk ledger). */
async function siklusOpnameDisetujui(
  client: PoolClient,
  lokasiId: number,
  tanggal: string,
  itemKode: string,
  qtyFisik: number,
): Promise<number> {
  const { headerId } = await createOpname(client, {
    locationId: lokasiId,
    tanggal,
    baris: [{ itemKode, qtyFisik }],
  });
  await decideOpname(client, { opnameId: Number(headerId), decision: "setuju" });
  return Number(headerId);
}

test("getAnalitikOperasional: insight opname streak muncul kalau N siklus terakhir selisihnya negatif", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "OPNAME-STREAK");
    const senin = await seninMingguIni(client);
    const n = await ambang(client, "opname_selisih_streak");
    assert.equal(n, 2, "test ini ditulis untuk ambang default 2 siklus (migrasi 0025)");

    // Isi stok dulu (qty_change POSITIF -> tidak dihitung sebagai waste),
    // supaya qty_sistem > qty_fisik dan selisihnya negatif (susut).
    await createMutasiLain(client, {
      locationId: lokasi,
      // Seed stok lewat qty POSITIF -> jenis WAJIB `koreksi_tambah` sejak
      // migrasi 0027 (jenis pengurangan hanya boleh qty negatif). Tidak ikut
      // hitungan waste: bukan waste_rusak/hilang, dan qty-nya > 0.
      jenis: "koreksi_tambah",
      alasan: "QA stok awal",
      tanggal: geser(senin, -7),
      baris: [{ itemKode: "BB-005", qtyChange: 100 }],
    });

    // Siklus 1: sistem 100, fisik 90 -> selisih -10 (setelah disetujui stok jadi 90).
    await siklusOpnameDisetujui(client, lokasi, geser(senin, -6), "BB-005", 90);
    // Siklus 2: sistem 90, fisik 85 -> selisih -5.
    await siklusOpnameDisetujui(client, lokasi, geser(senin, 1), "BB-005", 85);

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.equal(hasil.opnameSelisihTren.length, 1, "satu lokasi -> satu entri");
    const lokasiTren = hasil.opnameSelisihTren[0];
    assert.equal(lokasiTren.lokasiId, lokasi);
    assert.deepEqual(
      lokasiTren.siklus.map((s) => s.selisihTotal),
      [-10, -5],
      "selisih = qty_fisik - qty_sistem per siklus, urut kronologis ASC",
    );

    assert.ok(
      hasil.insight.includes(
        "Selisih opname di QA-ANALITIK OPNAME-STREAK negatif 2 siklus berturut-turut -- " +
          "indikasi susut berulang, perlu ditelusuri.",
      ),
      `teks insight opname streak tidak sesuai: ${JSON.stringify(hasil.insight)}`,
    );
  });
});

test("getAnalitikOperasional: opname status draft/ditolak TIDAK ikut (cuma 'disetujui' yang valid)", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "OPNAME-STATUS");
    const senin = await seninMingguIni(client);

    await createMutasiLain(client, {
      locationId: lokasi,
      // Seed stok lewat qty POSITIF -> jenis WAJIB `koreksi_tambah` sejak
      // migrasi 0027 (jenis pengurangan hanya boleh qty negatif). Tidak ikut
      // hitungan waste: bukan waste_rusak/hilang, dan qty-nya > 0.
      jenis: "koreksi_tambah",
      alasan: "QA stok awal",
      tanggal: geser(senin, -7),
      baris: [{ itemKode: "BB-005", qtyChange: 100 }],
    });

    // Draft (tidak diputuskan sama sekali).
    await createOpname(client, {
      locationId: lokasi,
      tanggal: geser(senin, -6),
      baris: [{ itemKode: "BB-005", qtyFisik: 80 }],
    });
    // Ditolak.
    const { headerId } = await createOpname(client, {
      locationId: lokasi,
      tanggal: geser(senin, -5),
      baris: [{ itemKode: "BB-005", qtyFisik: 70 }],
    });
    await decideOpname(client, { opnameId: Number(headerId), decision: "tolak" });

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.deepEqual(
      hasil.opnameSelisihTren,
      [],
      "draft & ditolak selisihnya belum/tidak pernah masuk ledger -> tidak boleh muncul di tren",
    );
    assert.deepEqual(hasil.insight, [], "tanpa siklus disetujui tidak ada insight opname");
  });
});

test("getAnalitikOperasional: siklus opname kurang dari ambang -> dilewati (bukan insight dari data sebagian)", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "OPNAME-KURANG");
    const senin = await seninMingguIni(client);
    const n = await ambang(client, "opname_selisih_streak");

    await createMutasiLain(client, {
      locationId: lokasi,
      // Seed stok lewat qty POSITIF -> jenis WAJIB `koreksi_tambah` sejak
      // migrasi 0027 (jenis pengurangan hanya boleh qty negatif). Tidak ikut
      // hitungan waste: bukan waste_rusak/hilang, dan qty-nya > 0.
      jenis: "koreksi_tambah",
      alasan: "QA stok awal",
      tanggal: geser(senin, -7),
      baris: [{ itemKode: "BB-005", qtyChange: 100 }],
    });
    // CUMA satu siklus negatif, sedangkan ambangnya 2.
    await siklusOpnameDisetujui(client, lokasi, geser(senin, -6), "BB-005", 90);

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.equal(hasil.opnameSelisihTren[0].siklus.length, 1);
    assert.ok(n > 1, "prasyarat test: ambang streak > 1");
    assert.deepEqual(hasil.insight, [], "siklus yang tersedia kurang dari ambang -> tidak boleh ada insight");
  });
});

test("getAnalitikOperasional: selisih opname POSITIF tidak memicu insight susut", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "OPNAME-POSITIF");
    const senin = await seninMingguIni(client);

    await createMutasiLain(client, {
      locationId: lokasi,
      // Seed stok lewat qty POSITIF -> jenis WAJIB `koreksi_tambah` sejak
      // migrasi 0027 (jenis pengurangan hanya boleh qty negatif). Tidak ikut
      // hitungan waste: bukan waste_rusak/hilang, dan qty-nya > 0.
      jenis: "koreksi_tambah",
      alasan: "QA stok awal",
      tanggal: geser(senin, -7),
      baris: [{ itemKode: "BB-005", qtyChange: 100 }],
    });
    // Fisik LEBIH BANYAK dari sistem dua siklus berturut-turut (selisih +).
    await siklusOpnameDisetujui(client, lokasi, geser(senin, -6), "BB-005", 110);
    await siklusOpnameDisetujui(client, lokasi, geser(senin, 1), "BB-005", 120);

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.deepEqual(
      hasil.opnameSelisihTren[0].siklus.map((s) => s.selisihTotal),
      [10, 10],
    );
    assert.deepEqual(hasil.insight, [], "selisih positif bukan indikasi susut -> tidak ada insight");
  });
});

test("getAnalitikOperasional: transfer status 'dikirim' TIDAK dihitung susut (qty_terima belum ada)", async () => {
  await withRollback(async (client) => {
    const senin = await seninMingguIni(client);

    // Baseline dulu (database dev bisa sudah punya transfer sungguhan) --
    // yang diuji adalah DELTA setelah transfer 'dikirim' ditambahkan.
    const sebelum = await getAnalitikOperasional(client, {});

    const { rows: ckRows } = await client.query<{ id: string }>(
      `SELECT id FROM core_locations WHERE entitas = 'samsara_ck' LIMIT 1`,
    );
    // entitas != 'samsara_ck' (BUKAN hardcode 'samsara_outlet') -- query yang
    // diuji di sini (getAnalitikOperasional) sudah diperbaiki memakai pola
    // yang sama, lihat COMMENT di domain/laporan.ts.
    const { rows: outletRows } = await client.query<{ id: string }>(
      `SELECT id FROM core_locations WHERE entitas != 'samsara_ck' AND is_active = true LIMIT 1`,
    );
    assert.ok(ckRows[0] && outletRows[0], "butuh lokasi CK & minimal 1 outlet aktif (migrasi 0011)");

    const { rows: headerRows } = await client.query<{ id: string }>(
      `INSERT INTO inventory_transaksi_transfer (location_asal_id, location_tujuan_id, tanggal, status)
       VALUES ($1, $2, $3, 'dikirim') RETURNING id`,
      [ckRows[0].id, outletRows[0].id, geser(senin, 1)],
    );
    await client.query(
      `INSERT INTO inventory_transaksi_transfer_baris (header_id, item_id, qty_kirim, qty_terima, unit)
       VALUES ($1, (SELECT id FROM inventory_items WHERE kode = 'BB-005'), 10, NULL, 'pcs')`,
      [headerRows[0].id],
    );

    const sesudah = await getAnalitikOperasional(client, {});

    assert.equal(
      sesudah.transferSusutTren[7].susutTotal,
      sebelum.transferSusutTren[7].susutTotal,
      "transfer yang belum diterima tidak boleh mengubah angka susut (qty_terima NULL, bukan 0)",
    );

    // Setelah diterima dengan qty lebih kecil, susutnya baru terhitung.
    await client.query(`UPDATE inventory_transaksi_transfer_baris SET qty_terima = 8 WHERE header_id = $1`, [
      headerRows[0].id,
    ]);
    await client.query(`UPDATE inventory_transaksi_transfer SET status = 'diterima' WHERE id = $1`, [headerRows[0].id]);

    const diterima = await getAnalitikOperasional(client, {});
    assert.equal(
      diterima.transferSusutTren[7].susutTotal,
      sebelum.transferSusutTren[7].susutTotal + 2,
      "susut = qty_kirim - qty_terima, dihitung saat query",
    );
  });
});

test("getAnalitikOperasional: periode eksplisit menggeser seluruh jendela 8 minggu", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "PERIODE");
    const senin = await seninMingguIni(client);

    // Waste dicatat di minggu yang mulai 3 minggu sebelum minggu ini
    // (senin-21 .. senin-15).
    await createMutasiLain(client, {
      locationId: lokasi,
      jenis: "waste_rusak",
      alasan: "QA periode",
      tanggal: geser(senin, -16),
      baris: [{ itemKode: "BB-005", qtyChange: -1 }],
    });

    // periode = tanggal di minggu itu -> minggu itu jadi titik TERAKHIR jendela.
    const hasil = await getAnalitikOperasional(client, { periode: geser(senin, -18), lokasiId: lokasi });
    assert.equal(hasil.wasteTren[7].minggu.mulai, geser(senin, -21));
    assert.ok(hasil.wasteTren[7].nilaiTotal > 0, "transaksi masuk ke minggu terakhir jendela periode itu");

    // Tanpa periode (jendela berakhir di minggu ini) transaksi yang sama ada
    // di indeks 4 -- indeks 7 = minggu ini, jadi 3 minggu sebelumnya = 7 - 3.
    const sekarang = await getAnalitikOperasional(client, { lokasiId: lokasi });
    assert.equal(sekarang.wasteTren[7].nilaiTotal, 0, "minggu ini tidak ada waste");
    assert.equal(sekarang.wasteTren[4].minggu.mulai, geser(senin, -21));
    assert.ok(sekarang.wasteTren[4].nilaiTotal > 0, "waste-nya ada di titik 3 minggu sebelum minggu ini");
  });
});

// ===========================================================================
// getAnalitikOperasional: cogsTren & transparansi data estimasi
// (hpp_saat_transaksi/hpp_sumber, migrasi 0028)
// ===========================================================================

test("getAnalitikOperasional: cogsTren = SUM(qty * hpp_saat_transaksi) per minggu, dari snapshot createPenjualan", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "COGS-DASAR");
    const senin = await seninMingguIni(client);

    const { headerId } = await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: geser(senin, 2),
      baris: [{ menuKode: "M-001", qty: 3 }],
    });

    // Angka pembanding diambil LANGSUNG dari baris yang sudah disimpan
    // createPenjualan (bukan dihitung ulang/dihardcode) -- test ini memverifikasi
    // getAnalitikOperasional MEMBACA snapshot, bukan sumber HPP lain.
    const { rows: mentah } = await client.query<{ hpp_saat_transaksi: string | null }>(
      `SELECT hpp_saat_transaksi FROM inventory_transaksi_penjualan_baris WHERE header_id = $1`,
      [Number(headerId)],
    );
    const hppSaatTransaksi = mentah[0].hpp_saat_transaksi === null ? null : Number(mentah[0].hpp_saat_transaksi);

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.equal(hasil.cogsTren.length, 8, "jendela tren tetap 8 minggu, sama seperti wasteTren/transferSusutTren");
    assert.equal(hasil.cogsTren[7].minggu.mulai, senin, "titik terakhir = minggu periode");
    assert.equal(hasil.cogsTren[7].jumlahBaris, 1);
    assert.equal(hasil.cogsTren[7].jumlahBarisEstimasi, 0, "baris baru selalu snapshot_asli, bukan estimasi");
    assert.equal(
      hasil.cogsTren[7].totalCogs,
      hppSaatTransaksi === null ? 0 : 3 * hppSaatTransaksi,
      "totalCogs = qty x hpp_saat_transaksi (0 kalau HPP pending)",
    );
    assert.equal(hasil.cogsTren[6].totalCogs, 0, "minggu tanpa transaksi tetap jadi titik data bernilai 0");
    assert.equal(hasil.cogsTren[6].jumlahBaris, 0);
  });
});

test("getAnalitikOperasional: adaDataEstimasi true kalau ADA baris hpp_sumber='snapshot_estimasi', LINTAS WAKTU (bukan cuma jendela 8 minggu cogsTren)", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "COGS-ESTIMASI");
    const senin = await seninMingguIni(client);
    const tanggalLampau = geser(senin, -200); // jauh di luar jendela 8 minggu (56 hari)

    const { headerId } = await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: tanggalLampau,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });

    // Simulasikan baris LAMA yang sudah di-backfill (createPenjualan SELALU
    // menulis 'snapshot_asli', lihat test di stok.test.ts -- di sini diubah
    // manual supaya bisa menguji getAnalitikOperasional terhadap data
    // 'snapshot_estimasi' tanpa menyentuh createPenjualan itu sendiri).
    await client.query(
      `UPDATE inventory_transaksi_penjualan_baris SET hpp_sumber = 'snapshot_estimasi' WHERE header_id = $1`,
      [Number(headerId)],
    );

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });

    assert.equal(hasil.adaDataEstimasi, true, "lokasi ini cuma punya baris snapshot_estimasi");
    assert.equal(
      hasil.tanggalMulaiDataAsli,
      null,
      "tidak ada satu pun baris snapshot_asli untuk lokasi ini -> null, bukan error",
    );

    // Transaksinya jauh di luar jendela cogsTren -- totalCogs semua minggu
    // tetap 0, membuktikan adaDataEstimasi TIDAK dibatasi jendela 8 minggu.
    assert.ok(
      hasil.cogsTren.every((c) => c.jumlahBaris === 0),
      "transaksi lampau di luar jendela 8 minggu tidak masuk cogsTren",
    );
  });
});

test("getAnalitikOperasional: tanggalMulaiDataAsli = tanggal transaksi snapshot_asli PALING AWAL, dibatasi lokasiId", async () => {
  await withRollback(async (client) => {
    const lokasi = await lokasiQa(client, "COGS-TANGGAL-ASLI");
    const senin = await seninMingguIni(client);
    const tanggalLebihAwal = geser(senin, -100);
    const tanggalLebihBaru = geser(senin, -50);

    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: tanggalLebihBaru,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });
    await createPenjualan(client, {
      locationId: lokasi,
      sumber: "Offline",
      tanggal: tanggalLebihAwal,
      baris: [{ menuKode: "M-001", qty: 1 }],
    });

    const hasil = await getAnalitikOperasional(client, { lokasiId: lokasi });
    assert.equal(hasil.tanggalMulaiDataAsli, tanggalLebihAwal);
    assert.equal(hasil.adaDataEstimasi, false, "kedua baris snapshot_asli, tidak ada estimasi");
  });
});
