import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOGO_URL, getIdentitasBisnis } from "../api/identitas-bisnis";

/**
 * Nama tampilan + ada/tidaknya logo -- diambil SEKALI saat app mount dari
 * endpoint publik `GET /api/core/identitas-bisnis` (tidak perlu login),
 * dipakai sidebar/judul tab/halaman login. Default sebelum berhasil memuat
 * TETAP "Samsara Backoffice" (bukan string kosong) supaya tidak ada "flash"
 * tampilan kosong saat pertama render.
 */
interface IdentitasBisnisContextValue {
  displayName: string;
  logoUrl: string | null;
  loading: boolean;
  muatUlang: () => void;
}

const DEFAULT_NAME = "Samsara Backoffice";

const IdentitasBisnisContext = createContext<IdentitasBisnisContextValue | null>(null);

export function IdentitasBisnisProvider({ children }: { children: ReactNode }) {
  const [displayName, setDisplayName] = useState(DEFAULT_NAME);
  const [hasLogo, setHasLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [versi, setVersi] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getIdentitasBisnis()
      .then((res) => {
        if (!active) return;
        setDisplayName(res.displayName);
        setHasLogo(res.hasLogo);
        document.title = res.displayName;
      })
      .catch(() => {
        // Gagal muat -> biarkan default DEFAULT_NAME, tanpa logo. Tidak
        // ditampilkan sebagai error ke user -- ini murni tampilan kosmetik,
        // bukan data yang keputusan bisnisnya bergantung padanya.
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [versi]);

  // Cache-buster `versi` di query string -- browser kalau tidak akan terus
  // menampilkan logo LAMA dari cache gambar setelah diganti (URL-nya sama
  // persis, GET /identitas-bisnis/logo).
  const logoUrl = hasLogo ? `${LOGO_URL}?v=${versi}` : null;

  const value = useMemo<IdentitasBisnisContextValue>(
    () => ({ displayName, logoUrl, loading, muatUlang: () => setVersi((v) => v + 1) }),
    [displayName, logoUrl, loading],
  );

  return <IdentitasBisnisContext.Provider value={value}>{children}</IdentitasBisnisContext.Provider>;
}

export function useIdentitasBisnis(): IdentitasBisnisContextValue {
  const ctx = useContext(IdentitasBisnisContext);
  if (!ctx) throw new Error("useIdentitasBisnis dipanggil di luar <IdentitasBisnisProvider>");
  return ctx;
}
