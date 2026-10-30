import { pool, signAuthToken, type AuthUser } from "@samsara/core";
import { prosesSinkronisasi } from "./proses.js";
import { getPengaturanOtomatis } from "./settings.js";

/**
 * Pemrosesan sinkronisasi penjualan OTOMATIS -- dipanggil di LATAR BELAKANG
 * (tanpa di-`await` pemanggilnya) persis setelah POST /import/log-penjualan
 * sukses dan setelah PATCH /item-mapping/:id sukses (lihat router.ts).
 *
 * Fungsi ini TIDAK PERNAH melempar error ke pemanggil -- seluruh isinya
 * dibungkus try/catch, supaya kegagalan di sini TIDAK PERNAH membuat
 * response import/pemetaan yang MEMICUNYA jadi gagal. Kegagalan dicatat ke
 * `salessync_otomatis_log.pesan_error_terakhir`.
 *
 * Kunci advisory Postgres (`pg_try_advisory_lock`) mencegah 2 pemicu
 * ber-tumpukan (mis. import dan simpan-pemetaan nyaris bersamaan) jalan
 * PARALEL -- kalau lock gagal didapat, fungsi selesai TANPA error dan TANPA
 * melakukan apa pun (pemicu berikutnya akan coba lagi; state "apa yang
 * masih perlu diproses" selalu dihitung ulang dari `processed_at IS NULL`,
 * jadi tidak ada yang "hilang" karena dilewati sekali).
 */

/** Angka sembarang tapi TETAP -- kunci sama dipakai tiap panggilan supaya saling mengunci satu sama lain. `hashtext` di SQL (bukan di sini) yang mengubahnya jadi bigint untuk pg_try_advisory_lock. */
const KUNCI_ADVISORY = "sales_sync_otomatis";

/** @returns token internal + id user -- satu query, dipakai untuk mint token DAN sebagai `userId` di `prosesSinkronisasi` (dicatat ke core_audit_log sebagai "siapa yang memicu"). */
async function mintTokenSistemOtomatis(): Promise<{ token: string; userId: number }> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: string; username: string; token_version: number }>(
      `SELECT u.id, u.username, u.token_version
       FROM core_users u JOIN core_roles r ON r.id = u.role_id
       WHERE r.name = 'sistem_otomatis' AND u.is_active
       LIMIT 1`,
    );
    const row = rows[0];
    if (!row) {
      throw new Error(
        "Identitas 'sistem_otomatis' belum ada -- jalankan 'npm run seed:sistem-otomatis -w @samsara/api' sekali.",
      );
    }
    const user: AuthUser = {
      id: Number(row.id),
      username: row.username,
      role: "sistem_otomatis",
      allLocations: true,
      locationIds: [],
      tokenVersion: row.token_version,
      // Identitas internal, tidak pernah "wajib ganti kredensial" -- login
      // interaktifnya sendiri sudah diblok permanen (lihat authenticate()).
      wajibGantiKredensial: false,
    };
    // TTL 60 detik: token ini cuma hidup selama satu panggilan HTTP loopback
    // ke Inventory (POST /api/inventory/transaksi/penjualan) per order,
    // bukan dipakai ulang lintas request.
    return { token: signAuthToken(user, "60s"), userId: user.id };
  } finally {
    client.release();
  }
}

async function tulisLogOtomatis(
  dipicuOleh: "impor" | "pemetaan",
  hasil: {
    transaksiDibuat: number;
    barisDiproses: number;
    tertahan: number;
    perluDitinjau: number;
    gagal: number;
    pesanErrorTerakhir: string | null;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO salessync_otomatis_log
         (dipicu_oleh, transaksi_dibuat, baris_diproses, tertahan, perlu_ditinjau, gagal, pesan_error_terakhir)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        dipicuOleh,
        hasil.transaksiDibuat,
        hasil.barisDiproses,
        hasil.tertahan,
        hasil.perluDitinjau,
        hasil.gagal,
        hasil.pesanErrorTerakhir,
      ],
    );
  } finally {
    client.release();
  }
}

export async function jalankanOtomatisJikaAktif(dipicuOleh: "impor" | "pemetaan"): Promise<void> {
  try {
    const pengaturan = await (async () => {
      const client = await pool.connect();
      try {
        return await getPengaturanOtomatis(client);
      } finally {
        client.release();
      }
    })();

    if (!pengaturan.aktif) return;
    if (!pengaturan.tanggalMulai) return; // belum pernah diisi owner -- tidak ada yang bisa dijalankan

    const lockClient = await pool.connect();
    try {
      const { rows } = await lockClient.query<{ terkunci: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext($1)) AS terkunci`,
        [KUNCI_ADVISORY],
      );
      if (!rows[0]?.terkunci) return; // proses otomatis lain sedang jalan -- selesai, pemicu berikutnya akan coba lagi

      try {
        const { token, userId } = await mintTokenSistemOtomatis();
        const hasil = await prosesSinkronisasi(`Bearer ${token}`, userId, pengaturan.tanggalMulai);

        await tulisLogOtomatis(dipicuOleh, {
          transaksiDibuat: hasil.transaksiDibuat,
          barisDiproses: hasil.barisDiproses,
          tertahan: hasil.dilewatiBelumTerpetakan.length,
          perluDitinjau: hasil.perluDitinjau.length,
          gagal: hasil.gagal.length,
          pesanErrorTerakhir: hasil.gagal[0]?.pesan ?? null,
        });
      } finally {
        await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [KUNCI_ADVISORY]);
      }
    } finally {
      lockClient.release();
    }
  } catch (err) {
    // TIDAK PERNAH dilempar ke pemanggil -- lihat catatan di atas. Dicatat
    // ke log server (console.error, konsisten dengan error handler Express
    // di router.ts modul lain yang juga tidak punya logger terstruktur
    // terpisah) supaya tetap terlihat di `docker logs`/output server.
    console.error("[sales-sync otomatis] gagal:", err);
    try {
      await tulisLogOtomatis(dipicuOleh, {
        transaksiDibuat: 0,
        barisDiproses: 0,
        tertahan: 0,
        perluDitinjau: 0,
        gagal: 0,
        pesanErrorTerakhir: err instanceof Error ? err.message : "Gagal menjalankan pemrosesan otomatis",
      });
    } catch {
      // Kalau MENULIS log pun gagal (mis. DB benar-benar tidak terjangkau),
      // tidak ada lagi yang bisa dilakukan di sini -- sudah dicatat ke
      // console.error di atas.
    }
  }
}
