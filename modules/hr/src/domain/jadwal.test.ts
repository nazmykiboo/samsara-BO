import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import {
  createJadwalShift,
  deleteJadwalShift,
  getJadwalGrid,
  listJadwalShift,
  salinMingguJadwal,
  updateJadwalShift,
} from "./jadwal.js";
import { fakeUser, withRollback } from "./test-helpers.js";

after(() => pool.end());

// Fixture nyata dari seed: owner id 1, manajer_ops (Ibnu) id 304, staf (Fitri) id 305, staf (Naura) id 306. Lokasi 1 & 2 (core_locations).
// Shift template dari migrasi 0002: id 1 = "Pagi" (06:00-14:00), id 2 = "Siang" (14:00-21:00).
// locationIds di fixture di bawah SENGAJA tidak selalu mengikuti core_user_lokasi
// nyata -- domain layer cuma membaca `user.locationIds` dari AuthUser yang dioper
// langsung (tidak query ulang ke DB), jadi bebas diset sesuai kebutuhan skenario test.
const OWNER = fakeUser({ id: 1, role: "owner" });
const MANAJER_OPS = fakeUser({ id: 304, role: "manajer_ops" });
const STAF_FITRI = fakeUser({ id: 305, role: "staf", locationIds: [1] });
const STAF_NAURA_LOKASI2 = fakeUser({ id: 306, role: "staf", locationIds: [2] });
// Duhan (307) dipakai sebagai fixture role "supervisor" -- role_id aslinya di DB
// staf, tapi domain layer cuma baca `user.role` dari AuthUser yang dioper
// langsung (lihat catatan locationIds di atas), jadi aman dipakai untuk
// membuktikan cabang non-manajerial yang sama juga berlaku untuk supervisor.
const SUPERVISOR_LOKASI1 = fakeUser({ id: 307, role: "supervisor", locationIds: [1] });
const SHIFT_PAGI = 1;
const SHIFT_SIANG = 2;

/**
 * Cuti berstatus 'disetujui' disisipkan LANGSUNG lewat SQL di test jadwal --
 * sengaja tidak lewat `createPengajuanLibur`+`decidePengajuanLibur` dari
 * domain pengajuan-libur: yang diuji di sini cuma pembacaan `konflikCuti`
 * oleh jadwal.ts, jadi test ini tidak perlu ikut terikat aturan H-2 dan
 * kuota di jalur pengajuan (pola sama seperti test CHECK constraint
 * jam_selesai > jam_mulai di bawah yang juga INSERT langsung).
 */
async function sisipkanCutiDisetujui(
  client: PoolClient,
  userId: number,
  tanggalMulai: string,
  tanggalSelesai: string,
): Promise<void> {
  await client.query(
    `INSERT INTO hr_pengajuan_libur (user_id, tanggal_mulai, tanggal_selesai, status, diputuskan_oleh, diputuskan_pada)
     VALUES ($1, $2, $3, 'disetujui', 304, now())`,
    [userId, tanggalMulai, tanggalSelesai],
  );
}

test("createJadwalShift + listJadwalShift: owner/manajer_ops lihat jadwal siapa pun di lokasi manapun", async () => {
  await withRollback(async (client) => {
    await createJadwalShift(
      client,
      { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI },
      304,
    );
    await createJadwalShift(
      client,
      { userId: 306, lokasiId: 2, tanggal: "2026-11-02", shiftTemplateId: SHIFT_SIANG },
      304,
    );

    const semua = await listJadwalShift(client, OWNER, { dari: "2026-11-01", sampai: "2026-11-03" });
    assert.equal(semua.length, 2, "owner lihat semua jadwal tanpa filter lokasi/user");

    const lokasi1Saja = await listJadwalShift(client, MANAJER_OPS, {
      dari: "2026-11-01",
      sampai: "2026-11-03",
      lokasiId: 1,
    });
    assert.equal(lokasi1Saja.length, 1);
    assert.equal(lokasi1Saja[0].userId, "305");
  });
});

