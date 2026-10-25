import type { PoolClient } from "pg";
import { parseCsv } from "./csv.js";
import { syncItemMappingFromLog } from "./item-mapping.js";

/**
 * Import keempat CSV sumber modul sales-sync ke tabel arsip mentahnya.
 *
 * Pola yang berlaku untuk KEEMPAT fungsi di file ini:
 *
 * 1. Semua fungsi menerima teks CSV MENTAH (string), bukan path file dan bukan
 *    objek JSON -- endpoint HTTP-nya pakai body parser `express.text()` khusus
 *    per-route (lihat `../api/router.ts`), karena `express.json()` global di
 *    `core/src/server/build-server.ts` limitnya 100kb dan berlaku ke semua
 *    modul (tidak boleh dinaikkan cuma demi modul ini).
 *
 * 2. Upsert per baris pakai trik `xmax` Postgres supaya response bisa
 *    membedakan TIGA kategori, bukan cuma "berhasil/gagal":
 *      - muncul di RETURNING dengan was_insert = true  -> `dibuat`
 *      - muncul di RETURNING dengan was_insert = false -> `diperbarui`
 *      - TIDAK muncul sama sekali di RETURNING          -> `dilewati`
 *        (clause `WHERE ... IS DISTINCT FROM` bernilai false, artinya isi baris
 *        identik persis dengan yang sudah ada -- import ulang file yang sama)
 *
 * 3. Satu baris gagal TIDAK menghentikan baris lain (pola sama seperti
 *    POST /jadwal/batch di modul HR): kegagalan dicatat di `errors` dengan
 *    nomor baris CSV-nya, loop lanjut. Karena router membungkus seluruh import
 *    dalam SATU transaksi, tiap statement insert dilindungi SAVEPOINT -- tanpa
 *    itu, satu error dari Postgres (mis. pelanggaran constraint tak terduga)
 *    akan meng-abort seluruh transaksi dan membuat semua baris sisanya gagal
 *    beruntun, lalu COMMIT di akhir diam-diam jadi ROLLBACK (response bohong
 *    soal jumlah yang tersimpan).
 */

export interface HasilImport {
  dibuat: number;
  diperbarui: number;
  dilewati: number;
  /** `baris` = nomor baris DATA di CSV, mulai 1 untuk baris pertama setelah header. */
  errors: Array<{ baris: number; pesan: string }>;
}

// --- Helper parsing nilai ---------------------------------------------------

function pad2(value: string): string {
  return value.length === 1 ? `0${value}` : value;
}

function ambil(cols: string[], idx: number): string {
  return (cols[idx] ?? "").trim();
}

/** Teks wajib ada. Kosong -> error baris (kolom NOT NULL di skema). */
function teksWajib(cols: string[], idx: number, nama: string): string {
  const v = ambil(cols, idx);
  if (!v) throw new Error(`Kolom "${nama}" wajib diisi`);
  return v;
}

/** Teks opsional: string kosong di CSV disimpan sebagai NULL, bukan "". */
function teksOpsional(cols: string[], idx: number): string | null {
  const v = ambil(cols, idx);
  return v === "" ? null : v;
}

/**
 * Tanggal kalender MURNI dari DUA format sumber yang mungkin:
 * - `M/D/YYYY` (ekspor Majoo/dashboard asli, atau Google Sheets dengan locale
 *   US -- `toLocaleDateString("en-US", ...)` di workflow n8n menghasilkan ini)
 * - `YYYY-MM-DD` (ekspor langsung dari Postgres/`to_char(...)`, atau Google
 *   Sheets locale lain yang menyimpan ISO -- dikonfirmasi 2026-10-17 lewat
 *   pengujian eksplisit, lihat `import-csv.test.ts`)
 * -> selalu dikembalikan sebagai `YYYY-MM-DD`.
 *
 * SENGAJA disusun ulang sebagai STRING (split, bukan regex capture lalu
 * dirangkai manual), TIDAK pakai `new Date(...)`/`toISOString()` sama sekali:
 * ini tanggal kalender tanpa jam, dan mengonversinya lewat objek Date akan
 * menggeser tanggal tergantung timezone proses (bug yang sudah berulang di
 * repo ini -- lihat komentar `todayIso()` di `apps/web/src/utils/format.ts`).
 */
function tanggalKalender(cols: string[], idx: number, nama: string): string {
  const raw = teksWajib(cols, idx, nama);

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const bagian = raw.split("/");
  if (bagian.length === 3) {
    const [bulan, hari, tahun] = bagian as [string, string, string];
    if (/^\d{1,2}$/.test(bulan) && /^\d{1,2}$/.test(hari) && /^\d{4}$/.test(tahun)) {
      return `${tahun}-${pad2(bulan)}-${pad2(hari)}`;
    }
  }

  throw new Error(`Kolom "${nama}" bukan tanggal M/D/YYYY atau YYYY-MM-DD yang valid: "${raw}"`);
}

