import "./env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { Router } from "express";
import {
  pool,
  buildRegistry,
  buildServer,
  hashPassword,
  hashPin,
  type LoadedModule,
} from "@samsara/core";
import { modules } from "./modules.js";

let server: Server;
let baseUrl: string;

// Fixture user yang dibuat langsung lewat SQL (bukan lewat endpoint create
// user) supaya test tidak bergantung pada urutan/hasil test lain, dan
// dibersihkan lagi di `after()` -- test ini COMMIT sungguhan ke database
// dev (server HTTP mengurus transaksinya sendiri per-request, beda dari
// pola withRollback di modules/inventory/src/domain/*.test.ts), jadi
// pembersihan wajib eksplisit.
const testUserIds: number[] = [];
let ckLocationId: number;
let outletLocationId: number;

async function createTestUser(username: string, password: string, role: string, locationIds: number[] = []) {
  const client = await pool.connect();
  try {
    const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = $1`, [
      role,
    ]);
    const passwordHash = await hashPassword(password);
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO core_users (username, name, password_hash, role_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [username, passwordHash, roleRows[0].id],
    );
    const userId = rows[0].id;
    testUserIds.push(userId);
    for (const locationId of locationIds) {
      await client.query(`INSERT INTO core_user_lokasi (user_id, location_id) VALUES ($1, $2)`, [
        userId,
        locationId,
      ]);
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

/** Fixture staf lewat SQL langsung (role staf login PIN, bukan password -- lihat core/src/auth/users.ts). */
async function createTestStafUser(name: string, pin: string, locationIds: number[] = []): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = 'staf'`);
    const pinHash = await hashPin(pin);
    const username = `teststaf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

/** Helper: buat owner fixture + login, dipakai banyak test di bawah yang butuh token owner untuk POST /api/auth/users. */
async function getOwnerToken(usernameSuffix: string): Promise<string> {
  await createTestUser(`test_owner_${usernameSuffix}`, "rahasia123", "owner");
  return login(`test_owner_${usernameSuffix}`, "rahasia123");
}

async function createUserViaApi(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: { id?: number; username?: string; generatedPin?: string; error?: string } }> {
  const res = await fetch(`${baseUrl}/api/auth/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { id?: number; username?: string; generatedPin?: string; error?: string };
  if (json.id) testUserIds.push(json.id);
  return { status: res.status, body: json };
}

before(async () => {
  const client = await pool.connect();
  try {
    // SENGAJA TIDAK hardcode entitas "samsara_outlet" -- nama/entitas outlet
    // dev bisa berubah kapan saja lewat fitur Outlet & Kitchen (sudah pernah
    // terjadi, lihat docs/architecture-decisions.md §29). ckLocationId tetap
    // dicari spesifik entitas 'samsara_ck' (stabil, lokasi Central Kitchen
    // tidak pernah di-rename entitasnya); outletLocationId diambil sebagai
    // "lokasi aktif mana pun selain itu".
    const { rows: ckRows } = await client.query<{ id: number }>(
      `SELECT id FROM core_locations WHERE entitas = 'samsara_ck'`,
    );
    const { rows: outletRows } = await client.query<{ id: number }>(
      `SELECT id FROM core_locations WHERE entitas != 'samsara_ck' AND is_active = true ORDER BY id LIMIT 1`,
    );
    if (!ckRows[0] || !outletRows[0]) {
      throw new Error("Fixture lokasi (samsara_ck + minimal 1 outlet aktif) tidak lengkap di database dev");
    }
    ckLocationId = ckRows[0].id;
    outletLocationId = outletRows[0].id;
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
      await client.query(`DELETE FROM core_login_attempts WHERE user_id = $1`, [id]);
      await client.query(`DELETE FROM core_user_lokasi WHERE user_id = $1`, [id]);
      await client.query(`DELETE FROM core_users WHERE id = $1`, [id]);
    }
  } finally {
    client.release();
  }
  await pool.end();
});

test("staf tidak bisa membuka stok lokasi lain (cuma lokasi sendiri)", async () => {
  const userId = await createTestStafUser("Test Staf Stok", "111222", [ckLocationId]);
  const token = await loginPin(userId, "111222");

  const ownLocation = await fetch(`${baseUrl}/api/inventory/stok?item=BB-001&location=${ckLocationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(ownLocation.status, 200, "staf boleh lihat stok lokasi sendiri");

  const otherLocation = await fetch(`${baseUrl}/api/inventory/stok?item=BB-001&location=${outletLocationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(otherLocation.status, 403, "staf DITOLAK lihat stok lokasi lain");

  testUserIds.includes(userId); // no-op, hanya supaya linter tidak komplain unused
});

test("staf tidak menerima field harga/HPP/margin di response", async () => {
  const stafId = await createTestStafUser("Test Staf Harga", "222333", [ckLocationId]);
  const token = await loginPin(stafId, "222333");

  const itemRes = await fetch(`${baseUrl}/api/inventory/items/SJ-003/hpp`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(itemRes.status, 200);
  const itemBody = (await itemRes.json()) as Record<string, unknown>;
  assert.equal("cost_per_recipe_unit" in itemBody, false, "field biaya tidak boleh ada di response staf");
  assert.equal(itemBody.kode, "SJ-003");

  const menuRes = await fetch(`${baseUrl}/api/inventory/menu/M-001/hpp`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(menuRes.status, 200);
  const menuBody = (await menuRes.json()) as Record<string, unknown>;
  assert.equal("hpp_per_porsi" in menuBody, false);
  assert.equal("food_cost_pct" in menuBody, false);
  assert.equal("margin" in menuBody, false);
  assert.equal("harga_jual" in menuBody, true, "harga_jual TETAP tampil untuk staf");

  // Kontrol positif: owner tetap menerima field harga.
  await createTestUser("test_owner_harga", "rahasia123", "owner");
  const ownerToken = await login("test_owner_harga", "rahasia123");
  const ownerMenuRes = await fetch(`${baseUrl}/api/inventory/menu/M-001/hpp`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  const ownerMenuBody = (await ownerMenuRes.json()) as Record<string, unknown>;
  assert.equal("hpp_per_porsi" in ownerMenuBody, true, "owner tetap menerima field HPP");
});

test("manajer_ops tidak bisa ubah harga jual (owner saja)", async () => {
  await createTestUser("test_manajer_hj", "rahasia123", "manajer_ops");
  const manajerToken = await login("test_manajer_hj", "rahasia123");

  const forbidden = await fetch(`${baseUrl}/api/inventory/menu/M-048/harga-jual`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${manajerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ hargaJual: 12000 }),
  });
  assert.equal(forbidden.status, 403, "manajer_ops ditolak ubah harga jual");

  // Kontrol positif: owner boleh, lalu dikembalikan ke NULL supaya data seed tidak berubah permanen.
  await createTestUser("test_owner_hj", "rahasia123", "owner");
  const ownerToken = await login("test_owner_hj", "rahasia123");
  const allowed = await fetch(`${baseUrl}/api/inventory/menu/M-048/harga-jual`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ hargaJual: 12000 }),
  });
  assert.equal(allowed.status, 200, "owner boleh ubah harga jual");

  const client = await pool.connect();
  try {
    await client.query(`UPDATE inventory_menu SET harga_jual = NULL WHERE kode = 'M-048'`);
    // setMenuHargaJual otomatis menulis ke core_audit_log -- ini murni efek
    // test (bukan perubahan sungguhan), jadi dibersihkan juga.
    await client.query(
      `DELETE FROM core_audit_log WHERE table_name = 'inventory_menu' AND field_name = 'harga_jual'
       AND record_id = (SELECT id FROM inventory_menu WHERE kode = 'M-048')`,
    );
  } finally {
    client.release();
  }
});

