import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { pool } from "./pool.js";
import type { LoadedModule } from "../manifest/types.js";

const TRACKING_TABLE = "schema_migrations";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_MIGRATIONS_NAME = "core";
const CORE_MIGRATIONS_PATH = path.resolve(__dirname, "migrations");

async function ensureTrackingTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      module TEXT NOT NULL,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (module, filename)
    );
  `);
}

async function alreadyApplied(client: PoolClient, moduleName: string): Promise<Set<string>> {
  const { rows } = await client.query<{ filename: string }>(
    `SELECT filename FROM ${TRACKING_TABLE} WHERE module = $1`,
    [moduleName],
  );
  return new Set(rows.map((r) => r.filename));
}

async function applyMigrationsFromDir(client: PoolClient, moduleName: string, migrationsPath: string) {
  const applied = await alreadyApplied(client, moduleName);
  const files = readdirSync(migrationsPath)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(path.join(migrationsPath, file), "utf-8");
    console.log(`[migrate] ${moduleName}/${file}`);

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO ${TRACKING_TABLE} (module, filename) VALUES ($1, $2)`, [moduleName, file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migrasi gagal di ${moduleName}/${file}: ${(err as Error).message}`);
    }
  }
}

/**
 * Jalankan migrasi CORE dulu (tabel auth & platform lain, lihat
 * core/src/db/migrations/ -- ini fondasi yang modul lain boleh referensi,
 * mis. kolom dibuat_oleh di tabel transaksi Inventory yang FK ke
 * core_users), baru migrasi tiap modul (urutan dependency, dari
 * buildRegistry). Satu file .sql = satu transaksi.
 */
export async function runMigrations(modulesInOrder: LoadedModule[]) {
  const client = await pool.connect();
  try {
    await ensureTrackingTable(client);

    await applyMigrationsFromDir(client, CORE_MIGRATIONS_NAME, CORE_MIGRATIONS_PATH);

    for (const mod of modulesInOrder) {
      await applyMigrationsFromDir(client, mod.manifest.name, mod.migrationsPath);
    }
  } finally {
    client.release();
  }
}
