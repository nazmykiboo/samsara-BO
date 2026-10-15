/**
 * Klien HTTP loopback ke modul lain dalam proses API yang SAMA.
 *
 * Kenapa HTTP dan bukan `import { createPenjualan } from "@samsara/inventory"`:
 * aturan isolasi antar modul di CLAUDE.md § "Module manifest" -- modul bisnis
 * hanya boleh berinteraksi lewat API yang diekspos modul lain, tidak pernah
 * memanggil domain function atau menyentuh tabelnya langsung. Konsekuensinya
 * (disengaja): transaksi database sales-sync dan transaksi Inventory TERPISAH,
 * jadi penandaan `processed_at` di sini baru dilakukan setelah Inventory
 * membalas sukses.
 *
 * Token: dipakai ulang Authorization header dari request yang memicu proses --
 * tidak ada service account/token internal di sistem ini, dan memang tidak
 * perlu: yang memicu sinkronisasi adalah owner/manajer_ops yang juga punya
 * permission `penjualan.create` di Inventory.
 */

/**
 * Port API diambil dari env var yang SAMA dengan yang dipakai server
 * (`apps/api/src/index.ts`) -- jangan pernah hardcode 4000 di tempat lain,
 * cukup lewat konstanta ini.
 */
const PORT = process.env.PORT ?? "4000";
const BASE_URL = `http://localhost:${PORT}`;

export interface PenjualanApiInput {
  locationId: number;
  sumber: string;
  noReferensi?: string;
  /** Tanggal kalender murni "YYYY-MM-DD" (bukan objek Date -- hindari geser timezone). */
  tanggal: string;
  /**
   * Jam order ASLI di platform sumber, "HH:MM" atau "HH:MM:SS" (opsional).
   * Diambil dari `salessync_log_penjualan.transaction_time` (kolom `TIME`, jadi
   * tanpa isu timezone sama sekali) -- BUKAN jam proses sinkronisasi.
   */
  jam?: string;
  baris: Array<{ menuKode: string; qty: number }>;
}

export interface PenjualanApiResult {
  headerId: number;
  pemakaianBahan: unknown[];
}

/** POST /api/inventory/transaksi/penjualan. Melempar Error dengan pesan dari Inventory kalau ditolak. */
export async function createPenjualanViaApi(
  authHeader: string,
  input: PenjualanApiInput,
): Promise<PenjualanApiResult> {
  const res = await fetch(`${BASE_URL}/api/inventory/transaksi/penjualan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader },
    // `JSON.stringify` membuang field bernilai `undefined`, jadi `jam` yang
    // tidak diisi otomatis TIDAK ikut terkirim (bukan dikirim sebagai null) --
    // sesuai kontrak `jam?: string` di sisi Inventory.
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `Gagal membuat transaksi penjualan (HTTP ${res.status})`;
    throw new Error(message);
  }
  return data as PenjualanApiResult;
}
