import { test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { notifyEvent } from "./notify.js";
import { createAturanNotifikasi } from "./aturan.js";
import type { NotifikasiEvent } from "./types.js";

/** Pola sama seperti `modules/inventory/src/domain/test-helpers.ts` -- insert/update sungguhan lewat domain layer, SELALU di-ROLLBACK, jadi tidak pernah mengubah data dev. */
async function withRollback<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

async function buatUserOwnerUjiCoba(client: PoolClient): Promise<number> {
  const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = 'owner'`);
  const username = `test_notif_owner_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO core_users (username, name, password_hash, role_id) VALUES ($1, $1, 'x', $2) RETURNING id`,
    [username, roleRows[0].id],
  );
  return Number(rows[0].id);
}

test("notifyEvent: eskalasi/kejadian berulang tidak terkirim dobel -- dedup_key+user_id mencegah baris log kedua untuk aturan+referensi yang sama", async () => {
  await withRollback(async (client) => {
    const ownerId = await buatUserOwnerUjiCoba(client);
    const { id: aturanId } = await createAturanNotifikasi(client, {
      kejadian: "stok_minus",
      penerimaRole: "owner",
      kanal: "telegram",
      aktif: true,
    });

    const event: NotifikasiEvent = {
      kejadian: "stok_minus",
      judul: "Stok minus: Item Uji",
      pesan: "Lokasi: Uji\nQty saat ini: -5",
      referensiTipe: "item",
      referensiId: 999,
      dedupKeyBase: "stok_minus:999:1:2026-11-14",
    };

    // Panggil DUA KALI -- persis simulasi scheduler yang tick berkali-kali
    // selagi kondisi stok minus masih berlangsung sebelum sempat diperbaiki.
    await notifyEvent(client, event);
    await notifyEvent(client, event);

    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM core_notifikasi_log WHERE aturan_id = $1 AND user_id = $2`,
      [aturanId, ownerId],
    );
    assert.equal(Number(rows[0].n), 1, "harus cuma SATU baris log walau notifyEvent dipanggil 2x untuk kejadian+referensi+aturan yang sama");
  });
});

test("notifyEvent: dua aturan (tier eskalasi) berbeda untuk kejadian yang sama SAMA-SAMA kirim (tidak saling dianggap duplikat)", async () => {
  await withRollback(async (client) => {
    const ownerId = await buatUserOwnerUjiCoba(client);
    const aturan1 = await createAturanNotifikasi(client, {
      kejadian: "opname_menunggu_persetujuan",
      penerimaRole: "owner",
      kanal: "telegram",
      aktif: true,
    });
    const aturan2 = await createAturanNotifikasi(client, {
      kejadian: "opname_menunggu_persetujuan",
      penerimaRole: "owner",
      kanal: "telegram",
      aktif: true,
    });

    const event: NotifikasiEvent = {
      kejadian: "opname_menunggu_persetujuan",
      judul: "Opname id 1 menunggu persetujuan",
      pesan: "Lokasi id 1 mengajukan opname.",
      referensiTipe: "opname",
      referensiId: 1,
      dedupKeyBase: "opname_menunggu_persetujuan:1",
    };
    await notifyEvent(client, event);

    const { rows } = await client.query<{ aturan_id: string }>(
      `SELECT aturan_id FROM core_notifikasi_log WHERE user_id = $1 ORDER BY aturan_id`,
      [ownerId],
    );
    assert.deepEqual(
      rows.map((r) => Number(r.aturan_id)).sort(),
      [aturan1.id, aturan2.id].sort(),
      "kedua aturan (tier eskalasi berbeda) harus SAMA-SAMA menghasilkan baris log, bukan dianggap duplikat satu sama lain",
    );
  });
});
