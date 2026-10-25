import type { PoolClient } from "pg";

/**
 * Baca-saja daftar lokasi (`core_locations`) -- CRUD lokasi (create/update,
 * termasuk guard nonaktifkan) TETAP di modul Inventory
 * (`modules/inventory/src/domain/pengaturan.ts`, endpoint `/api/inventory/lokasi`)
 * sesuai preseden yang sudah ada (lihat `docs/architecture-decisions.md` §18)
 * -- guard nonaktifkan butuh tabel transaksi milik Inventory, jadi memang
 * lebih wajar di sana. Fungsi list murni ini ditaruh di `core` karena
 * `core_locations` adalah tabel core, DAN endpointnya WAJIB publik (dipakai
 * flow login PIN staf sebelum ada token auth) -- modul bisnis mana pun
 * selalu mount SETELAH `requireAuth` global (lihat `build-server.ts`), jadi
 * endpoint publik apa pun tidak bisa hidup di router modul manapun.
 */
export interface LokasiPublikRow {
  id: number;
  name: string;
  entitas: string;
  isActive: boolean;
  kode: string | null;
  tipe: "outlet" | "kitchen" | null;
}

export async function listLokasiPublik(client: PoolClient): Promise<LokasiPublikRow[]> {
  const { rows } = await client.query<{
    id: number;
    name: string;
    entitas: string;
    is_active: boolean;
    kode: string | null;
    tipe: string | null;
  }>(`SELECT id, name, entitas, is_active, kode, tipe FROM core_locations ORDER BY tipe, name`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    entitas: r.entitas,
    isActive: r.is_active,
    kode: r.kode,
    tipe: r.tipe === "outlet" || r.tipe === "kitchen" ? r.tipe : null,
  }));
}
