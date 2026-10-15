import type { PoolClient } from "pg";

/**
 * Pengaturan key-value modul sales-sync (pola sama seperti hr_settings /
 * inventory_settings). Value disimpan TEXT di database dan di-cast ke tipe
 * yang benar di sini, bukan di SQL.
 *
 * Belum ada endpoint HTTP untuk pengaturan ini -- sengaja: satu-satunya
 * pembacanya saat ini adalah `prosesSinkronisasi`.
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
