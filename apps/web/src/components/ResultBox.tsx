import type { ReactNode } from "react";

export function ResultBox({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{children}</div>;
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {children}
    </p>
  );
}

/** Peringatan NON-BLOKIR (kuning, bukan merah/error) -- dipakai untuk kondisi yang tetap berhasil
 * tapi perlu perhatian user, mis. pengajuan libur yang melebihi kuota bulanan (tetap tersimpan). */
export function WarningBox({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
      {children}
    </p>
  );
}