test("manajer_ops tidak bisa ubah visibilitas menu per channel (menu_visibilitas.edit = owner saja), dan toggle-nya tidak menyentuh harga", async () => {
  await createTestUser("test_manajer_vis", "rahasia123", "manajer_ops");
  const manajerToken = await login("test_manajer_vis", "rahasia123");

  const url = `${baseUrl}/api/inventory/menu/M-048/channel/GoFood/visibilitas`;

  // manajer_ops BOLEH POST /menu (master_menu.edit) tapi DITOLAK di sini --
  // permission visibilitas sengaja lebih sempit (owner saja), bukan numpang
  // master_menu.edit/harga_jual.edit.
  const forbidden = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${manajerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ aktif: false }),
  });
  assert.equal(forbidden.status, 403, "manajer_ops ditolak ubah visibilitas channel");

  // Kontrol positif: owner boleh. Harga jual menu yang sama dicatat sebelum
  // & sesudah untuk membuktikan endpoint visibilitas tidak menyentuh harga.
  await createTestUser("test_owner_vis", "rahasia123", "owner");
  const ownerToken = await login("test_owner_vis", "rahasia123");

  async function hargaGoFood(): Promise<string | null> {
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ harga_jual: string }>(
        `SELECT harga_jual FROM inventory_menu_harga_channel WHERE kode_menu = 'M-048' AND channel = 'GoFood'`,
      );
      return rows[0]?.harga_jual ?? null;
    } finally {
      client.release();
    }
  }

  const hargaSebelum = await hargaGoFood();
  try {
    const allowed = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ aktif: false }),
    });
    assert.equal(allowed.status, 200, "owner boleh ubah visibilitas channel");
    assert.deepEqual(await allowed.json(), { kode: "M-048", channel: "GoFood", aktif: false });

    assert.equal(await hargaGoFood(), hargaSebelum, "harga jual per channel TIDAK berubah karena toggle visibilitas");

    // Terbaca kembali di GET /menu/:kode/hpp sebagai channels[].isVisible.
    const hppRes = await fetch(`${baseUrl}/api/inventory/menu/M-048/hpp`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const hppBody = (await hppRes.json()) as { channels: Array<{ channel: string; isVisible: boolean }> };
    assert.equal(hppBody.channels.find((c) => c.channel === "GoFood")?.isVisible, false);
    assert.equal(
      hppBody.channels.find((c) => c.channel === "Offline")?.isVisible,
      true,
      "channel lain tetap tayang (tidak ada baris = tayang)",
    );

    // Body non-boolean ditolak 400, bukan diterima sebagai truthy.
    const badBody = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ aktif: "ya" }),
    });
    assert.equal(badBody.status, 400);
  } finally {
    // Test ini COMMIT sungguhan -- bersihkan baris visibilitas + jejak audit
    // log-nya supaya data dev kembali seperti semula (pola sama dengan test
    // harga jual M-048 di atas).
    const client = await pool.connect();
    try {
      await client.query(
        `DELETE FROM core_audit_log WHERE table_name = 'inventory_menu_channel_visibilitas'
         AND record_id IN (SELECT id FROM inventory_menu_channel_visibilitas WHERE kode_menu = 'M-048')`,
      );
      await client.query(`DELETE FROM inventory_menu_channel_visibilitas WHERE kode_menu = 'M-048'`);
    } finally {
      client.release();
    }
  }
});