/** Jam dari format sumber `H:MM`/`HH:MM` -> `HH:MM:00` untuk kolom TIME. */
function jamKalender(cols: string[], idx: number, nama: string): string {
  const raw = teksWajib(cols, idx, nama);
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) throw new Error(`Kolom "${nama}" bukan jam H:MM yang valid: "${raw}"`);
  return `${pad2(m[1]!)}:${m[2]}:${m[3] ?? "00"}`;
}

/** String waktu sudah menyertakan offset eksplisit (`Z` atau `+07:00`/`-0700`)? */
const SUDAH_ADA_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Lengkapi string waktu TANPA offset dengan `+07:00` (Asia/Jakarta) secara
 * eksplisit. Tanpa ini, `new Date("2026-07-22 6:16:03")` diperlakukan sebagai
 * waktu lokal proses (atau UTC untuk bentuk date-only), yang salah: semua
 * sumber data Samsara dicatat dalam waktu WIB.
 *
 * Menerima DUA keluarga format tanpa offset (dikonfirmasi 2026-10-17 lewat
 * pengujian eksplisit terhadap gaya ekspor Postgres vs Google Sheets, lihat
 * `import-csv.test.ts`):
 * - `YYYY-MM-DD[ T]HH:MM[:SS][.ffff]` atau `YYYY-MM-DD` saja (gaya Postgres/
 *   `to_char`, format asli fungsi ini).
 * - `M/D/YYYY[ H:MM[:SS]]` (gaya Google Sheets locale US, mis.
 *   `toLocaleDateString("en-US", ...)` di workflow n8n) -- BARU.
 */
