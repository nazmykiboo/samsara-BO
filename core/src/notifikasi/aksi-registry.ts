import type { PoolClient } from "pg";
import type { Role } from "../auth/types.js";

/**
 * Registry aksi notifikasi -- pola "late binding" supaya webhook Telegram
 * yang hidup di `core` bisa menjalankan aksi domain yang sebenarnya hidup
 * di modul bisnis (mis. `tolakPermintaan`/`akuiPermintaan` di modul
 * Inventory) TANPA `core` meng-import modul bisnis manapun (arah dependency
 * HARUS tetap modul -> core, bukan sebaliknya, lihat CLAUDE.md § module
 * manifest). Modul bisnis mendaftarkan handler-nya SEKALI saat boot lewat
 * `registerAksiNotifikasi(referensiTipe, aksi, handler)` -- lihat
 * pemanggilnya di `modules/inventory/src/notifikasi/register.ts`.
 *
 * "tolak" SELALU dijalankan untuk semua role yang berwenang (lihat
 * `requireAuth`-equivalent di webhook) -- TIDAK PERNAH menggerakkan stok di
 * kedua domain yang sudah terdaftar (permintaan_transfer, opname), jadi
 * aman dieksekusi tanpa batasan role tambahan.
 *
 * "terima" (2026-11-18, Tahap 2) -- SENGAJA dibatasi HANYA role owner di
 * level webhook (`core/src/notifikasi/router.ts`), BUKAN di sini -- owner
 * untuk sementara satu-satunya yang menjalankan CK sendirian (belum ada
 * tim), jadi tombol Terima perlu benar-benar berefek untuknya (acknowledgment
 * permintaan, approval opname -- lihat handler masing-masing). Role lain
 * TETAP dapat perilaku lama (generik, tidak pernah lewat registry ini).
 */
export interface HasilAksiNotifikasi {
  /** Teks ringkas untuk menggantikan isi pesan Telegram setelah aksi dijalankan. */
  ringkasan: string;
}

export interface JalankanAksiParams {
  client: PoolClient;
  referensiId: number;
  alasanPreset?: string;
  userId: number;
  role: Role;
}

export type AksiNotifikasiTipe = "terima" | "tolak";

export type HandlerAksiNotifikasi = (params: JalankanAksiParams) => Promise<HasilAksiNotifikasi>;

function kunciRegistry(referensiTipe: string, aksi: AksiNotifikasiTipe): string {
  return `${referensiTipe}:${aksi}`;
}

const registry = new Map<string, HandlerAksiNotifikasi>();

export function registerAksiNotifikasi(referensiTipe: string, aksi: AksiNotifikasiTipe, handler: HandlerAksiNotifikasi): void {
  registry.set(kunciRegistry(referensiTipe, aksi), handler);
}

/** `tolak` -- selalu WAJIB ada handler terdaftar (dipanggil setelah token aksi valid), lempar error kalau tidak ada. */
export async function jalankanAksiTolak(referensiTipe: string, params: JalankanAksiParams): Promise<HasilAksiNotifikasi> {
  const handler = registry.get(kunciRegistry(referensiTipe, "tolak"));
  if (!handler) {
    throw new Error(`Tidak ada handler aksi "tolak" terdaftar untuk referensiTipe "${referensiTipe}"`);
  }
  return handler(params);
}

/** `terima` -- OPSIONAL (`null` kalau tidak ada handler terdaftar untuk referensiTipe ini) -- caller (webhook) jatuh balik ke acknowledgment generik kalau `null`. */
export async function cariHandlerAksiTerima(referensiTipe: string): Promise<HandlerAksiNotifikasi | null> {
  return registry.get(kunciRegistry(referensiTipe, "terima")) ?? null;
}