test("modul nonaktif tetap tidak mengganggu server & auth (404, bukan 401/500)", async () => {
  const fakeDisabled: LoadedModule = {
    manifest: {
      name: "fake-disabled",
      version: "0.0.1",
      description: "",
      enabled: false,
      dependsOn: [],
      tablePrefix: "fakedisabled_",
      tables: [],
      api: { basePath: "/api/fake-disabled", endpoints: [] },
      migrationsDir: "/tmp/does-not-matter",
    },
    createRouter: () => Router().get("/ping", (_req, res) => res.json({ ok: true })),
    migrationsPath: "/tmp/does-not-matter",
  };

  const allModules = [...modules, fakeDisabled];
  const ordered = buildRegistry(allModules);
  const enabled = ordered.filter((m) => m.manifest.enabled);
  const app = buildServer(ordered, enabled);
  const testServer = app.listen(0);
  await new Promise<void>((resolve) => testServer.once("listening", resolve));
  const address = testServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const testBaseUrl = `http://127.0.0.1:${port}`;

  try {
    await createTestUser("test_owner_modonoff", "rahasia123", "owner");
    const token = await login("test_owner_modonoff", "rahasia123");

    const health = await fetch(`${testBaseUrl}/health`);
    const healthBody = (await health.json()) as { modules: Array<{ name: string; enabled: boolean }> };
    const fakeInHealth = healthBody.modules.find((m) => m.name === "fake-disabled");
    assert.equal(fakeInHealth?.enabled, false, "modul nonaktif tetap tercatat di /health");

    const pingDisabled = await fetch(`${testBaseUrl}/api/fake-disabled/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(pingDisabled.status, 404, "modul nonaktif tidak ter-mount sama sekali (404, bukan diblokir auth)");

    const inventoryStatus = await fetch(`${testBaseUrl}/api/inventory/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(inventoryStatus.status, 200, "modul lain (inventory) tetap jalan normal");
  } finally {
    testServer.close();
  }
});

test("staf tidak bisa menyetujui/menolak opname (owner/manajer_ops saja)", async () => {
  await createTestUser("test_owner_opname", "rahasia123", "owner");
  const ownerToken = await login("test_owner_opname", "rahasia123");
  const stafId = await createTestStafUser("Test Staf Opname", "333444", [ckLocationId]);
  const stafToken = await loginPin(stafId, "333444");

  // Staf input hitungan draft dulu (ini boleh -- semua role boleh input).
  const inputRes = await fetch(`${baseUrl}/api/inventory/transaksi/opname`, {
    method: "POST",
    headers: { Authorization: `Bearer ${stafToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      locationId: ckLocationId,
      tanggal: "2026-09-29",
      baris: [{ itemKode: "BB-001", qtyFisik: 999999 }],
    }),
  });
  assert.equal(inputRes.status, 201, "staf boleh input hitungan opname (draft)");
  const opname = (await inputRes.json()) as { headerId: number };

  try {
    const stafApprove = await fetch(`${baseUrl}/api/inventory/transaksi/opname/${opname.headerId}/keputusan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${stafToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "setuju" }),
    });
    assert.equal(stafApprove.status, 403, "staf DITOLAK menyetujui/menolak opname");

    const ownerApprove = await fetch(`${baseUrl}/api/inventory/transaksi/opname/${opname.headerId}/keputusan`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "tolak" }), // "tolak" supaya tidak mengubah stok sungguhan
    });
    assert.equal(ownerApprove.status, 200, "owner boleh memutuskan opname");
  } finally {
    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM inventory_transaksi_opname_baris WHERE header_id = $1`, [opname.headerId]);
      await client.query(`DELETE FROM inventory_transaksi_opname WHERE id = $1`, [opname.headerId]);
    } finally {
      client.release();
    }
  }
});

test("PIN duplikat di lokasi sama ditolak, PIN sama di lokasi beda diterima", async () => {
  const token = await getOwnerToken("pindup");

  const staf1 = await createUserViaApi(token, {
    name: "Test Staf Satu",
    role: "staf",
    locationIds: [ckLocationId],
    pin: "135790",
  });
  assert.equal(staf1.status, 201, "staf pertama dengan PIN itu berhasil dibuat");

  const staf2SameLocation = await createUserViaApi(token, {
    name: "Test Staf Dua",
    role: "staf",
    locationIds: [ckLocationId],
    pin: "135790",
  });
  assert.equal(staf2SameLocation.status, 400, "PIN sama di LOKASI SAMA ditolak");
  assert.match(staf2SameLocation.body.error ?? "", /pin.*sudah dipakai/i);

  const staf3OtherLocation = await createUserViaApi(token, {
    name: "Test Staf Tiga",
    role: "staf",
    locationIds: [outletLocationId],
    pin: "135790",
  });
  assert.equal(staf3OtherLocation.status, 201, "PIN sama persis tapi di LOKASI BEDA diterima");
});

test("POST /api/auth/users: PIN kosong di-generate otomatis dan dikembalikan sekali di response", async () => {
  const token = await getOwnerToken("pingen");

  const res = await createUserViaApi(token, {
    name: "Test Staf Generate",
    role: "staf",
    locationIds: [ckLocationId],
    // pin sengaja tidak diisi
  });
  assert.equal(res.status, 201);
  assert.match(res.body.generatedPin ?? "", /^\d{6}$/, "PIN 6 digit di-generate dan dikembalikan di response create");

  // PIN yang di-generate itu harus benar-benar valid untuk login.
  const loginRes = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: res.body.id, pin: res.body.generatedPin }),
  });
  assert.equal(loginRes.status, 200, "PIN yang di-generate otomatis itu bisa dipakai login sungguhan");
});

test("lockout: 5x gagal berturut-turut (gabungan password+PIN) dalam 15 menit mengunci sementara", async () => {
  const token = await getOwnerToken("lockout");
  const created = await createUserViaApi(token, {
    name: "Test Staf Lockout",
    role: "staf",
    locationIds: [ckLocationId],
    pin: "222444",
  });
  assert.equal(created.status, 201);
  const userId = created.body.id!;

  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${baseUrl}/api/auth/login-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, pin: "000000" }), // sengaja salah
    });
    assert.equal(res.status, 401, `percobaan gagal ke-${i + 1} harus 401 (PIN salah), belum terkunci`);
  }

  // Percobaan ke-6, walau PIN-nya BENAR, harus tetap ditolak karena sudah terkunci.
  const lockedRes = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, pin: "222444" }),
  });
  assert.equal(lockedRes.status, 429, "percobaan ke-6 ditolak karena terkunci, walau PIN-nya benar");
});

test("staf tidak bisa login lewat /login (password), dan role password tidak bisa lewat /login-pin", async () => {
  const token = await getOwnerToken("crossmethod");
  const staf = await createUserViaApi(token, {
    name: "Test Staf Crossmethod",
    role: "staf",
    locationIds: [ckLocationId],
    pin: "919293",
  });
  assert.equal(staf.status, 201);

  const stafViaPassword = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: staf.body.username, password: "apa-saja" }),
  });
  assert.equal(stafViaPassword.status, 401, "staf TIDAK BISA login lewat endpoint password biasa");

  const supervisorId = await createTestUser("test_supervisor_crossmethod", "rahasia123", "supervisor", [
    ckLocationId,
  ]);

  const passwordRoleViaPin = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: supervisorId, pin: "123456" }),
  });
  assert.equal(passwordRoleViaPin.status, 401, "role password (supervisor) TIDAK BISA login lewat /login-pin");
});

test("GET /api/auth/staf?lokasi= cuma tampilkan staf aktif di lokasi itu, tanpa data sensitif", async () => {
  const token = await getOwnerToken("liststaf");
  const staf = await createUserViaApi(token, {
    name: "Test Staf Daftar",
    role: "staf",
    locationIds: [outletLocationId],
    pin: "456789",
  });
  assert.equal(staf.status, 201);

  const res = await fetch(`${baseUrl}/api/auth/staf?lokasi=${outletLocationId}`);
  assert.equal(res.status, 200, "endpoint ini PUBLIK (tanpa token) -- dipakai sebelum login");
  const list = (await res.json()) as Array<Record<string, unknown>>;
  const entry = list.find((s) => s.id === staf.body.id);
  assert.ok(entry, "staf yang baru dibuat muncul di daftar lokasinya");
  assert.equal(entry!.name, "Test Staf Daftar");
  assert.equal("pin_hash" in entry!, false, "tidak boleh ada data sensitif di respons");
  assert.equal("username" in entry!, false, "tidak boleh ada username di respons (bukan data yang relevan untuk picker PIN)");

  const ckList = (await (await fetch(`${baseUrl}/api/auth/staf?lokasi=${ckLocationId}`)).json()) as Array<
    Record<string, unknown>
  >;
  assert.equal(
    ckList.some((s) => s.id === staf.body.id),
    false,
    "staf TIDAK muncul di daftar lokasi lain",
  );
});

test("PATCH /api/auth/users/:id nonaktifkan user -- user nonaktif tidak bisa login lagi", async () => {
  const token = await getOwnerToken("deactivate");
  const staf = await createUserViaApi(token, {
    name: "Test Staf Nonaktif",
    role: "staf",
    locationIds: [ckLocationId],
    pin: "135791",
  });
  assert.equal(staf.status, 201);

  const loginBefore = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: staf.body.id, pin: "135791" }),
  });
  assert.equal(loginBefore.status, 200, "sebelum dinonaktifkan, login PIN berhasil");

  const patchRes = await fetch(`${baseUrl}/api/auth/users/${staf.body.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(patchRes.status, 200);

  const loginAfter = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: staf.body.id, pin: "135791" }),
  });
  assert.equal(loginAfter.status, 401, "setelah dinonaktifkan, login PIN yang sama DITOLAK");
});