test("createJadwalShift: jam diambil dari shift template, diduplikasi ke jam_mulai/jam_selesai (DEPRECATED) + shiftTemplateNama ikut tampil", async () => {
  await withRollback(async (client) => {
    await createJadwalShift(
      client,
      { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI },
      304,
    );

    const hasil = await listJadwalShift(client, OWNER, { dari: "2026-11-01", sampai: "2026-11-03" });
    assert.equal(hasil[0].shiftTemplateId, String(SHIFT_PAGI));
    assert.equal(hasil[0].shiftTemplateNama, "Pagi");
    assert.equal(hasil[0].jamMulai, "06:00:00");
    assert.equal(hasil[0].jamSelesai, "14:00:00");
  });
});

test("listJadwalShift: staf/supervisor lihat SEMUA staf di lokasi sendiri (bukan cuma diri sendiri), lokasiId yang dikirim DIABAIKAN", async () => {
  await withRollback(async (client) => {
    // Fitri (305) dan Duhan (307, fixture "supervisor") sama-sama lokasi 1; Naura (306) lokasi 2.
    await createJadwalShift(client, { userId: 305, lokasiId: 1, tanggal: "2026-11-05", shiftTemplateId: SHIFT_PAGI }, 304);
    await createJadwalShift(client, { userId: 307, lokasiId: 1, tanggal: "2026-11-05", shiftTemplateId: SHIFT_PAGI }, 304);
    await createJadwalShift(client, { userId: 306, lokasiId: 2, tanggal: "2026-11-05", shiftTemplateId: SHIFT_PAGI }, 304);

    // Fitri mencoba mengintip lokasi 2 lewat query -- harus tetap dipaksa ke lokasi sendiri (1), dapat KEDUA staf di lokasi itu.
    const hasilStaf = await listJadwalShift(client, STAF_FITRI, { dari: "2026-11-01", sampai: "2026-11-10", lokasiId: 2 });
    assert.equal(hasilStaf.length, 2, "staf lihat semua staf lain di lokasi sendiri, bukan cuma diri sendiri");
    assert.deepEqual(
      hasilStaf.map((r) => r.userId).sort(),
      ["305", "307"],
    );

    // Supervisor (fixture, lokasi 1) -- cabang non-manajerial yang sama juga berlaku untuknya.
    const hasilSupervisor = await listJadwalShift(client, SUPERVISOR_LOKASI1, { dari: "2026-11-01", sampai: "2026-11-10" });
    assert.equal(hasilSupervisor.length, 2);
  });
});

test("listJadwalShift: userId tetap bisa dipakai staf/supervisor untuk MEMPERSEMPIT (bukan memperluas) hasil yang sudah lokasi-scoped", async () => {
  await withRollback(async (client) => {
    await createJadwalShift(client, { userId: 305, lokasiId: 1, tanggal: "2026-11-05", shiftTemplateId: SHIFT_PAGI }, 304);
    await createJadwalShift(client, { userId: 307, lokasiId: 1, tanggal: "2026-11-05", shiftTemplateId: SHIFT_PAGI }, 304);

    const hasil = await listJadwalShift(client, STAF_FITRI, { dari: "2026-11-01", sampai: "2026-11-10", userId: 307 });
    assert.equal(hasil.length, 1);
    assert.equal(hasil[0].userId, "307");
  });
});

test("listJadwalShift: staf TIDAK bisa lihat staf lokasi lain meski mengirim userId staf itu (lokasi tetap jadi batas utama)", async () => {
  await withRollback(async (client) => {
    await createJadwalShift(client, { userId: 306, lokasiId: 2, tanggal: "2026-11-05", shiftTemplateId: SHIFT_PAGI }, 304);

    // Fitri (lokasi 1) minta userId=306 (jadwalnya ada di lokasi 2) -- AND lokasi-scope tetap berlaku, hasil kosong.
    const hasil = await listJadwalShift(client, STAF_FITRI, { dari: "2026-11-01", sampai: "2026-11-10", userId: 306 });
    assert.equal(hasil.length, 0);
  });
});

