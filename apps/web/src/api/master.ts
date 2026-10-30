import { api } from "./client";
import type {
  ItemListItem,
  KategoriMenu,
  MenuListItem,
  MenuResepBarisItem,
  ResepProduksiBarisItem,
  ResepProduksiListItem,
} from "./types";

export function listItems(): Promise<ItemListItem[]> {
  return api.get<ItemListItem[]>("/api/inventory/items");
}

export interface CreateItemInput {
  kode: string;
  name: string;
  type: "bahan_baku" | "packaging" | "operasional" | "setengah_jadi";
  recipeUnit: string;
  category?: string;
  purchaseUnit?: string;
  purchaseToRecipeFactor?: number;
  hargaMaster?: number;
  minStok?: number;
  shelfLifeHari?: number;
  catatan?: string;
}

export function createItem(input: CreateItemInput): Promise<{ id: string }> {
  return api.post("/api/inventory/items", input);
}

export function updateItem(kode: string, input: Partial<CreateItemInput>): Promise<{ kode: string }> {
  return api.patch(`/api/inventory/items/${encodeURIComponent(kode)}`, input);
}

export function deactivateItem(kode: string): Promise<{ kode: string; isActive: false }> {
  return api.patch(`/api/inventory/items/${encodeURIComponent(kode)}/nonaktifkan`);
}

export interface ResepProduksiBarisInput {
  bahanItemKode: string;
  qty: number;
  unit: string;
}

export function listResepProduksi(): Promise<ResepProduksiListItem[]> {
  return api.get<ResepProduksiListItem[]>("/api/inventory/resep-produksi");
}

export function getResepProduksiBaris(kode: string): Promise<ResepProduksiBarisItem[]> {
  return api.get<ResepProduksiBarisItem[]>(`/api/inventory/resep-produksi/${encodeURIComponent(kode)}`);
}

export function createResepProduksi(input: {
  kode: string;
  outputItemKode: string;
  yieldQty?: number;
  yieldUnit?: string;
  catatan?: string;
  baris: ResepProduksiBarisInput[];
}): Promise<{ id: string }> {
  return api.post("/api/inventory/resep-produksi", input);
}

export function updateResepProduksi(
  kode: string,
  input: { yieldQty?: number; yieldUnit?: string; catatan?: string; baris?: ResepProduksiBarisInput[] },
): Promise<{ kode: string }> {
  return api.patch(`/api/inventory/resep-produksi/${encodeURIComponent(kode)}`, input);
}

export function deactivateResepProduksi(kode: string): Promise<{ kode: string; isActive: false }> {
  return api.patch(`/api/inventory/resep-produksi/${encodeURIComponent(kode)}/nonaktifkan`);
}

export interface MenuResepBarisInput {
  itemKode: string;
  qty: number;
  unit: string;
}

export function listMenu(): Promise<MenuListItem[]> {
  return api.get<MenuListItem[]>("/api/inventory/menu");
}

/** Body POST /menu.
 *
 * `kategoriMenu` (teks bebas) SUDAH TIDAK ADA lagi -- diganti `kategoriId`, FK ke tabel
 * referensi kategori menu (lihat `listKategoriMenu`). Kategori divalidasi backend harus ADA
 * & AKTIF; kalau tidak, balasannya 404 dengan pesan "Kategori menu ... tidak ditemukan atau
 * nonaktif" (404, bukan 400 -- jangan dianggap "menu tidak ditemukan").
 *
 * `lokasiIds` SEMANTIK PENTING (tabel pengecualian): tidak dikirim / array kosong = menu
 * aktif di SEMUA lokasi (ini defaultnya). Dikirim sebagian = menu HANYA aktif di lokasi yang
 * disebut. Jadi JANGAN kirim array kosong untuk maksud "tidak ada lokasi" -- artinya kebalikannya.
 *
 * `isActive` tidak dikirim dari form: backend sudah default `true`. */
export interface CreateMenuInput {
  kode: string;
  name: string;
  kategoriId?: number;
  isActive?: boolean;
  lokasiIds?: number[];
}

/** Tambah master menu baru (header saja -- baris resepnya diisi terpisah lewat
 * `updateMenuResep`, jadi menu baru berstatus "menunggu data" sampai resepnya ada).
 * Permission backend: `master_menu.edit` (owner/manajer_ops). Keunikan kode/nama dijaga
 * constraint database -- benturannya datang sebagai ApiError 400. */
export function createMenu(input: CreateMenuInput): Promise<{ id: string }> {
  return api.post("/api/inventory/menu", input);
}

/** Rename menu, kode TETAP (2026-10-30). Permission: `master_menu.edit`. Nama unik
 * tanpa besar/kecil & spasi tepi -- pesan error dari backend sudah rapi Bahasa
 * Indonesia (pre-check aplikasi, bukan pesan Postgres mentah), tampilkan apa adanya. */