test("PATCH /api/auth/users/:id: owner tidak bisa menonaktifkan akun sendiri", async () => {
  const ownerId = await createTestUser("test_owner_selfdeactivate", "rahasia123", "owner");
  const token = await login("test_owner_selfdeactivate", "rahasia123");

  const selfDeactivate = await fetch(`${baseUrl}/api/auth/users/${ownerId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(selfDeactivate.status, 400, "owner DITOLAK menonaktifkan akun sendiri");

  // Kontrol: owner TETAP bisa menonaktifkan akun LAIN seperti biasa.
  const other = await createTestUser("test_owner_other_target", "rahasia123", "manajer_ops");
  const deactivateOther = await fetch(`${baseUrl}/api/auth/users/${other}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(deactivateOther.status, 200, "owner tetap boleh menonaktifkan user lain");

  // Kontrol: owner tetap bisa ubah field lain (name) di akunnya sendiri -- yang ditolak cuma isActive:false.
  const renameSelf = await fetch(`${baseUrl}/api/auth/users/${ownerId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Owner Baru" }),
  });
  assert.equal(renameSelf.status, 200, "owner tetap boleh ubah nama akun sendiri (cuma isActive:false yang ditolak)");
});

test("PATCH /api/auth/users/:id: nonaktifkan lalu aktifkan lagi berhasil, status konsisten di list dan login", async () => {
  const token = await getOwnerToken("reactivate");
  const targetId = await createTestUser("test_reactivate_target", "rahasia123", "manajer_ops");

  // Aktif dari awal -- login harus berhasil.
  await login("test_reactivate_target", "rahasia123");

  const deactivate = await fetch(`${baseUrl}/api/auth/users/${targetId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(deactivate.status, 200);

  type ListedUser = { id: string; isActive: boolean };
  const listAfterDeactivate = (await (
    await fetch(`${baseUrl}/api/auth/users`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as ListedUser[];
  assert.equal(
    listAfterDeactivate.find((u) => u.id === String(targetId))?.isActive,
    false,
    "status nonaktif setelah dinonaktifkan",
  );

  const loginWhileInactive = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test_reactivate_target", password: "rahasia123" }),
  });
  assert.equal(loginWhileInactive.status, 401, "login ditolak selagi nonaktif");

  const reactivate = await fetch(`${baseUrl}/api/auth/users/${targetId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: true }),
  });
  assert.equal(reactivate.status, 200, "PATCH isActive:true (arah sebaliknya) berhasil, bukan cuma satu arah");

  const listAfterReactivate = (await (
    await fetch(`${baseUrl}/api/auth/users`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as ListedUser[];
  assert.equal(
    listAfterReactivate.find((u) => u.id === String(targetId))?.isActive,
    true,
    "status aktif lagi setelah diaktifkan ulang",
  );

  const loginAfterReactivate = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test_reactivate_target", password: "rahasia123" }),
  });
  assert.equal(loginAfterReactivate.status, 200, "login berhasil lagi setelah diaktifkan ulang");
});

test("PATCH /api/auth/users/:id: tidak bisa menonaktifkan owner terakhir yang aktif (proteksi lockout total)", async () => {
  const ownerAId = await createTestUser("test_ownerA_lastowner", "rahasia123", "owner");
  const ownerBId = await createTestUser("test_ownerB_lastowner", "rahasia123", "owner");
  // Token ownerB diambil SEBELUM dinonaktifkan -- skenario: token lama masih
  // valid secara kriptografis (sistem ini belum punya revoke token, lihat
  // architecture-decisions.md §13.6/14) walau akunnya sudah nonaktif di DB.
  const ownerBToken = await login("test_ownerB_lastowner", "rahasia123");
  const ownerAToken = await login("test_ownerA_lastowner", "rahasia123");

  // Setup via SQL langsung (bukan API) supaya skenario "cuma ownerA yang
  // aktif" terkontrol -- nonaktifkan ownerB dan SEMUA owner lain (termasuk
  // seed "owner") KECUALI ownerA. Status semua owner yang disentuh di sini
  // dikembalikan lagi di `finally` di bawah, termasuk seed owner.
  let previouslyActiveOwnerIds: number[] = [];
  const setupClient = await pool.connect();
  try {
    const { rows } = await setupClient.query<{ id: number }>(
      `SELECT u.id FROM core_users u JOIN core_roles r ON r.id = u.role_id
       WHERE r.name = 'owner' AND u.is_active = true AND u.id != $1`,
      [ownerAId],
    );
    previouslyActiveOwnerIds = rows.map((r) => r.id);
    await setupClient.query(
      `UPDATE core_users SET is_active = false
       WHERE role_id = (SELECT id FROM core_roles WHERE name = 'owner') AND id != $1`,
      [ownerAId],
    );
  } finally {
    setupClient.release();
  }

  try {
    // ownerA (satu-satunya owner aktif sekarang) tetap dilindungi: diuji dulu
    // kontrol positifnya -- ownerA boleh ubah hal lain di sistem seperti biasa.
    const sanity = await fetch(`${baseUrl}/api/auth/users`, { headers: { Authorization: `Bearer ${ownerAToken}` } });
    assert.equal(sanity.status, 200);

    // Serangan: token BASI milik ownerB (sudah nonaktif) dipakai mencoba
    // menonaktifkan ownerA, satu-satunya owner yang masih aktif.
    const attack = await fetch(`${baseUrl}/api/auth/users/${ownerAId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ownerBToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(attack.status, 400, "ditolak -- ownerA satu-satunya owner aktif tersisa");
    const attackBody = (await attack.json()) as { error: string };
    assert.match(attackBody.error, /owner/i);

    const checkClient = await pool.connect();
    try {
      const { rows: checkA } = await checkClient.query<{ is_active: boolean }>(
        `SELECT is_active FROM core_users WHERE id = $1`,
        [ownerAId],
      );
      assert.equal(checkA[0].is_active, true, "ownerA tidak jadi dinonaktifkan");
    } finally {
      checkClient.release();
    }
  } finally {
    const restoreClient = await pool.connect();
    try {
      if (previouslyActiveOwnerIds.length > 0) {
        await restoreClient.query(`UPDATE core_users SET is_active = true WHERE id = ANY($1)`, [
          previouslyActiveOwnerIds,
        ]);
      }
    } finally {
      restoreClient.release();
    }
  }
});

// ---------------------------------------------------------------------------
// Tahap 2 "Kelola User": ubah role + nomor WhatsApp
// ---------------------------------------------------------------------------

async function getAuditLastValue(userId: number): Promise<{ old_value: string | null; new_value: string | null } | undefined> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ old_value: string | null; new_value: string | null }>(
      `SELECT old_value, new_value FROM core_audit_log
       WHERE table_name = 'core_users' AND record_id = $1 AND field_name = 'role'
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    return rows[0];
  } finally {
    client.release();
  }
}

test("PATCH /api/auth/users/:id: owner ubah role (sama-sama password role) -- audit log tercatat, token lama ditolak", async () => {
  const ownerToken = await getOwnerToken("ubahrole_sejajar");
  const targetId = await createTestUser("test_target_ubahrole_sejajar", "rahasia123", "manajer_ops");
  const targetTokenLama = await login("test_target_ubahrole_sejajar", "rahasia123");

  const res = await fetch(`${baseUrl}/api/auth/users/${targetId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "supervisor" }),
  });
  const body = (await res.json()) as { generatedPassword?: string; generatedPin?: string; error?: string };
  assert.equal(res.status, 200, body.error);
  assert.equal(body.generatedPassword, undefined, "sesama keluarga password TIDAK membuat kredensial baru");
  assert.equal(body.generatedPin, undefined);

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ role: string }>(
      `SELECT r.name AS role FROM core_users u JOIN core_roles r ON r.id = u.role_id WHERE u.id = $1`,
      [targetId],
    );
    assert.equal(rows[0].role, "supervisor");
  } finally {
    client.release();
  }

  const audit = await getAuditLastValue(targetId);
  assert.equal(audit?.old_value, "manajer_ops");
  assert.equal(audit?.new_value, "supervisor");

  // Password LAMA masih valid (tidak diganti), tapi TOKEN lama harus basi
  // (role ikut payload JWT).
  const loginLagi = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test_target_ubahrole_sejajar", password: "rahasia123" }),
  });
  assert.equal(loginLagi.status, 200, "password lama TETAP valid, cuma role yang berubah");

  const cekTokenLama = await fetch(`${baseUrl}/api/auth/users`, {
    headers: { Authorization: `Bearer ${targetTokenLama}` },
  });
  assert.equal(cekTokenLama.status, 401, "token lama (role basi) harus ditolak -- token_version wajib naik saat role berubah");
});

