import type { ReactNode } from "react";
import { Button } from "./ui/Button";

/** Popup umum untuk konten yang lebih panjang dari `ConfirmDialog` (formulir, daftar, dll) --
 * scroll internal supaya tetap muat di layar HP, klik area gelap di luar atau tombol "Tutup"
 * untuk menutup. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-6" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <Button type="button" variant="ghost" onClick={onClose} className="shrink-0 px-2 py-1 text-xs">
            Tutup
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
