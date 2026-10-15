import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "@samsara/core";
import {
  createPengajuanLibur,
  decidePengajuanLibur,
  getSisaKuotaCuti,
  listPengajuanLibur,
  overridePengajuanLibur,
} from "./pengajuan-libur.js";
import { fakeUser, withRollback } from "./test-helpers.js";

after(() => pool.end());

const OWNER = fakeUser({ id: 1, role: "owner" });
const MANAJER_OPS = fakeUser({ id: 304, role: "manajer_ops" });
const STAF_FITRI = fakeUser({ id: 305, role: "staf" });

/**
 * Tanggal di test file ini dihitung RELATIF terhadap hari ini, bukan
 * hardcode seperti di jadwal.test.ts -- sejak aturan H-2 (lihat
 * `createPengajuanLibur`), tanggal hardcode akan jadi "masa lalu" begitu
 * kalender berjalan dan pengajuannya ditolak, jadi test-nya akan rusak
 * sendiri. Semua helper memakai Date.UTC murni + basis `hariIniUtc()` di
 * bawah, yang HARUS sepakat persis dengan `hariIniJakarta()` di domain layer
 * (pengajuan-libur.ts) -- kalau basisnya beda (mis. versi lama yang pakai
 * `new Date().toISOString().slice(0,10)`, zona UTC bukan WIB), test ini bisa
 * flaky tepat selama jam 00:00-06:59 WIB (UTC masih tanggal kemarin, lihat
 * catatan panjang di `hariIniJakarta`) tanpa ada perubahan kode apa pun.
 */
function hariIniUtc(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Hari ini + `n` hari (n boleh negatif). */
function tanggalPlus(n: number): string {
  const [y, m, d] = hariIniUtc().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Hari ke-`hari` di BULAN KALENDER INI -- dipakai skenario kuota bulanan
 * yang butuh tanggal se-bulan dengan "hari ini" (mis. aturan H-2 dilanggar
 * tapi kuota bulanan juga sudah terpakai). */
function tanggalBulanIni(hari: number): string {
  const [y, m] = hariIniUtc().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, hari)).toISOString().slice(0, 10);
}

/** Hari ke-`hari` di bulan setelah BULAN DEPAN -- selalu jauh di depan (>= ~30
 * hari), jadi aman dari H-2, dan beberapa pemanggilan selalu jatuh di SATU
 * bulan kalender yang sama (yang dibutuhkan test kuota bulanan). */
function tanggalBulanJauh(hari: number): string {
  const [y, m] = hariIniUtc().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + 2, hari)).toISOString().slice(0, 10);
}

/** Rentang 3 hari di bulan ini yang PASTI tidak menyentuh hari ini/besok --
 * dipakai untuk "sudah ada cuti disetujui bulan ini" tanpa ikut bentrok
 * tanggal dengan pengajuan yang sedang diuji. */
function rentangLainBulanIni(): { mulai: string; selesai: string } {
  const tanggalHariIni = Number(hariIniUtc().slice(8, 10));
  const mulaiHari = tanggalHariIni <= 14 ? 20 : 1;
  return { mulai: tanggalBulanIni(mulaiHari), selesai: tanggalBulanIni(mulaiHari + 2) };
}