test("PATCH /api/auth/users/:id: tidak bisa mengubah role owner terakhir yang aktif ke role lain", async () => {
  const ownerAId = await createTestUser("test_ownerA_ubahrole_terakhir", "rahasia123", "owner");
  const ownerAToken = await login("test_ownerA_ubahrole_terakhir", "rahasia123");

  let previouslyActiveOwnerIds: number[] = [];
  const setupClient = await pool.connect();
  try {
    const { rows } = await setupClient.query<{ id: number }>(
      `SELECT u.id FROM core_users u JOIN core_roles r ON r.id = u.role_id
       WHERE r.name = 'owner' AND u.is_active = true AND u.id != $1`,
      [ownerAId],
    );
    previouslyActiveOwnerIds = rows.map((r) => r.id);
    await setupClient.query(
      `UPDATE core_users SET is_active = false
       WHERE role_id = (SELECT id FROM core_roles WHERE name = 'owner') AND id != $1`,
      [ownerAId],
    );
  } finally {
    setupClient.release();
  }

  try {
    const res = await fetch(`${baseUrl}/api/auth/users/${ownerAId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${ownerAToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "manajer_ops" }),
    });
    assert.equal(res.status, 400, "ditolak -- ownerA satu-satunya owner aktif tersisa");
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /owner/i);

    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ role: string }>(
        `SELECT r.name AS role FROM core_users u JOIN core_roles r ON r.id = u.role_id WHERE u.id = $1`,
        [ownerAId],
      );
      assert.equal(rows[0].role, "owner", "role ownerA TIDAK jadi berubah");
    } finally {
      client.release();
    }
  } finally {
    const restoreClient = await pool.connect();
    try {
      if (previouslyActiveOwnerIds.length > 0) {
        await restoreClient.query(`UPDATE core_users SET is_active = true WHERE id = ANY($1)`, [
          previouslyActiveOwnerIds,
        ]);
      }
    } finally {
      restoreClient.release();
    }
  }
});

test("PATCH /api/auth/users/:id: ubah role LINTAS keluarga auth (staf -> supervisor) menghasilkan password baru, PIN lama langsung tidak berlaku", async () => {
  const ownerToken = await getOwnerToken("ubahrole_lintas_ke_password");
  const stafId = await createTestStafUser("Staf Ubah Role", "135790", [outletLocationId]);
  const pinTokenLama = await loginPin(stafId, "135790");

  const res = await fetch(`${baseUrl}/api/auth/users/${stafId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "supervisor" }),
  });
  const body = (await res.json()) as { generatedPassword?: string; error?: string };
  assert.equal(res.status, 200, body.error);
  assert.ok(body.generatedPassword, "role staf->supervisor WAJIB menghasilkan password baru (tidak ada password lama)");

  // PIN lama sudah tidak relevan (role bukan staf lagi) DAN token lamanya basi.
  const cekPinLama = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: stafId, pin: "135790" }),
  });
  assert.equal(cekPinLama.status, 401, "login-pin harus ditolak -- role sudah bukan staf");

  const cekTokenLama = await fetch(`${baseUrl}/api/auth/users`, { headers: { Authorization: `Bearer ${pinTokenLama}` } });
  assert.equal(cekTokenLama.status, 401, "token PIN lama harus basi");

  // Password BARU benar-benar bisa dipakai login.
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ username: string }>(`SELECT username FROM core_users WHERE id = $1`, [
      stafId,
    ]);
    const loginBaru = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: rows[0].username, password: body.generatedPassword }),
    });
    assert.equal(loginBaru.status, 200, "password baru hasil ubah role harus benar-benar bisa dipakai login");
  } finally {
    client.release();
  }
});

test("PATCH /api/auth/users/:id: ubah role LINTAS keluarga auth (supervisor -> staf) menghasilkan PIN baru, wajib locationIds", async () => {
  const ownerToken = await getOwnerToken("ubahrole_lintas_ke_pin");
  // SENGAJA tanpa locationIds di fixture -- supervisor TIDAK WAJIB
  // core_user_lokasi saat dibuat (beda dari staf, lihat createUser), jadi
  // user ini representasi "supervisor yang belum pernah di-assign lokasi
  // apa pun". Kirim role=staf tanpa locationIds di body harus ditolak
  // (lihat `tanpaLokasi` di bawah) justru karena TIDAK ada fallback apa pun.
  const supervisorId = await createTestUser("test_supervisor_ubahrole_pin", "rahasia123", "supervisor");
  const tanpaLokasi = await fetch(`${baseUrl}/api/auth/users/${supervisorId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "staf" }),
  });
  assert.equal(tanpaLokasi.status, 400, "ditolak -- staf wajib locationIds, tidak ada yang ter-assign sebelumnya");

  const res = await fetch(`${baseUrl}/api/auth/users/${supervisorId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "staf", locationIds: [outletLocationId] }),
  });
  const body = (await res.json()) as { generatedPin?: string; error?: string };
  assert.equal(res.status, 200, body.error);
  assert.ok(body.generatedPin, "role supervisor->staf WAJIB menghasilkan PIN baru");
  assert.match(body.generatedPin!, /^\d{6}$/);

  const cekPinBaru = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: supervisorId, pin: body.generatedPin }),
  });
  assert.equal(cekPinBaru.status, 200, "PIN baru hasil ubah role harus benar-benar bisa dipakai login");
});

test("PATCH /api/auth/users/:id: nomorWhatsapp tersimpan dan muncul di GET /users", async () => {
  const ownerToken = await getOwnerToken("whatsapp");
  const targetId = await createTestUser("test_target_whatsapp", "rahasia123", "manajer_ops");

  const res = await fetch(`${baseUrl}/api/auth/users/${targetId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ nomorWhatsapp: "081234567890" }),
  });
  assert.equal(res.status, 200, await res.text());

  const list = await fetch(`${baseUrl}/api/auth/users`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const users = (await list.json()) as Array<{ id: number; nomorWhatsapp: string | null }>;
  const target = users.find((u) => u.id === targetId);
  assert.equal(target?.nomorWhatsapp, "081234567890");
});

test("POST /api/auth/users/:id/reset: staf dapat PIN baru, PIN lama langsung tidak berlaku", async () => {
  const token = await getOwnerToken("resetpin");
  const created = await createUserViaApi(token, {
    name: "Test Reset Pin",
    role: "staf",
    locationIds: [ckLocationId],
    pin: "555666",
  });
  assert.equal(created.status, 201);
  const userId = created.body.id!;

  const loginOld = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, pin: "555666" }),
  });
  assert.equal(loginOld.status, 200, "PIN lama bekerja sebelum reset");

  const resetRes = await fetch(`${baseUrl}/api/auth/users/${userId}/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(resetRes.status, 200);
  const resetBody = (await resetRes.json()) as { role: string; generatedPin?: string };
  assert.equal(resetBody.role, "staf");
  assert.match(resetBody.generatedPin ?? "", /^\d{6}$/, "PIN baru 6 digit dikembalikan sekali di response");

  const loginOldAfter = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, pin: "555666" }),
  });
  assert.equal(loginOldAfter.status, 401, "PIN LAMA tidak bisa dipakai login lagi setelah reset");

  const loginNew = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, pin: resetBody.generatedPin }),
  });
  assert.equal(loginNew.status, 200, "PIN BARU hasil reset berhasil dipakai login");
});

// ---------------------------------------------------------------------------
// Role `integrasi` (akun bot n8n) -- lihat core/src/db/migrations/0008_add_integrasi_role.sql
//
// Kriteria penerimaan dari owner: akun ini HANYA boleh 4 endpoint import CSV
// modul sales-sync, dan DITOLAK di endpoint lain APA PUN (termasuk POST
// /proses yang mengurangi stok, daftar menu Inventory, dan modul HR).
//
// User integrasi di bawah dibuat FIXTURE SENDIRI lewat `createTestUser` (SQL
// langsung), BUKAN memakai akun hasil `npm run seed:integrasi` -- test tidak
// boleh bergantung pada akun operasional yang passwordnya cuma ada di catatan
// owner.
// ---------------------------------------------------------------------------

/** Prefix semua baris fixture sales-sync di file ini -- SENGAJA beda dari `TEST-IMP-` di modules/sales-sync/src/domain/import-csv.test.ts. */
const SS_PREFIX = "TEST-PERM-";
const SS_PLATFORM = `${SS_PREFIX}PLATFORM`;
/** id raw Majoo fiktif; blok 9_8xx dipakai di sini, 9_9xx dipakai import-csv.test.ts. */
const SS_MAJOO_ID = 9_800_000_001;

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buatCsv(header: readonly string[], baris: ReadonlyArray<Record<string, string>>): string {
  const rows = baris.map((nilai) => header.map((kolom) => nilai[kolom] ?? ""));
  return [[...header], ...rows].map((r) => r.map(csvField).join(",")).join("\n") + "\n";
}

/**
 * Satu baris CSV minimal-tapi-VALID untuk masing-masing dari 4 endpoint
 * import. Header & format nilainya diambil dari fixture yang sudah terbukti
 * di modules/sales-sync/src/domain/import-csv.test.ts (bukan tebakan):
 * header yang tidak lengkap ditolak 400 sebelum menyentuh data, jadi CSV di
 * sini harus lengkap supaya 200-nya benar-benar membuktikan gate permission
 * terlewati, bukan kebetulan gagal di tempat lain.
 */
