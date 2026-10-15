/** `orange` = tingkat keparahan MENENGAH, di antara `warning` (kuning) dan `danger` (merah) --
 * dipakai untuk ringkasan hasil override cuti darurat level 2 (lihat PengajuanLiburTab).
 *
 * `info` (biru) = keterangan NETRAL, bukan tingkat keparahan dan bukan "bagus/buruk" -- dipakai
 * untuk membedakan dua kondisi yang dua-duanya normal (mis. asal pencatatan transaksi
 * "dari sinkronisasi" vs "input manual", lihat SumberPencatatanBadge). Sengaja bukan `success`
 * (hijau) supaya tidak terbaca sebagai penilaian. */
type Tone = "neutral" | "info" | "warning" | "orange" | "success" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-blue-100 text-blue-800",
  warning: "bg-amber-100 text-amber-800",
  orange: "bg-orange-100 text-orange-800",
  success: "bg-emerald-100 text-emerald-800",
  danger: "bg-red-100 text-red-700",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

/** Badge khusus status pending_data -- dipakai berulang di banyak halaman. */
export function StatusPendingBadge({ status }: { status: "ok" | "pending_data" }) {
  if (status === "ok") return <Badge tone="success">Lengkap</Badge>;
  return <Badge tone="warning">Menunggu data</Badge>;
}

/** Badge status permintaan transfer (outlet <-> CK) -- dipakai di tab Permintaan dan Laporan Harian. */
export function PermintaanStatusBadge({ status }: { status: "diminta" | "dipenuhi" | "dibatalkan" }) {
  if (status === "diminta") return <Badge tone="warning">Menunggu dipenuhi</Badge>;
  if (status === "dipenuhi") return <Badge tone="success">Dipenuhi</Badge>;
  return <Badge tone="neutral">Dibatalkan</Badge>;
}

/** Badge asal pencatatan satu baris penjualan (tab Riwayat Penjualan). DUA-DUANYA normal:
 * "Input manual" = ada orang yang mencatat lewat form Penjualan, "Dari sinkronisasi" = dibuat
 * otomatis dari file penjualan aplikasi pesan-antar. Jangan pakai warna peringatan untuk salah
 * satunya -- tidak ada yang salah di antara keduanya. */
export function SumberPencatatanBadge({ sumber }: { sumber: "manual" | "sinkronisasi" }) {
  if (sumber === "sinkronisasi") return <Badge tone="info">Dari sinkronisasi</Badge>;
  return <Badge tone="neutral">Input manual</Badge>;
}

/** Badge asal angka HPP historis satu baris penjualan (migrasi 0028, lihat `HppSumber` di
 * api/types.ts). Hanya ditampilkan untuk `'snapshot_estimasi'` -- menandai HPP baris itu bukan
 * harga historis asli, cuma perkiraan dari harga SAAT INI (backfill data transaksi lama). Netral
 * (abu-abu), bukan warning: estimasi di baris lama adalah kondisi normal, bukan kesalahan.
 * `'snapshot_asli'`/`null` tidak perlu badge apa-apa (itu kondisi standar). */
export function HppSumberBadge({ sumber }: { sumber: "snapshot_asli" | "snapshot_estimasi" | null }) {
  if (sumber !== "snapshot_estimasi") return null;
  return <Badge tone="neutral">Estimasi</Badge>;
}

/** Badge status pengajuan libur -- dipakai di tab Pengajuan Libur (halaman Jadwal & Izin). */
export function PengajuanLiburStatusBadge({ status }: { status: "diajukan" | "disetujui" | "ditolak" }) {
  if (status === "diajukan") return <Badge tone="warning">Menunggu</Badge>;
  if (status === "disetujui") return <Badge tone="success">Disetujui</Badge>;
  return <Badge tone="danger">Ditolak</Badge>;
}
