/**
 * Parser CSV minimal, quote-aware (menangani field berkutip "..." yang berisi
 * koma/kutip di dalamnya). Diadaptasi dari parser yang sudah dipakai di
 * `apps/api/src/import-harga-jual.ts` (sumber asli) -- `modules/sales-sync/src/domain/csv.ts`
 * adalah adaptasi dari file yang SAMA. Duplikasi kecil ini SENGAJA: modul
 * terisolasi (tidak boleh saling import, lihat docs/module-manifest.md), dan
 * repo ini tidak punya csv-parse/papaparse terpasang -- formatnya sederhana
 * dan dikontrol sendiri (CSV hasil GET /menu/harga-channel/export yang
 * diedit di spreadsheet lalu dikirim balik).
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

/**
 * Escaping minimal untuk satu field CSV: dikutip HANYA kalau isinya
 * mengandung koma/kutip/baris baru. Dalam praktik kode_menu, nama channel,
 * dan angka harga TIDAK pernah mengandung karakter itu -- fungsi ini cuma
 * jaring pengaman supaya nama channel baru yang aneh (mis. "GoFood, Promo")
 * tidak merusak kolom. Hasil parseCsv() di atas bisa membaca balik format ini.
 */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
