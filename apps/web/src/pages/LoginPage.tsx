import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { SESSION_NOTICE_KEY } from "../api/client";
import { LoginManajemenForm } from "./login/LoginManajemenForm";
import { LoginTimForm } from "./login/LoginTimForm";

/**
 * Pesan "kenapa saya tiba-tiba di sini" yang ditulis `api/client.ts` saat
 * sebuah request dapat 401 di tengah sesi (mis. akun dinonaktifkan atau PIN
 * di-reset owner -- lihat core_users.token_version). Dibaca SEKALI lalu
 * dihapus, supaya tidak muncul lagi di kunjungan berikutnya ke /login.
 * Dibaca di initializer useState (bukan useEffect) supaya tidak kedip
 * dua-render dan tidak dobel-baca di StrictMode.
 */
function ambilNoticeSekali(): string | null {
  const pesan = sessionStorage.getItem(SESSION_NOTICE_KEY);
  if (pesan) sessionStorage.removeItem(SESSION_NOTICE_KEY);
  return pesan;
}

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
  const [notice] = useState<string | null>(ambilNoticeSekali);

  if (isAuthenticated) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-slate-900">Samsara Backoffice</h1>
          <p className="text-sm text-slate-500">Masuk untuk mengelola stok, HPP, dan transaksi.</p>
        </div>

        {notice ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
            {notice}
          </p>
        ) : null}

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