export function updateMenu(kode: string, name: string): Promise<{ kode: string }> {
  return api.patch(`/api/inventory/menu/${encodeURIComponent(kode)}`, { name });
}

/** Body POST /menu/:kode/duplikat -- field opsionalnya SEMANTIKNYA SAMA dengan CreateMenuInput
 * (termasuk aturan `lokasiIds` di atas). Kategori & lokasi diambil dari body ini, BUKAN diwarisi
 * dari menu sumber. */
export interface DuplicateMenuInput {
  kodeBaru: string;
  nameBaru: string;
  kategoriId?: number;
  isActive?: boolean;
  lokasiIds?: number[];
}

/**
 * Duplikat satu menu jadi menu baru. SATU panggilan: penyalinan baris resep dari menu sumber
 * dikerjakan backend di dalam satu transaksi -- frontend TIDAK perlu lagi GET resep sumber +
 * PATCH resep menu baru sendiri (orkestrasi 3 panggilan yang lama sudah dihapus).
 *
 * Menu sumber yang belum punya resep tetap berhasil diduplikat (menu baru dibuat kosong), itu
 * BUKAN error. Yang TIDAK ikut disalin: harga jual (legacy & per channel), visibilitas channel,
 * dan komposisi paket.
 *
 * 404 kalau `kodeSumber` tidak ada ("Menu sumber ... tidak ditemukan").
 */
export function duplicateMenu(kodeSumber: string, input: DuplicateMenuInput): Promise<{ id: string }> {
  return api.post(`/api/inventory/menu/${encodeURIComponent(kodeSumber)}/duplikat`, input);
}

/** GET /kategori-menu -- daftar SEMUA kategori menu (aktif & nonaktif), urut `urutanTampil`.
 * Pemanggil yang butuh isi dropdown "pilih kategori" HARUS menyaring `aktif` sendiri: kategori
 * nonaktif ditolak backend saat dipakai di POST /menu. */
export function listKategoriMenu(): Promise<KategoriMenu[]> {
  return api.get<KategoriMenu[]>("/api/inventory/kategori-menu");
}

/** POST /kategori-menu -- `kode`/`nama` wajib. Keunikan kode & nama dijaga constraint database,
 * jadi duplikatnya sampai ke sini sebagai ApiError biasa (pesan Postgres mentah -- terjemahkan
 * di layar sebelum ditampilkan ke staf). */
export function createKategoriMenu(input: {
  kode: string;
  nama: string;
  urutanTampil?: number;
}): Promise<{ id: number }> {
  return api.post("/api/inventory/kategori-menu", input);
}

/** PATCH /kategori-menu/:id -- field yang tidak dikirim tidak berubah. `aktif` dua arah
 * (nonaktifkan DAN aktifkan lagi); menu lama yang sudah memakai kategori nonaktif tidak
 * ikut berubah. */
export function updateKategoriMenu(
  id: number,
  input: { kode?: string; nama?: string; urutanTampil?: number; aktif?: boolean },
): Promise<{ id: number }> {
  return api.patch(`/api/inventory/kategori-menu/${id}`, input);
}

/**
 * PATCH /menu/:kode/channel/:channel/visibilitas -- tayangkan (`aktif: true`) atau sembunyikan
 * (`aktif: false`) satu menu di satu channel penjualan.
 *
 * Permission `menu_visibilitas.edit`: OWNER SAJA -- lebih sempit dari `harga_jual.edit`/
 * `master_menu.edit`, manajer_ops ditolak 403.
 *
 * TIDAK menyentuh harga jual sama sekali (baik legacy maupun per channel) -- panggil ini
 * sendiri, JANGAN digabung ke penyimpanan harga.
 */
export function setVisibilitasChannel(
  kodeMenu: string,
  channel: string,
  aktif: boolean,
): Promise<{ kode: string; channel: string; aktif: boolean }> {
  return api.patch(
    `/api/inventory/menu/${encodeURIComponent(kodeMenu)}/channel/${encodeURIComponent(channel)}/visibilitas`,
    { aktif },
  );
}

export function getMenuResep(kode: string): Promise<MenuResepBarisItem[]> {
  return api.get<MenuResepBarisItem[]>(`/api/inventory/menu/${encodeURIComponent(kode)}/resep`);
}

export function updateMenuResep(kode: string, baris: MenuResepBarisInput[]): Promise<{ kode: string }> {
  return api.patch(`/api/inventory/menu/${encodeURIComponent(kode)}/resep`, { baris });
}

export function deactivateMenu(kode: string): Promise<{ kode: string; isActive: false }> {
  return api.patch(`/api/inventory/menu/${encodeURIComponent(kode)}/nonaktifkan`);
}
