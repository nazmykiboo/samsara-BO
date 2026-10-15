/**
 * Parser CSV minimal, quote-aware (menangani field berkutip "..." yang berisi
 * koma/kutip/JSON di dalamnya). Diadaptasi dari parser yang sudah dipakai di
 * `apps/api/src/import-harga-jual.ts` -- SENGAJA tanpa library eksternal:
 * repo ini tidak punya csv-parse/papaparse terpasang, dan parser ini sudah
 * diverifikasi cukup untuk keempat CSV sumber modul sales-sync (log penjualan,
 * transaksi, raw Majoo, biaya platform) termasuk kolom `raw_payload` yang
 * isinya JSON berkutip.
 *
 * Baris benar-benar kosong dibuang (artefak trailing newline di akhir file).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}
