import "./lokasi-test-port.js"; // WAJIB baris import pertama, lihat komentar di filenya
import "./env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { pool, buildRegistry, buildServer, hashPassword, hashPin } from "@samsara/core";
import { modules } from "./modules.js";

/**
 * Test Tahap 1 "Outlet & Kitchen + Identitas Bisnis" lewat server HTTP
 * SUNGGUHAN -- pola identik `sales-sync-proses.test.ts` (lihat komentar
 * lengkap di sana soal KENAPA bukan `withRollback`): guard nonaktifkan
 * lokasi memanggil modul HR lewat HTTP sungguhan
 * (`adaJadwalKeDepanViaApi`), jadi datanya harus benar-benar COMMIT supaya
 * terlihat di sisi panggilan itu.
 *
 * Semua fixture memakai prefix `TEST-LOK-` (lokasi) supaya tidak mungkin
 * bertabrakan dengan 2 lokasi Burnas asli (Central Kitchen, Outlet 1
 * Malang) -- TIDAK PERNAH menyentuh lokasi id 1/2.
 */

const PORT = 4321;
const PREFIX = "TEST-LOK-";

let server: Server;
let baseUrl: string;
let ownerToken: string;
let ownerUserId: number;
let stafToken: string;
let stafUserId: number;
let itemIdContoh: number;

const lokasiIdBuatan: number[] = [];

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<T>(sql, params);
    return rows;
  } finally {
    client.release();
  }
}

async function buatLokasiTest(nama: string, entitas: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `INSERT INTO core_locations (name, entitas, tipe) VALUES ($1, $2, 'outlet') RETURNING id`,
    [`${PREFIX}${nama}`, entitas],
  );
  const id = Number(rows[0].id);
  lokasiIdBuatan.push(id);
  return id;
}

async function patchLokasi(
  id: number,
  body: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: { error?: string; penghalang?: string[]; id?: number } }> {
  const res = await fetch(`${baseUrl}/api/inventory/lokasi/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { error?: string; penghalang?: string[]; id?: number } };
}

async function bersihkanArtefakTest(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM inventory_stock_ledger WHERE location_id = ANY(
      SELECT id FROM core_locations WHERE name LIKE $1)`, [`${PREFIX}%`]);
    await client.query(`DELETE FROM hr_jadwal_shift WHERE lokasi_id = ANY(
      SELECT id FROM core_locations WHERE name LIKE $1)`, [`${PREFIX}%`]);
    await client.query(`DELETE FROM inventory_location_channel WHERE location_id = ANY(
      SELECT id FROM core_locations WHERE name LIKE $1)`, [`${PREFIX}%`]);
    await client.query(`DELETE FROM core_user_lokasi WHERE location_id = ANY(
      SELECT id FROM core_locations WHERE name LIKE $1)`, [`${PREFIX}%`]);
    await client.query(`DELETE FROM core_locations WHERE name LIKE $1`, [`${PREFIX}%`]);
  } finally {
    client.release();
  }
}

before(async () => {
  await bersihkanArtefakTest();

  const item = await query<{ id: string }>(`SELECT id FROM inventory_items LIMIT 1`);
  itemIdContoh = Number(item[0].id);

  const ordered = buildRegistry(modules);
  const enabled = ordered.filter((m) => m.manifest.enabled);
  const app = buildServer(ordered, enabled);
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://localhost:${PORT}`;

  const client = await pool.connect();
  try {
    const { rows: ownerRole } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = 'owner'`);
    const { rows: stafRole } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = 'staf'`);
    const passwordHash = await hashPassword("rahasia123");

    const ownerUsername = `test_lok_owner_${Date.now()}`;
    const { rows: ownerRows } = await client.query<{ id: string }>(
      `INSERT INTO core_users (username, name, password_hash, role_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [ownerUsername, passwordHash, ownerRole[0].id],
    );
    ownerUserId = Number(ownerRows[0].id);

    const pinHash = await hashPin("123456");
    const stafUsername = `test_lok_staf_${Date.now()}`;
    const { rows: stafRows } = await client.query<{ id: string }>(
      `INSERT INTO core_users (username, name, pin_hash, role_id) VALUES ($1, $1, $2, $3) RETURNING id`,
      [stafUsername, pinHash, stafRole[0].id],
    );
    stafUserId = Number(stafRows[0].id);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: ownerUsername, password: "rahasia123" }),
    });
    assert.equal(loginRes.status, 200, "login fixture owner harus berhasil");
    ownerToken = ((await loginRes.json()) as { token: string }).token;

    const loginPinRes = await fetch(`${baseUrl}/api/auth/login-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: stafUserId, pin: "123456" }),
    });
    assert.equal(loginPinRes.status, 200, "login-pin fixture staf harus berhasil");
    stafToken = ((await loginPinRes.json()) as { token: string }).token;
  } finally {
    client.release();
  }
});

