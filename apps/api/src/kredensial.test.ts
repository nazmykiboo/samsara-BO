import "./env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { pool, buildRegistry, buildServer, hashPassword, hashPin } from "@samsara/core";
import { modules } from "./modules.js";

/**
 * Keamanan kredensial (2026-10-30): reset manual/otomatis oleh owner, flag
 * `wajib_ganti_kredensial`, endpoint self-service `POST /api/auth/ganti-kredensial`,
 * rate-limit percobaan gagal, dan pencabutan aturan "PIN unik per lokasi".
 * Server HTTP sungguhan sendiri (pola sama `auth.test.ts`), port acak.
 */

let server: Server;
let baseUrl: string;
let ckLocationId: number;

const testUserIds: number[] = [];

before(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: number }>(`SELECT id FROM core_locations WHERE entitas = 'samsara_ck'`);
    if (!rows[0]) throw new Error("Fixture lokasi samsara_ck tidak ada di database dev");
    ckLocationId = rows[0].id;
  } finally {
    client.release();
  }

  const ordered = buildRegistry(modules);
  const enabled = ordered.filter((m) => m.manifest.enabled);
  const app = buildServer(ordered, enabled);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.close();
  const client = await pool.connect();
  try {
    for (const id of testUserIds) {
      await client.query(`DELETE FROM core_audit_log WHERE user_id = $1`, [id]);
      await client.query(`DELETE FROM core_login_attempts WHERE user_id = $1`, [id]);
      await client.query(`DELETE FROM core_user_lokasi WHERE user_id = $1`, [id]);
      await client.query(`DELETE FROM core_users WHERE id = $1`, [id]);
    }
  } finally {
    client.release();
  }
  await pool.end();
});

