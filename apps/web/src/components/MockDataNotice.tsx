import type { ReactNode } from "react";

/** Banner kecil dipakai di semua halaman yang daftarnya masih dari data referensi (bukan endpoint list sungguhan). Lihat docs/architecture-decisions.md § 15.1. */
export function MockDataNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <span className="mr-1 font-semibold">Data contoh:</span>
      {children}
    </div>
  );
}
