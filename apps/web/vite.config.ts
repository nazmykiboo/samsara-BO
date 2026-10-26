import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dev proxy ke apps/api (localhost:4000) supaya browser memanggil path
// relatif (/api/..., /health) dan tidak kena CORS -- backend belum punya
// header CORS sama sekali (lihat laporan struktur untuk owner). Untuk
// production nanti (Tahap 4) perlu reverse proxy satu origin atau CORS di
// backend -- belum diputuskan di sini.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/health": "http://localhost:4000",
    },
    fs: {
      // Halaman Panduan (src/pages/PanduanPage.tsx) mengambil konten langsung dari
      // docs/panduan-ops.md lewat `?raw` import -- file itu ada di ROOT monorepo,
      // DI LUAR root project Vite ini (apps/web), jadi defaultnya ditolak Vite
      // (security server.fs.allow). Izinkan root monorepo supaya raw-import-nya
      // bisa baca file itu tanpa duplikasi konten.
      allow: [path.resolve(__dirname, "../..")],
    },
  },
});
