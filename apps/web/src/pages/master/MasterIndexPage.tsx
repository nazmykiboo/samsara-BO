import { useState } from "react";
import { ItemTab } from "./ItemTab";
import { ResepProduksiTab } from "./ResepProduksiTab";
import { ResepMenuTab } from "./ResepMenuTab";

type Tab = "item" | "resep_produksi" | "resep_menu";

const TABS: { key: Tab; label: string }[] = [
  { key: "item", label: "Item" },
  { key: "resep_produksi", label: "Resep Produksi" },
  { key: "resep_menu", label: "Resep Menu" },
];

export function MasterIndexPage() {
  const [tab, setTab] = useState<Tab>("item");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Master Item & Resep</h1>
        <p className="text-sm text-slate-500">Kelola data induk item, resep produksi, dan resep menu.</p>
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

      {tab === "item" ? <ItemTab /> : null}
      {tab === "resep_produksi" ? <ResepProduksiTab /> : null}
      {tab === "resep_menu" ? <ResepMenuTab /> : null}
    </div>
  );
}
