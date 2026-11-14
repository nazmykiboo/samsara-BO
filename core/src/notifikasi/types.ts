/**
 * Modul Notifikasi (2026-11-14) -- tipe bersama. Kejadian HARUS persis sama
 * dengan CHECK constraint `core_notifikasi_aturan.kejadian` (migrasi 0015).
 */
export const KEJADIAN_VALID = [
  "permintaan_baru_ck",
  "jawaban_ck",
  "permintaan_belum_dijawab",
  "transfer_belum_diterima",
  "sumber_data_tidak_masuk",
  "otomatis_error",
  "stok_minus",
  "opname_menunggu_persetujuan",
] as const;

export type KejadianNotifikasi = (typeof KEJADIAN_VALID)[number];

export const KANAL_VALID = ["telegram", "email"] as const;
export type KanalNotifikasi = (typeof KANAL_VALID)[number];

/** Label Bahasa Indonesia untuk tiap kejadian -- dipakai UI Pengaturan > Notifikasi, JANGAN disalin ke tempat lain (satu sumber kebenaran). */
export const LABEL_KEJADIAN: Record<KejadianNotifikasi, string> = {
  permintaan_baru_ck: "Permintaan baru ke Central Kitchen",
  jawaban_ck: "Central Kitchen menjawab permintaan",
  permintaan_belum_dijawab: "Permintaan belum dijawab (ambang jam)",
  transfer_belum_diterima: "Transfer belum diterima (ambang jam)",
  sumber_data_tidak_masuk: "Sumber data sales-sync tidak masuk (merah)",
  otomatis_error: "Error pada pemrosesan otomatis sales-sync",
  stok_minus: "Item dengan stok total minus",
  opname_menunggu_persetujuan: "Opname menunggu persetujuan",
};

/** Kejadian yang relevan dengan `ambang_jam` pada aturan (dicek scheduler berkala) -- kejadian lain event-driven. */
export const KEJADIAN_AMBANG_JAM: readonly KejadianNotifikasi[] = ["permintaan_belum_dijawab", "transfer_belum_diterima"];

export type AksiNotifikasi = "terima" | "tolak";

/** Satu baris aksi/tombol yang disiapkan utk notifikasi actionable (Telegram). "buka_app" bukan token -- cuma url button. */
export interface NotifikasiAksiSpec {
  /** Alasan preset untuk tombol Tolak -- index-nya yang dikirim lewat callback_data, BUKAN teksnya (hemat ruang 64 byte). */
  alasanPresetTolak?: string[];
  /** Path relatif di app (tanpa domain) untuk tombol "Buka di app". */
  deepLinkPath: string;
}

export interface NotifikasiEvent {
  kejadian: KejadianNotifikasi;
  judul: string;
  /** Isi pesan -- TIDAK BOLEH memuat nilai Rupiah apa pun (lihat CLAUDE.md aturan baru § notifikasi). */
  pesan: string;
  /** Lokasi tempat kejadian terjadi -- dipakai mencocokkan `penerima_lokasi_id` aturan. undefined = kejadian global (tidak terikat satu lokasi). */
  lokasiId?: number;
  referensiTipe?: string;
  referensiId?: number;
  /** Basis kunci dedup, SEBELUM digabung aturan_id+user_id oleh notifyEvent -- biasanya `${kejadian}:${referensiId}`. */
  dedupKeyBase: string;
  /** Kalau diisi, notifikasi ke kanal Telegram akan actionable (tombol Terima/Tolak/Buka di app). */
  aksi?: NotifikasiAksiSpec;
  /**
   * WAJIB diisi scheduler untuk kejadian di `KEJADIAN_AMBANG_JAM` -- berapa
   * jam sejak entitas ini "menunggu" (mis. sejak permintaan diajukan/transfer
   * dikirim). `notifyEvent` membandingkannya ke `aturan.ambangJam` MASING-
   * MASING aturan (bukan dicek scheduler) -- supaya aturan multi-tier (mis.
   * 2 jam -> supervisor, 6 jam -> owner) untuk kejadian yang SAMA bisa
   * eskalasi bertahap: tiap tier baru terkirim begitu jamSejak melewati
   * ambangJam tier itu (dan TETAP idempoten per tier lewat dedup_key yang
   * menggabungkan aturan_id). Diabaikan untuk kejadian lain.
   */
  jamSejak?: number;
}