test("createJadwalShift: ditolak kalau userId, lokasiId, atau shiftTemplateId tidak ada", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () =>
        createJadwalShift(client, { userId: 999999, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI }),
      /tidak ditemukan/i,
    );
    await assert.rejects(
      () =>
        createJadwalShift(client, { userId: 305, lokasiId: 999999, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI }),
      /tidak ditemukan/i,
    );
    await assert.rejects(
      () => createJadwalShift(client, { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: 999999 }),
      /shift template.*tidak ditemukan/i,
    );
  });
});

test("hr_jadwal_shift: CHECK constraint jam_selesai > jam_mulai tetap aktif di level DB (dites lewat INSERT langsung, bukan lewat domain layer lagi -- jam sekarang selalu dari template yang sudah valid)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() =>
      client.query(
        `INSERT INTO hr_jadwal_shift (user_id, lokasi_id, tanggal, jam_mulai, jam_selesai, dibuat_oleh)
         VALUES (305, 1, '2026-11-02', '16:00', '08:00', 304)`,
      ),
    );
  });
});

test("updateJadwalShift: ganti shift template, jam_mulai/jam_selesai ikut berubah, tercatat ke audit log", async () => {
  await withRollback(async (client) => {
    const { id } = await createJadwalShift(
      client,
      { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI },
      304,
    );
    await updateJadwalShift(client, Number(id), { shiftTemplateId: SHIFT_SIANG }, 304);

    const hasil = await listJadwalShift(client, OWNER, { dari: "2026-11-01", sampai: "2026-11-03" });
    const baris = hasil.find((r) => r.id === id);
    assert.equal(baris?.shiftTemplateId, String(SHIFT_SIANG));
    assert.equal(baris?.jamMulai, "14:00:00");
    assert.equal(baris?.jamSelesai, "21:00:00");

    const { rows: auditRows } = await client.query(
      `SELECT field_name FROM core_audit_log WHERE table_name = 'hr_jadwal_shift' AND record_id = $1`,
      [id],
    );
    assert.ok(auditRows.some((r: { field_name: string }) => r.field_name === "updated"));
  });
});

test("deleteJadwalShift: baris benar-benar hilang", async () => {
  await withRollback(async (client) => {
    const { id } = await createJadwalShift(
      client,
      { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI },
      304,
    );
    await deleteJadwalShift(client, Number(id), 304);

    const hasil = await listJadwalShift(client, OWNER, { dari: "2026-11-01", sampai: "2026-11-03" });
    assert.ok(!hasil.some((r) => r.id === id));
  });
});

test("getJadwalGrid: shape per hari x shift, staf muncul di sel yang benar, shift kosong tetap ada barisnya", async () => {
  await withRollback(async (client) => {
    await createJadwalShift(client, { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI }, 304);
    await createJadwalShift(client, { userId: 307, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI }, 304);
    await createJadwalShift(client, { userId: 306, lokasiId: 2, tanggal: "2026-11-02", shiftTemplateId: SHIFT_SIANG }, 304);

    const grid = await getJadwalGrid(client, OWNER, { lokasiId: 1, minggu: "2026-11-02" });
    assert.equal(grid.lokasiId, "1");
    assert.equal(grid.hari.length, 7, "selalu 7 hari (Senin-Minggu) walau sebagian kosong");
    assert.ok(grid.mingguMulai <= "2026-11-02" && "2026-11-02" <= grid.mingguSelesai);

    const hari2nov = grid.hari.find((h) => h.tanggal === "2026-11-02");
    assert.ok(hari2nov, "tanggal 2026-11-02 harus ada di grid");
    const selPagi = hari2nov!.shift.find((s) => s.shiftTemplateId === String(SHIFT_PAGI));
    assert.deepEqual(selPagi!.staf.map((s) => s.userId).sort(), ["305", "307"]);

    const selSiang = hari2nov!.shift.find((s) => s.shiftTemplateId === String(SHIFT_SIANG));
    assert.equal(selSiang!.staf.length, 0, "shift Siang lokasi 1 kosong -- baris tetap ada, bukan hilang");

    // Jadwal Naura ada di lokasi 2, tidak boleh bocor ke grid lokasi 1.
    assert.ok(!hari2nov!.shift.some((s) => s.staf.some((st) => st.userId === "306")));
  });
});