async function createTestUser(username: string, password: string, role: string, locationIds: number[] = []): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = $1`, [role]);
    const passwordHash = await hashPassword(password);
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO core_users (username, name, password_hash, role_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [username, passwordHash, roleRows[0].id],
    );
    const userId = rows[0].id;
    testUserIds.push(userId);
    for (const locationId of locationIds) {
      await client.query(`INSERT INTO core_user_lokasi (user_id, location_id) VALUES ($1, $2)`, [userId, locationId]);
    }
    return userId;
  } finally {
    client.release();
  }
}

async function createTestStafUser(name: string, pin: string, locationIds: number[] = []): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = 'staf'`);
    const pinHash = await hashPin(pin);
    const username = `testkred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO core_users (username, name, pin_hash, role_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [username, name, pinHash, roleRows[0].id],
    );
    const userId = rows[0].id;
    testUserIds.push(userId);
    for (const locationId of locationIds) {
      await client.query(`INSERT INTO core_user_lokasi (user_id, location_id) VALUES ($1, $2)`, [userId, locationId]);
    }
    return userId;
  } finally {
    client.release();
  }
}

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `login ${username} harus berhasil`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function loginPin(userId: number, pin: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, pin }),
  });
  assert.equal(res.status, 200, `login PIN user ${userId} harus berhasil`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function getOwnerToken(suffix: string): Promise<string> {
  const id = await createTestUser(`test_kred_owner_${suffix}`, "rahasia-owner-123", "owner");
  return login(`test_kred_owner_${suffix}`, "rahasia-owner-123");
}

async function resetViaApi(
  ownerToken: string,
  userId: number,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/auth/users/${userId}/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("resetCredential manual: PIN pola lemah (sama semua / berurutan) ditolak, PIN valid diterima, wajib_ganti_kredensial menyala", async () => {
  const ownerToken = await getOwnerToken("pinlemah");
  const stafId = await createTestStafUser("Test Staf Reset Manual", "919293", [ckLocationId]);

  const semuaSama = await resetViaApi(ownerToken, stafId, { pinManual: "111111" });
  assert.equal(semuaSama.status, 400, "PIN semua digit sama ditolak");
  assert.match(String(semuaSama.body.error), /mudah ditebak/i);

  const berurutan = await resetViaApi(ownerToken, stafId, { pinManual: "123456" });
  assert.equal(berurutan.status, 400, "PIN berurutan naik ditolak");

  const berurutanTurun = await resetViaApi(ownerToken, stafId, { pinManual: "654321" });
  assert.equal(berurutanTurun.status, 400, "PIN berurutan turun ditolak");

  const kurangDigit = await resetViaApi(ownerToken, stafId, { pinManual: "12345" });
  assert.equal(kurangDigit.status, 400, "PIN kurang dari 6 digit ditolak");

  const valid = await resetViaApi(ownerToken, stafId, { pinManual: "482917" });
  assert.equal(valid.status, 200, "PIN valid diterima");
  assert.equal(valid.body.generatedPin, "482917");

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ wajib_ganti_kredensial: boolean }>(
      `SELECT wajib_ganti_kredensial FROM core_users WHERE id = $1`,
      [stafId],
    );
    assert.equal(rows[0].wajib_ganti_kredensial, true, "wajib_ganti_kredensial menyala setelah reset manual");

    const { rows: auditRows } = await client.query<{ field_name: string; new_value: string }>(
      `SELECT field_name, new_value FROM core_audit_log WHERE table_name = 'core_users' AND record_id = $1 AND field_name = 'kredensial_direset' ORDER BY id DESC LIMIT 1`,
      [stafId],
    );
    assert.equal(auditRows[0].new_value, "manual", "audit log mencatat PENANDA 'manual', BUKAN nilai PIN-nya");
  } finally {
    client.release();
  }
});

test("resetCredential manual: password kurang dari 8 karakter ditolak, password valid diterima", async () => {
  const ownerToken = await getOwnerToken("pwlemah");
  const targetId = await createTestUser("test_kred_pwtarget", "password-lama-abc", "manajer_ops");

  const pendek = await resetViaApi(ownerToken, targetId, { passwordManual: "pendek1" });
  assert.equal(pendek.status, 400, "password < 8 karakter ditolak");
  assert.match(String(pendek.body.error), /minimal 8 karakter/i);

  const valid = await resetViaApi(ownerToken, targetId, { passwordManual: "password-baru-manual-123" });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.generatedPassword, "password-baru-manual-123");
});

test("resetCredential otomatis (tanpa body): tetap menyalakan wajib_ganti_kredensial, audit log penanda 'otomatis'", async () => {
  const ownerToken = await getOwnerToken("otomatis");
  const targetId = await createTestUser("test_kred_otomatis_target", "password-lama-xyz", "supervisor");

  const res = await resetViaApi(ownerToken, targetId);
  assert.equal(res.status, 200);
  assert.ok(res.body.generatedPassword, "password acak tetap dikembalikan seperti sebelumnya");

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ new_value: string }>(
      `SELECT new_value FROM core_audit_log WHERE table_name = 'core_users' AND record_id = $1 AND field_name = 'kredensial_direset' ORDER BY id DESC LIMIT 1`,
      [targetId],
    );
    assert.equal(rows[0].new_value, "otomatis");
  } finally {
    client.release();
  }
});

test("wajib_ganti_kredensial aktif: endpoint lain ditolak 403 WAJIB_GANTI_KREDENSIAL, endpoint ganti-kredensial sendiri tetap boleh", async () => {
  const ownerToken = await getOwnerToken("blokir");
  const targetId = await createTestUser("test_kred_blokir_target", "password-lama-blokir", "supervisor", [ckLocationId]);
  await resetViaApi(ownerToken, targetId, { passwordManual: "password-sementara-1" });
  const tokenSetelahReset = await login("test_kred_blokir_target", "password-sementara-1");

  const stokRes = await fetch(`${baseUrl}/api/inventory/stok?item=BB-001&location=${ckLocationId}`, {
    headers: { Authorization: `Bearer ${tokenSetelahReset}` },
  });
  assert.equal(stokRes.status, 403, "endpoint lain ditolak selama wajib_ganti_kredensial aktif");
  const stokBody = (await stokRes.json()) as { code?: string };
  assert.equal(stokBody.code, "WAJIB_GANTI_KREDENSIAL");

  // Endpoint lain di DALAM /api/auth (mis. GET /users) juga ikut ditolak --
  // bukan cuma endpoint modul bisnis.
  const usersRes = await fetch(`${baseUrl}/api/auth/users`, {
    headers: { Authorization: `Bearer ${tokenSetelahReset}` },
  });
  assert.equal(usersRes.status, 403);
  const usersBody = (await usersRes.json()) as { code?: string };
  assert.equal(usersBody.code, "WAJIB_GANTI_KREDENSIAL");

  const gantiRes = await fetch(`${baseUrl}/api/auth/ganti-kredensial`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenSetelahReset}`, "Content-Type": "application/json" },
    body: JSON.stringify({ kredensialLama: "password-sementara-1", kredensialBaru: "password-permanen-baru" }),
  });
  assert.equal(gantiRes.status, 200, "endpoint ganti-kredensial sendiri TETAP boleh diakses");
});

