import type { PoolClient } from "pg";

/**
 * Identitas bisnis tampilan (nama + logo) -- SATU baris, `core_business_identity.id = 1`
 * (lihat migrasi `0010_tambah_detail_lokasi_dan_identitas_bisnis.sql`).
 *
 * GET nama+logo PUBLIK (tanpa login, lihat router) -- dipakai sidebar/judul
 * tab/halaman login yang tampil SEBELUM ada token auth. PUT khusus owner.
 */

const TIPE_DIIZINKAN = new Set(["image/png", "image/jpeg", "image/webp"]);
const UKURAN_MAKS_BYTES = 500 * 1024;

export interface BusinessIdentity {
  displayName: string;
  hasLogo: boolean;
}

export async function getBusinessIdentity(client: PoolClient): Promise<BusinessIdentity> {
  const { rows } = await client.query<{ display_name: string; has_logo: boolean }>(
    `SELECT display_name, (logo_bytes IS NOT NULL) AS has_logo FROM core_business_identity WHERE id = 1`,
  );
  const row = rows[0];
  // Baris seed SELALU ada sejak migrasi (lihat INSERT ... ON CONFLICT DO
  // NOTHING di migrasi) -- fallback ini murni jaring pengaman kalau baris
  // itu somehow terhapus manual, bukan jalur yang diharapkan terjadi.
  return row ? { displayName: row.display_name, hasLogo: row.has_logo } : { displayName: "Burnas", hasLogo: false };
}

export async function setBusinessDisplayName(client: PoolClient, displayName: string): Promise<void> {
  if (!displayName.trim()) throw new Error("Nama tampilan wajib diisi");
  await client.query(`UPDATE core_business_identity SET display_name = $1, updated_at = now() WHERE id = 1`, [
    displayName.trim(),
  ]);
}

/** @param contentType Dari header Content-Type request -- divalidasi terhadap whitelist di sini, bukan di router. */
export async function setBusinessLogo(client: PoolClient, bytes: Buffer, contentType: string): Promise<void> {
  if (!TIPE_DIIZINKAN.has(contentType)) {
    throw new Error(`Tipe file logo wajib PNG/JPG/WebP (diterima: ${contentType})`);
  }
  if (bytes.length === 0) throw new Error("File logo kosong");
  if (bytes.length > UKURAN_MAKS_BYTES) {
    throw new Error(`Ukuran logo maksimal 500KB (dikirim: ${Math.ceil(bytes.length / 1024)}KB)`);
  }
  await client.query(
    `UPDATE core_business_identity SET logo_bytes = $1, logo_content_type = $2, updated_at = now() WHERE id = 1`,
    [bytes, contentType],
  );
}

export async function getBusinessLogo(
  client: PoolClient,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const { rows } = await client.query<{ logo_bytes: Buffer | null; logo_content_type: string | null }>(
    `SELECT logo_bytes, logo_content_type FROM core_business_identity WHERE id = 1`,
  );
  const row = rows[0];
  if (!row?.logo_bytes || !row.logo_content_type) return null;
  return { bytes: row.logo_bytes, contentType: row.logo_content_type };
}
