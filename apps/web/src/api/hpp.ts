import { ApiError, api, getToken, postCsv } from "./client";
import type {
  ApiErrorBody,
  BarisHargaBatch,
  HppMethod,
  ItemCostReport,
  MenuHppReport,
  PreviewHargaChannel,
  RekomendasiHargaResult,
} from "./types";

export function getItemHpp(kode: string, metode?: HppMethod): Promise<ItemCostReport> {
  const qs = metode ? `?metode=${metode}` : "";
  return api.get<ItemCostReport>(`/api/inventory/items/${encodeURIComponent(kode)}/hpp${qs}`);
}

export function getMenuHpp(kode: string, metode?: HppMethod): Promise<MenuHppReport> {
  const qs = metode ? `?metode=${metode}` : "";
  return api.get<MenuHppReport>(`/api/inventory/menu/${encodeURIComponent(kode)}/hpp${qs}`);
}

export function setMenuHargaJual(kode: string, hargaJual: number): Promise<{ kode: string; hargaJual: number }> {
  return api.patch(`/api/inventory/menu/${encodeURIComponent(kode)}/harga-jual`, { hargaJual });
}

export function setMenuHargaChannel(
  kode: string,
  channel: string,
  hargaJual: number,
): Promise<{ kode: string; channel: string; hargaJual: number }> {
  return api.patch(`/api/inventory/menu/${encodeURIComponent(kode)}/harga-channel`, { channel, hargaJual });
}

/**
 * PATCH /menu/harga-channel/batch -- simpan BANYAK harga menu+channel sekaligus (tombol
 * "Simpan Semua" di grid Edit Harga Massal dan tombol "Terapkan Perubahan" di layar preview
 * import CSV). Permission `harga_jual.edit` (owner saja).
 *
 * ATOMIK SUNGGUHAN: satu baris ditolak -> SELURUH kiriman dibatalkan, tidak ada yang tersimpan,
 * dan ApiError-nya (400 ATAU 404 -- 404 kalau penyebabnya menu tidak ditemukan, karena error
 * handler router memetakan pesan "tidak ditemukan" ke 404) sudah menyebut baris ke-berapa yang
 * bermasalah. Tampilkan `err.message` APA ADANYA, jangan diganti pesan generik: nomor barisnya
 * itu satu-satunya petunjuk sel mana yang perlu dikoreksi.
 *
 * Konsekuensi untuk UI: karena tidak ada yang tersimpan, JANGAN memuat ulang grid setelah gagal
 * -- biarkan angka yang sudah diketik user tetap di layar supaya bisa dikoreksi tanpa mengetik
 * ulang semuanya.
 */
export function batchUpsertHargaChannel(baris: BarisHargaBatch[]): Promise<{ disimpan: number }> {
  return api.patch<{ disimpan: number }>("/api/inventory/menu/harga-channel/batch", { baris });
}

/**
 * POST /menu/harga-channel/import -- PREVIEW import CSV harga per channel. READ-ONLY: tidak
 * menyimpan apa pun, cuma melaporkan apa yang AKAN terjadi (baru/berubah/sama/error per baris).
 * Untuk benar-benar menyimpan, saring baris `sama`/`error` lalu kirim ke
 * `batchUpsertHargaChannel`.
 *
 * Body-nya TEKS CSV MENTAH (Content-Type: text/csv) -- pakai `postCsv` yang sudah ada (sama
 * seperti import modul sales-sync); `api.post` tidak bisa dipakai karena selalu JSON.
 * Pembacaan file jadi teks dilakukan di komponen dengan `await file.text()`.
 *
 * Melempar ApiError (400) kalau CSV-nya kosong atau header kolomnya tidak lengkap -- itu
 * kegagalan SELURUH file, beda dari baris bermasalah yang muncul sebagai `status: "error"`.
 */
export function importHargaChannelPreview(csvText: string): Promise<PreviewHargaChannel[]> {
  return postCsv<PreviewHargaChannel[]>("/api/inventory/menu/harga-channel/import", csvText);
}

/**
 * GET /menu/harga-channel/export -- SEMUA kombinasi menu aktif x channel aktif sebagai TEKS CSV
 * (header `kode_menu,channel,harga_jual`; kolom harga KOSONG untuk kombinasi yang belum pernah
 * diisi -- itu memang gunanya, supaya kelihatan lubangnya). Read-only.
 *
 * SENGAJA `fetch` manual, BUKAN `api.get`: response-nya `text/csv`, bukan JSON, dan `request()`
 * di client.ts mengembalikan `null` untuk response non-JSON. Cara ambil token & pembentukan
 * ApiError disamakan dengan `request()`/`postCsv` supaya pemanggil tetap menangkap error yang
 * sama -- ini kebalikan arah dari `postCsv` (CSV masuk) dengan penanganan yang sepola.
 */
export async function exportHargaChannelCsv(): Promise<string> {
  const token = getToken();
  const res = await fetch("/api/inventory/menu/harga-channel/export", {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    // Jalur gagal tetap JSON (error handler router), jadi pesannya dibaca dari field `error`.
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const data = isJson ? ((await res.json()) as ApiErrorBody | null) : null;
    throw new ApiError(res.status, data?.error ?? `Permintaan gagal (${res.status})`);
  }

  return res.text();
}

export function getRekomendasiHarga(
  kode: string,
  opts?: { targetFoodCost?: number; metode?: HppMethod },
): Promise<RekomendasiHargaResult> {
  const params = new URLSearchParams();
  if (opts?.targetFoodCost !== undefined) params.set("target_food_cost", String(opts.targetFoodCost));
  if (opts?.metode) params.set("metode", opts.metode);
  const qs = params.toString();
  return api.get(`/api/inventory/menu/${encodeURIComponent(kode)}/rekomendasi-harga${qs ? `?${qs}` : ""}`);
}
