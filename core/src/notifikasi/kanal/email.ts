/**
 * Kanal email -- ANTARMUKA SAJA, implementasi SMTP DITUNDA (instruksi
 * eksplisit owner, 2026-11-14). Dipanggil `notify.ts` persis sama seperti
 * kanal Telegram (lewat `KirimKanal`), supaya saat SMTP benar-benar
 * diimplementasikan nanti, caller-nya TIDAK perlu berubah sama sekali --
 * cukup ganti isi fungsi ini.
 */
export interface HasilKirimEmail {
  ok: boolean;
  error?: string;
}

/** Selalu `ok: false` dengan pesan jelas -- caller (`notify.ts`) mencatat status 'ditunda' di log, BUKAN 'gagal' (beda makna: ini "belum diimplementasikan", bukan "dicoba lalu gagal"). */
export async function emailSendMessage(_to: string, _subject: string, _body: string): Promise<HasilKirimEmail> {
  return { ok: false, error: "Kanal email belum diimplementasikan (SMTP ditunda, lihat core/src/notifikasi/kanal/email.ts)" };
}
