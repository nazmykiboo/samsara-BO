import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@samsara/core";
import { createShiftTemplate, listShiftTemplate, updateShiftTemplate } from "./shift-template.js";
import { withRollback } from "./test-helpers.js";

after(() => pool.end());

test("listShiftTemplate: seed Pagi/Siang dari migrasi 0002 ada", async () => {
  await withRollback(async (client) => {
    const rows = await listShiftTemplate(client);
    const kodes = rows.map((r) => r.kode);
    assert.ok(kodes.includes("PAGI"));
    assert.ok(kodes.includes("SIANG"));
    const pagi = rows.find((r) => r.kode === "PAGI")!;
    assert.equal(pagi.jamMulai, "06:00:00");
    assert.equal(pagi.jamSelesai, "14:00:00");
    assert.equal(pagi.aktif, true);
  });
});

test("createShiftTemplate: template baru langsung muncul di listShiftTemplate (regresi: pola list-setelah-create yang sudah berulang kali jadi bug di sesi-sesi sebelumnya)", async () => {
  await withRollback(async (client) => {
    await createShiftTemplate(client, { kode: "MALAM", nama: "Malam", jamMulai: "21:00", jamSelesai: "23:59" }, 1);
    const rows = await listShiftTemplate(client);
    const malam = rows.find((r) => r.kode === "MALAM");
    assert.ok(malam, "template baru harus langsung muncul");
    assert.equal(malam?.aktif, true);
  });
});

test("updateShiftTemplate: nonaktifkan lalu aktifkan lagi (field aktif dua arah), tercatat audit log", async () => {
  await withRollback(async (client) => {
    const { id } = await createShiftTemplate(client, { kode: "SORE", nama: "Sore", jamMulai: "16:00", jamSelesai: "22:00" });

    await updateShiftTemplate(client, Number(id), { aktif: false }, 1);
    let rows = await listShiftTemplate(client);
    assert.equal(rows.find((r) => r.id === id)?.aktif, false, "nonaktif tapi TETAP muncul di list (bukan hilang)");

    await updateShiftTemplate(client, Number(id), { aktif: true }, 1);
    rows = await listShiftTemplate(client);
    assert.equal(rows.find((r) => r.id === id)?.aktif, true);

    const { rows: auditRows } = await client.query<{ field_name: string }>(
      `SELECT field_name FROM core_audit_log WHERE table_name = 'hr_shift_template' AND record_id = $1`,
      [id],
    );
    assert.ok(auditRows.some((r) => r.field_name === "aktif"));
  });
});

test("updateShiftTemplate: ubah jam, ditolak kalau id tidak ada", async () => {
  await withRollback(async (client) => {
    await assert.rejects(() => updateShiftTemplate(client, 999999, { nama: "Tidak ada" }), /tidak ditemukan/i);
  });
});
