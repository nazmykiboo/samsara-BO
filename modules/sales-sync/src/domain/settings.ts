import type { PoolClient } from "pg";
import { writeAuditLog } from "@samsara/core";

/**
 * Pengaturan key-value modul sales-sync (pola sama seperti hr_settings /
 * inventory_settings). Value disimpan TEXT di database dan di-cast ke tipe
 * yang benar di sini, bukan di SQL.
 *
 * `default_location_id` belum ada endpoint HTTP -- sengaja, satu-satunya
 * pembacanya adalah `prosesSinkronisasi`. `otomatis_aktif`/
 * `tanggal_mulai_otomatis` DIEKSPOS lewat GET/PUT /otomatis/pengaturan
 * (lihat router.ts) karena owner perlu mengubahnya dari UI.
 */

/**
 * Lokasi tujuan transaksi Penjualan Inventory hasil sinkronisasi.
 * Disimpan sebagai setting (bukan hardcode) supaya siap kalau nanti ada
 * outlet ke-2 -- lihat COMMENT ON COLUMN salessync_settings.value di migrasi.
 */
export async function getDefaultLocationId(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ value: string }>(
    `SELECT value FROM salessync_settings WHERE key = 'default_location_id'`,
  );
  const value = rows[0]?.value;
  if (value === undefined) {
    throw new Error("Pengaturan 'default_location_id' tidak ditemukan di salessync_settings");
  }
  const id = Number(value);
  if (!Number.isFinite(id)) {
    throw new Error(`Pengaturan 'default_location_id' bukan angka valid: "${value}"`);
  }
  return id;
}

export interface PengaturanOtomatis {
  aktif: boolean;
  /** `null` kalau belum pernah diisi owner (baris belum ada di salessync_settings -- lihat migrasi 0003). */
  tanggalMulai: string | null;
}

/** Baca pengaturan pemrosesan otomatis. Default `aktif: false` kalau baris belum ada (seharusnya tidak terjadi setelah migrasi 0003, tapi tetap toleran). */
export async function getPengaturanOtomatis(client: PoolClient): Promise<PengaturanOtomatis> {
  const { rows } = await client.query<{ key: string; value: string }>(
    `SELECT key, value FROM salessync_settings WHERE key IN ('otomatis_aktif', 'tanggal_mulai_otomatis')`,
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    aktif: map.get("otomatis_aktif") === "true",
    tanggalMulai: map.get("tanggal_mulai_otomatis") ?? null,
  };
}

/**
 * Ubah pengaturan pemrosesan otomatis + catat `core_audit_log` per field yang
 * BENAR-BENAR berubah (pola sama seperti `logFieldChanges` -- di sini ditulis
 * manual, bukan reuse helper itu, karena sumbernya key-value bukan baris
 * tabel biasa).
 */
export async function setPengaturanOtomatis(
  client: PoolClient,
  userId: number,
  input: { aktif?: boolean; tanggalMulai?: string | null },
): Promise<PengaturanOtomatis> {
  const sebelum = await getPengaturanOtomatis(client);

  // recordId = 0: salessync_settings key-value tidak punya id numerik asli
  // (primary key-nya TEXT `key`) -- 0 dipakai sebagai sentinel "bukan baris
  // tabel biasa", konsisten dipakai di kedua field di bawah supaya riwayat
  // perubahan setting ini tetap tercatat lewat mekanisme audit yang sama
  // dengan field lain di aplikasi, bukan tabel audit terpisah.
  if (input.aktif !== undefined && input.aktif !== sebelum.aktif) {
    await client.query(
      `INSERT INTO salessync_settings (key, value, updated_at) VALUES ('otomatis_aktif', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [String(input.aktif)],
    );
    await writeAuditLog(client, {
      userId,
      tableName: "salessync_settings",
      recordId: 0,
      fieldName: "otomatis_aktif",
      oldValue: sebelum.aktif,
      newValue: input.aktif,
    });
  }

  if (input.tanggalMulai !== undefined && input.tanggalMulai !== sebelum.tanggalMulai) {
    if (input.tanggalMulai === null) {
      await client.query(`DELETE FROM salessync_settings WHERE key = 'tanggal_mulai_otomatis'`);
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tanggalMulai)) {
        throw new Error("tanggal_mulai_otomatis harus format YYYY-MM-DD");
      }
      await client.query(
        `INSERT INTO salessync_settings (key, value, updated_at) VALUES ('tanggal_mulai_otomatis', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [input.tanggalMulai],
      );
    }
    await writeAuditLog(client, {
      userId,
      tableName: "salessync_settings",
      recordId: 0,
      fieldName: "tanggal_mulai_otomatis",
      oldValue: sebelum.tanggalMulai,
      newValue: input.tanggalMulai,
    });
  }

  return getPengaturanOtomatis(client);
}
