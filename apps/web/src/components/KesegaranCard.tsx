import { useEffect, useState } from "react";
import { listKesegaran, type KesegaranSumber } from "../api/sales-sync";
import { Card } from "./ui/Card";
import { Badge } from "./ui/Badge";

/** Kartu "baris terakhir masuk" per sumber sales-sync (Tahap 1E, 2026-11-14).
 * Murni baca, non-kritis -- kegagalan load tidak boleh mengganggu halaman tempat
 * kartu ini dipasang, cukup tidak tampil (pola sama RefundHariIniCard). */
export function KesegaranCard() {
  const [rows, setRows] = useState<KesegaranSumber[] | null>(null);

  useEffect(() => {
    let active = true;
    listKesegaran()
      .then((res) => {
        if (active) setRows(res);
      })
      .catch(() => {
        if (active) setRows(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (rows === null) return null;

  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">Kesegaran data sales-sync</h3>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-700">{r.label}</span>
            <div className="flex items-center gap-1.5 text-right">
              <span className="text-xs text-slate-500">{formatTerakhir(r)}</span>
              {r.merah ? <Badge tone="danger">Macet</Badge> : <Badge tone="success">Normal</Badge>}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Ambang per sumber: rata-rata jarak antar baris 7 hari terakhir x3 (otomatis), atau diatur manual
        lewat Pengaturan. Tidak ada baris sama sekali dalam 7 hari = langsung "Macet".
      </p>
    </Card>
  );
}

function formatTerakhir(r: KesegaranSumber): string {
  if (r.terakhirMasuk === null) return "Belum pernah ada baris";
  const jam = r.jamSejakTerakhir ?? 0;
  if (jam < 1) return "Baru saja";
  if (jam < 48) return `${Math.round(jam)} jam lalu`;
  return `${Math.round(jam / 24)} hari lalu`;
}
