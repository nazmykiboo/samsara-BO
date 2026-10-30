import type { StatusOtomatis } from "../../api/otomatis";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";

const LABEL_JENIS: Record<string, string> = {
  "log-penjualan": "Log Penjualan",
  transaksi: "Transaksi",
  "raw-majoo": "Raw Transaksi Majoo",
  "biaya-platform": "Biaya Platform",
};

const JENIS_URUT = ["log-penjualan", "transaksi", "raw-majoo", "biaya-platform"];

function formatWaktu(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Ringkasan dashboard halaman Sinkronisasi -- bagian 1 dari 4 (urutan baru 2026-10-30, lihat
 * SinkronisasiPenjualanPage). Murni tampilan, tidak ada aksi di sini.
 *
 * `jumlahBelumDipetakan` diteruskan dari state halaman (BUKAN dari `status.imporTerakhir`) karena
 * daftar itu sudah dimuat untuk Bagian 2 -- tidak perlu diminta dua kali dari sumber berbeda.
 */
export function DashboardSinkronisasiSection({
  status,
  loading,
  error,
  jumlahBelumDipetakan,
}: {
  status: StatusOtomatis | null;
  loading: boolean;
  error: string | null;
  jumlahBelumDipetakan: number;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Ringkasan</h2>
        <p className="text-sm text-slate-500">Status impor terbaru dan hal yang perlu perhatian.</p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {loading && !status ? <p className="text-sm text-slate-400">Memuat ringkasan...</p> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="text-center">
          <p className="text-2xl font-semibold text-slate-900">{jumlahBelumDipetakan}</p>
          <p className="text-xs text-slate-500">Item belum dipetakan</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-semibold text-slate-900">{status?.perluDitinjau ?? "-"}</p>
          <p className="text-xs text-slate-500">Perlu ditinjau (retur/EXCEPTION)</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-semibold text-slate-900">{status?.tertahan ?? "-"}</p>
          <p className="text-xs text-slate-500">Tertahan (belum terpetakan)</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-semibold text-slate-900">
            {status?.pengaturan.aktif ? <Badge tone="success">Aktif</Badge> : <Badge tone="neutral">Mati</Badge>}
          </p>
          <p className="text-xs text-slate-500">Pemrosesan otomatis</p>
        </Card>
      </div>

      {status ? (
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Impor terakhir per sumber</h3>
          <div className="space-y-2">
            {JENIS_URUT.map((jenis) => {
              const data = status.imporTerakhir.find((i) => i.jenisImpor === jenis);
              return (
                <div key={jenis} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-700">{LABEL_JENIS[jenis] ?? jenis}</span>
                  {data ? (
                    <span className="text-right text-xs text-slate-500">
                      {formatWaktu(data.dijalankanPada)} &middot; {data.dibuat} dibuat, {data.diperbarui} diperbarui
                      {data.jumlahError > 0 ? (
                        <span className="text-red-600"> &middot; {data.jumlahError} error</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">Belum pernah diimpor</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {status?.otomatisTerakhir ? (
        <Card>
          <h3 className="mb-1 text-sm font-semibold text-slate-900">Pemrosesan otomatis terakhir</h3>
          <p className="text-xs text-slate-500">
            {formatWaktu(status.otomatisTerakhir.dijalankanPada)} (dipicu oleh{" "}
            {status.otomatisTerakhir.dipicuOleh === "impor" ? "impor data" : "penyimpanan pemetaan item"}) &middot;{" "}
            {status.otomatisTerakhir.transaksiDibuat} transaksi dibuat dari {status.otomatisTerakhir.barisDiproses}{" "}
            baris.
          </p>
          {status.otomatisTerakhir.gagal > 0 ? (
            <p className="mt-1 text-xs text-red-600">
              {status.otomatisTerakhir.gagal} order gagal.{" "}
              {status.otomatisTerakhir.pesanErrorTerakhir ? `Contoh: ${status.otomatisTerakhir.pesanErrorTerakhir}` : ""}
            </p>
          ) : null}
        </Card>
      ) : null}
    </section>
  );
}