/**
 * Cuti berstatus 'disetujui' disisipkan LANGSUNG lewat SQL -- dipakai HANYA
 * untuk menyiapkan kondisi awal (mis. "bulan ini sudah ada 3 hari cuti
 * disetujui") pada tanggal yang tidak bisa lewat jalur normal karena H-2.
 * Pola sama seperti INSERT langsung di jadwal.test.ts.
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

test("createPengajuanLibur + listPengajuanLibur: owner/manajer_ops lihat semua (antrian approval)", async () => {
  await withRollback(async (client) => {
    await createPengajuanLibur(client, 305, {
      tanggalMulai: tanggalBulanJauh(1),
      tanggalSelesai: tanggalBulanJauh(2),
      alasan: "Acara keluarga",
    });
    await createPengajuanLibur(client, 306, { tanggalMulai: tanggalBulanJauh(5), tanggalSelesai: tanggalBulanJauh(5) });

    const semua = await listPengajuanLibur(client, OWNER, {});
    assert.equal(semua.length, 2);

    const punyaFitri = await listPengajuanLibur(client, MANAJER_OPS, { userId: 305 });
    assert.equal(punyaFitri.length, 1);
    assert.equal(punyaFitri[0].userId, "305");
    assert.equal(punyaFitri[0].status, "diajukan");
  });
});

test("listPengajuanLibur: staf cuma lihat riwayat sendiri, userId yang dikirim DIABAIKAN", async () => {
  await withRollback(async (client) => {
    await createPengajuanLibur(client, 305, { tanggalMulai: tanggalBulanJauh(1), tanggalSelesai: tanggalBulanJauh(2) });
    await createPengajuanLibur(client, 306, { tanggalMulai: tanggalBulanJauh(5), tanggalSelesai: tanggalBulanJauh(5) });

    const hasil = await listPengajuanLibur(client, STAF_FITRI, { userId: 306 });
    assert.equal(hasil.length, 1);
    assert.equal(hasil[0].userId, "305", "userId query diabaikan, dipaksa ke user sendiri");
  });
});

test("decidePengajuanLibur: disetujui -- status & diputuskan_oleh/diputuskan_pada terisi, tercatat audit log", async () => {
  await withRollback(async (client) => {
    const { id } = await createPengajuanLibur(client, 305, {
      tanggalMulai: tanggalBulanJauh(1),
      tanggalSelesai: tanggalBulanJauh(2),
    });
    await decidePengajuanLibur(client, Number(id), "disetujui", 304);

    const hasil = await listPengajuanLibur(client, OWNER, {});
    const baris = hasil.find((r) => r.id === id);
    assert.equal(baris?.status, "disetujui");
    assert.equal(baris?.diputuskanOleh, "304");
    assert.ok(baris?.diputuskanPada !== null);

    const { rows: auditRows } = await client.query(
      `SELECT old_value, new_value FROM core_audit_log WHERE table_name = 'hr_pengajuan_libur' AND record_id = $1 AND field_name = 'status'`,
      [id],
    );
    assert.equal(auditRows[0].old_value, "diajukan");
    assert.equal(auditRows[0].new_value, "disetujui");
  });
});

test("decidePengajuanLibur: tidak bisa diputuskan ulang kalau sudah disetujui/ditolak", async () => {
  await withRollback(async (client) => {
    const { id } = await createPengajuanLibur(client, 305, {
      tanggalMulai: tanggalBulanJauh(1),
      tanggalSelesai: tanggalBulanJauh(2),
    });
    await decidePengajuanLibur(client, Number(id), "ditolak", 304);

    await assert.rejects(() => decidePengajuanLibur(client, Number(id), "disetujui", 304), /sudah diputuskan/i);
  });
});

test("decidePengajuanLibur: manajer_ops TIDAK bisa memutuskan pengajuan milik sendiri (konflik kepentingan)", async () => {
  await withRollback(async (client) => {
    const { id } = await createPengajuanLibur(client, 304, {
      tanggalMulai: tanggalBulanJauh(1),
      tanggalSelesai: tanggalBulanJauh(2),
    });

    await assert.rejects(() => decidePengajuanLibur(client, Number(id), "disetujui", 304), /milik sendiri/i);

    // Owner (bukan pemilik pengajuan) tetap bisa memutuskan punya manajer_ops.
    await decidePengajuanLibur(client, Number(id), "disetujui", 1);
    const hasil = await listPengajuanLibur(client, OWNER, {});
    assert.equal(hasil.find((r) => r.id === id)?.status, "disetujui");
  });
});

test("createPengajuanLibur: ditolak kalau tanggal_selesai < tanggal_mulai (CHECK constraint)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() =>
      createPengajuanLibur(client, 305, { tanggalMulai: tanggalBulanJauh(5), tanggalSelesai: tanggalBulanJauh(1) }),
    );
  });
});

// --- Aturan H-2 (jalur pengajuan NORMAL) -----------------------------------

test("createPengajuanLibur: ditolak kalau kurang dari H-2 (hari ini / besok), TANPA menyimpan baris apa pun", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () => createPengajuanLibur(client, 305, { tanggalMulai: tanggalPlus(0), tanggalSelesai: tanggalPlus(0) }),
      /H-2|2 hari/,
    );
    await assert.rejects(
      () => createPengajuanLibur(client, 305, { tanggalMulai: tanggalPlus(1), tanggalSelesai: tanggalPlus(3) }),
      /H-2|2 hari/,
    );

    const { rows } = await client.query(`SELECT 1 FROM hr_pengajuan_libur WHERE user_id = 305`);
    assert.equal(rows.length, 0, "ditolak SEBELUM insert, bukan disimpan lalu ditandai");
  });
});

test("createPengajuanLibur: H-2 tepat (2 hari) dan lebih jauh tetap diterima", async () => {
  await withRollback(async (client) => {
    const tepatH2 = await createPengajuanLibur(client, 305, { tanggalMulai: tanggalPlus(2), tanggalSelesai: tanggalPlus(2) });
    assert.ok(tepatH2.id, "H-2 tepat adalah batas yang MASIH boleh (bukan < 2)");

    const jauh = await createPengajuanLibur(client, 306, { tanggalMulai: tanggalPlus(10), tanggalSelesai: tanggalPlus(10) });
    assert.ok(jauh.id);
  });
});

test("createPengajuanLibur: aturan H-2 berlaku juga untuk owner/manajer_ops yang mengajukan untuk diri sendiri (satu jalur untuk semua role)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () => createPengajuanLibur(client, 304, { tanggalMulai: tanggalPlus(1), tanggalSelesai: tanggalPlus(1) }),
      /H-2|2 hari/,
    );
    await assert.rejects(
      () => createPengajuanLibur(client, 1, { tanggalMulai: tanggalPlus(0), tanggalSelesai: tanggalPlus(0) }),
      /H-2|2 hari/,
    );
  });
});

// Kuota cuti bulanan: seed migrasi 0003_create_settings.sql = 2 hari/bulan.

test("createPengajuanLibur: dalam kuota -- melebihiKuota false, selisih 0", async () => {
  await withRollback(async (client) => {
    const result = await createPengajuanLibur(client, 305, {
      tanggalMulai: tanggalBulanJauh(10),
      tanggalSelesai: tanggalBulanJauh(10),
    });
    assert.equal(result.melebihiKuota, false);
    assert.equal(result.selisih, 0);
  });
});

test("createPengajuanLibur + decidePengajuanLibur: pengajuan yang melebihi kuota TETAP dibuat (tidak ditolak sistem), ditandai melebihiKuota + selisih, dan tampil sebagai badge di antrian approval manajer", async () => {
  await withRollback(async (client) => {
    // Setujui 2 hari dulu di satu bulan -- pas habis kuota (2).
    const pertama = await createPengajuanLibur(client, 305, {
      tanggalMulai: tanggalBulanJauh(1),
      tanggalSelesai: tanggalBulanJauh(2),
    });
    assert.equal(pertama.melebihiKuota, false);
    await decidePengajuanLibur(client, Number(pertama.id), "disetujui", 304);

    // Ajukan 1 hari lagi bulan yang sama -- total jadi 3 hari, kuota 2 -> melebihi 1.
    const kedua = await createPengajuanLibur(client, 305, {
      tanggalMulai: tanggalBulanJauh(15),
      tanggalSelesai: tanggalBulanJauh(15),
    });
    assert.equal(kedua.melebihiKuota, true, "pengajuan tetap dibuat walau melebihi kuota, bukan ditolak");
    assert.equal(kedua.selisih, 1);

    const hasil = await listPengajuanLibur(client, MANAJER_OPS, {});
    const barisKedua = hasil.find((r) => r.id === kedua.id);
    assert.equal(barisKedua?.status, "diajukan", "tersimpan normal, kuota bukan blocker");
    assert.equal(barisKedua?.melebihiKuota, true);
    assert.equal(barisKedua?.selisihKuota, 1);

    // Pengajuan pertama (sudah disetujui, PAS kuota, bukan melebihi) tidak ikut ditandai.
    const barisPertama = hasil.find((r) => r.id === pertama.id);
    assert.equal(barisPertama?.melebihiKuota, false);
  });
});

test("getSisaKuotaCuti: sisa berkurang sesuai hari yang sudah DISETUJUI bulan kalender ini (bukan yang masih 'diajukan')", async () => {
  await withRollback(async (client) => {
    const sebelum = await getSisaKuotaCuti(client, 305);
    assert.equal(sebelum.kuotaBulanan, 2);
    assert.equal(sebelum.terpakai, 0);
    assert.equal(sebelum.sisa, 2);

    // Masih 'diajukan' -> belum mengurangi sisa kuota, apa pun bulannya.
    await createPengajuanLibur(client, 305, { tanggalMulai: tanggalPlus(2), tanggalSelesai: tanggalPlus(2) });
    const masihDiajukan = await getSisaKuotaCuti(client, 305);
    assert.equal(masihDiajukan.terpakai, 0, "belum disetujui, belum mengurangi sisa kuota");

    // Disetujui 1 hari di bulan INI (lewat jalur override, karena cuti untuk
    // hari ini tidak mungkin lewat jalur normal yang kena H-2).
    await overridePengajuanLibur(client, 304, {
      userId: 305,
      tanggalMulai: hariIniUtc(),
      tanggalSelesai: hariIniUtc(),
    });
    const sesudahDisetujui = await getSisaKuotaCuti(client, 305);
    assert.equal(sesudahDisetujui.terpakai, 1);
    assert.equal(sesudahDisetujui.sisa, 1);
  });
});

// --- Kuota harian cuti per lokasi ------------------------------------------
// Fitri (305), Naura (306), Duhan (307) semuanya di core_locations id 2
// ("Samsara Outlet 1 Malang") menurut core_user_lokasi NYATA.

test("kuotaHarianPenuh: staf KEDUA di lokasi yang SAMA dengan cuti disetujui yang tanggalnya overlap ditandai -- pengajuannya tetap tersimpan", async () => {
  await withRollback(async (client) => {
    const fitri = await createPengajuanLibur(client, 305, {
      tanggalMulai: tanggalBulanJauh(10),
      tanggalSelesai: tanggalBulanJauh(11),
    });
    assert.equal(fitri.kuotaHarianPenuh, false, "belum ada cuti DISETUJUI di lokasi itu");
    await decidePengajuanLibur(client, Number(fitri.id), "disetujui", 304);

    // Naura (lokasi sama) minta cuti yang overlap 1 hari dengan cuti Fitri.
    const naura = await createPengajuanLibur(client, 306, {
      tanggalMulai: tanggalBulanJauh(11),
      tanggalSelesai: tanggalBulanJauh(12),
    });
    assert.equal(naura.kuotaHarianPenuh, true, "maksimal 1 cuti disetujui per lokasi per tanggal");

    const hasil = await listPengajuanLibur(client, MANAJER_OPS, { userId: 306 });
    assert.equal(hasil[0].status, "diajukan", "tetap tersimpan, kuota harian bukan blocker");
    assert.equal(hasil[0].kuotaHarianPenuh, true, "ikut terbaca di listPengajuanLibur");

    // Tanggal yang TIDAK overlap sama sekali -> tidak kena.
    const tidakOverlap = await createPengajuanLibur(client, 307, {
      tanggalMulai: tanggalBulanJauh(20),
      tanggalSelesai: tanggalBulanJauh(20),
    });
    assert.equal(tidakOverlap.kuotaHarianPenuh, false);
  });
});

test("kuotaHarianPenuh: ikut ter-return untuk STAF yang mengajukan (tidak di-strip berdasarkan role)", async () => {
  await withRollback(async (client) => {
    const fitri = await createPengajuanLibur(client, 305, {
      tanggalMulai: tanggalBulanJauh(10),
      tanggalSelesai: tanggalBulanJauh(10),
    });
    await decidePengajuanLibur(client, Number(fitri.id), "disetujui", 304);
    await createPengajuanLibur(client, 306, { tanggalMulai: tanggalBulanJauh(10), tanggalSelesai: tanggalBulanJauh(10) });

    // Naura membaca daftarnya sendiri (self-scoped) -- field tetap ada.
    const hasilNaura = await listPengajuanLibur(client, fakeUser({ id: 306, role: "staf" }), {});
    assert.equal(hasilNaura.length, 1);
    assert.equal(hasilNaura[0].kuotaHarianPenuh, true);
  });
});

test("kuotaHarianPenuh: cuti di LOKASI LAIN tidak ikut dihitung (kuota harian per lokasi, bukan global)", async () => {
  await withRollback(async (client) => {
    // Pindahkan Naura (306) ke lokasi 1 SEMENTARA -- ikut ter-rollback di akhir
    // transaksi test. Tidak membuat user baru, cuma menggeser baris
    // core_user_lokasi milik user existing supaya `resolveUserLokasiId`
    // memulangkan lokasi 1 untuknya (bukan 2 seperti data nyata).
    await client.query(`DELETE FROM core_user_lokasi WHERE user_id = 306 AND location_id = 2`);
    await client.query(`INSERT INTO core_user_lokasi (user_id, location_id) VALUES (306, 1)`);

    // Fitri (tetap lokasi 2) punya cuti disetujui di tanggal yang sama.
    const fitri = await createPengajuanLibur(client, 305, {
      tanggalMulai: tanggalBulanJauh(10),
      tanggalSelesai: tanggalBulanJauh(11),
    });
    await decidePengajuanLibur(client, Number(fitri.id), "disetujui", 304);

    const naura = await createPengajuanLibur(client, 306, {
      tanggalMulai: tanggalBulanJauh(10),
      tanggalSelesai: tanggalBulanJauh(11),
    });
    assert.equal(naura.kuotaHarianPenuh, false, "cuti Fitri ada di lokasi 2, Naura sekarang lokasi 1");
  });
});

test("kuotaHarianPenuh: selalu false untuk user tanpa lokasi tetap (owner/manajer_ops, allLocations)", async () => {
  await withRollback(async (client) => {
    const fitri = await createPengajuanLibur(client, 305, {
      tanggalMulai: tanggalBulanJauh(10),
      tanggalSelesai: tanggalBulanJauh(10),
    });
    await decidePengajuanLibur(client, Number(fitri.id), "disetujui", 304);

    // Ibnu (304) tidak punya baris core_user_lokasi -> kuota harian lokasi tidak relevan.
    const ibnu = await createPengajuanLibur(client, 304, {
      tanggalMulai: tanggalBulanJauh(10),
      tanggalSelesai: tanggalBulanJauh(10),
    });
    assert.equal(ibnu.kuotaHarianPenuh, false);
  });
});

// --- overridePengajuanLibur ------------------------------------------------

test("overridePengajuanLibur: level 0 (tidak ada aturan dilanggar) tetap sukses, langsung status 'disetujui' + dibuat_via_override", async () => {
  await withRollback(async (client) => {
    const hasil = await overridePengajuanLibur(client, 304, {
      userId: 305,
      tanggalMulai: tanggalBulanJauh(20),
      tanggalSelesai: tanggalBulanJauh(20),
      alasan: "Dibuatkan manajer karena staf tidak punya akses",
    });
    assert.equal(hasil.level, 0);
    assert.deepEqual(hasil.aturanDilanggar, []);

    const { rows } = await client.query<{
      status: string;
      dibuat_via_override: boolean;
      diputuskan_oleh: string;
      pengganti_nama: string | null;
    }>(
      `SELECT status, dibuat_via_override, diputuskan_oleh, pengganti_nama FROM hr_pengajuan_libur WHERE id = $1`,
      [hasil.id],
    );
    assert.equal(rows[0].status, "disetujui", "override membuat DAN menyetujui dalam satu langkah");
    assert.equal(rows[0].dibuat_via_override, true);
    assert.equal(rows[0].diputuskan_oleh, "304");
    assert.equal(rows[0].pengganti_nama, null, "pengganti tidak wajib kalau kuota harian lokasi tidak penuh");
  });
});

test("overridePengajuanLibur: level 1 -- H-2 ditembus (cuti untuk hari ini), TANPA penggantiNama tetap boleh", async () => {
  await withRollback(async (client) => {
    const hasil = await overridePengajuanLibur(client, 304, {
      userId: 305,
      tanggalMulai: hariIniUtc(),
      tanggalSelesai: hariIniUtc(),
      alasan: "Sakit mendadak",
    });
    assert.deepEqual(hasil.aturanDilanggar, ["h2_minimum"]);
    assert.equal(hasil.level, 1);

    const { rows } = await client.query<{ status: string; dibuat_via_override: boolean }>(
      `SELECT status, dibuat_via_override FROM hr_pengajuan_libur WHERE id = $1`,
      [hasil.id],
    );
    assert.equal(rows[0].status, "disetujui");
    assert.equal(rows[0].dibuat_via_override, true);

    const { rows: auditRows } = await client.query<{ new_value: string; user_id: string }>(
      `SELECT new_value, user_id FROM core_audit_log
       WHERE table_name = 'hr_pengajuan_libur' AND record_id = $1 AND field_name = 'created_via_override'`,
      [hasil.id],
    );
    assert.equal(auditRows.length, 1, "override tercatat di audit log");
    assert.equal(auditRows[0].user_id, "304", "yang tercatat adalah pelaku override, bukan staf pemilik cuti");
    const dicatat = JSON.parse(auditRows[0].new_value);
    assert.equal(dicatat.level, 1);
    assert.deepEqual(dicatat.aturanDilanggar, ["h2_minimum"]);
    assert.equal(dicatat.userId, 305);
  });
});

test("overridePengajuanLibur: level 2 -- H-2 + kuota bulanan staf ditembus (kuota harian lokasi aman), tetap boleh tanpa penggantiNama", async () => {
  await withRollback(async (client) => {
    // Bulan ini sudah ada 3 hari cuti DISETUJUI milik Fitri, di rentang
    // tanggal yang tidak menyentuh hari ini (jadi tidak ikut memicu kuota
    // harian lokasi saat override untuk hari ini dibuat).
    const lain = rentangLainBulanIni();
    await sisipkanCutiDisetujui(client, 305, lain.mulai, lain.selesai);

    const hasil = await overridePengajuanLibur(client, 304, {
      userId: 305,
      tanggalMulai: hariIniUtc(),
      tanggalSelesai: hariIniUtc(),
    });
    assert.deepEqual(hasil.aturanDilanggar, ["h2_minimum", "kuota_bulanan_staf"]);
    assert.equal(hasil.level, 2);

    const { rows } = await client.query<{ status: string; pengganti_nama: string | null }>(
      `SELECT status, pengganti_nama FROM hr_pengajuan_libur WHERE id = $1`,
      [hasil.id],
    );
    assert.equal(rows[0].status, "disetujui");
    assert.equal(rows[0].pengganti_nama, null);
  });
});

test("overridePengajuanLibur: kuota harian lokasi penuh TANPA penggantiNama -> ditolak; DENGAN penggantiNama -> sukses", async () => {
  await withRollback(async (client) => {
    // Naura (lokasi 2) sudah punya cuti DISETUJUI di tanggal itu.
    const naura = await createPengajuanLibur(client, 306, {
      tanggalMulai: tanggalBulanJauh(10),
      tanggalSelesai: tanggalBulanJauh(11),
    });
    await decidePengajuanLibur(client, Number(naura.id), "disetujui", 304);

    const input = {
      userId: 305,
      tanggalMulai: tanggalBulanJauh(11),
      tanggalSelesai: tanggalBulanJauh(11),
      alasan: "Keluarga sakit",
    };

    await assert.rejects(
      () => overridePengajuanLibur(client, 304, input),
      /nama pengganti wajib diisi/i,
    );
    await assert.rejects(
      () => overridePengajuanLibur(client, 304, { ...input, penggantiNama: "   " }),
      /nama pengganti wajib diisi/i,
      "spasi saja tidak dianggap terisi",
    );

    const { rows: belum } = await client.query(`SELECT 1 FROM hr_pengajuan_libur WHERE user_id = 305`);
    assert.equal(belum.length, 0, "ditolak sebelum insert");

    const hasil = await overridePengajuanLibur(client, 304, { ...input, penggantiNama: "Duhan" });
    assert.deepEqual(hasil.aturanDilanggar, ["kuota_harian_lokasi"]);
    assert.equal(hasil.level, 1);

    const { rows } = await client.query<{
      status: string;
      dibuat_via_override: boolean;
      pengganti_nama: string;
    }>(`SELECT status, dibuat_via_override, pengganti_nama FROM hr_pengajuan_libur WHERE id = $1`, [hasil.id]);
    assert.equal(rows[0].status, "disetujui");
    assert.equal(rows[0].dibuat_via_override, true);
    assert.equal(rows[0].pengganti_nama, "Duhan");

    const { rows: auditRows } = await client.query<{ new_value: string }>(
      `SELECT new_value FROM core_audit_log
       WHERE table_name = 'hr_pengajuan_libur' AND record_id = $1 AND field_name = 'created_via_override'`,
      [hasil.id],
    );
    assert.equal(JSON.parse(auditRows[0].new_value).penggantiNama, "Duhan");
  });
});

test("overridePengajuanLibur: tidak bisa override untuk DIRI SENDIRI (konflik kepentingan, sama seperti decidePengajuanLibur)", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () =>
        overridePengajuanLibur(client, 304, {
          userId: 304,
          tanggalMulai: tanggalBulanJauh(10),
          tanggalSelesai: tanggalBulanJauh(10),
        }),
      /diri sendiri/i,
    );

    // Owner tetap bisa meng-override untuk manajer_ops (bukan dirinya sendiri).
    const hasil = await overridePengajuanLibur(client, 1, {
      userId: 304,
      tanggalMulai: tanggalBulanJauh(10),
      tanggalSelesai: tanggalBulanJauh(10),
    });
    assert.equal(hasil.level, 0);
  });
});

test("overridePengajuanLibur: userId yang tidak ada -> error", async () => {
  await withRollback(async (client) => {
    await assert.rejects(
      () =>
        overridePengajuanLibur(client, 304, {
          userId: 999999,
          tanggalMulai: tanggalBulanJauh(10),
          tanggalSelesai: tanggalBulanJauh(10),
        }),
      /user id 999999 tidak ditemukan/i,
    );
  });
});
