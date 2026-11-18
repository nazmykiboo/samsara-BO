import type { PoolClient } from "pg";
import { listAturanNotifikasi, type AturanNotifikasiRow } from "./aturan.js";
import { resolveNotifikasiPenerima } from "./penerima.js";
import { telegramSendMessage, type TelegramInlineButton, type TelegramInlineKeyboard } from "./telegram.js";
import { emailSendMessage } from "./kanal/email.js";
import { buatTokenAksi, setTelegramMessageIdTokenAksi } from "./token.js";
import { KEJADIAN_AMBANG_JAM, type NotifikasiEvent } from "./types.js";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://burnas-app.duckdns.org";

/** 1 baris = 1 tombol (instruksi owner, 2026-11-18) -- termasuk alasan preset Tolak, supaya tiap tombol gampang dibaca/ditekan di layar kecil Telegram. */
function buildKeyboard(event: NotifikasiEvent, token: string | null): TelegramInlineKeyboard {
  const rows: TelegramInlineButton[][] = [];
  if (token && event.aksi) {
    rows.push([{ text: "✅ Terima", callbackData: `${token}|terima` }]);
    const presets = event.aksi.alasanPresetTolak ?? [];
    if (presets.length > 0) {
      for (const [i, label] of presets.entries()) {
        rows.push([{ text: `❌ ${label}`, callbackData: `${token}|tolak|${i}` }]);
      }
    } else {
      rows.push([{ text: "❌ Tolak", callbackData: `${token}|tolak|0` }]);
    }
  }
  if (event.aksi?.deepLinkPath) {
    rows.push([{ text: "📱 Buka di app", url: `${APP_BASE_URL}${event.aksi.deepLinkPath}` }]);
  }
  return rows;
}

/**
 * Lokasi aturan (kalau diisi) HARUS cocok dengan lokasi kejadian -- aturan
 * global (penerimaLokasiId null) selalu cocok, aturan ber-lokasi cuma
 * cocok kalau kejadian juga terjadi di lokasi yang SAMA PERSIS.
 */
function aturanCocokLokasi(aturan: AturanNotifikasiRow, eventLokasiId: number | undefined): boolean {
  if (aturan.penerimaLokasiId === null) return true;
  return eventLokasiId !== undefined && aturan.penerimaLokasiId === eventLokasiId;
}

/** Untuk kejadian ber-ambang-jam, aturan cuma cocok kalau tier-nya SUDAH terlewati. Kejadian lain selalu cocok (tidak berambang). */
function aturanCocokAmbangJam(aturan: AturanNotifikasiRow, event: NotifikasiEvent): boolean {
  if (!KEJADIAN_AMBANG_JAM.includes(event.kejadian)) return true;
  return aturan.ambangJam !== null && event.jamSejak !== undefined && event.jamSejak >= aturan.ambangJam;
}

/**
 * Titik masuk UTAMA modul notifikasi -- dipanggil dari modul bisnis
 * (event-driven, mis. setelah createPermintaanTransfer sukses) ATAU dari
 * scheduler `apps/api` (ambang jam / kejadian berkala). Idempoten per
 * (aturan+kejadian+referensi) x penerima lewat UNIQUE(dedup_key, user_id)
 * di `core_notifikasi_log` -- lihat migrasi 0015.
 */
export async function notifyEvent(client: PoolClient, event: NotifikasiEvent): Promise<void> {
  const semuaAturan = await listAturanNotifikasi(client);
  const aturanRelevan = semuaAturan.filter(
    (a) =>
      a.aktif &&
      a.kejadian === event.kejadian &&
      aturanCocokLokasi(a, event.lokasiId) &&
      aturanCocokAmbangJam(a, event),
  );

  for (const aturan of aturanRelevan) {
    const penerimaList = await resolveNotifikasiPenerima(client, {
      penerimaRole: aturan.penerimaRole,
      penerimaUserId: aturan.penerimaUserId,
      penerimaLokasiId: aturan.penerimaLokasiId,
    });

    for (const penerima of penerimaList) {
      const dedupKey = `${event.dedupKeyBase}:${aturan.id}`;

      // Klaim slot dedup DULU (status 'ditunda' sementara) -- kalau bentrok
      // (sudah pernah terkirim ke penerima ini untuk aturan+kejadian ini),
      // lewati total, TIDAK mencoba kirim lagi. Inilah yang menjaga
      // "eskalasi tidak terkirim dobel" walau fungsi ini dipanggil
      // berkali-kali (scheduler tiap tick) untuk kejadian yang sama.
      const { rows: klaimRows } = await client.query<{ id: string }>(
        `INSERT INTO core_notifikasi_log
          (aturan_id, kejadian, user_id, kanal, referensi_tipe, referensi_id, dedup_key, status, judul, pesan)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ditunda', $8, $9)
         ON CONFLICT (dedup_key, user_id) DO NOTHING
         RETURNING id`,
        [
          aturan.id,
          event.kejadian,
          penerima.userId,
          aturan.kanal,
          event.referensiTipe ?? null,
          event.referensiId ?? null,
          dedupKey,
          event.judul,
          event.pesan,
        ],
      );
      const logId = klaimRows[0] ? Number(klaimRows[0].id) : null;
      if (logId === null) continue; // sudah pernah dikirim untuk aturan+penerima ini -- lewati.

      if (aturan.kanal === "email") {
        const hasil = await emailSendMessage(`user-${penerima.userId}`, event.judul, event.pesan);
        await client.query(`UPDATE core_notifikasi_log SET status = 'ditunda', pesan_error = $1 WHERE id = $2`, [
          hasil.error ?? null,
          logId,
        ]);
        continue;
      }

      // kanal === 'telegram'
      if (!penerima.telegramChatId) {
        await client.query(`UPDATE core_notifikasi_log SET status = 'gagal', pesan_error = $1 WHERE id = $2`, [
          "User belum menghubungkan akun Telegram (lihat Akun Saya)",
          logId,
        ]);
        continue;
      }

      let token: string | null = null;
      if (event.aksi && event.referensiTipe && event.referensiId !== undefined) {
        const hasilToken = await buatTokenAksi(client, {
          notifikasiLogId: logId,
          referensiTipe: event.referensiTipe,
          referensiId: event.referensiId,
          userIdTarget: penerima.userId,
          roleTarget: penerima.role,
          telegramChatId: penerima.telegramChatId,
          alasanPresetTolak: event.aksi.alasanPresetTolak,
        });
        token = hasilToken.token;
      }

      const teks = `<b>${event.judul}</b>\n\n${event.pesan}`;
      const hasilKirim = await telegramSendMessage(penerima.telegramChatId, teks, buildKeyboard(event, token));

      if (hasilKirim.ok) {
        if (token && hasilKirim.messageId) {
          await setTelegramMessageIdTokenAksi(client, token, hasilKirim.messageId);
        }
        await client.query(`UPDATE core_notifikasi_log SET status = 'terkirim' WHERE id = $1`, [logId]);
      } else {
        await client.query(`UPDATE core_notifikasi_log SET status = 'gagal', pesan_error = $1 WHERE id = $2`, [
          hasilKirim.error ?? "Gagal mengirim ke Telegram",
          logId,
        ]);
      }
    }
  }
}