const CSV_IMPORT: Record<string, string> = {
  "/import/log-penjualan": buatCsv(
    [
      "transaction_date",
      "transaction_time",
      "platform",
      "order_id",
      "item_name",
      "menu_id",
      "quantity",
      "item_type",
      "parent_item",
      "unique_key",
      "inv_status",
    ],
    [
      {
        transaction_date: "7/22/2026",
        transaction_time: "6:16",
        platform: SS_PLATFORM,
        order_id: `${SS_PREFIX}ORDER-1`,
        item_name: "Item Uji Permission",
        menu_id: `${SS_PREFIX}EXT-1`,
        quantity: "1",
        item_type: "menu",
        parent_item: "",
        unique_key: `${SS_PREFIX}KEY-1`,
        // SENGAJA bukan 'OK': baris 'OK' yang belum terpetakan akan muncul di
        // antrian pemetaan & daftar belum-diproses data dev. 'SKIP-TEST'
        // tetap tersimpan (yang diuji di sini permission, bukan isi arsip).
        inv_status: "SKIP-TEST",
      },
    ],
  ),
  "/import/transaksi": buatCsv(
    [
      "platform",
      "platform_order_number",
      "platform_transaction_id",
      "order_time",
      "settled_time",
      "status",
      "gross_amount",
      "total_fees",
      "net_revenue",
      "currency",
      "source",
      "source_id",
      "raw_payload",
    ],
    [
      {
        platform: SS_PLATFORM,
        platform_order_number: `${SS_PREFIX}ORD-1`,
        platform_transaction_id: `${SS_PREFIX}TRX-1`,
        order_time: "2026-07-25T13:30:00+07:00",
        settled_time: "",
        status: "SETTLED",
        gross_amount: "29,600",
        total_fees: "3,000",
        net_revenue: "26,600",
        currency: "IDR",
        source: "email",
        source_id: `${SS_PREFIX}SRC-1`,
        raw_payload: `{"order":"${SS_PREFIX}ORD-1"}`,
      },
    ],
  ),
  "/import/raw-majoo": buatCsv(
    [
      "id",
      "transaction_no",
      "transaction_date",
      "payment_date",
      "order_type_name",
      "payment_method_name",
      "payment_cashier_name",
      "total_sales",
      "receivables",
      "total_discount_amount",
      "refund_amount",
      "is_paid",
      "outlet_id",
      "hasMore",
      "nextPage",
      "_empty",
      "refund_id",
      "refund_no",
      "refund_date",
      "refund_reason",
    ],
    [
      {
        id: String(SS_MAJOO_ID),
        transaction_no: `${SS_PREFIX}TRXNO-1`,
        transaction_date: "2025-12-15T15:12:22Z",
        payment_date: "2025-12-15T15:12:30Z",
        order_type_name: "Dine In",
        payment_method_name: "Cash",
        payment_cashier_name: "Kasir Uji",
        total_sales: "50000",
        receivables: "0",
        total_discount_amount: "0",
        refund_amount: "0",
        is_paid: "1",
        outlet_id: `${SS_PREFIX}OUTLET`,
      },
    ],
  ),
  "/import/biaya-platform": buatCsv(
    [
      "tanggal_closing",
      "platform",
      "kategori_biaya",
      "deskripsi",
      "transaction_type_raw",
      "amount",
      "amount_raw",
      "reference_id",
      "id_platform",
      "create_time",
      "synced_at",
    ],
    [
      {
        tanggal_closing: "2026-08-04",
        platform: SS_PLATFORM,
        kategori_biaya: "iklan",
        deskripsi: "Biaya uji permission",
        transaction_type_raw: "3",
        amount: "15000",
        amount_raw: "15000.1234",
        reference_id: `${SS_PREFIX}REF-1`,
        id_platform: `${SS_PREFIX}IDP-1`,
        create_time: "2026-08-04 10:15:00",
        synced_at: "2026-08-05T01:00:00Z",
      },
    ],
  ),
};

const PATH_IMPORT = Object.keys(CSV_IMPORT);

async function postImport(path: string, token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/sales-sync${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/csv" },
    body: CSV_IMPORT[path],
  });
}

/**
 * Endpoint import COMMIT sungguhan (beda dari domain test yang pakai
 * withRollback), jadi baris fixture-nya wajib dibersihkan eksplisit -- sama
 * alasannya dengan pembersihan user di `after()`. Termasuk antrian
 * salessync_item_mapping, yang disegarkan otomatis oleh importLogPenjualan.
 */
