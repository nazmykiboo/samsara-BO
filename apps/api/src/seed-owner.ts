import "./env.js";
import { createUser, pool } from "@samsara/core";

/**
 * Buat user owner pertama, SEKALI SAJA. Password dibaca dari .env
 * (AUTH_SEED_OWNER_PASSWORD) -- tidak ada password default di kode/repo,
 * sesuai instruksi owner. Idempotent: kalau sudah ada user dengan role
 * owner, script berhenti tanpa membuat user baru atau mengubah apa pun.
 */
async function main() {
  const username = process.env.AUTH_SEED_OWNER_USERNAME;
  const password = process.env.AUTH_SEED_OWNER_PASSWORD;

  if (!username || !password) {
    console.error(
      "[seed-owner] AUTH_SEED_OWNER_USERNAME dan AUTH_SEED_OWNER_PASSWORD wajib diisi di .env (lihat .env.example).",
    );
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM core_users u JOIN core_roles r ON r.id = u.role_id WHERE r.name = 'owner'`,
    );
    if (Number(rows[0].count) > 0) {
      console.log("[seed-owner] Sudah ada user dengan role owner -- tidak membuat user baru.");
      return;
    }

    await client.query("BEGIN");
    const result = await createUser(client, { name: username, username, password, role: "owner" });
    await client.query("COMMIT");
    console.log(`[seed-owner] User owner "${username}" dibuat (id ${result.id}).`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error("[seed-owner] gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
