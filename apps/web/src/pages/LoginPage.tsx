import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LoginManajemenForm } from "./login/LoginManajemenForm";
import { LoginTimForm } from "./login/LoginTimForm";

type Tab = "tim" | "manajemen";

const TABS: { key: Tab; label: string }[] = [
  { key: "tim", label: "Login Tim" },
  { key: "manajemen", label: "Login Manajemen" },
];

export function LoginPage() {
  const { isAuthenticated } = useAuth();
  // Default "Login Tim" -- target utama HP/tablet staf outlet (lihat CLAUDE.md
  // §5), login manajemen (username/password) tetap ada sebagai tab kedua.
  const [tab, setTab] = useState<Tab>("tim");

  if (isAuthenticated) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-slate-900">Samsara Backoffice</h1>
          <p className="text-sm text-slate-500">Masuk untuk mengelola stok, HPP, dan transaksi.</p>
        </div>

        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "tim" ? <LoginTimForm /> : <LoginManajemenForm />}
      </div>
    </div>
  );
}
