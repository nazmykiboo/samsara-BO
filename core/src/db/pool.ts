import { Pool, types } from "pg";

// Kolom DATE (OID 1082) SENGAJA dikembalikan sebagai string "YYYY-MM-DD" apa
// adanya -- default `pg` mem-parsing-nya jadi objek JS Date di TENGAH MALAM
// WAKTU LOKAL proses Node, lalu res.json()/JSON.stringify() men-serialize-nya
// via toISOString() (UTC) -- di timezone depan UTC (mis. Asia/Jakarta, +7)
// ini MENGGESER tanggalnya mundur satu hari begitu dibaca ulang di frontend
// (mis. DB '2026-10-06' jadi "2026-10-05T17:00:00.000Z", tanggal yang
// ditampilkan salah). Kolom TIMESTAMPTZ (mis. created_at) TIDAK disentuh --
// itu memang harus tetap jadi instant absolut dengan timezone, beda kasus
// dari DATE murni (tanggal kalender, tanpa jam).
types.setTypeParser(1082, (value: string) => value);

export const pool = new Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? "samsara",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "samsara",
});