test("getJadwalGrid: staf dipaksa ke lokasi sendiri, parameter 'lokasi' di luar locationIds diabaikan", async () => {
  await withRollback(async (client) => {
    await createJadwalShift(client, { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI }, 304);

    const grid = await getJadwalGrid(client, STAF_FITRI, { lokasiId: 2, minggu: "2026-11-02" });
    assert.equal(grid.lokasiId, "1", "lokasi query (2) diabaikan, dipaksa ke lokasi sendiri (1)");
  });
});

test("getJadwalGrid: owner/manajer_ops wajib kirim lokasi (tidak ada default)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() => getJadwalGrid(client, OWNER, { minggu: "2026-11-02" }), /lokasi.*wajib/i);
  });
});

// --- salinMingguJadwal ------------------------------------------------------
// Minggu 2026-11-02 (Senin) s/d 2026-11-08 (Minggu); minggu tujuan
// 2026-11-09 (Senin) s/d 2026-11-15.

test("salinMingguJadwal: tiap baris tersalin ke HARI YANG SAMA di minggu tujuan (offset hari dijaga), jam & shift template ikut apa adanya", async () => {
  await withRollback(async (client) => {
    // Senin (offset 0) dan Rabu (offset 2) di minggu sumber.
    await createJadwalShift(client, { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI }, 304);
    await createJadwalShift(client, { userId: 307, lokasiId: 1, tanggal: "2026-11-04", shiftTemplateId: SHIFT_SIANG }, 304);

    // Minggu sumber/tujuan dikirim sebagai tanggal SEMBARANG dalam minggu itu (bukan harus Senin).
    const hasil = await salinMingguJadwal(
      client,
      { lokasiId: 1, mingguSumber: "2026-11-05", mingguTujuan: "2026-11-12" },
      304,
    );
    assert.deepEqual(hasil, { disalin: 2, dilewati: 0 });

    const tujuan = await listJadwalShift(client, OWNER, { dari: "2026-11-09", sampai: "2026-11-15", lokasiId: 1 });
    assert.equal(tujuan.length, 2);

    const senin = tujuan.find((r) => r.tanggal === "2026-11-09");
    assert.ok(senin, "baris Senin sumber harus jatuh di Senin minggu tujuan (offset 0)");
    assert.equal(senin!.userId, "305");
    assert.equal(senin!.shiftTemplateId, String(SHIFT_PAGI));
    assert.equal(senin!.jamMulai, "06:00:00");

    const rabu = tujuan.find((r) => r.tanggal === "2026-11-11");
    assert.ok(rabu, "baris Rabu sumber harus jatuh di Rabu minggu tujuan (offset 2)");
    assert.equal(rabu!.userId, "307");
    assert.equal(rabu!.shiftTemplateId, String(SHIFT_SIANG));

    // Minggu sumber tidak disentuh.
    const sumber = await listJadwalShift(client, OWNER, { dari: "2026-11-02", sampai: "2026-11-08", lokasiId: 1 });
    assert.equal(sumber.length, 2);

    // Audit log baris hasil salin mencatat asal tanggalnya.
    const { rows: auditRows } = await client.query<{ new_value: string }>(
      `SELECT new_value FROM core_audit_log WHERE table_name = 'hr_jadwal_shift' AND record_id = $1 AND field_name = 'created'`,
      [senin!.id],
    );
    assert.equal(JSON.parse(auditRows[0].new_value).disalinDariTanggal, "2026-11-02");
  });
});

