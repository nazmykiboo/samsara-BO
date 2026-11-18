import "./env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { pool, buildRegistry, buildServer, hashPassword, buatTokenAksi, cariTokenAksi } from "@samsara/core";
import { modules } from "./modules.js";

/**
 * Tes webhook Telegram -- 2 dari 3 skenario wajib instruksi owner ("pengirim
 * tidak berwenang ditolak", "tombol tidak bisa dipakai dua kali"). Skenario
 * ketiga ("eskalasi tidak terkirim dobel") diuji di
 * `core/src/notifikasi/notify.test.ts` (level `notifyEvent`, lebih langsung).
 *
 * `TELEGRAM_WEBHOOK_SECRET` di-set manual di sini KHUSUS untuk tes -- ini
 * BUKAN `TELEGRAM_BOT_TOKEN` (yang dilarang dibaca/ditulis Claude), murni
 * secret verifikasi header webhook sendiri. `TELEGRAM_BOT_TOKEN` SENGAJA
 * TIDAK diisi -- aksi "terima"/"tolak" di tes ini tidak pernah benar-benar
 * memanggil Telegram API (tidak relevan buat tes otorisasi/idempotensi),
 * `telegramEditMessage`/`telegramAnswerCallbackQuery` cukup gagal diam-diam
 * (lihat `core/src/notifikasi/telegram.ts`).
 */
process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret-notifikasi";

let server: Server;
let baseUrl: string;
const testUserIds: number[] = [];
const testLogIds: number[] = [];

async function createTelegramUser(chatId: string, role: string = "owner"): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows: roleRows } = await client.query<{ id: number }>(`SELECT id FROM core_roles WHERE name = $1`, [role]);
    const passwordHash = await hashPassword("rahasia123");
    const username = `test_telegram_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO core_users (username, name, password_hash, role_id, telegram_chat_id)
       VALUES ($1, $1, $2, $3, $4) RETURNING id`,
      [username, passwordHash, roleRows[0].id, chatId],
    );
    const userId = Number(rows[0].id);
    testUserIds.push(userId);
    return userId;
  } finally {
    client.release();
  }
}

const testPermintaanIds: number[] = [];

/** Fixture minimal permintaan transfer -- lokasi kitchen/outlet dan item APA PUN yang sudah ada di dev DB (tidak hardcode id tertentu). */
async function createPermintaanFixture(): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows: ck } = await client.query<{ id: number }>(
      `SELECT id FROM core_locations WHERE tipe = 'kitchen' AND is_active = true LIMIT 1`,
    );
    const { rows: outlet } = await client.query<{ id: number }>(
      `SELECT id FROM core_locations WHERE tipe = 'outlet' AND is_active = true LIMIT 1`,
    );
    const { rows: item } = await client.query<{ id: number }>(`SELECT id FROM inventory_items LIMIT 1`);
    const kode = `PT-TEST-${Date.now()}`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO inventory_permintaan_transfer
        (kode, location_asal_id, location_tujuan_id, item_id, qty_diminta, status, tanggal_diminta, kelompok_id)
       VALUES ($1, $2, $3, $4, 1, 'diminta', CURRENT_DATE, 0) RETURNING id`,
      [kode, ck[0].id, outlet[0].id, item[0].id],
    );
    const id = Number(rows[0].id);
    await client.query(`UPDATE inventory_permintaan_transfer SET kelompok_id = $1 WHERE id = $1`, [id]);
    testPermintaanIds.push(id);
    return id;
  } finally {
    client.release();
  }
}

async function getStatusDanDiakui(id: number): Promise<{ status: string; diakuiPada: string | null }> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ status: string; diakui_pada: string | null }>(
      `SELECT status, diakui_pada FROM inventory_permintaan_transfer WHERE id = $1`,
      [id],
    );
    return { status: rows[0].status, diakuiPada: rows[0].diakui_pada };
  } finally {
    client.release();
  }
}

async function insertLogRow(userId: number, kejadian: string = "opname_menunggu_persetujuan"): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO core_notifikasi_log (kejadian, user_id, kanal, dedup_key, status, judul, pesan)
       VALUES ($1, $2, 'telegram', $3, 'terkirim', 'Judul uji', 'Pesan uji')
       RETURNING id`,
      [kejadian, userId, `test-webhook-dedup-${Date.now()}-${Math.random()}`],
    );
    const logId = Number(rows[0].id);
    testLogIds.push(logId);
    return logId;
  } finally {
    client.release();
  }
}

