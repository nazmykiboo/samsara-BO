import type { PoolClient } from "pg";

/**
 * Kesegaran data per sumber sales-sync (Tahap 1E, 2026-11-14) -- kartu
 * "baris terakhir masuk" dengan peringatan merah kalau melewati ambang.
 * Tidak ada tabel baru: murni query MAX(created_at) + rata-rata jarak antar
 * baris dari tabel yang sudah ada, plus override opsional di
 * `salessync_settings` (pola key-value yang sudah ada, lihat settings.ts).
 *
 * Ambang DEFAULT per sumber = rata-rata jarak antar baris 7 hari terakhir x
 * 3 (faktor aman supaya jarak yang sedikit lebih lama dari biasanya tidak
 * langsung dianggap macet) -- "bisa diatur" lewat baris
 * `ambang_segar_jam_<key>` di salessync_settings (jam, boleh desimal).
 *
 * Kalau baseline TIDAK BISA dihitung (kurang dari 2 baris di jendela 7 hari
 * terakhir -- termasuk 0 baris sama sekali), sumber itu dipaksa MERAH --
 * ini SENGAJA, bukan edge-case yang diabaikan: tidak ada cukup data untuk
 * membuktikan sumber ini sehat, jadi default-nya "tidak dipercaya", bukan
 * "dianggap baik-baik saja". Ini yang membuat raw-majoo (0 baris berturut-
 * turut, lihat audit Tahap 0 2026-11-14) langsung tampil merah.
 */

const FAKTOR_AMAN = 3;
const JENDELA_RATA_RATA_HARI = 7;

interface DefinisiSumber {
  key: string;
  label: string;
  table: string;
  whereSql: string;
}

const DAFTAR_SUMBER: DefinisiSumber[] = [
  { key: "shopee", label: "Shopee (penjualan)", table: "salessync_log_penjualan", whereSql: "platform = 'Shopee'" },
  { key: "gofood", label: "GoFood (penjualan)", table: "salessync_log_penjualan", whereSql: "platform = 'GoFood'" },
  { key: "grabfood", label: "GrabFood (penjualan)", table: "salessync_log_penjualan", whereSql: "platform = 'GrabFood'" },
  { key: "majoo_log", label: "Majoo (penjualan, log harian)", table: "salessync_log_penjualan", whereSql: "platform = 'Majoo'" },
  { key: "raw_majoo", label: "Majoo (transaksi, langsung API)", table: "salessync_raw_majoo", whereSql: "true" },
  { key: "majoo_refund", label: "Majoo (refund, langsung API)", table: "salessync_majoo_refund", whereSql: "true" },
];

export interface SumberKesegaran {
  key: string;
  label: string;
  /** ISO timestamp baris terakhir, null kalau belum pernah ada baris sama sekali. */
  terakhirMasuk: string | null;
  /** Jam sejak baris terakhir masuk, null kalau terakhirMasuk null. */
  jamSejakTerakhir: number | null;
  /** Ambang (jam) yang dipakai -- hasil override setting ATAU hasil hitung otomatis. */
  ambangJam: number | null;
  /** true kalau ambangJam berasal dari override manual (salessync_settings), false kalau dihitung otomatis. */
  ambangDiatasManual: boolean;
  /** true = tampil merah di kartu. */
  merah: boolean;
}

async function hitungAmbangOtomatisJam(client: PoolClient, table: string, whereSql: string): Promise<number | null> {
  // jumlah_baris dihitung dari jendela yang SAMA (bukan count(jam) yang
  // otomatis N-1 lebih kecil) supaya ambang "kurang dari 2 baris -> tidak
  // ada jarak" konsisten dengan jumlah baris SEBENARNYA di jendela ini.
  const { rows } = await client.query<{ rata2_jam: number | null; jumlah_baris: string }>(
    `SELECT avg(jam) AS rata2_jam, count(*) AS jumlah_baris FROM (
       SELECT created_at, extract(epoch FROM (created_at - lag(created_at) OVER (ORDER BY created_at))) / 3600 AS jam
       FROM ${table} WHERE ${whereSql} AND created_at >= now() - interval '${JENDELA_RATA_RATA_HARI} days'
     ) t`,
  );
  const jumlahBaris = Number(rows[0]?.jumlah_baris ?? 0);
  const rata2 = rows[0]?.rata2_jam;
  if (jumlahBaris < 2 || rata2 === null || rata2 === undefined) return null; // kurang dari 2 baris -> tidak ada jarak yang bisa dirata-rata
  return Number(rata2) * FAKTOR_AMAN;
}

export async function getKesegaranSumber(client: PoolClient): Promise<SumberKesegaran[]> {
  const { rows: overrideRows } = await client.query<{ key: string; value: string }>(
    `SELECT key, value FROM salessync_settings WHERE key LIKE 'ambang_segar_jam_%'`,
  );
  const overrideMap = new Map(overrideRows.map((r) => [r.key.replace("ambang_segar_jam_", ""), Number(r.value)]));

  const hasil: SumberKesegaran[] = [];
  for (const sumber of DAFTAR_SUMBER) {
    const { rows } = await client.query<{ terakhir: string | null }>(
      `SELECT MAX(created_at) AS terakhir FROM ${sumber.table} WHERE ${sumber.whereSql}`,
    );
    const terakhirMasuk = rows[0]?.terakhir ?? null;
    const jamSejakTerakhir = terakhirMasuk ? (Date.now() - new Date(terakhirMasuk).getTime()) / 3600000 : null;

    const overrideJam = overrideMap.get(sumber.key);
    const ambangDiatasManual = overrideJam !== undefined && Number.isFinite(overrideJam);
    const ambangJam = ambangDiatasManual ? overrideJam! : await hitungAmbangOtomatisJam(client, sumber.table, sumber.whereSql);

    const merah = terakhirMasuk === null || ambangJam === null || jamSejakTerakhir === null || jamSejakTerakhir > ambangJam;

    hasil.push({
      key: sumber.key,
      label: sumber.label,
      terakhirMasuk,
      jamSejakTerakhir,
      ambangJam,
      ambangDiatasManual,
      merah,
    });
  }
  return hasil;
}

/** Set/hapus override ambang manual (jam) untuk satu sumber -- "bisa diatur" per instruksi Tahap 1E. */
export async function setAmbangSegarManual(client: PoolClient, sumberKey: string, ambangJam: number | null): Promise<void> {
  if (!DAFTAR_SUMBER.some((s) => s.key === sumberKey)) {
    throw new Error(`Sumber "${sumberKey}" tidak dikenal untuk pengaturan ambang kesegaran`);
  }
  const settingKey = `ambang_segar_jam_${sumberKey}`;
  if (ambangJam === null) {
    await client.query(`DELETE FROM salessync_settings WHERE key = $1`, [settingKey]);
    return;
  }
  if (!Number.isFinite(ambangJam) || ambangJam <= 0) {
    throw new Error("Ambang kesegaran harus angka lebih dari 0 (jam)");
  }
  await client.query(
    `INSERT INTO salessync_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [settingKey, String(ambangJam)],
  );
}
