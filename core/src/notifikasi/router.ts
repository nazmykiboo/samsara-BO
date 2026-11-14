import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "../db/pool.js";
import { requireAuth, requirePermission, getAuthUser } from "../auth/permissions.js";
import { writeAuditLog } from "../auth/audit.js";
import type { Role } from "../auth/types.js";
import {
  telegramEditMessage,
  telegramSendMessage,
  telegramAnswerCallbackQuery,
  getWebhookSecret,
} from "./telegram.js";
import { mulaiTautanTelegram, statusTautanTelegram, verifikasiKodeTautan } from "./tautan.js";
import { cariTokenAksi, pakaiTokenAksi } from "./token.js";
import { jalankanAksiTolak } from "./aksi-registry.js";
import {
  createAturanNotifikasi,
  deleteAturanNotifikasi,
  listAturanNotifikasi,
  updateAturanNotifikasi,
} from "./aturan.js";

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

/**
 * Pola callback_data tombol aksi: "<token>|terima" atau "<token>|tolak|<presetIndex>".
 * Preset-nya INDEX, bukan teks (hemat batas 64 byte Telegram) -- teksnya
 * dibaca balik dari `TokenAksiRow.alasanPresetTolak` (migrasi 0016).
 */
function parseCallbackData(data: string): { token: string; aksi: "terima" | "tolak"; presetIndex?: number } | null {
  const parts = data.split("|");
  if (parts.length < 2) return null;
  const [token, aksi, presetIndexStr] = parts;
  if (!token || (aksi !== "terima" && aksi !== "tolak")) return null;
  if (aksi === "tolak") {
    const presetIndex = Number(presetIndexStr ?? "0");
    if (Number.isNaN(presetIndex)) return null;
    return { token, aksi, presetIndex };
  }
  return { token, aksi };
}

interface TelegramUpdate {
  message?: { text?: string; chat: { id: number } };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
}

/**
 * Router PUBLIK (di-mount SEBELUM `requireAuth` global, lihat build-server.ts)
 * -- satu-satunya gerbang masuk Telegram. Otorisasi di sini BUKAN lewat JWT
 * (Telegram tidak kirim itu), melainkan: (1) header secret Telegram sendiri
 * yang memverifikasi request benar dari Telegram, (2) `telegram_chat_id` +
 * role user yang DICOCOKKAN ULANG ke database (bukan dipercaya dari token
 * yang sudah mungkin basi) sebelum aksi apa pun dijalankan.
 */
export function createTelegramWebhookRouter(): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const secret = getWebhookSecret();
      if (!secret) {
        res.status(503).json({ error: "Webhook Telegram belum dikonfigurasi di server (TELEGRAM_WEBHOOK_SECRET)" });
        return;
      }
      if (req.headers["x-telegram-bot-api-secret-token"] !== secret) {
        res.status(401).json({ error: "Secret token tidak valid" });
        return;
      }

      const update = req.body as TelegramUpdate;
      const client = await pool.connect();
      try {
        if (update.message?.text) {
          await tanganiPesan(client, update.message.text, String(update.message.chat.id));
        } else if (update.callback_query) {
          await tanganiCallback(client, update.callback_query);
        }
        res.json({ ok: true });
      } finally {
        client.release();
      }
    }),
  );

  return router;
}

async function tanganiPesan(client: import("pg").PoolClient, text: string, chatId: string): Promise<void> {
  const match = text.trim().match(/^\/link\s+(\d{6})$/);
  if (!match) return;
  const hasil = await verifikasiKodeTautan(client, match[1], chatId);
  await telegramSendMessage(
    chatId,
    hasil.berhasil
      ? `✅ Akun Telegram ini berhasil ditautkan ke user "${hasil.username}". Anda akan menerima notifikasi di sini.`
      : `❌ Gagal menautkan: ${hasil.alasanGagal}`,
  );
}