test("salinMingguJadwal: idempoten -- dipanggil 2x, baris identik di minggu tujuan dilewati bukan diduplikasi", async () => {
  await withRollback(async (client) => {
    await createJadwalShift(client, { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI }, 304);
    await createJadwalShift(client, { userId: 307, lokasiId: 1, tanggal: "2026-11-04", shiftTemplateId: SHIFT_SIANG }, 304);

    const pertama = await salinMingguJadwal(client, { lokasiId: 1, mingguSumber: "2026-11-02", mingguTujuan: "2026-11-09" }, 304);
    assert.deepEqual(pertama, { disalin: 2, dilewati: 0 });

    const kedua = await salinMingguJadwal(client, { lokasiId: 1, mingguSumber: "2026-11-02", mingguTujuan: "2026-11-09" }, 304);
    assert.deepEqual(kedua, { disalin: 0, dilewati: 2 }, "pemanggilan kedua tidak menambah baris apa pun");

    const tujuan = await listJadwalShift(client, OWNER, { dari: "2026-11-09", sampai: "2026-11-15", lokasiId: 1 });
    assert.equal(tujuan.length, 2, "tidak ada duplikat di minggu tujuan");
  });
});

test("salinMingguJadwal: baris yang BEDA shift template tetap disalin walau user+tanggal sama (bukan dianggap identik)", async () => {
  await withRollback(async (client) => {
    await createJadwalShift(client, { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI }, 304);
    // Minggu tujuan sudah punya baris user+tanggal sama tapi shift SIANG -- bukan duplikat.
    await createJadwalShift(client, { userId: 305, lokasiId: 1, tanggal: "2026-11-09", shiftTemplateId: SHIFT_SIANG }, 304);

    const hasil = await salinMingguJadwal(client, { lokasiId: 1, mingguSumber: "2026-11-02", mingguTujuan: "2026-11-09" }, 304);
    assert.deepEqual(hasil, { disalin: 1, dilewati: 0 });

    const tujuan = await listJadwalShift(client, OWNER, { dari: "2026-11-09", sampai: "2026-11-09", lokasiId: 1 });
    assert.equal(tujuan.length, 2, "Pagi hasil salin + Siang yang sudah ada");
  });
});

test("salinMingguJadwal: lokasi tidak ada -> error", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () => salinMingguJadwal(client, { lokasiId: 999999, mingguSumber: "2026-11-02", mingguTujuan: "2026-11-09" }, 304),
      /lokasi id 999999 tidak ditemukan/i,
    );
  });
});

// --- konflikCuti -----------------------------------------------------------

test("konflikCuti: createJadwalShift menandai (bukan memblokir) jadwal staf yang sedang cuti disetujui; staf tanpa cuti false", async () => {
  await withRollback(async (client) => {
    // Fitri (305) cuti disetujui 2026-11-02 s/d 2026-11-03.
    await sisipkanCutiDisetujui(client, 305, "2026-11-02", "2026-11-03");

    const bentrok = await createJadwalShift(
      client,
      { userId: 305, lokasiId: 1, tanggal: "2026-11-03", shiftTemplateId: SHIFT_PAGI },
      304,
    );
    assert.equal(bentrok.konflikCuti, true, "tanggal di TENGAH/ujung rentang cuti ikut terdeteksi");

    // Baris tetap tersimpan -- konflik cuma penanda, bukan blocker.
    const tersimpan = await listJadwalShift(client, OWNER, { dari: "2026-11-03", sampai: "2026-11-03", lokasiId: 1 });
    assert.ok(tersimpan.some((r) => r.id === bentrok.id));

    // Di luar rentang cuti -> false.
    const amanTanggal = await createJadwalShift(
      client,
      { userId: 305, lokasiId: 1, tanggal: "2026-11-05", shiftTemplateId: SHIFT_PAGI },
      304,
    );
    assert.equal(amanTanggal.konflikCuti, false);

    // Staf lain di tanggal yang sama -> false (cuti milik orang, bukan milik tanggal).
    const amanStaf = await createJadwalShift(
      client,
      { userId: 307, lokasiId: 1, tanggal: "2026-11-03", shiftTemplateId: SHIFT_PAGI },
      304,
    );
    assert.equal(amanStaf.konflikCuti, false);
  });
});