function tambahOffsetJakarta(raw: string): string {
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
  if (mdy) {
    const [, bulan, hari, tahun, jam, menit, detik] = mdy;
    return `${tahun}-${pad2(bulan!)}-${pad2(hari!)}T${pad2(jam ?? "0")}:${menit ?? "00"}:${detik ?? "00"}+07:00`;
  }

  const s = raw.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00+07:00`;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?(\.\d+)?$/.exec(s);
  if (!m) return s; // biarkan `new Date` yang menolak, dilaporkan sebagai error baris
  return `${m[1]}T${pad2(m[2]!)}:${m[3]}:${m[4] ?? "00"}${m[5] ?? ""}+07:00`;
}

/**
 * Timestamp (TIMESTAMPTZ) dari string sumber yang formatnya BERVARIASI:
 * - sudah ada offset/`Z` (mis. `2026-07-25T13:30:00+07:00`, `2025-12-15T15:12:22Z`)
 *   -> dipakai apa adanya, tidak ambigu, tidak ditambahi apa pun.
 * - tanpa offset (mis. `2026-07-22 6:16:03`, `2026-08-04`)
 *   -> dianggap waktu lokal Asia/Jakarta, offset `+07:00` ditambahkan eksplisit.
 */
function waktuWajib(cols: string[], idx: number, nama: string): string {
  const raw = teksWajib(cols, idx, nama);
  const normal = SUDAH_ADA_OFFSET.test(raw) ? raw : tambahOffsetJakarta(raw);
  const d = new Date(normal);
  if (Number.isNaN(d.getTime())) throw new Error(`Kolom "${nama}" bukan waktu valid: "${raw}"`);
  return d.toISOString();
}

function waktuOpsional(cols: string[], idx: number, nama: string): string | null {
  if (ambil(cols, idx) === "") return null;
  return waktuWajib(cols, idx, nama);
}

/**
 * KHUSUS kolom waktu `raw_majoo` (transaction_date/payment_date/refund_date):
 * sumbernya SELALU diakhiri "Z" (klaim UTC eksplisit), TAPI klaim itu SALAH --
 * dikonfirmasi 2026-10-17 lewat perbandingan jam genuinely-lokal di
 * `salessync_log_penjualan` untuk order Majoo yang sama: 5537 dari 5539 order
 * yang match (99,96%, toleransi ±65 detik) menunjukkan angka jam mentah di
 * balik "Z" itu SEBENARNYA sudah waktu lokal Asia/Jakarta, bukan UTC asli --
 * 2 pengecualian punya selisih yang masuk akal dijelaskan beda semantik
 * "jam order" vs "jam closing transaksi", bukan kontradiksi pola. Detail
 * lengkap: docs/architecture-decisions.md § 24.
 *
 * BEDA dari `waktuWajib`/`waktuOpsional` (generic, TETAP dipakai apa adanya
 * untuk sumber LAIN yang offset-nya genuinely benar, mis. `salessync_transaksi`
 * -- JANGAN disatukan dengan fungsi ini) -- fungsi ini SELALU memperlakukan
 * wall-clock digit sebagai lokal +07:00, APA PUN offset yang tertulis di
 * sumbernya (termasuk kalau offset itu "Z"), dengan membuang offset asli
 * sebelum menambahkan +07:00 yang benar.
 *
 * Fix ini CUMA mengubah interpretasi untuk IMPOR BARU -- baris yang sudah
 * tersimpan di `salessync_raw_majoo` dari impor SEBELUM perbaikan ini TIDAK
 * ikut berubah (tidak ada backfill/migrasi data), kecuali baris itu
 * di-upload ulang lewat CSV yang sama (upsert akan menimpa dengan interpretasi
 * yang sudah benar).
 */
function waktuWajibLokalPaksa(cols: string[], idx: number, nama: string): string {
  const raw = teksWajib(cols, idx, nama);
  const tanpaOffsetAsli = raw.replace(SUDAH_ADA_OFFSET, "");
  const normal = tambahOffsetJakarta(tanpaOffsetAsli);
  const d = new Date(normal);
  if (Number.isNaN(d.getTime())) throw new Error(`Kolom "${nama}" bukan waktu valid: "${raw}"`);
  return d.toISOString();
}

function waktuOpsionalLokalPaksa(cols: string[], idx: number, nama: string): string | null {
  if (ambil(cols, idx) === "") return null;
  return waktuWajibLokalPaksa(cols, idx, nama);
}

/**
 * Angka yang di sumber pakai pemisah ribuan koma DAN berkutip (mis. `"29,600"`).
 * Parser CSV sudah membuka kutipnya, tapi pemisah ribuannya masih ada dan
 * HARUS dibuang manual sebelum parseFloat (kalau tidak, `parseFloat("29,600")`
 * menghasilkan 29 -- salah tanpa error).
 */
function angkaRibuanWajib(cols: string[], idx: number, nama: string): number {
  return angkaWajib(cols, idx, nama);
}

/**
 * Angka dari sumber -- SELALU membuang pemisah ribuan koma dulu (mis.
 * `"29,600"` -> `29600`) sebelum `parseFloat`, APA PUN sumbernya.
 *
 * Awalnya fungsi ini ("polos, tanpa pemisah ribuan") dan `angkaRibuanWajib`
 * ("berkoma") dipisah karena sumber asli raw Majoo/biaya platform memang
 * tidak pernah berkoma. Diperbaiki 2026-10-17 (lihat `import-csv.test.ts`):
 * Google Sheets BISA mengekspor angka dengan pemisah ribuan untuk kolom
 * manapun, termasuk yang "seharusnya" polos -- tanpa perbaikan ini,
 * `parseFloat("-1,000")` diam-diam menghasilkan `-1` (BUKAN error, data
 * senyap salah 1000x lipat). Membuang koma pada angka yang memang sudah
 * polos tidak berefek apa pun (no-op), jadi aman untuk SEMUA sumber --
 * `angkaRibuanWajib` sekarang murni alias, dipertahankan di call site demi
 * kejelasan sumber data mana yang secara native berkoma.
 */
function angkaWajib(cols: string[], idx: number, nama: string): number {
  const raw = teksWajib(cols, idx, nama);
  const n = Number.parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new Error(`Kolom "${nama}" bukan angka valid: "${raw}"`);
  return n;
}

function angkaOpsional(cols: string[], idx: number, nama: string): number | null {
  if (ambil(cols, idx) === "") return null;
  return angkaWajib(cols, idx, nama);
}

function bilanganBulatWajib(cols: string[], idx: number, nama: string): number {
  const raw = teksWajib(cols, idx, nama);
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n)) throw new Error(`Kolom "${nama}" bukan bilangan bulat valid: "${raw}"`);
  return n;
}

// --- Helper struktur CSV ----------------------------------------------------

/**
 * Peta nama kolom header -> indeks. Kolom sumber yang TIDAK terdaftar di
 * `namaKolom` otomatis diabaikan -- ini sekaligus menangani 2 kolom tanpa nama
 * di akhir header `transaksi.csv` (artefak export, lihat
 * `COMMENT ON TABLE salessync_transaksi`): kolom tanpa nama tidak pernah
 * dicari, jadi isinya tidak pernah masuk tabel.
 */
/**
 * @param kolomOpsionalHeader Nama kolom yang boleh TIDAK ADA SAMA SEKALI di
 * header CSV (beda dari kolom opsional biasa, yang headernya wajib ada tapi
 * NILAINYA boleh kosong per baris) -- dipakai untuk kolom baru yang
 * ditambahkan belakangan (mis. `outlet_ref`), supaya CSV/workflow n8n lama
 * yang belum menyertakan kolom itu tetap valid. idx-nya jadi -1 kalau
 * memang tidak ada di header; `ambil()`/`teksOpsional()` sudah otomatis
 * memperlakukan idx -1 sama seperti kolom kosong (`cols[-1]` -> `undefined`).
 */
function buatIndeks(
  header: string[],
  namaKolom: readonly string[],
  kolomOpsionalHeader: readonly string[] = [],
): Record<string, number> {
  const bersih = header.map((h) => h.trim());
  const idx: Record<string, number> = {};
  const hilang: string[] = [];
  for (const nama of namaKolom) {
    const i = bersih.indexOf(nama);
    if (i === -1 && !kolomOpsionalHeader.includes(nama)) hilang.push(nama);
    idx[nama] = i;
  }
  if (hilang.length > 0) {
    throw new Error(`Header CSV tidak lengkap, kolom berikut tidak ada: ${hilang.join(", ")}`);
  }
  return idx;
}

interface BarisUpsert {
  /** Query upsert yang RETURNING-nya menyertakan `was_insert`. */
  sql: string;
  params: unknown[];
}

/**
 * Jalankan upsert satu baris di dalam SAVEPOINT dan terjemahkan hasilnya ke
 * salah satu dari tiga kategori (lihat dokumentasi `xmax` di atas file ini).
 */
async function jalankanUpsert(
  client: PoolClient,
  hasil: HasilImport,
  nomorBaris: number,
  buat: () => BarisUpsert,
): Promise<void> {
  let perintah: BarisUpsert;
  try {
    // Validasi/parsing nilai -- gagal di sini belum menyentuh database sama
    // sekali, jadi tidak perlu rollback apa pun.
    perintah = buat();
  } catch (err) {
    hasil.errors.push({ baris: nomorBaris, pesan: err instanceof Error ? err.message : "Baris gagal diproses" });
    return;
  }

  await client.query("SAVEPOINT baris_import");
  try {
    const { rows } = await client.query<{ was_insert: boolean }>(perintah.sql, perintah.params);
    await client.query("RELEASE SAVEPOINT baris_import");
    const row = rows[0];
    if (!row) {
      hasil.dilewati += 1;
    } else if (row.was_insert) {
      hasil.dibuat += 1;
    } else {
      hasil.diperbarui += 1;
    }
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT baris_import");
    await client.query("RELEASE SAVEPOINT baris_import");
    hasil.errors.push({ baris: nomorBaris, pesan: err instanceof Error ? err.message : "Baris gagal disimpan" });
  }
}

function siapkan(
  text: string,
  namaKolom: readonly string[],
  kolomOpsionalHeader: readonly string[] = [],
): { rows: string[][]; idx: Record<string, number> } {
  const rows = parseCsv(text ?? "");
  const header = rows[0];
  if (!header) throw new Error("CSV kosong -- tidak ada baris header");
  return { rows: rows.slice(1), idx: buatIndeks(header, namaKolom, kolomOpsionalHeader) };
}

function hasilKosong(): HasilImport {
  return { dibuat: 0, diperbarui: 0, dilewati: 0, errors: [] };
}

// --- 1. Log penjualan -------------------------------------------------------

const KOLOM_LOG = [
  "transaction_date",
  "transaction_time",
  "platform",
  "order_id",
  "item_name",
  "menu_id",
  "quantity",
  "item_type",
  "parent_item",
  "unique_key",
  "inv_status",
  "outlet_ref",
] as const;

/** `outlet_ref` BOLEH TIDAK ADA SAMA SEKALI di header -- lihat `buatIndeks`. Kolom baru Tahap 1 "Outlet & Kitchen", CSV/workflow n8n lama belum menyertakannya. */
const KOLOM_LOG_OPSIONAL_HEADER = ["outlet_ref"] as const;

const SQL_LOG = `
  INSERT INTO salessync_log_penjualan
    (transaction_date, transaction_time, platform, order_id, item_name, menu_id, quantity, item_type, parent_item, unique_key, inv_status, outlet_ref)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (unique_key) DO UPDATE SET
    transaction_date = EXCLUDED.transaction_date,
    transaction_time = EXCLUDED.transaction_time,
    platform = EXCLUDED.platform,
    order_id = EXCLUDED.order_id,
    item_name = EXCLUDED.item_name,
    menu_id = EXCLUDED.menu_id,
    quantity = EXCLUDED.quantity,
    item_type = EXCLUDED.item_type,
    parent_item = EXCLUDED.parent_item,
    inv_status = EXCLUDED.inv_status,
    outlet_ref = EXCLUDED.outlet_ref
  WHERE (
    salessync_log_penjualan.transaction_date, salessync_log_penjualan.transaction_time,
    salessync_log_penjualan.platform, salessync_log_penjualan.order_id,
    salessync_log_penjualan.item_name, salessync_log_penjualan.menu_id,
    salessync_log_penjualan.quantity, salessync_log_penjualan.item_type,
    salessync_log_penjualan.parent_item, salessync_log_penjualan.inv_status, salessync_log_penjualan.outlet_ref
  ) IS DISTINCT FROM (
    EXCLUDED.transaction_date, EXCLUDED.transaction_time, EXCLUDED.platform, EXCLUDED.order_id,
    EXCLUDED.item_name, EXCLUDED.menu_id, EXCLUDED.quantity, EXCLUDED.item_type,
    EXCLUDED.parent_item, EXCLUDED.inv_status, EXCLUDED.outlet_ref
  )
  RETURNING id, (xmax = 0) AS was_insert
`;

/**
 * Import export harian log penjualan per baris item.
 *
 * `processed_at` SENGAJA tidak ikut di SET maupun di perbandingan
 * `IS DISTINCT FROM`: import ulang file CSV yang sama tidak boleh mereset
 * status "sudah diproses jadi transaksi Penjualan Inventory".
 *
 * Setelah SEMUA baris selesai di-upsert, `syncItemMappingFromLog` dipanggil di
 * transaksi yang SAMA supaya item/kode eksternal baru langsung muncul di
 * antrian pemetaan tanpa langkah manual.
 */
export async function importLogPenjualan(client: PoolClient, text: string): Promise<HasilImport> {
  const hasil = hasilKosong();
  const { rows, idx } = siapkan(text, KOLOM_LOG, KOLOM_LOG_OPSIONAL_HEADER);

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i]!;
    await jalankanUpsert(client, hasil, i + 1, () => ({
      sql: SQL_LOG,
      params: [
        tanggalKalender(cols, idx.transaction_date!, "transaction_date"),
        jamKalender(cols, idx.transaction_time!, "transaction_time"),
        teksWajib(cols, idx.platform!, "platform"),
        teksWajib(cols, idx.order_id!, "order_id"),
        teksWajib(cols, idx.item_name!, "item_name"),
        teksOpsional(cols, idx.menu_id!),
        bilanganBulatWajib(cols, idx.quantity!, "quantity"),
        teksWajib(cols, idx.item_type!, "item_type"),
        teksOpsional(cols, idx.parent_item!),
        teksWajib(cols, idx.unique_key!, "unique_key"),
        teksWajib(cols, idx.inv_status!, "inv_status"),
        teksOpsional(cols, idx.outlet_ref!),
      ],
    }));
  }

  await syncItemMappingFromLog(client);
  return hasil;
}

// --- 2. Transaksi (rekonsiliasi income/fee per platform) --------------------

const KOLOM_TRANSAKSI = [
  "platform",
  "platform_order_number",
  "platform_transaction_id",
  "order_time",
  "settled_time",
  "status",
  "gross_amount",
  "total_fees",
  "net_revenue",
  "currency",
  "source",
  "source_id",
  "raw_payload",
] as const;

// Conflict target (source_id, platform_order_number) -- BUKAN source_id
// sendirian. Satu source_id (satu email laporan harian) berisi banyak order
// sebagai baris terpisah; lihat COMMENT ON COLUMN salessync_transaksi.source_id
// di migrasi 0001 untuk hasil verifikasi datanya.
const SQL_TRANSAKSI = `
  INSERT INTO salessync_transaksi
    (platform, platform_order_number, platform_transaction_id, order_time, settled_time, status,
     gross_amount, total_fees, net_revenue, currency, source, source_id, raw_payload)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT (source_id, platform_order_number) DO UPDATE SET
    platform = EXCLUDED.platform,
    platform_transaction_id = EXCLUDED.platform_transaction_id,
    order_time = EXCLUDED.order_time,
    settled_time = EXCLUDED.settled_time,
    status = EXCLUDED.status,
    gross_amount = EXCLUDED.gross_amount,
    total_fees = EXCLUDED.total_fees,
    net_revenue = EXCLUDED.net_revenue,
    currency = EXCLUDED.currency,
    source = EXCLUDED.source,
    raw_payload = EXCLUDED.raw_payload
  WHERE (
    salessync_transaksi.platform, salessync_transaksi.platform_transaction_id,
    salessync_transaksi.order_time, salessync_transaksi.settled_time, salessync_transaksi.status,
    salessync_transaksi.gross_amount, salessync_transaksi.total_fees, salessync_transaksi.net_revenue,
    salessync_transaksi.currency, salessync_transaksi.source, salessync_transaksi.raw_payload
  ) IS DISTINCT FROM (
    EXCLUDED.platform, EXCLUDED.platform_transaction_id, EXCLUDED.order_time, EXCLUDED.settled_time,
    EXCLUDED.status, EXCLUDED.gross_amount, EXCLUDED.total_fees, EXCLUDED.net_revenue,
    EXCLUDED.currency, EXCLUDED.source, EXCLUDED.raw_payload
  )
  RETURNING id, (xmax = 0) AS was_insert
`;

/**
 * Import laporan rekonsiliasi transaksi per platform.
 *
 * `raw_payload` adalah kolom PENDUKUNG: kalau isinya bukan JSON valid (atau
 * kosong), disimpan NULL dan barisnya TETAP diproses -- bukan alasan
 * menggagalkan baris yang angka-angkanya sendiri sudah benar.
 */
export async function importTransaksi(client: PoolClient, text: string): Promise<HasilImport> {
  const hasil = hasilKosong();
  const { rows, idx } = siapkan(text, KOLOM_TRANSAKSI);

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i]!;
    await jalankanUpsert(client, hasil, i + 1, () => {
      const payloadRaw = ambil(cols, idx.raw_payload!);
      let payload: string | null = null;
      if (payloadRaw !== "") {
        try {
          JSON.parse(payloadRaw);
          payload = payloadRaw;
        } catch {
          payload = null;
        }
      }
      return {
        sql: SQL_TRANSAKSI,
        params: [
          teksWajib(cols, idx.platform!, "platform"),
          teksWajib(cols, idx.platform_order_number!, "platform_order_number"),
          teksOpsional(cols, idx.platform_transaction_id!),
          waktuWajib(cols, idx.order_time!, "order_time"),
          waktuOpsional(cols, idx.settled_time!, "settled_time"),
          teksWajib(cols, idx.status!, "status"),
          angkaRibuanWajib(cols, idx.gross_amount!, "gross_amount"),
          angkaRibuanWajib(cols, idx.total_fees!, "total_fees"),
          angkaRibuanWajib(cols, idx.net_revenue!, "net_revenue"),
          teksWajib(cols, idx.currency!, "currency"),
          teksWajib(cols, idx.source!, "source"),
          teksWajib(cols, idx.source_id!, "source_id"),
          payload,
        ],
      };
    });
  }

  return hasil;
}

// --- 3. Raw Majoo -----------------------------------------------------------

const KOLOM_MAJOO = [
  "id",
  "transaction_no",
  "transaction_date",
  "payment_date",
  "order_type_name",
  "payment_method_name",
  "payment_cashier_name",
  "total_sales",
  "receivables",
  "total_discount_amount",
  "refund_amount",
  "is_paid",
  "outlet_id",
  "hasMore",
  "nextPage",
  "_empty",
  "refund_id",
  "refund_no",
  "refund_date",
  "refund_reason",
] as const;

// Conflict target (id) = primary key tabel ini; id diisi apa adanya dari id
// asli Majoo (bukan identity), lihat COMMENT ON TABLE salessync_raw_majoo.
const SQL_MAJOO = `
  INSERT INTO salessync_raw_majoo
    (id, transaction_no, transaction_date, payment_date, order_type_name, payment_method_name,
     payment_cashier_name, total_sales, receivables, total_discount_amount, refund_amount, is_paid,
     outlet_id, has_more, next_page, empty_field, refund_id, refund_no, refund_date, refund_reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
  ON CONFLICT (id) DO UPDATE SET
    transaction_no = EXCLUDED.transaction_no,
    transaction_date = EXCLUDED.transaction_date,
    payment_date = EXCLUDED.payment_date,
    order_type_name = EXCLUDED.order_type_name,
    payment_method_name = EXCLUDED.payment_method_name,
    payment_cashier_name = EXCLUDED.payment_cashier_name,
    total_sales = EXCLUDED.total_sales,
    receivables = EXCLUDED.receivables,
    total_discount_amount = EXCLUDED.total_discount_amount,
    refund_amount = EXCLUDED.refund_amount,
    is_paid = EXCLUDED.is_paid,
    outlet_id = EXCLUDED.outlet_id,
    has_more = EXCLUDED.has_more,
    next_page = EXCLUDED.next_page,
    empty_field = EXCLUDED.empty_field,
    refund_id = EXCLUDED.refund_id,
    refund_no = EXCLUDED.refund_no,
    refund_date = EXCLUDED.refund_date,
    refund_reason = EXCLUDED.refund_reason
  WHERE (
    salessync_raw_majoo.transaction_no, salessync_raw_majoo.transaction_date,
    salessync_raw_majoo.payment_date, salessync_raw_majoo.order_type_name,
    salessync_raw_majoo.payment_method_name, salessync_raw_majoo.payment_cashier_name,
    salessync_raw_majoo.total_sales, salessync_raw_majoo.receivables,
    salessync_raw_majoo.total_discount_amount, salessync_raw_majoo.refund_amount,
    salessync_raw_majoo.is_paid, salessync_raw_majoo.outlet_id, salessync_raw_majoo.has_more,
    salessync_raw_majoo.next_page, salessync_raw_majoo.empty_field, salessync_raw_majoo.refund_id,
    salessync_raw_majoo.refund_no, salessync_raw_majoo.refund_date, salessync_raw_majoo.refund_reason
  ) IS DISTINCT FROM (
    EXCLUDED.transaction_no, EXCLUDED.transaction_date, EXCLUDED.payment_date,
    EXCLUDED.order_type_name, EXCLUDED.payment_method_name, EXCLUDED.payment_cashier_name,
    EXCLUDED.total_sales, EXCLUDED.receivables, EXCLUDED.total_discount_amount,
    EXCLUDED.refund_amount, EXCLUDED.is_paid, EXCLUDED.outlet_id, EXCLUDED.has_more,
    EXCLUDED.next_page, EXCLUDED.empty_field, EXCLUDED.refund_id, EXCLUDED.refund_no,
    EXCLUDED.refund_date, EXCLUDED.refund_reason
  )
  RETURNING id, (xmax = 0) AS was_insert
`;

/**
 * Import export transaksi mentah dari API Majoo POS.
 *
 * Nama kolom sumber `hasMore`/`nextPage`/`_empty` dipetakan ke kolom tabel
 * `has_more`/`next_page`/`empty_field` (lihat COMMENT ON COLUMN masing-masing
 * di migrasi 0001 -- leading-underscore & camelCase bukan konvensi kolom di
 * repo ini, tapi strukturnya tetap dipertahankan demi ketertelusuran).
 *
 * Kolom angka di sumber ini POLOS (tanpa pemisah ribuan koma), beda dari
 * `transaksi.csv` -- karena itu pakai `angkaWajib`, bukan `angkaRibuanWajib`.
 */
export async function importRawMajoo(client: PoolClient, text: string): Promise<HasilImport> {
  const hasil = hasilKosong();
  const { rows, idx } = siapkan(text, KOLOM_MAJOO);

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i]!;
    await jalankanUpsert(client, hasil, i + 1, () => ({
      sql: SQL_MAJOO,
      params: [
        bilanganBulatWajib(cols, idx.id!, "id"),
        teksWajib(cols, idx.transaction_no!, "transaction_no"),
        // transaction_date/payment_date/refund_date di sumber ini diakhiri
        // "Z" tapi itu SALAH LABEL -- angkanya sebenarnya sudah waktu lokal
        // Asia/Jakarta, bukan UTC asli. Lihat waktuWajibLokalPaksa() untuk
        // bukti & penjelasan lengkap -- JANGAN kembalikan ke waktuWajib/
        // waktuOpsional generic di sini.
        waktuWajibLokalPaksa(cols, idx.transaction_date!, "transaction_date"),
        waktuOpsionalLokalPaksa(cols, idx.payment_date!, "payment_date"),
        teksOpsional(cols, idx.order_type_name!),
        teksOpsional(cols, idx.payment_method_name!),
        teksOpsional(cols, idx.payment_cashier_name!),
        angkaWajib(cols, idx.total_sales!, "total_sales"),
        angkaWajib(cols, idx.receivables!, "receivables"),
        angkaWajib(cols, idx.total_discount_amount!, "total_discount_amount"),
        angkaWajib(cols, idx.refund_amount!, "refund_amount"),
        ambil(cols, idx.is_paid!) === "1",
        teksWajib(cols, idx.outlet_id!, "outlet_id"),
        teksOpsional(cols, idx.hasMore!),
        teksOpsional(cols, idx.nextPage!),
        teksOpsional(cols, idx._empty!),
        teksOpsional(cols, idx.refund_id!),
        teksOpsional(cols, idx.refund_no!),
        waktuOpsionalLokalPaksa(cols, idx.refund_date!, "refund_date"),
        teksOpsional(cols, idx.refund_reason!),
      ],
    }));
  }

  return hasil;
}

// --- 4. Biaya platform ------------------------------------------------------

const KOLOM_BIAYA = [
  "tanggal_closing",
  "platform",
  "kategori_biaya",
  "deskripsi",
  "transaction_type_raw",
  "amount",
  "amount_raw",
  "reference_id",
  "id_platform",
  "create_time",
  "synced_at",
] as const;

const KOLOM_BIAYA_SQL = `(tanggal_closing, platform, kategori_biaya, deskripsi, transaction_type_raw,
     amount, amount_raw, reference_id, id_platform, create_time, synced_at)`;

const SQL_BIAYA_UPSERT = `
  INSERT INTO salessync_biaya_platform ${KOLOM_BIAYA_SQL}
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (id_platform) DO UPDATE SET
    tanggal_closing = EXCLUDED.tanggal_closing,
    platform = EXCLUDED.platform,
    kategori_biaya = EXCLUDED.kategori_biaya,
    deskripsi = EXCLUDED.deskripsi,
    transaction_type_raw = EXCLUDED.transaction_type_raw,
    amount = EXCLUDED.amount,
    amount_raw = EXCLUDED.amount_raw,
    reference_id = EXCLUDED.reference_id,
    create_time = EXCLUDED.create_time,
    synced_at = EXCLUDED.synced_at
  WHERE (
    salessync_biaya_platform.tanggal_closing, salessync_biaya_platform.platform,
    salessync_biaya_platform.kategori_biaya, salessync_biaya_platform.deskripsi,
    salessync_biaya_platform.transaction_type_raw, salessync_biaya_platform.amount,
    salessync_biaya_platform.amount_raw, salessync_biaya_platform.reference_id,
    salessync_biaya_platform.create_time, salessync_biaya_platform.synced_at
  ) IS DISTINCT FROM (
    EXCLUDED.tanggal_closing, EXCLUDED.platform, EXCLUDED.kategori_biaya, EXCLUDED.deskripsi,
    EXCLUDED.transaction_type_raw, EXCLUDED.amount, EXCLUDED.amount_raw, EXCLUDED.reference_id,
    EXCLUDED.create_time, EXCLUDED.synced_at
  )
  RETURNING id, (xmax = 0) AS was_insert
`;

// Baris TANPA id_platform: INSERT biasa, TANPA ON CONFLICT sama sekali.
// Postgres tidak pernah menganggap NULL sama dengan NULL lain di kolom UNIQUE,
// jadi baris seperti ini memang tidak bisa di-dedup -- selalu dihitung
// "dibuat". Lihat COMMENT ON COLUMN salessync_biaya_platform.id_platform.
const SQL_BIAYA_INSERT = `
  INSERT INTO salessync_biaya_platform ${KOLOM_BIAYA_SQL}
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  RETURNING id, true AS was_insert
`;

/**
 * Import rincian biaya/potongan platform (iklan, komisi, adjustment, dll).
 *
 * `transaction_type_raw` disimpan sebagai STRING apa adanya walau isinya kadang
 * cuma angka (`"3"`) -- di sumber kolom ini campuran angka-sebagai-string dan
 * teks bebas (`adjustment`, `Iklan dengan potongan harian`). Lihat
 * COMMENT ON COLUMN-nya di migrasi 0001.
 */
export async function importBiayaPlatform(client: PoolClient, text: string): Promise<HasilImport> {
  const hasil = hasilKosong();
  const { rows, idx } = siapkan(text, KOLOM_BIAYA);

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i]!;
    await jalankanUpsert(client, hasil, i + 1, () => {
      const idPlatform = teksOpsional(cols, idx.id_platform!);
      return {
        sql: idPlatform === null ? SQL_BIAYA_INSERT : SQL_BIAYA_UPSERT,
        params: [
          waktuWajib(cols, idx.tanggal_closing!, "tanggal_closing"),
          teksWajib(cols, idx.platform!, "platform"),
          teksWajib(cols, idx.kategori_biaya!, "kategori_biaya"),
          teksOpsional(cols, idx.deskripsi!),
          teksOpsional(cols, idx.transaction_type_raw!),
          angkaWajib(cols, idx.amount!, "amount"),
          angkaOpsional(cols, idx.amount_raw!, "amount_raw"),
          teksOpsional(cols, idx.reference_id!),
          idPlatform,
          waktuOpsional(cols, idx.create_time!, "create_time"),
          waktuOpsional(cols, idx.synced_at!, "synced_at"),
        ],
      };
    });
  }

  return hasil;
}
