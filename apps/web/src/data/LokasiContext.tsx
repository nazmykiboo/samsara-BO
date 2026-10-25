import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { listLokasiPublik } from "../api/lokasi-publik";
import type { LokasiPublik } from "../api/types";

/**
 * Daftar lokasi PUBLIK (lihat GET /api/core/lokasi) -- diambil SEKALI saat
 * app mount, dipakai di mana pun (picker, flow login PIN staf SEBELUM ada
 * token auth, dsb). Dimount di App.tsx SEJAJAR AuthProvider (bukan di
 * dalamnya) supaya tersedia juga di halaman /login.
 *
 * Mengganti `MOCK_LOKASI` (snapshot statis 2 baris di mock/referenceData.ts)
 * yang sebelumnya dipakai karena endpoint ini belum ada -- lihat
 * docs/architecture-decisions.md §25 (riwayat) dan §26 kalau sudah ditulis.
 */
interface LokasiContextValue {
  lokasi: LokasiPublik[];
  loading: boolean;
  error: string | null;
  /** Panggil ulang setelah lokasi baru dibuat/diubah dari halaman Pengaturan, supaya picker lain ikut segar tanpa reload. */
  muatUlang: () => void;
}

const LokasiContext = createContext<LokasiContextValue | null>(null);

export function LokasiProvider({ children }: { children: ReactNode }) {
  const [lokasi, setLokasi] = useState<LokasiPublik[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listLokasiPublik()
      .then((rows) => {
        if (active) setLokasi(rows);
      })
      .catch(() => {
        if (active) setError("Gagal memuat daftar lokasi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [versi]);

  const value = useMemo<LokasiContextValue>(
    () => ({ lokasi, loading, error, muatUlang: () => setVersi((v) => v + 1) }),
    [lokasi, loading, error],
  );

  return <LokasiContext.Provider value={value}>{children}</LokasiContext.Provider>;
}

export function useLokasiContext(): LokasiContextValue {
  const ctx = useContext(LokasiContext);
  if (!ctx) throw new Error("useLokasiContext dipanggil di luar <LokasiProvider>");
  return ctx;
}
