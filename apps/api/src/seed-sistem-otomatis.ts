import "./env.js";
import { randomBytes } from "node:crypto";
import { createUser, pool } from "@samsara/core";

/**
 * Buat identitas internal "sistem_otomatis", SEKALI SAJA.
 *
 * BEDA dari seed-integrasi.ts: akun ini BUKAN dipakai login interaktif sama
 * sekali (diblok eksplisit di core/src/auth/users.ts, authenticate()) --
 * dipakai server MEMANGGIL DIRINYA SENDIRI untuk pemrosesan sinkronisasi
 * penjualan otomatis (lihat modules/sales-sync/src/domain/otomatis.ts) lewat
 * token JWT umur sangat pendek (~60 detik) yang di-mint saat dipakai, bukan
 * password ini. Password di sini SEKADAR mengisi kolom wajib `createUser()`
 * (pola password-role, lihat PASSWORD_ROLES) -- di-generate acak lalu
 * DIBUANG (tidak ditampilkan ke terminal sama sekali, beda dari
 * seed-integrasi.ts yang sengaja menampilkannya), karena memang tidak pernah
 * dibutuhkan oleh siapa pun.
 *
 * Idempotent: kalau sudah ada user dengan role sistem_otomatis, script
 * berhenti tanpa membuat user baru atau mengubah apa pun.
 */

const USERNAME = "sistem-otomatis-sales-sync";

function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM core_users u JOIN core_roles r ON r.id = u.role_id WHERE r.name = 'sistem_otomatis'`,
    );
    if (Number(rows[0].count) > 0) {
      console.log(
        "[seed-sistem-otomatis] Sudah ada user dengan role sistem_otomatis -- tidak membuat user baru dan tidak mengubah apa pun.",
      );
      return;
    }

    await client.query("BEGIN");
    const result = await createUser(client, {
      name: "Sistem Otomatis (Sales-Sync)",
      username: USERNAME,
      password: generatePassword(),
      role: "sistem_otomatis",
    });
    await client.query("COMMIT");

    console.log(
      [
        "",
        "============================================================",
        " IDENTITAS SISTEM OTOMATIS BERHASIL DIBUAT",
        "============================================================",
        ` id       : ${result.id}`,
        ` username : ${result.username}`,
        "============================================================",
        " Identitas ini TIDAK PERNAH login interaktif (password-nya",
        " sengaja tidak ditampilkan/dicatat di mana pun) -- dipakai",
        " server sendiri lewat token internal umur pendek untuk",
        " pemrosesan sinkronisasi penjualan otomatis.",
        "============================================================",
        "",
      ].join("\n"),
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error("[seed-sistem-otomatis] gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
