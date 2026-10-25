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
  // Gate READ (bukan write) untuk GET /items, /items/:kode/hpp, /menu,
  // /menu/:kode/hpp, /menu/:kode/rekomendasi-harga, /resep-produksi.
  | "master_item.lihat"
  | "master_menu.lihat"
  | "resep_produksi.lihat"
  // --- modul inventory: vendor & katalog (Tahap 3) ---
  | "vendor.lihat"
  | "vendor.edit"
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
  // --- core: identitas bisnis (nama + logo tampilan) ---
  | "identitas_bisnis.manage"
  // --- modul hr ---
  | "jadwal.lihat"
  | "jadwal.manage"
  | "pengajuan_libur.lihat"
  | "pengajuan_libur.create"
  | "pengajuan_libur.approve"
  | "shift_template.manage"
  // --- modul sales-sync ---
  | "sales_sync.import"
  | "sales_sync.manage";

/**
 * Keempat role MANUSIA. SENGAJA tidak termasuk "integrasi": itu akun bot
 * (n8n) yang cuma punya action `sales_sync.import` di backend dan tidak
 * pernah memakai UI ini -- jangan menambahkannya ke sini, nanti kontrol UI
 * yang pasti ditolak 403 malah ikut tampil.
 */
const SEMUA_ROLE: Role[] = ["owner", "manajer_ops", "supervisor", "staf"];

export const PERMISSION_ROLES: Record<PermissionAction, Role[]> = {
  // Master item + kategori/satuan + ambang min stok (PUT /min-stok).
  "master_item.edit": ["owner", "manajer_ops"],
  // POST /menu -- tambah master menu baru (header). TERPISAH dari master_item.edit karena
  // menu entitas master yang beda dari item; rolenya kebetulan sama (owner/manajer_ops).
  "master_menu.edit": ["owner", "manajer_ops"],
  // Resep produksi DAN resep menu (termasuk nonaktifkan menu).
  "resep.edit": ["owner", "manajer_ops"],
  // Gate READ daftar/HPP item, menu, dan resep produksi. Populasinya KEEMPAT
  // role manusia (bukan cuma owner/manajer_ops seperti versi .edit di atas),
  // jadi tidak ada kontrol UI yang perlu disembunyikan karena action ini --
  // didaftarkan di sini semata-mata supaya tabel ini tetap 1:1 dengan
  // modules/inventory/module.json. Yang ditolak cuma role di luar keempatnya
  // (yaitu akun bot "integrasi").
  "master_item.lihat": SEMUA_ROLE,
  "master_menu.lihat": SEMUA_ROLE,
  "resep_produksi.lihat": SEMUA_ROLE,

  // GET /vendor dkk. -- owner/manajer_ops/supervisor (supervisor ikut karena
  // dropdown vendor di form Pembelian, bukan cuma tab Master > Vendor yang
  // owner/manajer_ops saja). vendor.edit (CRUD vendor + katalog manual) lebih
  // sempit, owner/manajer_ops saja.
  "vendor.lihat": ["owner", "manajer_ops", "supervisor"],
  "vendor.edit": ["owner", "manajer_ops"],

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

  // PUT /api/core/identitas-bisnis dan .../logo -- nama tampilan + logo. GET-nya publik
  // (tanpa login), yang digerbang action ini cuma PUT (ubah).
  "identitas_bisnis.manage": ["owner"],

  "jadwal.lihat": SEMUA_ROLE,
  // Buat/ubah/pindah/hapus jadwal shift + salin jadwal satu minggu ke minggu lain.
  "jadwal.manage": ["owner", "manajer_ops"],
  "pengajuan_libur.lihat": SEMUA_ROLE,
  // Ajukan libur untuk DIRI SENDIRI -- semua role, termasuk owner/manajer_ops.
  "pengajuan_libur.create": SEMUA_ROLE,
  // Setujui/tolak pengajuan libur DAN jalur darurat "ajukan untuk staf" (override).
  "pengajuan_libur.approve": ["owner", "manajer_ops"],
  "shift_template.manage": ["owner", "manajer_ops"],

  // 4 endpoint import CSV sales-sync -- action TERPISAH dari sales_sync.manage karena
  // cuma endpoint import inilah yang boleh dipanggil akun bot role "integrasi" (n8n).
  // Untuk sisi UI ini tidak ada bedanya dengan sales_sync.manage (owner/manajer_ops
  // sama-sama boleh), tapi JANGAN disatukan lagi di backend: lihat komentar di
  // modules/sales-sync/src/api/router.ts (endpointImport).
  "sales_sync.import": ["owner", "manajer_ops", "integrasi"],
  // Endpoint sales-sync SELAIN import: daftar + ubah pemetaan item, daftar belum-diproses,
  // dan POST /proses yang MENGURANGI STOK. "integrasi" SENGAJA tidak ada di sini.
  "sales_sync.manage": ["owner", "manajer_ops"],
};

/** true kalau role user yang login termasuk yang diizinkan backend untuk `action`.
 * Action yang tidak dikenal => false (fail closed, jangan tampilkan kontrolnya). */
export function usePermission(action: PermissionAction | string): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return PERMISSION_ROLES[action as PermissionAction]?.includes(user.role) ?? false;
}
