import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { bisaAksesPengaturan, bisaKelolaMaster, bisaLihatLaporanHarian } from "../auth/permissions";
import { usePermission } from "../auth/usePermission";

interface NavItem {
  to: string;
  label: string;
  icon: string; // emoji sederhana -- cukup untuk v1, bisa diganti ikon SVG nanti
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Dikelompokkan jadi beberapa grup supaya tetap gampang dipindai meski jumlah halaman bertambah
 * (7+ item kalau ditampilkan flat). Grup yang isinya kosong untuk role tertentu sengaja tidak
 * dimasukkan sama sekali -- jangan tampilkan header grup kosong. */
function useNavGroups(): NavGroup[] {
  const { user } = useAuth();
  // WAJIB dipanggil SEBELUM early return di bawah -- usePermission adalah hook (dia sendiri
  // memanggil useAuth), jadi tidak boleh dipanggil di belakang percabangan. Aman: hook itu
  // mengembalikan false kalau belum ada user yang login.
  const bisaSinkronisasiPenjualan = usePermission("sales_sync.manage");
  const bisaLihatAnalitik = usePermission("analitik.lihat");

  if (!user) return [];

  const groups: NavGroup[] = [];

  const operasional: NavItem[] = [];
  if (bisaLihatLaporanHarian(user.role)) {
    operasional.push({ to: "/laporan-harian", label: "Laporan Harian", icon: "📊" });
  }
  // Ditaruh persis setelah Laporan Harian: dua-duanya "melihat data", cuma beda rentang waktu
  // (satu hari vs antar minggu), jadi orang mencarinya di tempat yang sama. Sengaja TIDAK dibuat
  // grup baru sendiri -- grup berisi satu item cuma menambah baris header di sidebar.
  if (bisaLihatAnalitik) {
    operasional.push({ to: "/analitik", label: "Analitik", icon: "📈" });
  }
  operasional.push({ to: "/transaksi", label: "Transaksi", icon: "🧾" });
  operasional.push({ to: "/stok", label: "Stok", icon: "📦" });
  if (bisaSinkronisasiPenjualan) {
    operasional.push({ to: "/sinkronisasi-penjualan", label: "Sinkronisasi Penjualan", icon: "🔄" });
  }
  if (operasional.length > 0) groups.push({ label: "Operasional Harian", items: operasional });

  const dataMaster: NavItem[] = [{ to: "/menu", label: "Menu & HPP", icon: "🍜" }];
  if (bisaKelolaMaster(user.role)) {
    dataMaster.push({ to: "/master", label: "Master", icon: "🛠️" });
  }
  if (dataMaster.length > 0) groups.push({ label: "Data Master", items: dataMaster });

  groups.push({ label: "Tim", items: [{ to: "/jadwal-izin", label: "Jadwal & Izin", icon: "🗓️" }] });

  if (bisaAksesPengaturan(user.role)) {
    groups.push({ label: "Pengaturan", items: [{ to: "/pengaturan", label: "Pengaturan", icon: "⚙️" }] });
  }

  groups.push({ label: "Bantuan", items: [{ to: "/panduan", label: "Panduan", icon: "📖" }] });

  return groups;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manajer_ops: "Manajer Ops",
  supervisor: "Supervisor",
  staf: "Staf",
};

function NavGroupList({
  groups,
  onNavigate,
}: {
  groups: NavGroup[];
  /** Dipanggil begitu satu link ditekan -- dipakai drawer mobile untuk menutup dirinya sendiri. */
  onNavigate?: () => void;
}) {
  return (
    <>
      {groups.map((g, idx) => (
        <div key={g.label} className={idx > 0 ? "mt-4 border-t border-slate-100 pt-4" : ""}>
          <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>
          <div className="space-y-1">
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const groups = useNavGroups();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 sm:flex-row">
      {/* Sidebar -- tampil mulai breakpoint sm ke atas */}
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white sm:flex sm:flex-col">
        <div className="border-b border-slate-200 px-4 py-4">
          <p className="text-sm font-semibold text-slate-900">Samsara Backoffice</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          <NavGroupList groups={groups} />
        </nav>
        <UserFooter role={user?.role} username={user?.username} onLogout={logout} />
      </aside>

      {/* Top bar -- tampil di mobile saja, dengan tombol hamburger untuk buka drawer menu
          (menggantikan bottom tab bar lama yang sudah kepenuhan sejak menu bertambah). */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-3 sm:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Buka menu navigasi"
            className="rounded-lg p-2 text-xl text-slate-600 hover:bg-slate-100"
          >
            <span aria-hidden>☰</span>
          </button>
          <p className="text-sm font-semibold text-slate-900">Samsara Backoffice</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p className="font-medium text-slate-700">{user?.username}</p>
          <p>{user ? ROLE_LABEL[user.role] : ""}</p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-6">
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6">
          <Outlet />
        </div>
      </main>

      {/* Drawer menu -- mobile saja. Tertutup lagi saat: tap link (navigasi), tap area luar (backdrop),
          atau tap tombol close eksplisit. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 sm:hidden" role="dialog" aria-modal="true" aria-label="Menu navigasi">
          <button
            type="button"
            aria-label="Tutup menu"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
              <p className="text-sm font-semibold text-slate-900">Samsara Backoffice</p>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Tutup menu"
                className="text-lg text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3">
              <NavGroupList groups={groups} onNavigate={() => setDrawerOpen(false)} />
            </nav>
            <UserFooter role={user?.role} username={user?.username} onLogout={logout} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserFooter({
  role,
  username,
  onLogout,
}: {
  role?: string;
  username?: string;
  onLogout: () => void;
}) {
  return (
    <div className="border-t border-slate-200 p-3">
      <p className="truncate text-sm font-medium text-slate-800">{username}</p>
      <p className="mb-2 text-xs text-slate-500">{role ? ROLE_LABEL[role] : ""}</p>
      <button
        onClick={onLogout}
        className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100"
      >
        Keluar
      </button>
    </div>
  );
}
