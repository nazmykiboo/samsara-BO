import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleManifest } from "@samsara/core";
import { createRouter } from "./api/router.js";
// Side-effect: daftarkan handler aksi "tolak" notifikasi (lihat
// notifikasi/register.ts) -- HARUS dijalankan saat modul ini di-load,
// sebelum webhook Telegram mungkin menerima callback apa pun.
import "./notifikasi/register.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const manifest: ModuleManifest = JSON.parse(
  readFileSync(path.join(packageRoot, "module.json"), "utf-8"),
);

const migrationsPath = path.join(packageRoot, manifest.migrationsDir);

export default { manifest, createRouter, migrationsPath };

// Named export TAMBAHAN (selain default LoadedModule di atas) -- KHUSUS
// dipakai `apps/api/src/scheduler.ts` (composition root, bukan modul bisnis
// lain) untuk membaca data lintas-domain yang dibutuhkan kejadian
// notifikasi berbasis ambang jam/periodik (`permintaan_belum_dijawab`,
// `transfer_belum_diterima`, `stok_minus`). TIDAK dipakai modul bisnis
// manapun secara langsung (itu tetap wajib lewat API, lihat CLAUDE.md) --
// scheduler ini bukan modul, jadi aman mengimpor fungsi domain yang sudah
// ada ini daripada menduplikasi query SQL yang sama di `apps/api`.
export { listPermintaanTransfer } from "./domain/permintaan-transfer.js";
export { listStokMinus, listTransferBelumDiterima } from "./domain/stok.js";