async function tanganiCallback(
  client: import("pg").PoolClient,
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const parsed = callbackQuery.data ? parseCallbackData(callbackQuery.data) : null;
  if (!parsed || !callbackQuery.message) {
    await telegramAnswerCallbackQuery(callbackQuery.id, "Aksi tidak dikenali");
    return;
  }

  const tokenRow = await cariTokenAksi(client, parsed.token);
  if (!tokenRow) {
    await telegramAnswerCallbackQuery(callbackQuery.id, "Token tidak ditemukan");
    return;
  }

  const chatIdPengirim = String(callbackQuery.message.chat.id);
  if (tokenRow.telegramChatId !== chatIdPengirim) {
    await telegramAnswerCallbackQuery(callbackQuery.id, "Anda tidak berwenang untuk aksi ini");
    return;
  }

  // Cek ULANG ke database (bukan percaya snapshot role_target yang mungkin
  // sudah basi) -- user & role saat ini HARUS masih cocok dengan target.
  const { rows: userRows } = await client.query<{ id: string; username: string; role: Role }>(
    `SELECT u.id, u.username, r.name AS role FROM core_users u
     JOIN core_roles r ON r.id = u.role_id
     WHERE u.telegram_chat_id = $1 AND u.is_active = true`,
    [chatIdPengirim],
  );
  const pengirim = userRows[0];
  if (!pengirim || String(pengirim.id) !== String(tokenRow.userIdTarget) || pengirim.role !== tokenRow.roleTarget) {
    await telegramAnswerCallbackQuery(callbackQuery.id, "Anda tidak berwenang untuk aksi ini");
    return;
  }

  const berhasilPakai = await pakaiTokenAksi(client, parsed.token, parsed.aksi);
  if (!berhasilPakai) {
    await telegramAnswerCallbackQuery(callbackQuery.id, "Tombol ini sudah dipakai sebelumnya atau sudah kedaluwarsa");
    return;
  }

  let ringkasan: string;
  if (parsed.aksi === "terima") {
    // "Terima" TIDAK PERNAH menggerakkan stok (instruksi eksplisit owner) --
    // murni pengakuan sosial, TIDAK lewat aksi-registry sama sekali.
    ringkasan = `✅ Diterima oleh ${pengirim.username}`;
  } else {
    const alasanPreset = tokenRow.alasanPresetTolak?.[parsed.presetIndex ?? 0];
    const hasil = await jalankanAksiTolak(tokenRow.referensiTipe, {
      client,
      referensiId: tokenRow.referensiId,
      alasanPreset,
      userId: Number(pengirim.id),
    });
    ringkasan = `❌ ${hasil.ringkasan} (oleh ${pengirim.username})`;
  }

  await writeAuditLog(client, {
    userId: Number(pengirim.id),
    tableName: tokenRow.referensiTipe,
    recordId: tokenRow.referensiId,
    fieldName: "aksi_notifikasi",
    oldValue: null,
    newValue: parsed.aksi,
    source: "telegram",
  });

  if (tokenRow.telegramMessageId) {
    await telegramEditMessage(tokenRow.telegramChatId, tokenRow.telegramMessageId, ringkasan);
  }
  await telegramAnswerCallbackQuery(callbackQuery.id, ringkasan);
}

/**
 * Router AUTENTIKASI (di-mount SETELAH `requireAuth` global) -- self-service
 * "Hubungkan Telegram" untuk SEMUA user login, plus CRUD aturan notifikasi
 * yang khusus owner (`notifikasi.manage`).
 */
export function createNotifikasiRouter(): Router {
  const router = Router();

  router.post(
    "/telegram/tautkan",
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const client = await pool.connect();
      try {
        const hasil = await mulaiTautanTelegram(client, user.id);
        res.json(hasil);
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/telegram/status",
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const client = await pool.connect();
      try {
        res.json(await statusTautanTelegram(client, user.id));
      } finally {
        client.release();
      }
    }),
  );

  router.get(
    "/aturan",
    requirePermission("notifikasi.manage"),
    asyncHandler(async (_req, res) => {
      const client = await pool.connect();
      try {
        res.json(await listAturanNotifikasi(client));
      } finally {
        client.release();
      }
    }),
  );

  router.post(
    "/aturan",
    requirePermission("notifikasi.manage"),
    asyncHandler(async (req, res) => {
      const user = getAuthUser(req);
      const client = await pool.connect();
      try {
        const hasil = await createAturanNotifikasi(client, { ...req.body, dibuatOleh: user.id });
        res.status(201).json(hasil);
      } finally {
        client.release();
      }
    }),
  );

  router.patch(
    "/aturan/:id",
    requirePermission("notifikasi.manage"),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await updateAturanNotifikasi(client, Number(req.params.id), req.body);
        res.json({ ok: true });
      } finally {
        client.release();
      }
    }),
  );

  router.delete(
    "/aturan/:id",
    requirePermission("notifikasi.manage"),
    asyncHandler(async (req, res) => {
      const client = await pool.connect();
      try {
        await deleteAturanNotifikasi(client, Number(req.params.id));
        res.json({ ok: true });
      } finally {
        client.release();
      }
    }),
  );

  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan";
    res.status(400).json({ error: message });
  });

  return router;
}
