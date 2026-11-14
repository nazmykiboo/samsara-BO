import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import type { Role } from "../auth/types.js";

const UMUR_TOKEN_AKSI_JAM = 72;

/** Token OPAQUE acak (CSPRNG) -- dikirim mentah di callback_data Telegram (batas 64 byte Telegram, token ini jauh di bawahnya). */
function generateToken(): string {
  return randomBytes(16).toString("base64url");
}

export interface BuatTokenAksiInput {
  notifikasiLogId: number;
  referensiTipe: string;
  referensiId: number;
  userIdTarget: number;
  roleTarget: Role;
  telegramChatId: string;
  telegramMessageId?: number;
  /** Teks alasan preset Tolak (index-nya yang dikirim lewat callback_data) -- lihat migrasi 0016. */
  alasanPresetTolak?: string[];
}

export async function buatTokenAksi(client: PoolClient, input: BuatTokenAksiInput): Promise<{ token: string }> {
  const token = generateToken();
  await client.query(
    `INSERT INTO core_notifikasi_token_aksi
      (token, notifikasi_log_id, referensi_tipe, referensi_id, user_id_target, role_target, telegram_chat_id, telegram_message_id, alasan_preset_tolak, kadaluwarsa_pada)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + interval '${UMUR_TOKEN_AKSI_JAM} hours')`,
    [
      token,
      input.notifikasiLogId,
      input.referensiTipe,
      input.referensiId,
      input.userIdTarget,
      input.roleTarget,
      input.telegramChatId,
      input.telegramMessageId ?? null,
      input.alasanPresetTolak ?? null,
    ],
  );
  return { token };
}

/** Isi telegram_message_id SETELAH pesan terkirim (butuh messageId dari respons Telegram, token dibuat sebelum tahu itu). */
export async function setTelegramMessageIdTokenAksi(client: PoolClient, token: string, messageId: number): Promise<void> {
  await client.query(`UPDATE core_notifikasi_token_aksi SET telegram_message_id = $1 WHERE token = $2`, [messageId, token]);
}

export interface TokenAksiRow {
  id: number;
  notifikasiLogId: number;
  referensiTipe: string;
  referensiId: number;
  userIdTarget: number;
  roleTarget: Role;
  telegramChatId: string;
  telegramMessageId: number | null;
  alasanPresetTolak: string[] | null;
  dipakaiPada: string | null;
  kadaluwarsaPada: string;
}

export async function cariTokenAksi(client: PoolClient, token: string): Promise<TokenAksiRow | null> {
  const { rows } = await client.query<{
    id: string;
    notifikasi_log_id: string;
    referensi_tipe: string;
    referensi_id: string;
    user_id_target: string;
    role_target: Role;
    telegram_chat_id: string;
    telegram_message_id: string | null;
    alasan_preset_tolak: string[] | null;
    dipakai_pada: string | null;
    kadaluwarsa_pada: string;
  }>(
    `SELECT id, notifikasi_log_id, referensi_tipe, referensi_id, user_id_target, role_target,
            telegram_chat_id, telegram_message_id, alasan_preset_tolak, dipakai_pada, kadaluwarsa_pada
     FROM core_notifikasi_token_aksi WHERE token = $1`,
    [token],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    notifikasiLogId: Number(r.notifikasi_log_id),
    referensiTipe: r.referensi_tipe,
    referensiId: Number(r.referensi_id),
    userIdTarget: Number(r.user_id_target),
    roleTarget: r.role_target,
    telegramChatId: r.telegram_chat_id,
    telegramMessageId: r.telegram_message_id === null ? null : Number(r.telegram_message_id),
    alasanPresetTolak: r.alasan_preset_tolak,
    dipakaiPada: r.dipakai_pada,
    kadaluwarsaPada: r.kadaluwarsa_pada,
  };
}

/**
 * Tandai token DIPAKAI -- `WHERE dipakai_pada IS NULL` membuat ini ATOMIC
 * & IDEMPOTEN: kalau sudah dipakai sebelumnya (callback dobel/retry
 * Telegram), `rowCount` 0 dan caller TIDAK BOLEH menjalankan aksi lagi.
 */
export async function pakaiTokenAksi(client: PoolClient, token: string, aksiDipakai: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE core_notifikasi_token_aksi SET dipakai_pada = now(), aksi_dipakai = $1
     WHERE token = $2 AND dipakai_pada IS NULL AND kadaluwarsa_pada > now()`,
    [aksiDipakai, token],
  );
  return (rowCount ?? 0) > 0;
}
