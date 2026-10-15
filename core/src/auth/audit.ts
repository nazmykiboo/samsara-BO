import type { PoolClient } from "pg";

function stringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Bandingkan dua nilai untuk keperluan audit diff. Postgres selalu
 * mengembalikan kolom NUMERIC sebagai string lewat `pg` -- tanpa ini,
 * `harga_master` lama `"14.20"` (dari DB) vs baru `14.2` (angka JS dari
 * body request) akan dianggap "berubah" padahal nilainya sama.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== "" && String(b).trim() !== "") {
    return na === nb;
  }
  return stringify(a) === stringify(b);
}

export interface AuditEntry {
  userId: number | null;
  tableName: string;
  recordId: number;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
}

/** Tulis satu baris audit log. Dipanggil dari domain layer modul, bukan router langsung. */
export async function writeAuditLog(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO core_audit_log (user_id, table_name, record_id, field_name, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.userId,
      entry.tableName,
      entry.recordId,
      entry.fieldName,
      stringify(entry.oldValue),
      stringify(entry.newValue),
    ],
  );
}

/**
 * Bandingkan `oldRow`/`newRow` untuk daftar `fields`, tulis satu baris audit
 * log per field yang NILAINYA BENAR-BENAR BEDA (dibandingkan sebagai
 * string, jadi `12` dan `"12"` dianggap sama). Field yang tidak ada di
 * `newRow` (tidak diubah caller) dilewati.
 */
export async function logFieldChanges(
  client: PoolClient,
  params: {
    userId: number | null;
    tableName: string;
    recordId: number;
    oldRow: Record<string, unknown>;
    newRow: Record<string, unknown>;
    fields: string[];
  },
): Promise<void> {
  for (const field of params.fields) {
    if (!(field in params.newRow)) continue;
    const oldValue = params.oldRow[field];
    const newValue = params.newRow[field];
    if (valuesEqual(oldValue, newValue)) continue;
    await writeAuditLog(client, {
      userId: params.userId,
      tableName: params.tableName,
      recordId: params.recordId,
      fieldName: field,
      oldValue,
      newValue,
    });
  }
}
