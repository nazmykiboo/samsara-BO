import "./env.js";
import { buildRegistry, runMigrations, pool } from "@samsara/core";
import { modules } from "./modules.js";

const ordered = buildRegistry(modules);

runMigrations(ordered)
  .then(() => {
    console.log("[migrate] selesai");
  })
  .catch((err) => {
    console.error("[migrate] gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
