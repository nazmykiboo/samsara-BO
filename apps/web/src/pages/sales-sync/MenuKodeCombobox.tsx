import { useEffect, useMemo, useState } from "react";
import { listMenu } from "../../api/master";
import { Input } from "../../components/ui/Input";

/** Satu pilihan menu internal Samsara untuk dropdown pemetaan. */
export interface MenuOption {
  kode: string;
  name: string;
  kategori: string;
}

export interface MenuOptionsState {
  options: MenuOption[];
  loading: boolean;
  error: string | null;
}

/**
 * Ambil daftar menu internal SEKALI lalu simpan di state -- dipanggil di level HALAMAN, bukan di
 * dalam tiap baris: daftar item belum dipetakan bisa panjang, dan `MenuPicker` yang sudah ada
 * mengambil ulang daftar menu setiap kali DIPASANG (lihat catatan di
 * components/pickers/MenuPicker.tsx), jadi memakainya per baris = satu request per baris.
 *
 * Penyaringan dilakukan di sisi klien saat user mengetik (pola persis sama seperti MenuPicker /
 * ItemPicker), bukan request pencarian ke server.
 */
export function useMenuOptions(): MenuOptionsState {
  const [options, setOptions] = useState<MenuOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listMenu()
      .then((menu) => {
        if (!active) return;
        // Menu nonaktif / tanpa kode disaring: tidak ada gunanya memetakan item platform ke menu
        // yang sudah tidak dijual (pola penyaringan sama seperti MenuPicker).
        setOptions(
          menu
            .filter((m): m is typeof m & { kode: string } => m.kode !== null && m.isActive)
            .map((m) => ({ kode: m.kode, name: m.name, kategori: m.kategori ?? "" })),
        );
      })
      .catch(() => {
        if (active) setError("Gagal memuat daftar menu Samsara. Muat ulang halaman lalu coba lagi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { options, loading, error };
}

/**
 * Kotak pencarian + daftar pilihan menu internal. Begitu satu menu dipilih, `onPilih` langsung
 * dipanggil (tidak ada tombol "Simpan" terpisah) -- sesuai alur di halaman Sinkronisasi Penjualan.
 */
export function MenuKodeCombobox({
  menu,
  onPilih,
  disabled = false,
  placeholder = "Cari nama atau kode menu...",
  ariaLabel = "Cari menu Samsara",
}: {
  menu: MenuOptionsState;
  onPilih: (option: MenuOption) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Label untuk pembaca layar -- labelnya di halaman ini berupa teks biasa, bukan <label> yang
   * terikat ke input (lihat ItemBelumDipetakanSection). */
  ariaLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return menu.options.slice(0, 20);
    return menu.options
      .filter((m) => m.name.toLowerCase().includes(q) || m.kode.toLowerCase().includes(q))
      .slice(0, 20);
  }, [menu.options, query]);

  return (
    <div className="relative">
      <Input
        aria-label={ariaLabel}
        placeholder={menu.loading ? "Memuat daftar menu..." : placeholder}
        value={query}
        disabled={disabled || menu.loading}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Jeda singkat sebelum menutup supaya klik pada pilihan tetap terdaftar lebih dulu
        // (pola sama seperti MenuPicker/ItemPicker).
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && !disabled ? (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {menu.error ? <p className="px-3 py-2 text-sm text-red-600">{menu.error}</p> : null}
          {!menu.error && results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">Tidak ada menu yang cocok.</p>
          ) : (
            results.map((option) => (
              <button
                key={option.kode}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPilih(option);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">{option.name}</span>
                <span className="text-xs text-slate-500">
                  {option.kode}
                  {option.kategori ? ` · ${option.kategori}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
