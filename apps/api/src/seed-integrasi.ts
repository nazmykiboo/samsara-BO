import "./env.js";
import { randomBytes } from "node:crypto";
import { createUser, pool } from "@samsara/core";

/**
 * Buat akun otomatis (bot) untuk workflow n8n, SEKALI SAJA.
 *
 * BEDA PENTING dari `seed-owner.ts`: password di sini TIDAK dibaca dari `.env`
 * (atau file mana pun) -- di-GENERATE ACAK pakai CSPRNG `node:crypto` setiap
 * kali script dijalankan, lalu ditampilkan SEKALI ke terminal. Sistem cuma
 * menyimpan hash bcrypt-nya, jadi tidak ada satu pun file di repo/server yang
 * berisi password plaintext akun ini. Konsekuensinya: kalau output terminal
 * ini hilang, password TIDAK BISA dibaca ulang -- jalurnya reset kredensial
 * (POST /api/auth/users/:id/reset) oleh owner.
 *
 * Akun ini role `integrasi`: cuma boleh memanggil 4 endpoint import CSV modul
 * sales-sync (action `sales_sync.import`). Semua endpoint lain -- termasuk
 * POST /api/sales-sync/proses yang mengurangi stok, seluruh modul Inventory
 * dan HR -- otomatis ditolak 403 karena permission di repo ini murni
 * whitelist (lihat core/src/auth/permissions.ts).
 *
 * Idempotent: kalau sudah ada user dengan role `integrasi`, script berhenti
 * tanpa membuat user baru atau mengubah apa pun (pola sama seperti seed-owner).
 */

const USERNAME = "n8n-integrasi";

/** ~32 karakter base64url dari 24 byte acak CSPRNG -- jauh lebih kuat dari password manusia. */
function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*) FROM core_users u JOIN core_roles r ON r.id = u.role_id WHERE r.name = 'integrasi'`,
    );
    if (Number(rows[0].count) > 0) {
      console.log(
        "[seed-integrasi] Sudah ada user dengan role integrasi -- tidak membuat user baru dan tidak mengubah apa pun.\n" +
          "                 Kalau passwordnya hilang, JANGAN jalankan ulang script ini: pakai reset kredensial\n" +
          "                 (POST /api/auth/users/:id/reset) dari akun owner.",
      );
      return;
    }

    const password = generatePassword();

    await client.query("BEGIN");
    const result = await createUser(client, {
      name: "Integrasi n8n",
      username: USERNAME,
      password,
      role: "integrasi",
    });
    await client.query("COMMIT");

    // Satu-satunya kesempatan password ini terlihat. SENGAJA console.log
    // (bukan ditulis ke file apa pun) sesuai instruksi owner.
    console.log(
      [
        "",
        "============================================================",
        " AKUN INTEGRASI n8n BERHASIL DIBUAT",
        "============================================================",
        ` id       : ${result.id}`,
        ` username : ${result.username}`,
        ` password : ${password}`,
        "============================================================",
        " PERINGATAN: ini SATU-SATUNYA kali password di atas bisa",
        " dilihat. Sistem hanya menyimpan hash-nya -- tidak ada file,",
        " log, atau tabel mana pun yang menyimpan nilai aslinya.",
        " Catat sekarang ke tempat penyimpanan rahasia milik owner",
        " (mis. credential store n8n / password manager), lalu bersihkan",
        " scrollback terminal ini.",
        "",
        " Kalau password ini hilang: JANGAN jalankan ulang script ini",
        " (idempotent, tidak akan membuat password baru). Pakai reset",
        ` kredensial: POST /api/auth/users/${result.id}/reset dari akun owner.`,
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
    console.error("[seed-integrasi] gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
