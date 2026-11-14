/**
 * Klien Telegram Bot API (2026-11-14). Token bot dibaca dari env
 * `TELEGRAM_BOT_TOKEN` SAAT DIPANGGIL (runtime server), bukan disimpan di
 * kode/database -- nilainya TIDAK PERNAH dibaca/ditulis oleh siapa pun
 * yang mengerjakan modul ini selain server itu sendiri saat benar-benar
 * mengirim pesan. Kalau env ini belum diisi, fungsi di bawah TIDAK melempar
 * error (supaya tidak merusak alur lain) -- cuma mencetak instruksi setup
 * ke log server SEKALI per proses, dan mengembalikan hasil gagal.
 */

let sudahCetakInstruksiSetup = false;

function cetakInstruksiSetupSekali(): void {
  if (sudahCetakInstruksiSetup) return;
  sudahCetakInstruksiSetup = true;
  console.error(
    [
      "",
      "=====================================================================",
      "[notifikasi] TELEGRAM_BOT_TOKEN belum diatur -- notifikasi Telegram TIDAK akan terkirim.",
      "",
      "Langkah setup (dikerjakan OWNER/OPERATOR, BUKAN oleh Claude):",
      "1. Buka Telegram, cari @BotFather, kirim /newbot, ikuti instruksinya",
      "   (pilih nama + username bot, mis. @BurnasOpsBot).",
      "2. BotFather akan membalas dengan TOKEN bot (format 123456:ABC-...).",
      "3. Tambahkan baris berikut ke file .env (dev) dan .env.production (VPS),",
      "   GANTI <token-dari-botfather> dengan token sungguhan:",
      "     TELEGRAM_BOT_TOKEN=<token-dari-botfather>",
      "     TELEGRAM_WEBHOOK_SECRET=<string-acak-panjang-buat-sendiri>",
      "4. Restart container/proses api supaya env baru kebaca.",
      "5. Daftarkan webhook ke Telegram (jalankan SEKALI dari VPS lewat SSH,",
      "   supaya TELEGRAM_BOT_TOKEN tidak pernah tertulis di chat/log):",
      "     source .env.production",
      '     curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \\',
      '       -d "url=https://burnas-app.duckdns.org/api/telegram/webhook" \\',
      '       -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"',
      "6. Cek hasilnya: curl -s \"https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo\"",
      "=====================================================================",
      "",
    ].join("\n"),
  );
}

function getBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    cetakInstruksiSetupSekali();
    return null;
  }
  return token;
}

export interface TelegramInlineButton {
  text: string;
  /** Tombol callback (butuh token aksi) -- HARUS <=64 byte (batas Telegram). */
  callbackData?: string;
  /** Tombol URL biasa (buka di app) -- tidak butuh callback/token sama sekali. */
  url?: string;
}

export type TelegramInlineKeyboard = TelegramInlineButton[][];

export interface TelegramSendResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

async function callTelegramApi(method: string, body: Record<string, unknown>): Promise<TelegramSendResult> {
  const token = getBotToken();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN belum diatur" };

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; description?: string; result?: { message_id?: number } };
    if (!json.ok) {
      return { ok: false, error: json.description ?? `Telegram API ${method} gagal (HTTP ${res.status})` };
    }
    return { ok: true, messageId: json.result?.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal memanggil Telegram API" };
  }
}

function toReplyMarkup(keyboard: TelegramInlineKeyboard | undefined): Record<string, unknown> | undefined {
  if (!keyboard || keyboard.length === 0) return undefined;
  return {
    inline_keyboard: keyboard.map((row) =>
      row.map((btn) => ({
        text: btn.text,
        ...(btn.callbackData ? { callback_data: btn.callbackData } : {}),
        ...(btn.url ? { url: btn.url } : {}),
      })),
    ),
  };
}

export async function telegramSendMessage(
  chatId: string,
  text: string,
  keyboard?: TelegramInlineKeyboard,
): Promise<TelegramSendResult> {
  return callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: toReplyMarkup(keyboard),
  });
}

export async function telegramEditMessage(
  chatId: string,
  messageId: number,
  text: string,
  keyboard?: TelegramInlineKeyboard,
): Promise<TelegramSendResult> {
  return callTelegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: toReplyMarkup(keyboard) ?? { inline_keyboard: [] },
  });
}

export async function telegramAnswerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await callTelegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

/** Dipakai webhook verifikasi header `X-Telegram-Bot-Api-Secret-Token` -- TIDAK PERNAH dibaca/dicatat nilainya di log. */
export function getWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET ?? null;
}
