import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LokasiProvider } from "./data/LokasiContext";
import { IdentitasBisnisProvider } from "./data/IdentitasBisnisContext";
import { RequireAuth } from "./auth/RequireAuth";
import { bisaLihatLaporanHarian } from "./auth/permissions";
import { AppLayout } from "./layout/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { GantiKredensialPage } from "./pages/GantiKredensialPage";
import { MenuHppPage } from "./pages/MenuHppPage";
import { StokPage } from "./pages/StokPage";
import { LaporanHarianPage } from "./pages/LaporanHarianPage";
import { TransaksiIndexPage } from "./pages/transaksi/TransaksiIndexPage";
import { MasterIndexPage } from "./pages/master/MasterIndexPage";
import { PengaturanPage } from "./pages/PengaturanPage";
import { JadwalIzinPage } from "./pages/JadwalIzinPage";
import { PanduanPage } from "./pages/PanduanPage";
import { SinkronisasiPenjualanPage } from "./pages/sales-sync/SinkronisasiPenjualanPage";
import { AnalitikPage } from "./pages/analitik/AnalitikPage";

/** Redirect halaman utama setelah login: owner/manajer_ops/supervisor -> Laporan Harian
 * (ringkasan operasional harian), staf -> tetap ke Menu & HPP seperti sebelumnya (jangan
 * ubah pengalaman staf). Perlu komponen terpisah karena <Navigate> butuh tahu role dari
 * useAuth(), tidak bisa dibaca langsung di definisi <Route> JSX statis. */
function BerandaRedirect() {
  const { user } = useAuth();
  if (user && bisaLihatLaporanHarian(user.role)) {
    return <Navigate to="/laporan-harian" replace />;
  }
  return <Navigate to="/menu" replace />;
}

export function App() {
  return (
    <IdentitasBisnisProvider>
      <LokasiProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </LokasiProvider>
    </IdentitasBisnisProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* SENGAJA di luar <AppLayout> (tanpa nav/sidebar) -- halaman ini dipaksa
          tampil justru karena endpoint lain ditolak 403 WAJIB_GANTI_KREDENSIAL,
          jadi nav yang memanggil endpoint lain di latar belakang cuma akan
          memicu redirect balik ke sini berulang-ulang kalau dibungkus AppLayout. */}
      <Route
        path="/ganti-kredensial"
        element={
          <RequireAuth>
            <GantiKredensialPage />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<BerandaRedirect />} />
        <Route path="/menu" element={<MenuHppPage />} />
        <Route path="/stok" element={<StokPage />} />
        <Route path="/transaksi" element={<TransaksiIndexPage />} />
        <Route path="/jadwal-izin" element={<JadwalIzinPage />} />
        <Route path="/panduan" element={<PanduanPage />} />
        <Route
          path="/laporan-harian"
          element={
            <RequireAuth roles={["owner", "manajer_ops", "supervisor"]}>
              <LaporanHarianPage />
            </RequireAuth>
          }
        />
        {/* Analitik LEBIH SEMPIT dari Laporan Harian: supervisor tidak ikut (permission
            `analitik.lihat` di backend cuma owner/manajer_ops). */}
        <Route
          path="/analitik"
          element={
            <RequireAuth roles={["owner", "manajer_ops"]}>
              <AnalitikPage />
            </RequireAuth>
          }
        />
        <Route
          path="/sinkronisasi-penjualan"
          element={
            <RequireAuth roles={["owner", "manajer_ops"]}>
              <SinkronisasiPenjualanPage />
            </RequireAuth>
          }
        />
        <Route
          path="/master"
          element={
            <RequireAuth roles={["owner", "manajer_ops"]}>
              <MasterIndexPage />
            </RequireAuth>
          }
        />
        <Route
          path="/pengaturan"
          element={
            <RequireAuth roles={["owner", "manajer_ops"]}>
              <PengaturanPage />
            </RequireAuth>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
