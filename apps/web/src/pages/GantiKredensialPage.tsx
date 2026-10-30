import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { gantiKredensialSendiri } from "../api/auth";
import { ApiError } from "../api/client";
import { useIdentitasBisnis } from "../data/IdentitasBisnisContext";
import { Field, Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { ErrorBox } from "../components/ResultBox";

/**
 * Layar "Buat kredensial baru" (2026-10-30) -- dipaksa tampil begitu
 * `user.wajibGantiKredensial` aktif (owner baru me-reset kredensial user
 * ini). TIDAK dibungkus `AppLayout` (sengaja, tidak ada navigasi keluar
 * selain submit berhasil atau logout) -- redirect ke sini dipicu GLOBAL di
 * `api/client.ts` (`handleWajibGantiKredensial`) begitu endpoint APA PUN
 * selain `/auth/ganti-kredensial` balas 403 `WAJIB_GANTI_KREDENSIAL`.
 *
 * PIN (staf, 6 digit) vs password (role lain) ditentukan dari `user.role`
 * yang SUDAH diketahui `AuthContext` -- tidak perlu tanya ulang ke server.
 */
export function GantiKredensialPage() {
  const { user, setSession, logout } = useAuth();
  const { displayName } = useIdentitasBisnis();
  const navigate = useNavigate();

  const [kredensialLama, setKredensialLama] = useState("");
  const [kredensialBaru, setKredensialBaru] = useState("");
  const [konfirmasiBaru, setKonfirmasiBaru] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return <Navigate to="/login" replace />;
  // Tidak sedang dipaksa ganti (mis. user ketik URL ini sendiri secara
  // sukarela) -- tetap izinkan, cuma tidak ada redirect paksa yang
  // membawanya ke sini.

  const isPin = user.role === "staf";
  const label = isPin ? "PIN" : "password";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (isPin && !/^\d{6}$/.test(kredensialBaru)) {
      setError("PIN baru harus tepat 6 digit angka.");
      return;
    }
    if (!isPin && kredensialBaru.length < 8) {
      setError("Password baru minimal 8 karakter.");
      return;
    }
    if (kredensialBaru !== konfirmasiBaru) {
      setError(`${label} baru dan konfirmasinya tidak sama.`);
      return;
    }
    setSaving(true);
    try {
      const result = await gantiKredensialSendiri(kredensialLama, kredensialBaru);
      setSession(result);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Gagal mengganti ${label}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-slate-900">{displayName}</h1>
          <p className="text-sm text-slate-500">
            Kredensial Anda baru saja direset. Buat {label} baru dulu sebelum lanjut memakai aplikasi.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <Field label={`${label.charAt(0).toUpperCase()}${label.slice(1)} sementara (dari owner)`}>
            <Input
              type={isPin ? "text" : "password"}
              inputMode={isPin ? "numeric" : undefined}
              value={kredensialLama}
              onChange={(e) => setKredensialLama(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label={`${label.charAt(0).toUpperCase()}${label.slice(1)} baru`}>
            <Input
              type={isPin ? "text" : "password"}
              inputMode={isPin ? "numeric" : undefined}
              maxLength={isPin ? 6 : undefined}
              value={kredensialBaru}
              onChange={(e) => setKredensialBaru(e.target.value)}
              required
            />
          </Field>
          <Field label={`Ulangi ${label} baru`}>
            <Input
              type={isPin ? "text" : "password"}
              inputMode={isPin ? "numeric" : undefined}
              maxLength={isPin ? 6 : undefined}
              value={konfirmasiBaru}
              onChange={(e) => setKonfirmasiBaru(e.target.value)}
              required
            />
          </Field>

          {error ? <ErrorBox>{error}</ErrorBox> : null}

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Menyimpan..." : `Simpan ${label} baru`}
          </Button>
        </form>

        <button type="button" onClick={logout} className="w-full text-center text-sm text-slate-500 hover:text-slate-700">
          Keluar
        </button>
      </div>
    </div>
  );
}
