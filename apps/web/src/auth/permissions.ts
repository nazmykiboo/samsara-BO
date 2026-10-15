import type { Role } from "../api/types";

/**
 * Helper permission SISI TAMPILAN SAJA -- mencerminkan (bukan menggantikan)
 * permission sungguhan di modules/inventory/module.json. Backend tetap
 * satu-satunya penegak akses; ini cuma dipakai untuk menyembunyikan/
 * menonaktifkan kontrol UI supaya tidak menampilkan tombol yang pasti akan
 * ditolak API. Kalau permission backend berubah, sinkronkan di sini juga.
 *
 * STANDAR BARU: untuk kontrol BARU (atau yang diperbaiki), pakai hook terpusat
 * `usePermission("<action>")` di ./usePermission.ts -- daftar action di sana
 * disusun 1:1 dari module.json tiap modul, jadi lebih gampang dicocokkan ke
 * backend daripada menambah helper `bisaXxx` baru di file ini. Helper di bawah
 * tetap valid dan masih dipakai di beberapa halaman; beberapa (bisaLihatHarga,
 * bisaKelolaUser, bisaKelolaShiftTemplate, bisaKelolaJadwal) sudah digantikan
 * usePermission di pemakainya dan dibiarkan di sini sebagai rujukan/kompatibilitas.
 */

export const bisaLihatHarga = (role: Role): boolean => role === "owner" || role === "manajer_ops";
export const bisaUbahHargaJual = (role: Role): boolean => role === "owner";
export const bisaKelolaMaster = (role: Role): boolean => role === "owner" || role === "manajer_ops";

/** Pengaturan "sensitif" (lokasi, channel, metode HPP default, target food cost) -- backend
 * `pengaturan.manage` cuma ["owner"]. Beda dari bisaAksesPengaturan di bawah (nav/route), karena
 * halaman Pengaturan sekarang juga punya tab "Shift" yang boleh dibuka manajer_ops. */
export const bisaKelolaPengaturan = (role: Role): boolean => role === "owner";

/** Boleh membuka halaman /pengaturan sama sekali (nav + gate route) -- owner untuk semua tab, manajer_ops
 * cuma untuk tab "Shift" (lihat bisaKelolaShiftTemplate). Tab "Kelola User" sendiri TETAP owner-only,
 * digate terpisah lewat bisaKelolaUser di dalam halaman -- JANGAN pakai helper ini untuk itu. */
export const bisaAksesPengaturan = (role: Role): boolean => role === "owner" || role === "manajer_ops";

/** Kelola akun/user login -- backend `user.manage` cuma ["owner"]. Cuma 1 akun owner by design, jadi
 * tidak ada risiko owner menyembunyikan tab ini dari dirinya sendiri. */
export const bisaKelolaUser = (role: Role): boolean => role === "owner";

/** Kelola shift template (tambah/ubah/aktif-nonaktifkan) -- backend `shift_template.manage`
 * ["owner","manajer_ops"]. */
export const bisaKelolaShiftTemplate = (role: Role): boolean => role === "owner" || role === "manajer_ops";
export const bisaSetujuiOpname = (role: Role): boolean => role === "owner" || role === "manajer_ops";
export const bisaOverrideMetodeHpp = (role: Role): boolean => role === "owner" || role === "manajer_ops";

export const bisaPembelianProduksiPenjualan = (role: Role): boolean =>
  role === "owner" || role === "manajer_ops" || role === "supervisor";

export const bisaTransferKirim = (role: Role): boolean =>
  role === "owner" || role === "manajer_ops" || role === "supervisor";

/** Semua role boleh mencoba terima -- lingkup lokasi tetap ditegakkan backend. */
export const bisaTransferTerima = (_role: Role): boolean => true;

/** Memenuhi permintaan transfer = transfer kirim biasa (dengan permintaanId) -- permission sama. */
export const bisaMemenuhiPermintaan = bisaTransferKirim;

/** Staf TIDAK boleh akses laporan harian (tetap pakai halaman existing) -- lihat module.json. */
export const bisaLihatLaporanHarian = (role: Role): boolean =>
  role === "owner" || role === "manajer_ops" || role === "supervisor";

/** Kelola jadwal shift (buat/ubah/hapus) dan putuskan pengajuan libur -- lihat modules/hr. */
export const bisaKelolaJadwal = (role: Role): boolean => role === "owner" || role === "manajer_ops";
