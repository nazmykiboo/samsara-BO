import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { mulaiTautanTelegram, statusTautanTelegram } from "../api/notifikasi";
import type { MulaiTautanTelegramResult, TautanTelegramStatus } from "../api/types";
import { ApiError } from "../api/client";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { ErrorBox } from "../components/ResultBox";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manajer_ops: "Manajer Ops",
  supervisor: "Supervisor",
  staf: "Staf",
};

/**
 * Halaman "Akun Saya" (2026-11-14, BARU) -- SEMUA role login, isinya cuma
 * "Hubungkan Telegram" untuk v1 (profil dasar bisa ditambah belakangan kalau
 * dibutuhkan, bukan scope instruksi ini). Status tautan dicek sendiri (bukan
 * dari `AuthContext` -- token JWT tidak membawa info ini, dan status bisa
 * berubah tanpa perlu login ulang).
 */
export function AkunSayaPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<TautanTelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kode, setKode] = useState<MulaiTautanTelegramResult | null>(null);
  const [memulai, setMemulai] = useState(false);

  useEffect(() => {
    let active = true;
    statusTautanTelegram()
      .then((res) => {
        if (active) setStatus(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat status Telegram.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleMulaiTautan() {
    setError(null);
    setMemulai(true);
    try {
      setKode(await mulaiTautanTelegram());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal membuat kode tautan.");
    } finally {
      setMemulai(false);
    }
  }

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Akun Saya</h1>
        <p className="text-sm text-slate-500">
          {user?.username} · {user ? ROLE_LABEL[user.role] ?? user.role : ""}
        </p>
      </div>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Notifikasi Telegram</h2>
        <p className="mb-3 text-sm text-slate-500">
          Hubungkan akun Telegram Anda supaya menerima notifikasi (permintaan masuk, persetujuan, dll)
          langsung lewat chat, tanpa harus buka aplikasi terus-menerus.
        </p>

        {loading ? <Spinner label="Memeriksa status..." /> : null}
        {error ? <ErrorBox>{error}</ErrorBox> : null}

        {!loading && status?.terhubung ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            ✅ Sudah terhubung{status.terhubungPada ? ` sejak ${new Date(status.terhubungPada).toLocaleString("id-ID")}` : ""}.
          </p>
        ) : null}

        {!loading && !status?.terhubung && !kode ? (
          <Button onClick={handleMulaiTautan} disabled={memulai}>
            {memulai ? "Membuat kode..." : "Hubungkan Telegram"}
          </Button>
        ) : null}

        {kode ? (
          <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-slate-700">
            <p>
              1. Buka Telegram, cari bot notifikasi yang diberitahukan owner.
              <br />
              2. Kirim pesan: <code className="rounded bg-white px-1.5 py-0.5 font-mono">/link {kode.kode}</code>
              <br />
              3. Halaman ini akan otomatis menampilkan "Sudah terhubung" (refresh kalau belum berubah).
            </p>
            <p className="text-xs text-slate-500">
              Kode berlaku sampai {new Date(kode.kadaluwarsaPada).toLocaleTimeString("id-ID")} -- kalau kedaluwarsa, tekan
              "Hubungkan Telegram" lagi untuk kode baru.
            </p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
