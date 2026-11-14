import type { PoolClient } from "pg";

/**
 * Registry aksi notifikasi (2026-11-14) -- pola "late binding" supaya
 * webhook Telegram yang hidup di `core` bisa menjalankan aksi domain yang
 * sebenarnya hidup di modul bisnis (mis. `tolakPermintaan` di modul
 * Inventory) TANPA `core` meng-import modul bisnis manapun (arah dependency
 * HARUS tetap modul -> core, bukan sebaliknya, lihat CLAUDE.md § module
 * manifest). Modul bisnis mendaftarkan handler-nya SEKALI saat boot lewat
 * `registerAksiNotifikasi(referensiTipe, handler)` -- lihat pemanggilnya di
 * `modules/inventory/src/notifikasi/register.ts`.
 *
 * HANYA untuk aksi 'tolak' (state-changing) -- aksi 'terima' SENGAJA
 * ditangani generik di webhook.ts sendiri (TIDAK PERNAH menggerakkan stok,
 * instruksi eksplisit owner), jadi tidak perlu lewat registry ini sama
 * sekali.
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
}

export type HandlerAksiNotifikasi = (params: JalankanAksiParams) => Promise<HasilAksiNotifikasi>;

const registry = new Map<string, HandlerAksiNotifikasi>();

export function registerAksiNotifikasi(referensiTipe: string, handler: HandlerAksiNotifikasi): void {
  registry.set(referensiTipe, handler);
}

export async function jalankanAksiTolak(referensiTipe: string, params: JalankanAksiParams): Promise<HasilAksiNotifikasi> {
  const handler = registry.get(referensiTipe);
  if (!handler) {
    throw new Error(`Tidak ada handler aksi "tolak" terdaftar untuk referensiTipe "${referensiTipe}"`);
  }
  return handler(params);
}