test("ganti-kredensial sendiri: sukses mematikan wajib_ganti_kredensial dan langsung membuka endpoint lain; kredensial lama salah ditolak & dihitung rate-limit", async () => {
  const ownerToken = await getOwnerToken("gantisendiri");
  const targetId = await createTestUser("test_kred_ganti_target", "password-lama-ganti", "supervisor", [ckLocationId]);
  await resetViaApi(ownerToken, targetId, { passwordManual: "password-sementara-2" });
  const tokenSementara = await login("test_kred_ganti_target", "password-sementara-2");

  const salah = await fetch(`${baseUrl}/api/auth/ganti-kredensial`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenSementara}`, "Content-Type": "application/json" },
    body: JSON.stringify({ kredensialLama: "password-SALAH", kredensialBaru: "password-permanen-xyz" }),
  });
  assert.equal(salah.status, 401, "kredensial lama salah ditolak 401");

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM core_login_attempts WHERE user_id = $1 AND success = false`,
      [targetId],
    );
    assert.equal(Number(rows[0].count), 1, "percobaan gagal ganti-kredensial DIHITUNG ke rate-limit");
  } finally {
    client.release();
  }

  const benar = await fetch(`${baseUrl}/api/auth/ganti-kredensial`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenSementara}`, "Content-Type": "application/json" },
    body: JSON.stringify({ kredensialLama: "password-sementara-2", kredensialBaru: "password-permanen-xyz" }),
  });
  assert.equal(benar.status, 200, "kredensial lama benar diterima");
  const benarBody = (await benar.json()) as { token: string; user: { wajibGantiKredensial: boolean } };
  assert.equal(benarBody.user.wajibGantiKredensial, false);

  // Token BARU (hasil ganti-kredensial) langsung bisa dipakai endpoint lain tanpa login ulang manual.
  const stokRes = await fetch(`${baseUrl}/api/inventory/stok?item=BB-001&location=${ckLocationId}`, {
    headers: { Authorization: `Bearer ${benarBody.token}` },
  });
  assert.equal(stokRes.status, 200, "token baru langsung bisa dipakai endpoint lain");

  // Token LAMA (sebelum ganti) sudah mati (token_version naik).
  const stokLama = await fetch(`${baseUrl}/api/inventory/stok?item=BB-001&location=${ckLocationId}`, {
    headers: { Authorization: `Bearer ${tokenSementara}` },
  });
  assert.equal(stokLama.status, 401, "token lama ditolak setelah ganti kredensial");
});

test("ganti-kredensial sendiri: 5 percobaan gagal beruntun -> percobaan ke-6 kena 429 (rate-limit sama seperti login)", async () => {
  const ownerToken = await getOwnerToken("ratelimit");
  const targetId = await createTestUser("test_kred_ratelimit_target", "password-lama-rl", "supervisor", [ckLocationId]);
  await resetViaApi(ownerToken, targetId, { passwordManual: "password-sementara-3" });
  const token = await login("test_kred_ratelimit_target", "password-sementara-3");

  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${baseUrl}/api/auth/ganti-kredensial`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kredensialLama: "salah-terus", kredensialBaru: "password-permanen-abc" }),
    });
    assert.equal(res.status, 401, `percobaan ke-${i + 1} ditolak 401 (salah)`);
  }

  const keenam = await fetch(`${baseUrl}/api/auth/ganti-kredensial`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ kredensialLama: "password-sementara-3", kredensialBaru: "password-permanen-abc" }),
  });
  assert.equal(keenam.status, 429, "percobaan ke-6 ditolak karena terkunci, walau kredensial lamanya benar");
});

test("PIN sama persis dengan rekan SATU LOKASI sekarang DITERIMA (aturan unik-per-lokasi dicabut 2026-10-30)", async () => {
  const stafA = await createTestStafUser("Test Staf PIN Sama A", "246813", [ckLocationId]);
  const stafB = await createTestStafUser("Test Staf PIN Sama B", "246813", [ckLocationId]);

  const tokenA = await loginPin(stafA, "246813");
  const tokenB = await loginPin(stafB, "246813");
  assert.ok(tokenA.length > 0);
  assert.ok(tokenB.length > 0);
});