async function bersihkanFixtureSalesSync(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM salessync_item_mapping WHERE platform = $1`, [SS_PLATFORM]);
    await client.query(`DELETE FROM salessync_log_penjualan WHERE unique_key LIKE $1`, [`${SS_PREFIX}%`]);
    await client.query(`DELETE FROM salessync_transaksi WHERE source_id LIKE $1`, [`${SS_PREFIX}%`]);
    await client.query(`DELETE FROM salessync_raw_majoo WHERE id = $1`, [SS_MAJOO_ID]);
    await client.query(`DELETE FROM salessync_biaya_platform WHERE id_platform LIKE $1`, [`${SS_PREFIX}%`]);
  } finally {
    client.release();
  }
}

test("role integrasi: bisa login password dan BOLEH keempat endpoint import CSV sales-sync", async () => {
  await createTestUser("test_integrasi_import", "rahasia-bot-123", "integrasi");
  const token = await login("test_integrasi_import", "rahasia-bot-123");
  assert.ok(token.length > 0, "login username+password role integrasi mengembalikan token");

  try {
    for (const path of PATH_IMPORT) {
      const res = await postImport(path, token);
      assert.equal(res.status, 200, `integrasi BOLEH POST /api/sales-sync${path}`);
      const body = (await res.json()) as { dibuat: number; errors: unknown[] };
      assert.deepEqual(body.errors, [], `tidak ada baris error di ${path} (CSV fixture valid)`);
      assert.equal(body.dibuat, 1, `satu baris fixture tersimpan lewat ${path}`);
    }
  } finally {
    await bersihkanFixtureSalesSync();
  }
});

test("role integrasi: DITOLAK 403 di endpoint lain apa pun (sales-sync non-import, Inventory, HR)", async () => {
  await createTestUser("test_integrasi_tolak", "rahasia-bot-123", "integrasi");
  const token = await login("test_integrasi_tolak", "rahasia-bot-123");
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const wajibDitolak: Array<{ method: string; path: string; body?: string; catatan: string }> = [
    // --- sales-sync SELAIN import: sales_sync.manage, tanpa "integrasi" ---
    {
      method: "POST",
      path: "/api/sales-sync/proses",
      body: JSON.stringify({ tanggalMulai: "2026-01-01" }),
      catatan: "proses sinkronisasi MENGURANGI STOK -- paling penting ditolak",
    },
    { method: "GET", path: "/api/sales-sync/item-mapping", catatan: "daftar pemetaan item" },
    {
      method: "PATCH",
      // id 1 sembarang: permission dicek SEBELUM handler, jadi hasilnya 403
      // (bukan 404) walau barisnya tidak ada.
      path: "/api/sales-sync/item-mapping/1",
      body: JSON.stringify({ kodeMenu: "M-001" }),
      catatan: "ubah pemetaan item -- 403 sebelum sempat cek 404",
    },
    { method: "GET", path: "/api/sales-sync/belum-diproses", catatan: "arsip belum diproses" },

    // --- Inventory: 6 endpoint yang SEBELUMNYA tanpa gate permission ---
    { method: "GET", path: "/api/inventory/menu", catatan: "daftar menu -- contoh eksplisit dari owner" },
    { method: "GET", path: "/api/inventory/items", catatan: "daftar item" },
    { method: "GET", path: "/api/inventory/resep-produksi", catatan: "daftar resep produksi" },
    { method: "GET", path: "/api/inventory/items/SJ-003/hpp", catatan: "HPP item" },
    { method: "GET", path: "/api/inventory/menu/M-001/hpp", catatan: "HPP menu" },
    { method: "GET", path: "/api/inventory/menu/M-001/rekomendasi-harga", catatan: "rekomendasi harga menu" },

    // --- Inventory: endpoint yang memang sudah di-gate sejak awal ---
    {
      method: "POST",
      path: "/api/inventory/transaksi/opname/1/keputusan",
      body: JSON.stringify({ decision: "setuju" }),
      catatan: "approve opname (opname.approve) -- 403 sebelum sempat cek 404",
    },
    { method: "GET", path: "/api/inventory/stok?item=BB-001&location=1", catatan: "lihat stok" },

    // --- modul HR: tidak ada satu pun action yang memuat "integrasi" ---
    { method: "GET", path: "/api/hr/jadwal", catatan: "jadwal shift HR" },
  ];

  for (const { method, path, body, catatan } of wajibDitolak) {
    const res = await fetch(`${baseUrl}${path}`, { method, headers: auth, body });
    assert.equal(res.status, 403, `integrasi WAJIB 403 di ${method} ${path} (${catatan})`);
    const json = (await res.json()) as { error: string };
    assert.match(json.error, /integrasi/, `pesan 403 menyebut role-nya: ${method} ${path}`);
  }
});

test("regresi: owner & manajer_ops TETAP boleh keempat endpoint import setelah dipisah ke sales_sync.import", async () => {
  await createTestUser("test_owner_ssimport", "rahasia123", "owner");
  await createTestUser("test_manajer_ssimport", "rahasia123", "manajer_ops");
  const ownerToken = await login("test_owner_ssimport", "rahasia123");
  const manajerToken = await login("test_manajer_ssimport", "rahasia123");

  try {
    for (const path of PATH_IMPORT) {
      const ownerRes = await postImport(path, ownerToken);
      assert.equal(ownerRes.status, 200, `owner TETAP boleh POST /api/sales-sync${path}`);
      await ownerRes.json();

      // Baris fixture sudah ada dari panggilan owner di atas, jadi upsert-nya
      // masuk kategori 'dilewati' -- yang diuji di sini aksesnya (200, bukan
      // 403), bukan lagi kategori hasil upsert.
      const manajerRes = await postImport(path, manajerToken);
      assert.equal(manajerRes.status, 200, `manajer_ops TETAP boleh POST /api/sales-sync${path}`);
      await manajerRes.json();
    }

    // Kontrol negatif pasangannya: dua role yang sama TETAP boleh endpoint
    // sales_sync.manage juga (pemisahan action tidak mencabut apa pun dari mereka).
    for (const token of [ownerToken, manajerToken]) {
      const res = await fetch(`${baseUrl}/api/sales-sync/belum-diproses`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200, "owner/manajer_ops tetap boleh endpoint sales_sync.manage");
    }
  } finally {
    await bersihkanFixtureSalesSync();
  }
});

test("regresi: supervisor & staf TETAP boleh 6 endpoint Inventory yang baru di-gate (master_item.lihat/master_menu.lihat/resep_produksi.lihat)", async () => {
  await createTestUser("test_supervisor_lihat", "rahasia123", "supervisor", [ckLocationId]);
  const supervisorToken = await login("test_supervisor_lihat", "rahasia123");
  const stafId = await createTestStafUser("Test Staf Lihat Master", "444555", [ckLocationId]);
  const stafToken = await loginPin(stafId, "444555");

  const endpoints = [
    "/api/inventory/items",
    "/api/inventory/items/SJ-003/hpp",
    "/api/inventory/menu",
    "/api/inventory/menu/M-001/hpp",
    "/api/inventory/menu/M-001/rekomendasi-harga",
    "/api/inventory/resep-produksi",
  ];

  for (const [role, token] of [
    ["supervisor", supervisorToken],
    ["staf", stafToken],
  ] as const) {
    for (const path of endpoints) {
      const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(res.status, 200, `${role} TETAP boleh GET ${path} (tidak ada regresi dari gate baru)`);
    }
  }
});

test("POST /api/auth/users/:id/reset: manajer_ops/supervisor dapat password baru, password lama langsung tidak berlaku", async () => {
  const token = await getOwnerToken("resetpw");
  const targetId = await createTestUser("test_resetpw_target", "password-lama-123", "manajer_ops");

  await login("test_resetpw_target", "password-lama-123");

  const resetRes = await fetch(`${baseUrl}/api/auth/users/${targetId}/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(resetRes.status, 200);
  const resetBody = (await resetRes.json()) as { role: string; generatedPassword?: string };
  assert.equal(resetBody.role, "manajer_ops");
  assert.ok(
    resetBody.generatedPassword && resetBody.generatedPassword.length >= 8,
    "password baru dikembalikan sekali di response",
  );

  const loginOldAfter = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test_resetpw_target", password: "password-lama-123" }),
  });
  assert.equal(loginOldAfter.status, 401, "password LAMA tidak bisa dipakai login lagi setelah reset");

  const loginNew = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test_resetpw_target", password: resetBody.generatedPassword }),
  });
  assert.equal(loginNew.status, 200, "password BARU hasil reset berhasil dipakai login");
});

// ---------------------------------------------------------------------------
// Revoke token (`core_users.token_version`) -- lihat
// core/src/db/migrations/0009_add_token_version_to_users.sql
//
// Sebelum mekanisme ini ada, token yang sudah terbit tetap sah sampai TTL 12
// jam habis walau akunnya dinonaktifkan atau kredensialnya di-reset. Sekarang
// `requireAuth` membandingkan `tokenVersion` di payload JWT ke kolom
// `token_version` di database pada SETIAP request.
//
// Pesannya SENGAJA dibedakan dari "Token tidak valid atau kedaluwarsa"
// (signature gagal / lewat TTL) -- jadi test di bawah mengecek string-nya
// PERSIS, bukan cuma status 401-nya.
// ---------------------------------------------------------------------------

const PESAN_SESI_BERAKHIR = "Sesi berakhir, silakan login ulang";

/** Endpoint sembarang yang boleh diakses keempat role manusia (lihat modules/inventory/module.json § master_menu.lihat). */
const ENDPOINT_UJI = "/api/inventory/menu";

async function cekEndpoint(token: string, path = ENDPOINT_UJI): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

/** Assert token masih hidup (200 di endpoint biasa). */
async function assertTokenHidup(token: string, catatan: string): Promise<void> {
  const res = await cekEndpoint(token);
  assert.equal(res.status, 200, catatan);
  await res.json();
}

/** Assert token sudah dibasikan -- 401 DENGAN pesan revoke yang spesifik, bukan pesan generik. */
async function assertTokenBasi(token: string, catatan: string): Promise<void> {
  const res = await cekEndpoint(token);
  assert.equal(res.status, 401, catatan);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, PESAN_SESI_BERAKHIR, `pesan 401 harus spesifik "sesi berakhir": ${catatan}`);
}

