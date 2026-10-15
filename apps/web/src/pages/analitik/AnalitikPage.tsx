import { useState } from "react";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { usePermission } from "../../auth/usePermission";
import { formatTanggalSingkat } from "../../utils/format";
import { OperasionalTab } from "./OperasionalTab";
import { PenjualanTab } from "./PenjualanTab";

type Tab = "penjualan" | "operasional";

const TABS: { key: Tab; label: string }[] = [
  { key: "penjualan", label: "Penjualan" },
  { key: "operasional", label: "Operasional" },
];

/**
 * Halaman "Analitik" -- owner/manajer_ops saja (permission `analitik.lihat`).
 *
 * Route-nya sudah digate `RequireAuth roles={["owner","manajer_ops"]}` di App.tsx; pengecekan
 * `usePermission` di sini lapis kedua, pola sama seperti SinkronisasiPenjualanPage.
 *
 * Filter (lokasi + periode) ditaruh di halaman ini, BUKAN di masing-masing tab, supaya pindah tab
 * tidak mengubah apa yang sedang dilihat. Nilai filternya diturunkan sebagai props; tiap tab yang
 * mengambil datanya sendiri (dua endpoint berbeda, dan hanya tab yang dibuka yang perlu dimuat).
 */
export function AnalitikPage() {
  const bisaLihat = usePermission("analitik.lihat");
  const lokasiOptions = useLokasiOptions();
  const [tab, setTab] = useState<Tab>("penjualan");
  // null = semua lokasi (query ?lokasi= tidak dikirim). Default sengaja "semua lokasi", beda dari
  // Laporan Harian yang memang per-lokasi -- halaman ini dipakai untuk melihat gambaran besar.
  const [lokasiId, setLokasiId] = useState<number | null>(null);
  // Kosong = minggu hari ini menurut server (biarkan backend yang menentukan "hari ini" -- dia
  // yang tahu timezone Asia/Jakarta, jangan dihitung dari jam device).
  const [periode, setPeriode] = useState("");

  if (!bisaLihat) return null;

  const lokasiNama = lokasiId === null ? null : (lokasiOptions.find((l) => l.id === lokasiId)?.name ?? null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Analitik</h1>
        <p className="text-sm text-slate-500">
          Perbandingan penjualan antar minggu dan tren operasional 8 minggu terakhir, untuk melihat arah pergerakan
          &mdash; bukan laporan harian yang rinci.
        </p>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Lokasi">
            <Select
              value={lokasiId ?? ""}
              onChange={(e) => setLokasiId(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">Semua lokasi</option>
              {lokasiOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Periode">
            <Input type="date" value={periode} onChange={(e) => setPeriode(e.target.value)} />
          </Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Isi tanggal mana pun dalam minggu yang mau dilihat &mdash; satu minggu penuhnya otomatis terpilih. Kosongkan
          untuk memakai minggu ini.
        </p>
        {periode ? (
          <button
            type="button"
            onClick={() => setPeriode("")}
            className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Kembali ke minggu ini
          </button>
        ) : null}
      </Card>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "penjualan" ? <PenjualanTab periode={periode} lokasiId={lokasiId} /> : null}
      {tab === "operasional" ? (
        <OperasionalTab periode={periode} lokasiId={lokasiId} lokasiNama={lokasiNama} />
      ) : null}

      <p className="text-xs text-slate-400">
        Menampilkan data untuk {lokasiNama ?? "semua lokasi"}
        {periode ? `, minggu yang memuat tanggal ${formatTanggalSingkat(periode)}` : ", minggu ini"}.
      </p>
    </div>
  );
}
