/**
 * Klien HTTP loopback ke modul lain dalam proses API yang SAMA.
 *
 * Pola identik dengan `modules/sales-sync/src/lib/internal-api.ts` --
 * lihat alasan lengkapnya di sana (isolasi antar modul bisnis di CLAUDE.md
 * § "Module manifest": modul HANYA boleh bicara ke modul bisnis lain lewat
 * API yang diekspos, tidak pernah query tabel modul lain secara langsung).
 * Dipakai di sini oleh guard "tolak nonaktifkan lokasi kalau masih ada
 * jadwal shift ke depan" (`pengaturan.ts`, `updateLokasi`) -- jadwal shift
 * adalah tabel `hr_jadwal_shift`, milik modul HR, bukan Inventory.
 */

const PORT = process.env.PORT ?? "4000";
const BASE_URL = `http://localhost:${PORT}`;

/** Jarak jauh ke depan dianggap "selamanya" untuk keperluan guard ini -- 10 tahun lebih dari cukup. */
const TAHUN_KE_DEPAN_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * GET /api/hr/jadwal-shift?dari=hari ini&sampai=+10 tahun&lokasiId=X.
 * Mengembalikan `true` kalau ADA minimal satu baris jadwal (hari ini atau
 * sesudahnya) di lokasi tersebut. Melempar Error dengan pesan dari HR kalau
 * ditolak (mis. modul HR nonaktif -- lihat module manifest).
 */
export async function adaJadwalKeDepanViaApi(authHeader: string, lokasiId: number): Promise<boolean> {
  const dari = new Date().toISOString().slice(0, 10);
  const sampai = new Date(Date.now() + TAHUN_KE_DEPAN_MS).toISOString().slice(0, 10);
  const url = `${BASE_URL}/api/hr/jadwal-shift?dari=${dari}&sampai=${sampai}&lokasiId=${lokasiId}`;
  const res = await fetch(url, { headers: { Authorization: authHeader } });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Gagal mengecek jadwal shift (HTTP ${res.status})`;
    throw new Error(message);
  }
  return Array.isArray(data) && data.length > 0;
}

/** Satu entri hasil `GET /api/sales-sync/refund` -- lihat `RefundEntry` di
 * `modules/sales-sync/src/domain/refund.ts` untuk arti field opsional/null-nya.
 * `refundAmount` SENGAJA opsional di sini (bukan `| null`) -- Sales-Sync
 * sudah menghapus key itu dari respons kalau user yang memanggil (lewat
 * `authHeader` yang diteruskan apa adanya) tidak punya `hpp.lihat_harga`,
 * jadi stripping-nya otomatis ikut tanpa Inventory perlu cek ulang. */
export interface RefundViaApi {
  orderId: string;
  platform: string;
  itemName: string | null;
  qty: number | null;
  refundAmount?: number | null;
  refundDate: string;
  refundReason: string | null;
}

/**
 * GET /api/sales-sync/refund?tanggal_mulai&tanggal_selesai -- dipakai
 * Riwayat Transaksi (`getDetailTransaksiPenjualan`) untuk menghubungkan
 * baris transaksi ke refund-nya (lewat `no_referensi` = `orderId`). Murni
 * informasional -- pemanggil WAJIB menangani kegagalan ini dengan lembut
 * (Riwayat Transaksi tetap harus tampil walau pengambilan refund gagal),
 * BUKAN melempar error yang menggagalkan seluruh request.
 */
export async function listRefundViaApi(
  authHeader: string,
  tanggalMulai: string,
  tanggalSelesai: string,
): Promise<RefundViaApi[]> {
  const url = `${BASE_URL}/api/sales-sync/refund?tanggal_mulai=${tanggalMulai}&tanggal_selesai=${tanggalSelesai}`;
  const res = await fetch(url, { headers: { Authorization: authHeader } });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Gagal mengambil data refund (HTTP ${res.status})`;
    throw new Error(message);
  }
  return Array.isArray(data) ? (data as RefundViaApi[]) : [];
}