test("revoke token: token user yang baru dinonaktifkan LANGSUNG ditolak 401 (tidak menunggu TTL 12 jam)", async () => {
  const ownerToken = await getOwnerToken("revokedeact");
  const targetId = await createTestUser("test_revoke_deact", "rahasia123", "manajer_ops");
  const tokenA = await login("test_revoke_deact", "rahasia123");

  await assertTokenHidup(tokenA, "token A bekerja normal sebelum user dinonaktifkan");

  const patch = await fetch(`${baseUrl}/api/auth/users/${targetId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(patch.status, 200);

  await assertTokenBasi(tokenA, "token A DITOLAK begitu usernya dinonaktifkan");
});

test("revoke token: token lama ditolak setelah reset password, token hasil login ulang bekerja normal", async () => {
  const ownerToken = await getOwnerToken("revokeresetpw");
  const targetId = await createTestUser("test_revoke_resetpw", "password-lama-123", "supervisor", [ckLocationId]);
  const tokenA = await login("test_revoke_resetpw", "password-lama-123");

  await assertTokenHidup(tokenA, "token A bekerja normal sebelum reset");

  const resetRes = await fetch(`${baseUrl}/api/auth/users/${targetId}/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(resetRes.status, 200);
  const { generatedPassword } = (await resetRes.json()) as { generatedPassword?: string };
  assert.ok(generatedPassword, "password baru dikembalikan sekali di response reset");

  await assertTokenBasi(tokenA, "token A DITOLAK setelah password user di-reset");

  const tokenB = await login("test_revoke_resetpw", generatedPassword!);
  await assertTokenHidup(tokenB, "token B (login pakai password BARU) bekerja normal");
});

test("revoke token: token lama staf ditolak setelah reset PIN, PIN baru dipakai login ulang normal", async () => {
  const ownerToken = await getOwnerToken("revokeresetpin");
  const stafId = await createTestStafUser("Test Revoke Reset Pin", "616263", [ckLocationId]);
  const tokenA = await loginPin(stafId, "616263");

  await assertTokenHidup(tokenA, "token A staf bekerja normal sebelum reset PIN");

  const resetRes = await fetch(`${baseUrl}/api/auth/users/${stafId}/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(resetRes.status, 200);
  const { generatedPin } = (await resetRes.json()) as { generatedPin?: string };
  assert.match(generatedPin ?? "", /^\d{6}$/);

  await assertTokenBasi(tokenA, "token A staf DITOLAK setelah PIN di-reset");

  const tokenB = await loginPin(stafId, generatedPin!);
  await assertTokenHidup(tokenB, "token B (login pakai PIN BARU) bekerja normal");
});

test("revoke token: counter per-USER -- deactivate/reset satu user tidak mengganggu token user LAIN", async () => {
  const ownerToken = await getOwnerToken("revokeisolasi");

  const korbanId = await createTestUser("test_revoke_korban", "rahasia123", "supervisor", [ckLocationId]);
  const penontonId = await createTestUser("test_revoke_penonton", "rahasia123", "supervisor", [ckLocationId]);
  const tokenKorban = await login("test_revoke_korban", "rahasia123");
  const tokenPenonton = await login("test_revoke_penonton", "rahasia123");

  // Reset kredensial korban -- cuma token_version KORBAN yang naik.
  const resetRes = await fetch(`${baseUrl}/api/auth/users/${korbanId}/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(resetRes.status, 200);

  await assertTokenBasi(tokenKorban, "token korban dibasikan oleh reset-nya sendiri");
  await assertTokenHidup(tokenPenonton, "token user LAIN TIDAK terganggu (bukan counter global)");

  // Lalu nonaktifkan korban -- penonton tetap tidak terganggu.
  const patch = await fetch(`${baseUrl}/api/auth/users/${korbanId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(patch.status, 200);

  await assertTokenHidup(tokenPenonton, "token user LAIN tetap hidup setelah korban dinonaktifkan juga");
  assert.ok(penontonId, "penonton memang user terpisah dari korban");
});

test("revoke token: token lama ditolak setelah locationIds user diubah, login ulang membawa lokasi BARU", async () => {
  const ownerToken = await getOwnerToken("revokelokasi");
  const targetId = await createTestUser("test_revoke_lokasi", "rahasia123", "supervisor", [ckLocationId]);

  const loginA = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test_revoke_lokasi", password: "rahasia123" }),
  });
  assert.equal(loginA.status, 200);
  const bodyA = (await loginA.json()) as { token: string; user: { locationIds: number[] } };
  // `Number(...)`: `ckLocationId` dibaca dari `core_locations.id` (BIGINT ->
  // STRING lewat driver pg, pola yang sama dicatat di auth/types.ts), sedangkan
  // `locationIds` di payload token sudah dinormalkan ke number oleh
  // `getUserLocationIds` -- tanpa cast, deepEqual-nya membandingkan '1' vs 1.
  assert.deepEqual(bodyA.user.locationIds, [Number(ckLocationId)], "token A membawa locationIds LAMA");

  await assertTokenHidup(bodyA.token, "token A bekerja normal sebelum locationIds diubah");

  const patch = await fetch(`${baseUrl}/api/auth/users/${targetId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ locationIds: [outletLocationId] }),
  });
  assert.equal(patch.status, 200);

  await assertTokenBasi(bodyA.token, "token A DITOLAK karena masih mengklaim locationIds LAMA");

  const loginB = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test_revoke_lokasi", password: "rahasia123" }),
  });
  assert.equal(loginB.status, 200, "login ulang berhasil (locationIds bukan kredensial)");
  const bodyB = (await loginB.json()) as { token: string; user: { locationIds: number[] } };
  assert.deepEqual(bodyB.user.locationIds, [Number(outletLocationId)], "token B membawa locationIds BARU");
  await assertTokenHidup(bodyB.token, "token B bekerja normal");
});

test("revoke token: akun integrasi tetap login & pakai keempat endpoint import seperti biasa (tidak ada regresi)", async () => {
  await createTestUser("test_revoke_integrasi", "rahasia-bot-123", "integrasi");
  const token = await login("test_revoke_integrasi", "rahasia-bot-123");
  assert.ok(token.length > 0, "login role integrasi tetap mengembalikan token");

  try {
    for (const path of PATH_IMPORT) {
      const res = await postImport(path, token);
      assert.equal(res.status, 200, `integrasi TETAP boleh POST /api/sales-sync${path} setelah requireAuth query DB`);
      await res.json();
    }
  } finally {
    await bersihkanFixtureSalesSync();
  }
});

test("revoke token: kontrol positif -- token BARU semua role (4 role manusia + integrasi) langsung dipakai normal", async () => {
  // Jalur NORMAL (token_version MATCH) harus tetap lolos untuk setiap role,
  // bukan cuma jalur mismatch yang dites di atas.
  await createTestUser("test_tv_owner", "rahasia123", "owner");
  await createTestUser("test_tv_manajer", "rahasia123", "manajer_ops");
  await createTestUser("test_tv_supervisor", "rahasia123", "supervisor", [ckLocationId]);
  const stafId = await createTestStafUser("Test TV Staf", "717273", [ckLocationId]);

  for (const [role, username] of [
    ["owner", "test_tv_owner"],
    ["manajer_ops", "test_tv_manajer"],
    ["supervisor", "test_tv_supervisor"],
  ] as const) {
    const token = await login(username, "rahasia123");
    await assertTokenHidup(token, `token baru role ${role} langsung bisa dipakai (token_version match)`);
  }

  const stafToken = await loginPin(stafId, "717273");
  await assertTokenHidup(stafToken, "token baru role staf (login PIN) langsung bisa dipakai");

  // `integrasi` ditolak 403 di ENDPOINT_UJI (whitelist permission), jadi
  // kontrol positifnya lewat salah satu endpoint import yang memang haknya.
  await createTestUser("test_tv_integrasi", "rahasia-bot-123", "integrasi");
  const integrasiToken = await login("test_tv_integrasi", "rahasia-bot-123");
  try {
    const res = await postImport(PATH_IMPORT[0], integrasiToken);
    assert.equal(res.status, 200, "token baru role integrasi langsung bisa dipakai di endpoint import");
    await res.json();
  } finally {
    await bersihkanFixtureSalesSync();
  }
});