after(async () => {
  try {
    await bersihkanArtefakTest();
    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM core_login_attempts WHERE user_id = ANY($1::bigint[])`, [
        [ownerUserId, stafUserId],
      ]);
      await client.query(`DELETE FROM core_user_lokasi WHERE user_id = ANY($1::bigint[])`, [
        [ownerUserId, stafUserId],
      ]);
      await client.query(`DELETE FROM core_users WHERE id = ANY($1::bigint[])`, [[ownerUserId, stafUserId]]);
    } finally {
      client.release();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------
// Guard nonaktifkan lokasi
// ---------------------------------------------------------------------------

test("PATCH /lokasi/:id nonaktifkan: ditolak 400 kalau masih ada stok tersisa, penghalang menyebut stok", async () => {
  const id = await buatLokasiTest("STOK", "test_stok");
  // `inventory_stock_ledger` adalah tabel GLOBAL yang juga di-baseline-count
  // oleh sales-sync-proses.test.ts (file test LAIN, bisa jalan BERSAMAAN --
  // `node --test` menjalankan antar-file secara paralel). Baris ini WAJIB
  // dihapus lagi SESEGERA MUNGKIN (bukan menunggu after() di akhir seluruh
  // suite file ini) supaya jendela "baris asing nyangkut di tabel global"
  // sekecil mungkin -- dikonfirmasi nyata: tanpa try/finally ini sempat
  // bikin after() sales-sync-proses.test.ts gagal "5 !== 4 baris ledger"
  // secara flaky.
  try {
    await query(`INSERT INTO inventory_stock_ledger (item_id, location_id, transaction_type, reference_table, reference_id, qty_change) VALUES ($1, $2, 'opname', 'test', 0, 10)`, [
      itemIdContoh,
      id,
    ]);

    const hasil = await patchLokasi(id, { isActive: false }, ownerToken);
    assert.equal(hasil.status, 400);
    assert.ok(hasil.body.penghalang, "response harus menyertakan array 'penghalang'");
    assert.ok(
      hasil.body.penghalang!.some((p) => /stok/i.test(p)),
      `penghalang harus menyebut stok, dapat: ${JSON.stringify(hasil.body.penghalang)}`,
    );

    const after = await query<{ is_active: boolean }>(`SELECT is_active FROM core_locations WHERE id = $1`, [id]);
    assert.equal(after[0].is_active, true, "lokasi TETAP aktif setelah ditolak");
  } finally {
    await query(`DELETE FROM inventory_stock_ledger WHERE location_id = $1`, [id]);
  }
});

test("PATCH /lokasi/:id nonaktifkan: ditolak 400 kalau ada jadwal shift ke depan, penghalang menyebut jadwal", async () => {
  const id = await buatLokasiTest("JADWAL", "test_jadwal");
  const tanggalJauh = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await query(
    `INSERT INTO hr_jadwal_shift (user_id, lokasi_id, tanggal, jam_mulai, jam_selesai) VALUES ($1, $2, $3, '08:00', '16:00')`,
    [ownerUserId, id, tanggalJauh],
  );

  const hasil = await patchLokasi(id, { isActive: false }, ownerToken);
  assert.equal(hasil.status, 400);
  assert.ok(
    hasil.body.penghalang!.some((p) => /jadwal/i.test(p)),
    `penghalang harus menyebut jadwal, dapat: ${JSON.stringify(hasil.body.penghalang)}`,
  );
});

test("PATCH /lokasi/:id nonaktifkan: TANPA penghalang -> berhasil, dan token_version staf yang hanya bertugas di lokasi itu naik", async () => {
  const id = await buatLokasiTest("BERSIH", "test_bersih");
  await query(`INSERT INTO core_user_lokasi (user_id, location_id) VALUES ($1, $2)`, [stafUserId, id]);

  const sebelum = await query<{ token_version: number }>(`SELECT token_version FROM core_users WHERE id = $1`, [
    stafUserId,
  ]);

  const hasil = await patchLokasi(id, { isActive: false }, ownerToken);
  assert.equal(hasil.status, 200, JSON.stringify(hasil.body));

  const row = await query<{ is_active: boolean }>(`SELECT is_active FROM core_locations WHERE id = $1`, [id]);
  assert.equal(row[0].is_active, false);

  const sesudah = await query<{ token_version: number }>(`SELECT token_version FROM core_users WHERE id = $1`, [
    stafUserId,
  ]);
  assert.equal(
    sesudah[0].token_version,
    sebelum[0].token_version + 1,
    "token_version staf yang HANYA bertugas di lokasi yang dinonaktifkan harus naik 1",
  );
});

test("PATCH /lokasi/:id: field detail baru (alamat, kota, jamBuka, dst) tersimpan", async () => {
  const id = await buatLokasiTest("DETAIL", "test_detail");
  const hasil = await patchLokasi(
    id,
    { alamat: "Jl. Contoh No. 1", kota: "Malang", jamBuka: "06:00", jamTutup: "21:00", penanggungJawab: "Ibnu" },
    ownerToken,
  );
  assert.equal(hasil.status, 200);

  const row = await query<{ alamat: string; kota: string; jam_buka: string; penanggung_jawab: string }>(
    `SELECT alamat, kota, jam_buka::text AS jam_buka, penanggung_jawab FROM core_locations WHERE id = $1`,
    [id],
  );
  assert.equal(row[0].alamat, "Jl. Contoh No. 1");
  assert.equal(row[0].kota, "Malang");
  assert.equal(row[0].jam_buka, "06:00:00");
  assert.equal(row[0].penanggung_jawab, "Ibnu");
});

// ---------------------------------------------------------------------------
// Salin konfigurasi channel antar lokasi
// ---------------------------------------------------------------------------

test("POST /lokasi/salin-konfigurasi: channel aktif/nonaktif tersalin REPLACE penuh ke lokasi tujuan", async () => {
  const dari = await buatLokasiTest("SALIN-DARI", "test_salin_dari");
  const ke = await buatLokasiTest("SALIN-KE", "test_salin_ke");

  const channel = await query<{ id: string }>(`SELECT id FROM inventory_sales_channel LIMIT 1`);
  const channelId = Number(channel[0].id);
  await query(`INSERT INTO inventory_location_channel (location_id, channel_id, is_active) VALUES ($1, $2, false)`, [
    dari,
    channelId,
  ]);
  // Baris "basi" di tujuan yang harus KETIMPA (REPLACE, bukan merge).
  await query(`INSERT INTO inventory_location_channel (location_id, channel_id, is_active) VALUES ($1, $2, true)`, [
    ke,
    channelId,
  ]);

  const res = await fetch(`${baseUrl}/api/inventory/lokasi/salin-konfigurasi`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dariLocationId: dari, keLocationId: ke }),
  });
  assert.equal(res.status, 200);

  const row = await query<{ is_active: boolean }>(
    `SELECT is_active FROM inventory_location_channel WHERE location_id = $1 AND channel_id = $2`,
    [ke, channelId],
  );
  assert.equal(row[0].is_active, false, "hasil salin harus PERSIS sama dengan sumber (false), bukan nilai lama (true)");
});

// ---------------------------------------------------------------------------
// Identitas bisnis
// ---------------------------------------------------------------------------

test("GET /api/core/identitas-bisnis: publik, tidak perlu Authorization", async () => {
  const res = await fetch(`${baseUrl}/api/core/identitas-bisnis`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { displayName: string; hasLogo: boolean };
  assert.ok(typeof body.displayName === "string" && body.displayName.length > 0);
  assert.equal(typeof body.hasLogo, "boolean");
});

test("PUT /api/core/identitas-bisnis: owner boleh ubah nama, role staf ditolak 403", async () => {
  const original = (await (await fetch(`${baseUrl}/api/core/identitas-bisnis`)).json()) as { displayName: string };

  // Login ulang (BUKAN pakai `stafToken` dari before()): test lain di file
  // ini menonaktifkan lokasi yang membuat token_version stafUserId naik,
  // jadi token lama sudah basi di titik ini kalau test itu jalan duluan.
  const relog = await fetch(`${baseUrl}/api/auth/login-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: stafUserId, pin: "123456" }),
  });
  assert.equal(relog.status, 200, "login-pin ulang staf harus tetap berhasil");
  const stafTokenSegar = ((await relog.json()) as { token: string }).token;

  const stafAttempt = await fetch(`${baseUrl}/api/core/identitas-bisnis`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${stafTokenSegar}`, "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Tidak Boleh" }),
  });
  assert.equal(stafAttempt.status, 403, "role staf wajib ditolak -- identitas_bisnis.manage owner saja");

  const res = await fetch(`${baseUrl}/api/core/identitas-bisnis`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: `${PREFIX}Nama Baru` }),
  });
  assert.equal(res.status, 200);

  const sesudah = (await (await fetch(`${baseUrl}/api/core/identitas-bisnis`)).json()) as { displayName: string };
  assert.equal(sesudah.displayName, `${PREFIX}Nama Baru`);

  // Kembalikan ke nilai semula -- endpoint ini SATU baris global, jangan
  // ditinggal dalam keadaan berubah buat sesi/verifikasi lain setelah test ini.
  await fetch(`${baseUrl}/api/core/identitas-bisnis`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: original.displayName }),
  });
});

test("PUT /api/core/identitas-bisnis/logo: PNG kecil tersimpan dan terbaca ulang, tipe file terlarang ditolak 400", async () => {
  // Baris identitas bisnis itu SATU baris GLOBAL (bukan fixture ber-prefix
  // yang bisa dihapus bebas) -- snapshot logo lama di sini, WAJIB
  // dikembalikan di finally supaya test ini tidak meninggalkan logo uji
  // nyangkut permanen di database dev (dibuktikan nyata: lupa restore di
  // sini pernah bikin halaman login menampilkan kotak hitam 1x1 sampai
  // ditemukan manual lewat verifikasi browser).
  const snapshot = await query<{ logo_bytes: Buffer | null; logo_content_type: string | null }>(
    `SELECT logo_bytes, logo_content_type FROM core_business_identity WHERE id = 1`,
  );
  const logoLama = snapshot[0];

  try {
    // PNG 1x1 transparan paling minimal (67 byte) -- bukan file produksi,
    // cuma untuk membuktikan pipeline simpan+baca-ulang bytea bekerja.
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const pngBytes = Buffer.from(pngBase64, "base64");

    const tolak = await fetch(`${baseUrl}/api/core/identitas-bisnis/logo`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "text/plain" },
      body: "bukan gambar",
    });
    assert.equal(tolak.status, 400, "Content-Type di luar PNG/JPG/WebP harus ditolak");

    const put = await fetch(`${baseUrl}/api/core/identitas-bisnis/logo`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "image/png" },
      body: pngBytes,
    });
    assert.equal(put.status, 200, await put.text());

    const getRes = await fetch(`${baseUrl}/api/core/identitas-bisnis/logo`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.headers.get("content-type"), "image/png");
    const kembali = Buffer.from(await getRes.arrayBuffer());
    assert.ok(kembali.equals(pngBytes), "byte logo yang terbaca ulang harus PERSIS sama dengan yang diunggah");

    const identitas = (await (await fetch(`${baseUrl}/api/core/identitas-bisnis`)).json()) as { hasLogo: boolean };
    assert.equal(identitas.hasLogo, true);
  } finally {
    await query(`UPDATE core_business_identity SET logo_bytes = $1, logo_content_type = $2 WHERE id = 1`, [
      logoLama?.logo_bytes ?? null,
      logoLama?.logo_content_type ?? null,
    ]);
  }
});

// ---------------------------------------------------------------------------
// Daftar lokasi publik
// ---------------------------------------------------------------------------

test("GET /api/core/lokasi: publik, mengembalikan array lokasi termasuk yang baru dibuat", async () => {
  const id = await buatLokasiTest("PUBLIK", "test_publik");
  const res = await fetch(`${baseUrl}/api/core/lokasi`);
  assert.equal(res.status, 200);
  // id BIGINT -> dikembalikan sebagai STRING oleh driver `pg` (konsisten
  // dengan core_users.id dkk di seluruh repo ini) -- bandingkan via Number().
  const list = (await res.json()) as Array<{ id: string; name: string }>;
  assert.ok(list.some((l) => Number(l.id) === id), "lokasi yang baru dibuat harus muncul di daftar publik");
});