async function countAuditAksiNotifikasi(referensiId: number): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM core_audit_log WHERE table_name = 'test_entity' AND record_id = $1 AND field_name = 'aksi_notifikasi'`,
      [referensiId],
    );
    return Number(rows[0].n);
  } finally {
    client.release();
  }
}

async function postWebhook(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret-notifikasi" },
    body: JSON.stringify(body),
  });
}

before(async () => {
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
    for (const userId of testUserIds) {
      await client.query(`DELETE FROM core_audit_log WHERE user_id = $1`, [userId]);
    }
    await client.query(`DELETE FROM core_notifikasi_token_aksi WHERE notifikasi_log_id = ANY($1)`, [testLogIds]);
    await client.query(`DELETE FROM core_notifikasi_log WHERE id = ANY($1)`, [testLogIds]);
    await client.query(`DELETE FROM inventory_permintaan_transfer WHERE id = ANY($1)`, [testPermintaanIds]);
    for (const userId of testUserIds) {
      await client.query(`DELETE FROM core_users WHERE id = $1`, [userId]);
    }
  } finally {
    client.release();
  }
  await pool.end();
});

test("webhook: pengirim yang chat-id-nya BEDA dari target token ditolak -- token TETAP belum terpakai", async () => {
  const userId = await createTelegramUser("chat-sah-1");
  const logId = await insertLogRow(userId);
  const client = await pool.connect();
  const { token } = await buatTokenAksi(client, {
    notifikasiLogId: logId,
    referensiTipe: "test_entity",
    referensiId: 111,
    userIdTarget: userId,
    roleTarget: "owner",
    telegramChatId: "chat-sah-1",
  });
  client.release();

  const res = await postWebhook({
    callback_query: { id: "cb-unauthorized", data: `${token}|terima`, message: { chat: { id: "chat-PENYUSUP" }, message_id: 1 } },
  });
  assert.equal(res.status, 200, "webhook selalu balas 200 ke Telegram (penolakan dikirim lewat answerCallbackQuery, bukan status HTTP)");

  const verifyClient = await pool.connect();
  const tokenRow = await cariTokenAksi(verifyClient, token);
  verifyClient.release();
  assert.ok(tokenRow, "baris token harus tetap ada");
  assert.equal(tokenRow!.dipakaiPada, null, "token TIDAK BOLEH ternoda 'dipakai' oleh pengirim yang tidak berwenang");
});

test("webhook: tombol yang sama ditekan DUA KALI -- aksi cuma benar-benar dijalankan SEKALI (idempoten)", async () => {
  const userId = await createTelegramUser("chat-sah-2");
  const logId = await insertLogRow(userId);
  const client = await pool.connect();
  const { token } = await buatTokenAksi(client, {
    notifikasiLogId: logId,
    referensiTipe: "test_entity",
    referensiId: 222,
    userIdTarget: userId,
    roleTarget: "owner",
    telegramChatId: "chat-sah-2",
  });
  client.release();

  const callback = {
    callback_query: { id: "cb-pertama", data: `${token}|terima`, message: { chat: { id: "chat-sah-2" }, message_id: 2 } },
  };
  const res1 = await postWebhook(callback);
  assert.equal(res1.status, 200);
  assert.equal(await countAuditAksiNotifikasi(222), 1, "tekanan PERTAMA harus menghasilkan tepat 1 baris audit log");

  // Tekan lagi dengan callback_query id BEDA (simulasi Telegram retry/klik
  // ganda) tapi TOKEN SAMA -- harus ditolak idempoten, TIDAK menambah baris
  // audit log kedua.
  const res2 = await postWebhook({
    callback_query: { id: "cb-kedua", data: `${token}|terima`, message: { chat: { id: "chat-sah-2" }, message_id: 2 } },
  });
  assert.equal(res2.status, 200);
  assert.equal(await countAuditAksiNotifikasi(222), 1, "tekanan KEDUA TIDAK BOLEH menambah baris audit log -- token sudah dipakai");

  const verifyClient = await pool.connect();
  const tokenRow = await cariTokenAksi(verifyClient, token);
  verifyClient.release();
  assert.ok(tokenRow!.dipakaiPada !== null, "token harus tercatat sudah dipakai setelah tekanan pertama");
});

test("webhook: tombol Terima oleh OWNER untuk permintaan_transfer benar-benar mengakui (diakui_pada terisi), status TETAP 'diminta'", async () => {
  const userId = await createTelegramUser("chat-owner-1", "owner");
  const logId = await insertLogRow(userId, "permintaan_baru_ck");
  const permintaanId = await createPermintaanFixture();
  const client = await pool.connect();
  const { token } = await buatTokenAksi(client, {
    notifikasiLogId: logId,
    referensiTipe: "permintaan_transfer",
    referensiId: permintaanId,
    userIdTarget: userId,
    roleTarget: "owner",
    telegramChatId: "chat-owner-1",
  });
  client.release();

  const res = await postWebhook({
    callback_query: { id: "cb-terima-owner", data: `${token}|terima`, message: { chat: { id: "chat-owner-1" }, message_id: 3 } },
  });
  assert.equal(res.status, 200);

  const after = await getStatusDanDiakui(permintaanId);
  assert.equal(after.status, "diminta", "status TIDAK BOLEH berubah -- Terima bukan pemenuhan, qty belum ditentukan dari Telegram");
  assert.ok(after.diakuiPada !== null, "diakui_pada HARUS terisi -- inilah perbaikan untuk keluhan 'Terima tidak berfungsi ke app'");
});

test("webhook: tombol Terima oleh role SELAIN owner (supervisor) TETAP cuma acknowledgment generik -- diakui_pada TIDAK terisi", async () => {
  const userId = await createTelegramUser("chat-supervisor-1", "supervisor");
  const logId = await insertLogRow(userId, "permintaan_baru_ck");
  const permintaanId = await createPermintaanFixture();
  const client = await pool.connect();
  const { token } = await buatTokenAksi(client, {
    notifikasiLogId: logId,
    referensiTipe: "permintaan_transfer",
    referensiId: permintaanId,
    userIdTarget: userId,
    roleTarget: "supervisor",
    telegramChatId: "chat-supervisor-1",
  });
  client.release();

  const res = await postWebhook({
    callback_query: { id: "cb-terima-supervisor", data: `${token}|terima`, message: { chat: { id: "chat-supervisor-1" }, message_id: 4 } },
  });
  assert.equal(res.status, 200);

  const after = await getStatusDanDiakui(permintaanId);
  assert.equal(after.status, "diminta");
  assert.equal(after.diakuiPada, null, "role selain owner TIDAK memicu aksi nyata -- tetap perilaku lama (acknowledgment generik)");
});
