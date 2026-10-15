import { useState } from "react";
import { JadwalTab } from "./hr/JadwalTab";
import { PengajuanLiburTab } from "./hr/PengajuanLiburTab";

type Tab = "jadwal" | "libur";

const TABS: { key: Tab; label: string }[] = [
  { key: "jadwal", label: "Jadwal" },
  { key: "libur", label: "Pengajuan Libur" },
];

export function JadwalIzinPage() {
  const [tab, setTab] = useState<Tab>("jadwal");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Jadwal & Izin</h1>
        <p className="text-sm text-slate-500">Lihat/atur jadwal shift tim, dan ajukan atau kelola pengajuan libur.</p>
      </div>

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

      {tab === "jadwal" ? <JadwalTab /> : null}
      {tab === "libur" ? <PengajuanLiburTab /> : null}
    </div>
  );
}
