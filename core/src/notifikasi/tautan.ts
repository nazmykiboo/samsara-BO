import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";

const UMUR_KODE_TAUTAN_MENIT = 15;

/** Kode pendek 6 digit (mudah diketik manual di Telegram lewat `/link <kode>`), bukan token aksi (itu beda, lihat token.ts). */
function generateKodeTautan(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface MulaiTautanTelegramResult {
  kode: string;
  kadaluwarsaPada: string;
}

/** Dipanggil dari endpoint "Hubungkan Telegram" di Akun Saya -- user lihat kode ini, lalu kirim `/link <kode>` ke bot. */
export async function mulaiTautanTelegram(client: PoolClient, userId: number): Promise<MulaiTautanTelegramResult> {
  const kode = generateKodeTautan();
  const { rows } = await client.query<{ telegram_kode_tautan_kadaluwarsa: string }>(
    `UPDATE core_users
     SET telegram_kode_tautan = $1, telegram_kode_tautan_kadaluwarsa = now() + interval '${UMUR_KODE_TAUTAN_MENIT} minutes'
     WHERE id = $2
     RETURNING telegram_kode_tautan_kadaluwarsa`,
    [kode, userId],
  );
  if (!rows[0]) throw new Error(`User id ${userId} tidak ditemukan`);
  return { kode, kadaluwarsaPada: rows[0].telegram_kode_tautan_kadaluwarsa };
}

export interface VerifikasiKodeTautanResult {
  berhasil: boolean;
  username?: string;
  alasanGagal?: string;
}

/**
 * Dipanggil dari webhook Telegram saat user kirim `/link <kode>`. Cocokkan
 * kode TERLEPAS dari user mana yang mengirim (kode cukup unik+belum
 * kedaluwarsa) -- `chat_id` pengirim pesan itulah yang ditautkan.
 */
export async function verifikasiKodeTautan(
  client: PoolClient,
  kode: string,
  telegramChatId: string,
): Promise<VerifikasiKodeTautanResult> {
  const { rows } = await client.query<{ id: string; username: string }>(
    `SELECT id, username FROM core_users
     WHERE telegram_kode_tautan = $1 AND telegram_kode_tautan_kadaluwarsa > now()`,
    [kode],
  );
  const user = rows[0];
  if (!user) return { berhasil: false, alasanGagal: "Kode tidak valid atau sudah kedaluwarsa" };

  try {
    await client.query(
      `UPDATE core_users
       SET telegram_chat_id = $1, telegram_terhubung_pada = now(),
           telegram_kode_tautan = NULL, telegram_kode_tautan_kadaluwarsa = NULL
       WHERE id = $2`,
      [telegramChatId, user.id],
    );
  } catch (err) {
    // Unique index telegram_chat_id -- chat Telegram ini sudah dipakai akun lain.
    return { berhasil: false, alasanGagal: "Akun Telegram ini sudah terhubung ke user lain" };
  }
  return { berhasil: true, username: user.username };
}

/** Dipanggil dari Akun Saya untuk menampilkan status "sudah terhubung" / "belum". */
export async function statusTautanTelegram(
  client: PoolClient,
  userId: number,
): Promise<{ terhubung: boolean; terhubungPada: string | null }> {
  const { rows } = await client.query<{ telegram_chat_id: string | null; telegram_terhubung_pada: string | null }>(
    `SELECT telegram_chat_id, telegram_terhubung_pada FROM core_users WHERE id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) throw new Error(`User id ${userId} tidak ditemukan`);
  return { terhubung: r.telegram_chat_id !== null, terhubungPada: r.telegram_terhubung_pada };
}
