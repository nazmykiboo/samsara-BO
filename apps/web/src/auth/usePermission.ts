import { useAuth } from "./AuthContext";
import type { Role } from "../api/types";

/**
 * Hook permission TERPUSAT -- SISI TAMPILAN SAJA. Sama disclaimer-nya dengan
 * ./permissions.ts: ini mencerminkan (bukan menggantikan) permission sungguhan di
 * `modules/inventory/module.json`, `modules/hr/module.json`, dan
 * `core/src/auth/permissions.ts`. Backend tetap satu-satunya penegak akses; hook ini
 * cuma dipakai untuk menyembunyikan/menonaktifkan kontrol UI supaya staf tidak
 * menekan tombol yang sudah pasti ditolak API (403) -- bug kepercayaan, bukan bug
 * keamanan. Kalau permission backend berubah, sinkronkan tabel di bawah juga.
 *
 * Daftar di bawah disusun 1:1 dari field `permission.action`/`permission.roles` di
 * kedua module.json + CORE_PERMISSIONS (user.manage) -- bukan hasil menebak.
 *
 * Helper `bisaXxx` di ./permissions.ts tetap valid dan masih dipakai di tempat yang
 * sudah benar. Untuk kontrol BARU, pakai hook ini supaya daftar permission ada di satu
 * tempat dan gampang dicocokkan ke backend.
 */

export type PermissionAction =
  // --- modul inventory: master data ---
  | "master_item.edit"
  | "master_menu.edit"
  | "resep.edit"
  // --- modul inventory: harga & HPP ---
  | "harga_jual.edit"
  | "hpp.lihat_harga"
  | "menu_visibilitas.edit"
  // --- modul inventory: transaksi ---
  | "pembelian.create"
  | "produksi.create"
  | "penjualan.create"
  | "transfer.kirim"
  | "transfer.terima"
  | "mutasi_lain.create"
  | "permintaan_transfer.create"
  | "permintaan_transfer.lihat"
  | "opname.input"
  | "opname.approve"
  // --- modul inventory: lihat data ---
  | "stok.lihat"
  | "min_stok.lihat"
  | "laporan_harian.lihat"
  | "analitik.lihat"
  // --- modul inventory: pengaturan sistem ---
  | "pengaturan.manage"
  // --- core: akun login ---
  | "user.manage"
  // --- modul hr ---
  | "jadwal.lihat"
  | "jadwal.manage"
  | "pengajuan_libur.lihat"
  | "pengajuan_libur.create"
  | "pengajuan_libur.approve"
  | "shift_template.manage"
  // --- modul sales-sync ---
  | "sales_sync.manage";

const SEMUA_ROLE: Role[] = ["owner", "manajer_ops", "supervisor", "staf"];

export const PERMISSION_ROLES: Record<PermissionAction, Role[]> = {
  // Master item + kategori/satuan + ambang min stok (PUT /min-stok).
  "master_item.edit": ["owner", "manajer_ops"],
  // POST /menu -- tambah master menu baru (header). TERPISAH dari master_item.edit karena
  // menu entitas master yang beda dari item; rolenya kebetulan sama (owner/manajer_ops).
  "master_menu.edit": ["owner", "manajer_ops"],
  // Resep produksi DAN resep menu (termasuk nonaktifkan menu).
  "resep.edit": ["owner", "manajer_ops"],

  // PATCH /menu/:kode/harga-jual DAN PATCH /menu/:kode/harga-channel -- OWNER SAJA.
  "harga_jual.edit": ["owner"],
  // Bukan gate endpoint: menentukan field harga/HPP/margin di-strip atau tidak dari response.
  "hpp.lihat_harga": ["owner", "manajer_ops"],
  // PATCH /menu/:kode/channel/:channel/visibilitas -- tayangkan/sembunyikan menu per channel.
  // OWNER SAJA, dan ini memang LEBIH SEMPIT dari master_menu.edit/resep.edit yang juga dipegang
  // manajer_ops (diminta owner eksplisit) -- JANGAN "diseragamkan" ke owner+manajer_ops, backend
  // menolak manajer_ops dengan 403.
  "menu_visibilitas.edit": ["owner"],

  "pembelian.create": ["owner", "manajer_ops", "supervisor"],
  "produksi.create": ["owner", "manajer_ops", "supervisor"],
  "penjualan.create": ["owner", "manajer_ops", "supervisor"],
  "transfer.kirim": ["owner", "manajer_ops", "supervisor"],
  "transfer.terima": SEMUA_ROLE,
  "mutasi_lain.create": SEMUA_ROLE,
  "permintaan_transfer.create": SEMUA_ROLE,
  "permintaan_transfer.lihat": SEMUA_ROLE,
  // Input hitungan opname boleh SEMUA role -- yang dibatasi cuma persetujuannya.
  "opname.input": SEMUA_ROLE,
  // POST /transaksi/opname/:id/keputusan DAN GET /transaksi/opname (daftar untuk approval).
  "opname.approve": ["owner", "manajer_ops"],

  "stok.lihat": SEMUA_ROLE,
  "min_stok.lihat": SEMUA_ROLE,
  "laporan_harian.lihat": ["owner", "manajer_ops", "supervisor"],
  // GET /analitik/penjualan DAN GET /analitik/operasional. LEBIH SEMPIT dari laporan_harian.lihat:
  // supervisor TIDAK boleh (backend menolak 403) -- jangan "diseragamkan" ke tiga role.
  "analitik.lihat": ["owner", "manajer_ops"],

  // Metode HPP default, target food cost, kelola lokasi, kelola channel.
  "pengaturan.manage": ["owner"],

  // core_user: buat/ubah/nonaktifkan/reset kredensial akun login.
  "user.manage": ["owner"],

  "jadwal.lihat": SEMUA_ROLE,
  // Buat/ubah/pindah/hapus jadwal shift + salin jadwal satu minggu ke minggu lain.
  "jadwal.manage": ["owner", "manajer_ops"],
  "pengajuan_libur.lihat": SEMUA_ROLE,
  // Ajukan libur untuk DIRI SENDIRI -- semua role, termasuk owner/manajer_ops.
  "pengajuan_libur.create": SEMUA_ROLE,
  // Setujui/tolak pengajuan libur DAN jalur darurat "ajukan untuk staf" (override).
  "pengajuan_libur.approve": ["owner", "manajer_ops"],
  "shift_template.manage": ["owner", "manajer_ops"],

  // SATU action untuk SEMUA endpoint modul sales-sync (4 import CSV, daftar + ubah pemetaan item,
  // jalankan proses) -- lihat modules/sales-sync/module.json: tiap endpoint di sana memakai
  // action yang sama, tidak dipecah per aksi.
  "sales_sync.manage": ["owner", "manajer_ops"],
};

/** true kalau role user yang login termasuk yang diizinkan backend untuk `action`.
 * Action yang tidak dikenal => false (fail closed, jangan tampilkan kontrolnya). */
export function usePermission(action: PermissionAction | string): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return PERMISSION_ROLES[action as PermissionAction]?.includes(user.role) ?? false;
}
