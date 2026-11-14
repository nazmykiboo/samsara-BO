import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleManifest } from "@samsara/core";
import { createRouter } from "./api/router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const manifest: ModuleManifest = JSON.parse(
  readFileSync(path.join(packageRoot, "module.json"), "utf-8"),
);

const migrationsPath = path.join(packageRoot, manifest.migrationsDir);

export default { manifest, createRouter, migrationsPath };

// Named export TAMBAHAN -- KHUSUS dipakai `apps/api/src/scheduler.ts`, lihat
// komentar yang sama di `modules/inventory/src/index.ts`.
export { getKesegaranSumber } from "./domain/kesegaran.js";
