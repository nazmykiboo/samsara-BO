import "./env.js";
import { readFileSync } from "node:fs";
import { pool } from "@samsara/core";

// Parser CSV minimal (menangani field berkutip "..." dengan koma/kutip di
// dalamnya) -- tidak pakai library eksternal karena formatnya sederhana dan
// dikontrol sendiri (dihasilkan oleh proses seed, bukan input bebas).
function parseCsv(text: string): string[][] {
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

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Pakai: npm run import:harga-jual -- <path-ke-csv>");
    console.error("Contoh: npm run import:harga-jual -- ../../data/harga_jual_template.csv");
    process.exitCode = 1;
    return;
  }

  const text = readFileSync(filePath, "utf-8");
  const rows = parseCsv(text);
  const header = rows[0].map((h) => h.trim());
  const idx = {
    kode: header.indexOf("kode_menu"),
    nama: header.indexOf("nama_menu"),
    harga: header.indexOf("harga_jual"),
  };
  if (idx.kode === -1 || idx.harga === -1) {
    console.error('CSV harus punya kolom "kode_menu" dan "harga_jual".');
    process.exitCode = 1;
    return;
  }

  let updated = 0;
  let skippedEmpty = 0;
  const notFound: string[] = [];

  for (const cols of rows.slice(1)) {
    const kode = cols[idx.kode]?.trim();
    const nama = idx.nama >= 0 ? cols[idx.nama]?.trim() : "";
    const hargaRaw = cols[idx.harga]?.trim();
    if (!kode) continue;
    if (!hargaRaw) {
      skippedEmpty++;
      continue;
    }
    const harga = Number(hargaRaw.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(harga)) {
      console.warn(`[import] lewati ${kode} (${nama}): harga_jual "${hargaRaw}" bukan angka valid`);
      continue;
    }
    const result = await pool.query(
      "UPDATE inventory_menu SET harga_jual = $1, updated_at = now() WHERE kode = $2",
      [harga, kode],
    );
    if (result.rowCount === 0) {
      notFound.push(kode);
    } else {
      updated++;
    }
  }

  console.log(`[import] selesai: ${updated} menu diupdate, ${skippedEmpty} baris dilewati (harga_jual kosong).`);
  if (notFound.length > 0) {
    console.warn(`[import] kode_menu tidak ditemukan di database: ${notFound.join(", ")}`);
  }
}

main()
  .catch((err) => {
    console.error("[import] gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