test("konflikCuti: cuti yang masih 'diajukan' atau 'ditolak' TIDAK dianggap konflik", async () => {
  await withRollback(async (client) => {
    await client.query(
      `INSERT INTO hr_pengajuan_libur (user_id, tanggal_mulai, tanggal_selesai, status) VALUES (305, '2026-11-03', '2026-11-03', 'diajukan')`,
    );
    await client.query(
      `INSERT INTO hr_pengajuan_libur (user_id, tanggal_mulai, tanggal_selesai, status, diputuskan_oleh, diputuskan_pada)
       VALUES (305, '2026-11-03', '2026-11-03', 'ditolak', 304, now())`,
    );

    const hasil = await createJadwalShift(
      client,
      { userId: 305, lokasiId: 1, tanggal: "2026-11-03", shiftTemplateId: SHIFT_PAGI },
      304,
    );
    assert.equal(hasil.konflikCuti, false, "cuma status 'disetujui' yang dihitung konflik");
  });
});

test("konflikCuti: updateJadwalShift memakai user_id baris lama + tanggal BARU", async () => {
  await withRollback(async (client) => {
    await sisipkanCutiDisetujui(client, 305, "2026-11-02", "2026-11-03");

    const { id, konflikCuti } = await createJadwalShift(
      client,
      { userId: 305, lokasiId: 1, tanggal: "2026-11-06", shiftTemplateId: SHIFT_PAGI },
      304,
    );
    assert.equal(konflikCuti, false, "tanggal awal di luar rentang cuti");

    // Dipindah MASUK ke rentang cuti.
    const masuk = await updateJadwalShift(client, Number(id), { tanggal: "2026-11-02" }, 304);
    assert.equal(masuk.konflikCuti, true);

    // Dipindah KELUAR lagi.
    const keluar = await updateJadwalShift(client, Number(id), { tanggal: "2026-11-07" }, 304);
    assert.equal(keluar.konflikCuti, false);

    // Ganti shift saja (tanggal tidak dikirim) -- tetap pakai tanggal baris yang berlaku.
    await updateJadwalShift(client, Number(id), { tanggal: "2026-11-03" }, 304);
    const gantiShift = await updateJadwalShift(client, Number(id), { shiftTemplateId: SHIFT_SIANG }, 304);
    assert.equal(gantiShift.konflikCuti, true, "tanggal lama (dalam rentang cuti) tetap dipakai kalau tanggal tidak diubah");
  });
});

test("konflikCuti: ikut muncul di listJadwalShift dan getJadwalGrid", async () => {
  await withRollback(async (client) => {
    await sisipkanCutiDisetujui(client, 305, "2026-11-02", "2026-11-02");
    await createJadwalShift(client, { userId: 305, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI }, 304);
    await createJadwalShift(client, { userId: 307, lokasiId: 1, tanggal: "2026-11-02", shiftTemplateId: SHIFT_PAGI }, 304);

    const baris = await listJadwalShift(client, OWNER, { dari: "2026-11-02", sampai: "2026-11-02", lokasiId: 1 });
    assert.equal(baris.find((r) => r.userId === "305")?.konflikCuti, true);
    assert.equal(baris.find((r) => r.userId === "307")?.konflikCuti, false);

    const grid = await getJadwalGrid(client, OWNER, { lokasiId: 1, minggu: "2026-11-02" });
    const selPagi = grid.hari.find((h) => h.tanggal === "2026-11-02")!.shift.find((s) => s.shiftTemplateId === String(SHIFT_PAGI))!;
    assert.equal(selPagi.staf.find((s) => s.userId === "305")?.konflikCuti, true);
    assert.equal(selPagi.staf.find((s) => s.userId === "307")?.konflikCuti, false);
  });
});
