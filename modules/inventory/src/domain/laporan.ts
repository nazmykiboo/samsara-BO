import type { PoolClient } from "pg";
import type { AuthUser } from "@samsara/core";
import { listPermintaanTransfer, type PermintaanTransferListItem } from "./permintaan-transfer.js";

/**
 * Laporan harian per lokasi -- gabungan dari transaksi hari itu (keluar/
 * masuk/permintaan ke CK) PLUS kondisi stok Central Kitchen SAAT INI
 * (independen dari tanggal/lokasi yang difilter, lihat `perluDibeli`).
 * Read-only murni, tidak menulis apa pun.
 */

export interface LaporanHarianKeluarItem {
  menuKode: string;
  menuNama: string;
  qtyTerjual: number;
}

export interface LaporanHarianMasukBaris {
  itemKode: string;
  itemNama: string;
  qtyBeli: number;
  satuanBeli: string;
  hargaSatuan: number;
  /** Nama vendor (Tahap 3) kalau header pembelian ini punya vendor_id. Null untuk pembelian lama sebelum vendor diwajibkan. */
  vendorNama: string | null;
  /** DEPRECATED -- teks bebas dari SEBELUM vendor diwajibkan. Null untuk semua pembelian baru (lihat COMMENT di migrasi 0031). Tetap dibaca untuk baris lama, ditampilkan sebagai "Supplier (lama)" di frontend. */
  supplier: string | null;
  noReferensi: string | null;
}

export interface LaporanHarianPerluDibeliItem {
  itemKode: string;
  itemNama: string;
  stokSaatIni: number;
  minStok: number;
  selisih: number;
}

export interface LaporanHarian {
  keluar: LaporanHarianKeluarItem[];
  masuk: LaporanHarianMasukBaris[];
  permintaanKeCk: PermintaanTransferListItem[];
  perluDibeli: LaporanHarianPerluDibeliItem[];
}

export interface GetLaporanHarianInput {
  locationId: number;
  tanggal: string;
}

/** Resolve lokasi Central Kitchen. Lihat catatan asumsi di `perluDibeli` di bawah. */
async function resolveLokasiCk(client: PoolClient): Promise<number | null> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM core_locations WHERE entitas = 'samsara_ck' LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

export async function getLaporanHarian(client: PoolClient, input: GetLaporanHarianInput): Promise<LaporanHarian> {
  // --- keluar: ringkasan menu terjual hari itu, di-GROUP BY menu ---------
  const { rows: keluarRows } = await client.query<{ menu_kode: string; menu_nama: string; qty_terjual: string }>(
    `SELECT m.kode AS menu_kode, m.name AS menu_nama, SUM(b.qty) AS qty_terjual
     FROM inventory_transaksi_penjualan h
     JOIN inventory_transaksi_penjualan_baris b ON b.header_id = h.id
     JOIN inventory_menu m ON m.id = b.menu_id
     WHERE h.location_id = $1 AND h.tanggal = $2
     GROUP BY m.kode, m.name
     ORDER BY m.kode`,
    [input.locationId, input.tanggal],
  );
  const keluar: LaporanHarianKeluarItem[] = keluarRows.map((r) => ({
    menuKode: r.menu_kode,
    menuNama: r.menu_nama,
    qtyTerjual: Number(r.qty_terjual),
  }));

  // --- masuk: daftar pembelian hari itu, per baris (detail, + info header) ---
  // LEFT JOIN ke inventory_vendor (BUKAN JOIN biasa): pembelian lama sebelum
  // vendor diwajibkan punya vendor_id NULL, baris itu tetap harus muncul di
  // laporan (vendorNama null, supplier teks lama kalau ada -- lihat
  // LaporanHarianMasukBaris).
  const { rows: masukRows } = await client.query<{
    item_kode: string;
    item_nama: string;
    qty_beli: string;
    satuan_beli: string;
    harga_satuan: string;
    vendor_nama: string | null;
    supplier: string | null;
    no_referensi: string | null;
  }>(
    `SELECT i.kode AS item_kode, i.name AS item_nama, b.qty_beli, b.satuan_beli, b.harga_satuan,
            v.name AS vendor_nama, h.supplier, h.no_referensi
     FROM inventory_transaksi_pembelian h
     JOIN inventory_transaksi_pembelian_baris b ON b.header_id = h.id
     JOIN inventory_items i ON i.id = b.item_id
     LEFT JOIN inventory_vendor v ON v.id = h.vendor_id
     WHERE h.location_id = $1 AND h.tanggal = $2
     ORDER BY h.id, i.kode`,
    [input.locationId, input.tanggal],
  );
  const masuk: LaporanHarianMasukBaris[] = masukRows.map((r) => ({
    itemKode: r.item_kode,
    itemNama: r.item_nama,
    qtyBeli: Number(r.qty_beli),
    satuanBeli: r.satuan_beli,
    hargaSatuan: Number(r.harga_satuan),
    vendorNama: r.vendor_nama,
    supplier: r.supplier,
    noReferensi: r.no_referensi,
  }));

  // --- permintaanKeCk: permintaan yang diajukan lokasi ini (location_tujuan_id) ---
  const semuaPermintaan = await listPermintaanTransfer(client, { locationId: input.locationId });
  const permintaanKeCk = semuaPermintaan.filter(
    // Number(...) di sini WAJIB -- driver pg mengembalikan kolom BIGINT (termasuk
    // location_tujuan_id) sebagai string JS walau tipe TS-nya `number`, jadi
    // perbandingan `===` langsung ke `input.locationId` selalu false kalau tidak
    // dikonversi dulu.
    (p) => Number(p.locationTujuanId) === input.locationId && p.tanggalDiminta === input.tanggal,
  );

  // --- perluDibeli: stok CK saat ini di bawah min_stok CK. SELALU laporan
  // kondisi Central Kitchen, independen dari `input.locationId` -- ini soal
  // apa yang perlu DIBELI CK, bukan per-outlet. TIDAK difilter tanggal
  // (kondisi SEKARANG, bukan histori hari itu).
  //
  // ASUMSI (lihat migrasi 0011): saat ini cuma ada 1 Central Kitchen
  // (`entitas = 'samsara_ck'`), jadi `LIMIT 1` aman. Kalau nanti ada CK
  // kedua, resolveLokasiCk() di atas HARUS direvisit (jadi daftar, bukan
  // satu id) -- jangan diam-diam "diperbaiki" tanpa keputusan owner.
  const lokasiCkId = await resolveLokasiCk(client);
  let perluDibeli: LaporanHarianPerluDibeliItem[] = [];
  if (lokasiCkId !== null) {
    const { rows: perluDibeliRows } = await client.query<{
      item_kode: string;
      item_nama: string;
      stok_saat_ini: string | null;
      min_stok: string;
    }>(
      `SELECT i.kode AS item_kode, i.name AS item_nama,
              COALESCE(cs.qty, 0) AS stok_saat_ini, m.min_stok
       FROM inventory_min_stok_lokasi m
       JOIN inventory_items i ON i.id = m.item_id
       LEFT JOIN inventory_current_stock cs ON cs.item_id = m.item_id AND cs.location_id = m.location_id
       WHERE m.location_id = $1 AND COALESCE(cs.qty, 0) < m.min_stok
       ORDER BY i.kode`,
      [lokasiCkId],
    );
    perluDibeli = perluDibeliRows.map((r) => {
      const stokSaatIni = Number(r.stok_saat_ini ?? 0);
      const minStok = Number(r.min_stok);
      return { itemKode: r.item_kode, itemNama: r.item_nama, stokSaatIni, minStok, selisih: stokSaatIni - minStok };
    });
  }

  return { keluar, masuk, permintaanKeCk, perluDibeli };
}

// ---------------------------------------------------------------------------
// Detail transaksi penjualan (per BARIS menu, bukan ringkasan per menu)
//
// Beda dari `getLaporanHarian().keluar` di atas yang GROUP BY menu untuk SATU
// tanggal & SATU lokasi: fungsi ini mengembalikan satu objek per baris
// transaksi (satu transaksi dengan 2 baris menu -> 2 objek), lintas rentang
// tanggal, dengan info header (lokasi, channel, no referensi) ikut di tiap
// baris supaya bisa ditampilkan sebagai tabel datar tanpa query tambahan.
// Read-only murni, tidak menulis apa pun.
// ---------------------------------------------------------------------------

/** Dari input kasir manual (default) atau dari modul sales-sync (lihat `SUMBER_PENCATATAN_SQL`). */
export type SumberPencatatan = "manual" | "sinkronisasi";

export interface DetailTransaksiPenjualanBaris {
  headerId: number;
  tanggal: string;
  /** "HH:MM:SS" atau `null` -- kolom TIME dari migrasi 0026, baris SEBELUM migrasi itu (dan input manual yang jamnya tidak diisi) selalu null. Lihat juga komentar `heatmapJam` di bawah untuk alasan kenapa ini TIDAK PERNAH diperkirakan dari `created_at`. */
  jam: string | null;
  lokasiId: number;
  lokasiNama: string;
  /** Channel penjualan, nilai mentah kolom `sumber` (mis. "Offline", "GrabFood"). */
  sumber: string;
  noReferensi: string | null;
  menuKode: string;
  menuNama: string;
  qty: number;
  sumberPencatatan: SumberPencatatan;
  /**
   * Snapshot HPP (rupiah) menu ini PADA SAAT baris dicatat (migrasi 0028).
   * `null` kalau HPP gagal dihitung saat itu (menu bergantung ke item
   * `pending_data`) ATAU baris lama belum di-backfill sama sekali (lihat
   * `hppSumber`).
   */
  hppSaatTransaksi: number | null;
  /**
   * `null` cuma untuk baris LAMA yang belum pernah di-backfill (lihat
   * migrasi 0028 & script backfill). `'snapshot_asli'` = dihitung otomatis
   * persis saat transaksi dicatat. `'snapshot_estimasi'` = diisi belakangan
   * lewat backfill memakai harga SAAT backfill dijalankan sebagai perkiraan.
   */
  hppSumber: "snapshot_asli" | "snapshot_estimasi" | null;
}

export interface GetDetailTransaksiPenjualanFilter {
  /** `YYYY-MM-DD`. Kosong -> 30 hari sebelum `tanggalSelesai` (lihat `resolveRentangTanggal`). */
  tanggalMulai?: string;
  /** `YYYY-MM-DD`. Kosong -> hari ini (CURRENT_DATE di database, timezone Asia/Jakarta). */
  tanggalSelesai?: string;
  /**
   * Dicocokkan PERSIS (case-sensitive) ke kolom `sumber`, bukan ILIKE.
   * SENGAJA tidak divalidasi ke `inventory_sales_channel`: kolom `sumber`
   * memang TIDAK punya FK ke tabel channel (lihat migrasi 0011), jadi
   * transaksi lama tetap menyimpan nama channel apa adanya walau channel-nya
   * sudah dinonaktifkan/diganti nama -- memvalidasi ke daftar channel yang
   * aktif SEKARANG akan membuat data histori itu tidak bisa difilter lagi.
   */
  channel?: string;
  /** Kode menu (`inventory_menu.kode`), dicocokkan persis. */
  kodeMenu?: string;
  /** Diabaikan untuk role non-allLocations kalau bukan lokasi sendiri -- lihat doc fungsi. */
  lokasiId?: number;
  /** Jumlah TRANSAKSI (header) per halaman, bukan jumlah baris menu -- lihat `DEFAULT_LIMIT_DETAIL_PENJUALAN`. */
  limit?: number;
  /** Jumlah TRANSAKSI yang dilewati dari awal (paginasi) -- 0/tidak diisi = halaman pertama. */
  offset?: number;
}

export interface HasilDetailTransaksiPenjualan {
  rows: DetailTransaksiPenjualanBaris[];
  /** Jumlah TOTAL transaksi (bukan baris menu) yang cocok filter, TANPA memperhitungkan limit/offset -- dipakai untuk ringkasan "menampilkan X dari Y transaksi" dan tombol "muat lebih banyak" di frontend. */
  totalTransaksi: number;
}

/**
 * Batas baris default. Transaksi penjualan adalah tabel yang tumbuh paling
 * cepat di modul ini (satu baris per menu per order), jadi query TANPA batas
 * bisa mengembalikan puluhan ribu baris. BELUM ADA satu pun endpoint list di
 * repo ini yang pakai pagination (limit/offset/cursor), jadi di sini sengaja
 * cuma dipasang LIMIT tetap -- bukan pola pagination baru yang diputuskan
 * sendiri. Kalau nanti butuh halaman berikutnya, itu keputusan pola (owner /
 * Jarvis) yang harus diterapkan seragam ke semua endpoint list.
 */
export const DEFAULT_LIMIT_DETAIL_PENJUALAN = 200;

/**
 * Penanda "transaksi ini lahir dari modul sales-sync, bukan diinput manual".
 * Jejaknya ada di `core_audit_log` (ditulis `modules/sales-sync/src/domain/proses.ts`),
 * BUKAN kolom di tabel penjualan -- jadi dibaca lewat correlated subquery
 * (EXISTS) di SELECT utama, satu round-trip, bukan N+1 query per baris
 * (pola sama dengan `konflikCutiSql` di modules/hr/src/domain/jadwal.ts).
 */
const SUMBER_PENCATATAN_SQL = `EXISTS (
            SELECT 1 FROM core_audit_log a
            WHERE a.table_name = 'inventory_transaksi_penjualan'
              AND a.record_id = h.id
              AND a.field_name = 'created_via'
              AND a.new_value = 'sales-sync'
          )`;

/**
 * Lengkapi rentang tanggal yang tidak diisi. Default dihitung di DATABASE
 * (CURRENT_DATE, timezone server Asia/Jakarta) supaya "hari ini" konsisten
 * dengan kolom `tanggal` (tipe DATE) yang diisi transaksi, bukan dari jam
 * proses Node yang bisa beda timezone.
 *
 * - `tanggalSelesai` kosong -> hari ini.
 * - `tanggalMulai` kosong -> 30 hari sebelum `tanggalSelesai` (yang sudah
 *   diresolusi), jadi tanpa query param apa pun hasilnya = 30 hari terakhir.
 */
async function resolveRentangTanggal(
  client: PoolClient,
  filter: GetDetailTransaksiPenjualanFilter,
): Promise<{ mulai: string; selesai: string }> {
  const { rows } = await client.query<{ mulai: string; selesai: string }>(
    `SELECT to_char(COALESCE($1::date, s.selesai - 30), 'YYYY-MM-DD') AS mulai,
            to_char(s.selesai, 'YYYY-MM-DD') AS selesai
     FROM (SELECT COALESCE($2::date, CURRENT_DATE) AS selesai) s`,
    [filter.tanggalMulai ?? null, filter.tanggalSelesai ?? null],
  );
  return rows[0];
}

/**
 * Daftar DETAIL baris transaksi penjualan, terbaru dulu.
 *
 * Lingkup lokasi ditegakkan DI SINI (domain layer), bukan cuma di router --
 * pola sama dengan `listJadwalShift` di modul hr: owner/manajer_ops
 * (`allLocations`) bebas lihat semua lokasi dan boleh mempersempit lewat
 * `lokasiId`; role lain SELALU dibatasi ke `user.locationIds` walau tidak
 * mengirim `lokasiId` sama sekali (middleware `requirePermission` cuma bisa
 * MENOLAK lokasi yang dikirim, dia tidak memaksa filter kalau param-nya
 * kosong). `lokasiId` dari role itu cuma dihormati untuk MEMPERSEMPIT ke
 * salah satu lokasinya sendiri -- kalau menunjuk lokasi lain, diabaikan
 * (bukan ditolak, sama seperti `resolveHppMethod`), hasilnya tetap lokasi
 * sendiri.
 */
export async function getDetailTransaksiPenjualan(
  client: PoolClient,
  user: AuthUser,
  filter: GetDetailTransaksiPenjualanFilter = {},
): Promise<HasilDetailTransaksiPenjualan> {
  const rentang = await resolveRentangTanggal(client, filter);

  const params: unknown[] = [rentang.mulai, rentang.selesai];
  const conditions: string[] = ["h.tanggal BETWEEN $1 AND $2"];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (user.allLocations) {
    if (filter.lokasiId !== undefined) {
      conditions.push(`h.location_id = ${bind(filter.lokasiId)}`);
    }
  } else if (user.locationIds.length === 0) {
    // Role lokasi-scoped tanpa lokasi yang ditugaskan: tidak ada yang boleh
    // dilihat. "1 = 0" supaya tetap satu query (bukan early return beda jalur).
    conditions.push("1 = 0");
  } else {
    conditions.push(`h.location_id = ANY(${bind(user.locationIds)}::bigint[])`);
    if (filter.lokasiId !== undefined && user.locationIds.includes(filter.lokasiId)) {
      conditions.push(`h.location_id = ${bind(filter.lokasiId)}`);
    }
  }

  if (filter.channel !== undefined) {
    conditions.push(`h.sumber = ${bind(filter.channel)}`);
  }
  // Filter menu BERPENGARUH ke header mana yang lolos (EXISTS), bukan
  // menyaring baris satu-satu -- paginasi di bawah ini per TRANSAKSI, jadi
  // kondisinya harus bisa dievaluasi di level header SEBELUM join ke baris.
  if (filter.kodeMenu !== undefined) {
    conditions.push(
      `EXISTS (SELECT 1 FROM inventory_transaksi_penjualan_baris b0 JOIN inventory_menu m0 ON m0.id = b0.menu_id WHERE b0.header_id = h.id AND m0.kode = ${bind(filter.kodeMenu)})`,
    );
  }

  const limit = Number.isFinite(filter.limit) && (filter.limit as number) > 0
    ? Math.min(filter.limit as number, DEFAULT_LIMIT_DETAIL_PENJUALAN)
    : DEFAULT_LIMIT_DETAIL_PENJUALAN;
  const offset = Number.isFinite(filter.offset) && (filter.offset as number) > 0 ? (filter.offset as number) : 0;

  // Langkah 1: PAGINASI DI LEVEL HEADER (transaksi), bukan baris menu -- satu
  // transaksi dengan banyak baris menu TIDAK BOLEH terpotong di tengah kalau
  // kebetulan jatuh di batas halaman. `count(*) OVER()` memberi total TANPA
  // query terpisah (jendela dihitung SEBELUM LIMIT diterapkan Postgres).
  const { rows: headerRows } = await client.query<{ header_id: string; total: string }>(
    `SELECT h.id AS header_id, count(*) OVER() AS total
     FROM inventory_transaksi_penjualan h
     WHERE ${conditions.join(" AND ")}
     ORDER BY h.tanggal DESC, h.id DESC
     LIMIT ${bind(limit)} OFFSET ${bind(offset)}`,
    params,
  );

  const totalTransaksi = headerRows[0] ? Number(headerRows[0].total) : 0;
  if (headerRows.length === 0) {
    return { rows: [], totalTransaksi };
  }
  const headerIds = headerRows.map((r) => r.header_id);

  // Langkah 2: detail baris menu untuk header-header di halaman ini saja --
  // TANPA limit (jumlah menu per satu transaksi kecil & wajar diambil utuh).
  const { rows } = await client.query<{
    header_id: string;
    tanggal: string;
    jam: string | null;
    lokasi_id: string;
    lokasi_nama: string;
    sumber: string;
    no_referensi: string | null;
    menu_kode: string;
    menu_nama: string;
    qty: string;
    dari_sinkronisasi: boolean;
    hpp_saat_transaksi: string | null;
    hpp_sumber: "snapshot_asli" | "snapshot_estimasi" | null;
  }>(
    `SELECT h.id AS header_id,
            to_char(h.tanggal, 'YYYY-MM-DD') AS tanggal,
            h.jam::text AS jam,
            h.location_id AS lokasi_id, l.name AS lokasi_nama,
            h.sumber, h.no_referensi,
            m.kode AS menu_kode, m.name AS menu_nama, b.qty,
            ${SUMBER_PENCATATAN_SQL} AS dari_sinkronisasi,
            b.hpp_saat_transaksi, b.hpp_sumber
     FROM inventory_transaksi_penjualan h
     JOIN inventory_transaksi_penjualan_baris b ON b.header_id = h.id
     JOIN inventory_menu m ON m.id = b.menu_id
     JOIN core_locations l ON l.id = h.location_id
     WHERE h.id = ANY($1::bigint[])
     ORDER BY h.tanggal DESC, h.jam DESC NULLS LAST, h.id DESC, b.id`,
    [headerIds],
  );

  // Number(...) WAJIB untuk kolom BIGINT/NUMERIC -- driver pg mengembalikannya
  // sebagai string JS (pola yang sama dicatat di getLaporanHarian di atas).
  return {
    rows: rows.map((r) => ({
      headerId: Number(r.header_id),
      tanggal: r.tanggal,
      jam: r.jam,
      lokasiId: Number(r.lokasi_id),
      lokasiNama: r.lokasi_nama,
      sumber: r.sumber,
      noReferensi: r.no_referensi,
      menuKode: r.menu_kode,
      menuNama: r.menu_nama,
      qty: Number(r.qty),
      sumberPencatatan: r.dari_sinkronisasi ? "sinkronisasi" : "manual",
      hppSaatTransaksi: r.hpp_saat_transaksi === null ? null : Number(r.hpp_saat_transaksi),
      hppSumber: r.hpp_sumber,
    })),
    totalTransaksi,
  };
}

// ===========================================================================
// Analitik (GET /analitik/penjualan, GET /analitik/operasional)
//
// Dua fungsi di bawah read-only murni (tidak menulis apa pun, tidak menyentuh
// ledger) dan menerima `client` dari pemanggil seperti fungsi domain lain di
// modul ini. Keduanya menghasilkan DUA hal: angka mentah untuk grafik/tabel,
// dan `insight` berupa kalimat Bahasa Indonesia siap tampil. Ambang batas
// pemicu insight TIDAK di-hardcode -- dibaca dari `inventory_insight_rules`
// (migrasi 0025) supaya owner bisa mengubahnya lewat UI tanpa deploy ulang.
// ===========================================================================

/** Rentang satu minggu kalender (Senin..Minggu), dua-duanya inklusif. */
export interface RentangMinggu {
  mulai: string;
  selesai: string;
}

/**
 * Senin minggu yang memuat `dateStr` ("YYYY-MM-DD"). Perhitungan kalender
 * MURNI `Date.UTC` -- tanggal diperlakukan sebagai string abstrak tanpa
 * timezone, supaya tidak pernah bergeser sehari. Ini DUPLIKAT yang disengaja
 * dari `mondayOfWeek` di modules/hr/src/domain/jadwal.ts: modul harus tetap
 * terisolasi (tidak boleh import lintas modul bisnis, CLAUDE.md § 3), dan
 * menyalin helper kalender sekecil ini sudah jadi pola yang diterima di repo
 * ini (lihat catatan serupa di modules/hr/src/domain/pengajuan-libur.ts).
 */
function mondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diffToMonday);
  return utc.toISOString().slice(0, 10);
}

/** Geser tanggal kalender `days` hari (boleh negatif). Date.UTC murni, alasan sama seperti `mondayOfWeek`. */
function addDaysUTC(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/**
 * Format rupiah untuk DISISIPKAN KE KALIMAT INSIGHT (bukan untuk field angka
 * -- field angka di response tetap dikirim mentah supaya frontend bebas
 * memformatnya). Konfigurasi Intl-nya disamakan dengan `formatRupiah` di
 * apps/web/src/utils/format.ts supaya angka di dalam kalimat insight tampak
 * sama dengan angka di tabel sebelahnya.
 */
const RUPIAH = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

function formatRupiah(value: number): string {
  return RUPIAH.format(value);
}

/**
 * Ambang batas pemicu insight yang AKTIF saja, `kode -> ambang_batas`.
 * Baris yang `aktif = false` sengaja tidak dimasukkan ke map -- pemanggil
 * memeriksa `map.get(kode) === undefined` sebagai "rule ini dimatikan owner,
 * jangan hasilkan insight jenis itu sama sekali".
 *
 * Satuan `ambang_batas` BEDA-BEDA tergantung `kode` (persen / jumlah minggu /
 * jumlah siklus) -- lihat komentar di migrasi 0025. Jangan perlakukan seragam.
 */
async function readInsightRules(client: PoolClient): Promise<Map<string, number>> {
  const { rows } = await client.query<{ kode: string; ambang_batas: string }>(
    `SELECT kode, ambang_batas FROM inventory_insight_rules WHERE aktif = true`,
  );
  return new Map(rows.map((r) => [r.kode, Number(r.ambang_batas)]));
}

/**
 * "Hari ini" default diambil dari CURRENT_DATE DATABASE (timezone server
 * Asia/Jakarta), BUKAN jam proses Node -- alasan sama persis dengan
 * `resolveRentangTanggal` di atas: kolom `tanggal` transaksi bertipe DATE dan
 * diisi memakai acuan hari yang sama.
 */
async function resolvePeriode(client: PoolClient, periode: string | undefined): Promise<string> {
  if (periode !== undefined) return periode;
  const { rows } = await client.query<{ t: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS t`);
  return rows[0].t;
}

export interface AnalitikFilter {
  /**
   * `YYYY-MM-DD`, tanggal MANA PUN dalam minggu target (Senin-nya dihitung
   * sendiri lewat `mondayOfWeek`) -- pola sama dengan query param `minggu` di
   * GET /jadwal modul hr. Kosong -> hari ini (CURRENT_DATE database).
   */
  periode?: string;
  /** Kosong -> agregat SEMUA lokasi. Lihat catatan locationScope di tiap fungsi. */
  lokasiId?: number;
}

// --- 1. Analitik penjualan (minggu ini vs minggu lalu) ---------------------

export interface AnalitikProdukBaris {
  kodeMenu: string;
  namaMenu: string;
  qtyMingguIni: number;
  qtyMingguLalu: number;
  /** null kalau `qtyMingguLalu` = 0 -- persentase perubahan dari nol tidak terdefinisi (bukan Infinity). */
  persenPerubahan: number | null;
}

/** Satu titik heatmap "jam ramai": qty terjual di jam itu, dipisah offline vs online. */
export interface AnalitikHeatmapJamEntri {
  /** 0..23, jam lokal sesuai kolom `jam` (TIME) apa adanya -- tanpa konversi timezone. */
  jam: number;
  offline: number;
  online: number;
}

export interface AnalitikHeatmapJam {
  /** Jumlah HEADER transaksi minggu ini (bukan baris menu), termasuk yang jam-nya NULL. */
  totalTransaksiMingguIni: number;
  /** Bagian dari `totalTransaksiMingguIni` yang kolom `jam`-nya terisi -- cuma ini yang masuk `data`. */
  transaksiDenganJam: number;
  /** SELALU 24 entri, jam 0..23 berurutan; jam tanpa data bernilai 0 (bukan entri hilang). */
  data: AnalitikHeatmapJamEntri[];
}

export interface AnalitikPenjualan {
  mingguIni: RentangMinggu;
  mingguLalu: RentangMinggu;
  totalQtyMingguIni: number;
  totalQtyMingguLalu: number;
  topProduk: AnalitikProdukBaris[];
  bottomProduk: AnalitikProdukBaris[];
  /** Heatmap jam ramai, MINGGU INI SAJA (bukan dua minggu seperti field di atas). */
  heatmapJam: AnalitikHeatmapJam;
  /** Kalimat siap tampil; ARRAY KOSONG kalau tidak ada perubahan signifikan (teks "tidak ada perubahan" itu urusan frontend, bukan backend). */
  insight: string[];
}

/** Panjang daftar topProduk/bottomProduk. */
const MAKS_PRODUK_ANALITIK = 10;
/** Ukuran "papan 5 besar" yang dipantau insight masuk/keluar top 5. */
const UKURAN_TOP_MENU = 5;
/**
 * Panjang array `heatmapJam.data`: SELALU 24 (jam 0..23), termasuk jam di luar
 * jam operasional outlet (06.00-21.00). Jam sepi tetap dikirim sebagai 0 supaya
 * frontend bisa menggambar sumbu-X penuh tanpa "bolong", dan supaya transaksi
 * di luar jam operasional (mis. order delivery yang jam platform-nya meleset)
 * tidak hilang diam-diam dari laporan.
 */
const JAM_PER_HARI = 24;

/**
 * Perbandingan qty terjual per menu MINGGU INI vs MINGGU LALU, plus insight
 * teks. Satuan yang dibandingkan adalah QTY (porsi), bukan rupiah: kolom
 * transaksi penjualan tidak menyimpan nilai uang per baris.
 *
 * Plus `heatmapJam`: distribusi qty terjual per JAM (offline vs online),
 * MINGGU INI SAJA -- sumbernya kolom `jam` (TIME, nullable) yang ditambahkan
 * migrasi 0026. Baris dengan `jam IS NULL` (semua data sebelum migrasi itu,
 * plus input manual yang jamnya tidak diisi) SENGAJA tidak ikut: jam TIDAK
 * BOLEH diperkirakan dari `created_at` (itu jam INPUT/INSERT kasir, bukan jam
 * transaksi). Supaya ketimpangan itu transparan dan bukan "angka yang
 * kelihatan lengkap tapi diam-diam sebagian", response ikut mengirim
 * `transaksiDenganJam` vs `totalTransaksiMingguIni`. Keduanya BUKAN gerbang:
 * heatmap tetap dikirim apa adanya walau datanya masih sedikit (bahkan nol
 * semua) -- itu kondisi normal fase pengumpulan data, bukan error.
 *
 * Lingkup lokasi SENGAJA tidak ditegakkan di sini (beda dari
 * `getDetailTransaksiPenjualan` yang menerima `user`): endpoint pemanggilnya
 * cuma boleh diakses owner/manajer_ops (permission `analitik.lihat`), dan
 * dua role itu dua-duanya `allLocations`. Jadi `lokasiId` murni filter
 * "persempit ke satu lokasi", tanpa aturan "own" yang perlu dipaksakan.
 */
export async function getAnalitikPenjualan(
  client: PoolClient,
  filter: AnalitikFilter = {},
): Promise<AnalitikPenjualan> {
  const periode = await resolvePeriode(client, filter.periode);
  const mingguIniMulai = mondayOfWeek(periode);
  const mingguIni: RentangMinggu = { mulai: mingguIniMulai, selesai: addDaysUTC(mingguIniMulai, 6) };
  const mingguLalu: RentangMinggu = { mulai: addDaysUTC(mingguIniMulai, -7), selesai: addDaysUTC(mingguIniMulai, -1) };

  // Dua minggu dihitung dalam SATU query lewat SUM(CASE WHEN ...): rentang
  // kedua minggu itu 14 hari BERURUTAN, jadi WHERE luarnya cukup gabungannya.
  // Keuntungannya, menu yang cuma terjual di salah satu minggu tetap muncul
  // sebagai satu baris dengan sisi lainnya 0 (bukan baris hilang) tanpa perlu
  // FULL OUTER JOIN antar dua agregat.
  const params: unknown[] = [mingguIni.mulai, mingguIni.selesai, mingguLalu.mulai, mingguLalu.selesai];
  let filterLokasi = "";
  if (filter.lokasiId !== undefined) {
    params.push(filter.lokasiId);
    filterLokasi = ` AND h.location_id = $${params.length}`;
  }

  const { rows } = await client.query<{
    kode_menu: string;
    nama_menu: string;
    qty_minggu_ini: string;
    qty_minggu_lalu: string;
  }>(
    `SELECT m.kode AS kode_menu, m.name AS nama_menu,
            COALESCE(SUM(CASE WHEN h.tanggal BETWEEN $1 AND $2 THEN b.qty ELSE 0 END), 0) AS qty_minggu_ini,
            COALESCE(SUM(CASE WHEN h.tanggal BETWEEN $3 AND $4 THEN b.qty ELSE 0 END), 0) AS qty_minggu_lalu
     FROM inventory_transaksi_penjualan h
     JOIN inventory_transaksi_penjualan_baris b ON b.header_id = h.id
     JOIN inventory_menu m ON m.id = b.menu_id
     WHERE h.tanggal BETWEEN $3 AND $2${filterLokasi}
     GROUP BY m.kode, m.name`,
    params,
  );

  // Number(...) WAJIB (kolom NUMERIC dikembalikan driver pg sebagai string).
  const entri: AnalitikProdukBaris[] = rows.map((r) => {
    const qtyMingguIni = Number(r.qty_minggu_ini);
    const qtyMingguLalu = Number(r.qty_minggu_lalu);
    return {
      kodeMenu: r.kode_menu,
      namaMenu: r.nama_menu,
      qtyMingguIni,
      qtyMingguLalu,
      // Pembagi nol -> null, BUKAN Infinity/NaN: "naik dari 0 ke 5" tidak bisa
      // dinyatakan sebagai persentase, dan frontend perlu bisa membedakannya
      // dari "0%" (stabil).
      persenPerubahan: qtyMingguLalu === 0 ? null : ((qtyMingguIni - qtyMingguLalu) / qtyMingguLalu) * 100,
    };
  });

  const totalQtyMingguIni = entri.reduce((acc, e) => acc + e.qtyMingguIni, 0);
  const totalQtyMingguLalu = entri.reduce((acc, e) => acc + e.qtyMingguLalu, 0);

  // Tie-break `kodeMenu` di semua pengurutan di bawah supaya urutan hasil
  // stabil (dua menu dengan qty sama tidak bertukar posisi antar request).
  const topProduk = entri
    .filter((e) => e.qtyMingguIni > 0)
    .sort((a, b) => b.qtyMingguIni - a.qtyMingguIni || a.kodeMenu.localeCompare(b.kodeMenu))
    .slice(0, MAKS_PRODUK_ANALITIK);

  // bottomProduk: menu yang qty-nya 0 di KEDUA minggu tidak masuk daftar mana
  // pun -- menu yang memang tidak dijual di lokasi/periode itu bukan "produk
  // terlemah", memasukkannya cuma jadi noise.
  const bottomProduk = entri
    .filter((e) => e.qtyMingguIni > 0 || e.qtyMingguLalu > 0)
    .sort((a, b) => a.qtyMingguIni - b.qtyMingguIni || a.kodeMenu.localeCompare(b.kodeMenu))
    .slice(0, MAKS_PRODUK_ANALITIK);

  // --- heatmapJam ---------------------------------------------------------
  // Scope MINGGU INI SAJA: `mingguIni` di atas DIPAKAI ULANG (jangan hitung
  // ulang Senin/Minggu di sini, nanti bisa menyimpang dari field mingguIni
  // yang dikirim ke response).
  //
  // Pengelompokan offline/online pakai kolom `sumber` apa adanya: 'Offline'
  // adalah SATU-SATUNYA channel offline (migrasi 0011), tiga channel lainnya
  // (GrabFood/GoFood/ShopeeFood) delivery. CASE ELSE 'online' dipilih supaya
  // channel delivery BARU yang ditambahkan nanti otomatis masuk kelompok
  // online tanpa perlu mengubah query ini -- dan `sumber` tidak punya FK ke
  // tabel channel (lihat catatan di GetDetailTransaksiPenjualanFilter.channel),
  // jadi daftar nilai yang mungkin tidak bisa diandalkan tertutup.
  const heatmapParams: unknown[] = [mingguIni.mulai, mingguIni.selesai];
  let heatmapFilterLokasi = "";
  if (filter.lokasiId !== undefined) {
    heatmapParams.push(filter.lokasiId);
    heatmapFilterLokasi = ` AND h.location_id = $${heatmapParams.length}`;
  }

  const { rows: heatmapRows } = await client.query<{
    jam_ke: number;
    kelompok: "offline" | "online";
    total_qty: string;
  }>(
    `SELECT EXTRACT(HOUR FROM h.jam)::int AS jam_ke,
            CASE WHEN h.sumber = 'Offline' THEN 'offline' ELSE 'online' END AS kelompok,
            SUM(b.qty) AS total_qty
     FROM inventory_transaksi_penjualan h
     JOIN inventory_transaksi_penjualan_baris b ON b.header_id = h.id
     WHERE h.jam IS NOT NULL AND h.tanggal BETWEEN $1 AND $2${heatmapFilterLokasi}
     GROUP BY jam_ke, kelompok`,
    heatmapParams,
  );

  // Kerangka 24 jam dibuat LEBIH DULU lalu diisi dari hasil query -- bukan
  // sebaliknya (map hasil query), supaya jam yang tidak punya transaksi tetap
  // jadi titik data bernilai 0 dan frontend tidak perlu menambal lubangnya.
  const dataJam: AnalitikHeatmapJamEntri[] = Array.from({ length: JAM_PER_HARI }, (_, jam) => ({
    jam,
    offline: 0,
    online: 0,
  }));
  for (const r of heatmapRows) {
    // Number(...) WAJIB untuk total_qty (NUMERIC -> string di driver pg).
    const entri = dataJam[Number(r.jam_ke)];
    if (entri === undefined) continue; // defensif; EXTRACT(HOUR) selalu 0..23
    if (r.kelompok === "offline") entri.offline += Number(r.total_qty);
    else entri.online += Number(r.total_qty);
  }

  // Hitungan header (bukan baris menu) untuk transparansi cakupan data jam.
  const cakupanParams: unknown[] = [mingguIni.mulai, mingguIni.selesai];
  let cakupanFilterLokasi = "";
  if (filter.lokasiId !== undefined) {
    cakupanParams.push(filter.lokasiId);
    cakupanFilterLokasi = ` AND h.location_id = $${cakupanParams.length}`;
  }
  const { rows: cakupanRows } = await client.query<{ total: string; dengan_jam: string }>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE h.jam IS NOT NULL) AS dengan_jam
     FROM inventory_transaksi_penjualan h
     WHERE h.tanggal BETWEEN $1 AND $2${cakupanFilterLokasi}`,
    cakupanParams,
  );

  const heatmapJam: AnalitikHeatmapJam = {
    totalTransaksiMingguIni: Number(cakupanRows[0].total),
    transaksiDenganJam: Number(cakupanRows[0].dengan_jam),
    data: dataJam,
  };

  const rules = await readInsightRules(client);
  const insight: string[] = [];

  // Urutan insight: turun dulu (paling perlu ditindak), lalu naik, lalu
  // pergeseran papan 5 besar. Di dalam kategori turun/naik diurutkan dari
  // perubahan paling tajam.
  const ambangTurun = rules.get("turun_signifikan_persen");
  if (ambangTurun !== undefined) {
    for (const e of [...entri]
      .filter((x) => x.persenPerubahan !== null && x.persenPerubahan <= -ambangTurun)
      .sort((a, b) => a.persenPerubahan! - b.persenPerubahan! || a.kodeMenu.localeCompare(b.kodeMenu))) {
      insight.push(
        `${e.namaMenu} turun ${Math.abs(e.persenPerubahan!).toFixed(0)}% dibanding minggu lalu ` +
          `(${e.qtyMingguLalu} -> ${e.qtyMingguIni} porsi).`,
      );
    }
  }

  const ambangNaik = rules.get("naik_signifikan_persen");
  if (ambangNaik !== undefined) {
    for (const e of [...entri]
      .filter((x) => x.persenPerubahan !== null && x.persenPerubahan >= ambangNaik)
      .sort((a, b) => b.persenPerubahan! - a.persenPerubahan! || a.kodeMenu.localeCompare(b.kodeMenu))) {
      insight.push(
        `${e.namaMenu} naik ${e.persenPerubahan!.toFixed(0)}% dibanding minggu lalu ` +
          `(${e.qtyMingguLalu} -> ${e.qtyMingguIni} porsi).`,
      );
    }
  }

  // Papan 5 besar dua minggu dihitung TERPISAH dari map yang sama. Menu
  // ber-qty 0 tidak pernah dianggap anggota papan 5 besar walau daftarnya
  // belum penuh 5 -- "5 besar" dengan 0 porsi tidak berarti apa-apa.
  const top5 = (ambil: (e: AnalitikProdukBaris) => number): Set<string> =>
    new Set(
      [...entri]
        .filter((e) => ambil(e) > 0)
        .sort((a, b) => ambil(b) - ambil(a) || a.kodeMenu.localeCompare(b.kodeMenu))
        .slice(0, UKURAN_TOP_MENU)
        .map((e) => e.kodeMenu),
    );
  const top5Ini = top5((e) => e.qtyMingguIni);
  const top5Lalu = top5((e) => e.qtyMingguLalu);

  const urutKode = [...entri].sort((a, b) => a.kodeMenu.localeCompare(b.kodeMenu));
  for (const e of urutKode) {
    if (top5Ini.has(e.kodeMenu) && !top5Lalu.has(e.kodeMenu)) {
      insight.push(`${e.namaMenu} masuk ke ${UKURAN_TOP_MENU} besar menu terlaris minggu ini.`);
    }
  }
  for (const e of urutKode) {
    if (top5Lalu.has(e.kodeMenu) && !top5Ini.has(e.kodeMenu)) {
      insight.push(`${e.namaMenu} keluar dari ${UKURAN_TOP_MENU} besar menu terlaris.`);
    }
  }

  return {
    mingguIni,
    mingguLalu,
    totalQtyMingguIni,
    totalQtyMingguLalu,
    topProduk,
    bottomProduk,
    heatmapJam,
    insight,
  };
}

// --- 2. Analitik operasional (waste / opname / susut transfer) -------------

export interface AnalitikWastePerLokasi {
  lokasiId: number;
  lokasiNama: string;
  nilai: number;
}

export interface AnalitikWasteMinggu {
  minggu: RentangMinggu;
  nilaiTotal: number;
  /** Cuma lokasi yang PUNYA transaksi minggu itu (lokasi tanpa transaksi tidak muncul sebagai nol). */
  perLokasi: AnalitikWastePerLokasi[];
}

export interface AnalitikOpnameSiklus {
  /** Tanggal KEPUTUSAN opname (`diputuskan_at`) -- lihat catatan di `getAnalitikOperasional`. */
  tanggal: string;
  /** SUM(qty_fisik - qty_sistem) seluruh baris satu siklus. Negatif = fisik kurang dari sistem (susut). */
  selisihTotal: number;
}

export interface AnalitikOpnameLokasi {
  lokasiId: number;
  lokasiNama: string;
  /** Urut kronologis ASC (paling lama dulu). */
  siklus: AnalitikOpnameSiklus[];
}

export interface AnalitikTransferSusutMinggu {
  minggu: RentangMinggu;
  susutTotal: number;
}

export interface AnalitikCogsMinggu {
  minggu: RentangMinggu;
  /**
   * SUM(qty * hpp_saat_transaksi) baris penjualan minggu itu. Baris dengan
   * `hpp_saat_transaksi` NULL (HPP pending saat transaksi, atau baris lama
   * yang belum di-backfill) diperlakukan 0 -- sama seperti pola `wasteTren`
   * (COALESCE(..., 0)): barisnya TETAP ikut terhitung di `jumlahBaris`,
   * bukan dibuang, supaya item/menu `pending_data` tidak memblokir laporan.
   */
  totalCogs: number;
  /** Jumlah BARIS (bukan header) transaksi penjualan minggu itu, tanpa pandang hpp_sumber. */
  jumlahBaris: number;
  /** Subset `jumlahBaris` yang `hpp_sumber = 'snapshot_estimasi'` -- lihat `AnalitikOperasional.adaDataEstimasi`. */
  jumlahBarisEstimasi: number;
}

export interface AnalitikOperasional {
  wasteTren: AnalitikWasteMinggu[];
  opnameSelisihTren: AnalitikOpnameLokasi[];
  transferSusutTren: AnalitikTransferSusutMinggu[];
  /** Tren HPP/cost of goods sold penjualan, 8 minggu sama seperti tiga tren di atas. */
  cogsTren: AnalitikCogsMinggu[];
  /**
   * `true` kalau ADA baris penjualan (lintas waktu, bukan cuma jendela 8
   * minggu `cogsTren` -- lihat `tanggalMulaiDataAsli`) yang `hpp_sumber =
   * 'snapshot_estimasi'`, dibatasi `lokasiId` kalau filter itu diisi. Dipakai
   * frontend untuk menampilkan catatan transparansi "sebagian data di bawah
   * ini adalah estimasi dari harga saat ini, bukan harga historis asli".
   */
  adaDataEstimasi: boolean;
  /**
   * Tanggal (`YYYY-MM-DD`) transaksi penjualan PALING AWAL yang `hpp_sumber
   * = 'snapshot_asli'` (dihitung otomatis persis saat itu, lihat migrasi
   * 0028 & `createPenjualan`). `null` kalau belum ada satu pun baris
   * `snapshot_asli` (mis. database baru / belum ada transaksi sejak migrasi
   * 0028 jalan). SENGAJA lintas waktu penuh (tidak dibatasi jendela 8
   * minggu `cogsTren`) -- ini fakta "sejak kapan data historis mulai asli",
   * bukan bagian dari tren yang berjendela.
   */
  tanggalMulaiDataAsli: string | null;
  insight: string[];
}

/**
 * Panjang jendela tren: 8 minggu terakhir yang BERAKHIR di minggu `periode`
 * (indeks 0 = minggu paling lama, indeks terakhir = minggu periode).
 * Dipilih 8 karena ~2 bulan sudah cukup untuk melihat arah tren musiman dan
 * tetap memuat streak terpanjang yang masuk akal dari
 * `inventory_insight_rules` (default `waste_streak_minggu` = 3), tanpa
 * membuat grafik terlalu padat untuk dibaca di satu layar.
 */
const JUMLAH_MINGGU_TREN = 8;

/**
 * Tren operasional 8 minggu + insight teks. Tiga tren di dalamnya pakai
 * SUMBER dan FILTER yang berbeda -- jangan diasumsikan seragam:
 *
 * - `wasteTren`: baris Mutasi Lain `qty_change < 0` yang jenisnya
 *   `waste_rusak` atau `hilang_tidak_diketahui` saja (kolom `jenis`, migrasi
 *   0026). `staff_meal`/`sampel`/`retur_supplier` qty-nya juga berkurang tapi
 *   BUKAN waste, jadi tidak ikut -- ini koreksi dari versi sebelumnya yang
 *   menghitung semua qty negatif tanpa pandang jenis. Baris historis dengan
 *   `jenis IS NULL` (sebelum migrasi 0026) otomatis tidak ikut karena tidak
 *   match `IN (...)` -- disengaja, data lama tidak bisa dikategorikan
 *   belakangan. Nilai rupiah = ABS(qty_change) *
 *   harga_master; `harga_master` nullable (item ber-status `pending_data`),
 *   diperlakukan 0 -- barisnya TETAP ikut terhitung (nilai 0), bukan error
 *   dan bukan dibuang, supaya item yang harganya belum diisi tidak memblokir
 *   laporan (CLAUDE.md § aturan `pending_data`).
 * - `opnameSelisihTren`: cuma siklus `status = 'disetujui'` (opname 2 tahap,
 *   migrasi 0017) -- draft/ditolak selisihnya belum/tidak pernah masuk ledger
 *   jadi bukan fakta stok. Selisih tidak disimpan sebagai kolom, dihitung
 *   `qty_fisik - qty_sistem` saat query. Difilter & diurut pakai
 *   `diputuskan_at` (saat selisih benar-benar diposting), dan field `tanggal`
 *   di response adalah tanggal keputusan itu juga supaya yang ditampilkan
 *   konsisten dengan yang difilter/diurut.
 * - `transferSusutTren`: cuma transfer `status = 'diterima'` (transfer 2
 *   tahap, migrasi 0016). Selama status masih 'dikirim', `qty_terima` NULL,
 *   jadi baris itu WAJIB dikecualikan -- bukan dianggap susut 0. Arah dibatasi
 *   CK -> Outlet lewat `core_locations.entitas`. Tren ini SENGAJA tidak ikut
 *   difilter `lokasiId` (beda dari dua tren di atas): satu baris transfer
 *   menyentuh DUA lokasi, jadi "lokasi" satu angka susut itu ambigu (asal atau
 *   tujuan?) -- kalau nanti perlu dipecah per outlet, itu keputusan
 *   bentuk laporan yang perlu dikonfirmasi owner dulu.
 *
 * Catatan lokasi: sama seperti `getAnalitikPenjualan`, tidak ada penegakan
 * locationScope di sini karena pemanggilnya cuma owner/manajer_ops
 * (`allLocations`).
 */
export async function getAnalitikOperasional(
  client: PoolClient,
  filter: AnalitikFilter = {},
): Promise<AnalitikOperasional> {
  const periode = await resolvePeriode(client, filter.periode);
  const mingguIniMulai = mondayOfWeek(periode);

  const minggu: RentangMinggu[] = [];
  for (let i = JUMLAH_MINGGU_TREN - 1; i >= 0; i--) {
    const mulai = addDaysUTC(mingguIniMulai, -7 * i);
    minggu.push({ mulai, selesai: addDaysUTC(mulai, 6) });
  }
  const rentangMulai = minggu[0].mulai;
  const rentangSelesai = minggu[minggu.length - 1].selesai;

  // --- wasteTren ----------------------------------------------------------
  // Satu query untuk seluruh 8 minggu: nomor minggu dihitung di SQL sebagai
  // selisih hari dari awal rentang dibagi 7 (date - date di Postgres =
  // integer hari, pembagian integer = pembulatan ke bawah), lalu barisnya
  // disebar ke 8 titik data di JS. Menjalankan 8 query terpisah per minggu
  // (dan dikali jumlah lokasi) tidak perlu.
  const wasteParams: unknown[] = [rentangMulai, rentangSelesai];
  let wasteFilterLokasi = "";
  if (filter.lokasiId !== undefined) {
    wasteParams.push(filter.lokasiId);
    wasteFilterLokasi = ` AND h.location_id = $${wasteParams.length}`;
  }

  const { rows: wasteRows } = await client.query<{
    pekan_ke: number;
    lokasi_id: string;
    lokasi_nama: string;
    nilai: string;
  }>(
    `SELECT (h.tanggal - $1::date) / 7 AS pekan_ke,
            h.location_id AS lokasi_id, l.name AS lokasi_nama,
            SUM(ABS(b.qty_change) * COALESCE(i.harga_master, 0)) AS nilai
     FROM inventory_transaksi_mutasi_lain h
     JOIN inventory_transaksi_mutasi_lain_baris b ON b.header_id = h.id
     JOIN inventory_items i ON i.id = b.item_id
     JOIN core_locations l ON l.id = h.location_id
     WHERE b.qty_change < 0
       AND h.jenis IN ('waste_rusak', 'hilang_tidak_diketahui')
       AND h.tanggal BETWEEN $1 AND $2${wasteFilterLokasi}
     GROUP BY (h.tanggal - $1::date) / 7, h.location_id, l.name
     ORDER BY l.name`,
    wasteParams,
  );

  const wasteTren: AnalitikWasteMinggu[] = minggu.map((m, idx) => {
    const perLokasi = wasteRows
      .filter((r) => Number(r.pekan_ke) === idx)
      .map((r) => ({ lokasiId: Number(r.lokasi_id), lokasiNama: r.lokasi_nama, nilai: Number(r.nilai) }));
    return { minggu: m, nilaiTotal: perLokasi.reduce((acc, p) => acc + p.nilai, 0), perLokasi };
  });

  // --- opnameSelisihTren --------------------------------------------------
  // `diputuskan_at` nullable di skema, tapi selalu diisi bersamaan dengan
  // status 'disetujui' (lihat decideOpname di domain/stok.ts) -- guard
  // IS NOT NULL di bawah murni defensif supaya baris aneh tidak menghasilkan
  // tanggal null di response.
  const opnameParams: unknown[] = [rentangMulai, rentangSelesai];
  let opnameFilterLokasi = "";
  if (filter.lokasiId !== undefined) {
    opnameParams.push(filter.lokasiId);
    opnameFilterLokasi = ` AND h.location_id = $${opnameParams.length}`;
  }

  const { rows: opnameRows } = await client.query<{
    lokasi_id: string;
    lokasi_nama: string;
    tanggal: string;
    selisih_total: string;
  }>(
    `SELECT h.location_id AS lokasi_id, l.name AS lokasi_nama,
            to_char(h.diputuskan_at::date, 'YYYY-MM-DD') AS tanggal,
            SUM(b.qty_fisik - b.qty_sistem) AS selisih_total
     FROM inventory_transaksi_opname h
     JOIN inventory_transaksi_opname_baris b ON b.header_id = h.id
     JOIN core_locations l ON l.id = h.location_id
     WHERE h.status = 'disetujui'
       AND h.diputuskan_at IS NOT NULL
       AND h.diputuskan_at::date BETWEEN $1 AND $2${opnameFilterLokasi}
     GROUP BY h.id, h.location_id, l.name, h.diputuskan_at
     ORDER BY l.name, h.diputuskan_at, h.id`,
    opnameParams,
  );

  const opnameSelisihTren: AnalitikOpnameLokasi[] = [];
  for (const r of opnameRows) {
    const lokasiId = Number(r.lokasi_id);
    let lokasi = opnameSelisihTren.find((o) => o.lokasiId === lokasiId);
    if (!lokasi) {
      lokasi = { lokasiId, lokasiNama: r.lokasi_nama, siklus: [] };
      opnameSelisihTren.push(lokasi);
    }
    lokasi.siklus.push({ tanggal: r.tanggal, selisihTotal: Number(r.selisih_total) });
  }

  // --- transferSusutTren --------------------------------------------------
  // Tujuan transfer SENGAJA `entitas != 'samsara_ck'` (bukan hardcode nilai
  // entitas outlet tertentu, mis. 'samsara_outlet') -- bug nyata ditemukan
  // saat perbaikan vendor-pembelian (lihat docs/architecture-decisions.md
  // §29): entitas outlet dev bisa berubah lewat fitur Outlet & Kitchen,
  // dan versi lama query ini diam-diam berhenti mencocokkan baris apa pun
  // (bukan error, cuma angka transferSusutTren jadi nol terus) begitu outlet
  // di-rename entitasnya.
  const { rows: transferRows } = await client.query<{ pekan_ke: number; susut_total: string | null }>(
    `SELECT (h.tanggal - $1::date) / 7 AS pekan_ke,
            SUM(b.qty_kirim - b.qty_terima) AS susut_total
     FROM inventory_transaksi_transfer h
     JOIN inventory_transaksi_transfer_baris b ON b.header_id = h.id
     JOIN core_locations asal ON asal.id = h.location_asal_id AND asal.entitas = 'samsara_ck'
     JOIN core_locations tujuan ON tujuan.id = h.location_tujuan_id AND tujuan.entitas != 'samsara_ck'
     WHERE h.status = 'diterima' AND h.tanggal BETWEEN $1 AND $2
     GROUP BY (h.tanggal - $1::date) / 7`,
    [rentangMulai, rentangSelesai],
  );

  const transferSusutTren: AnalitikTransferSusutMinggu[] = minggu.map((m, idx) => {
    const row = transferRows.find((r) => Number(r.pekan_ke) === idx);
    return { minggu: m, susutTotal: row ? Number(row.susut_total ?? 0) : 0 };
  });

  // --- cogsTren (HPP/cost of goods sold penjualan, dari snapshot 0028) ----
  const cogsParams: unknown[] = [rentangMulai, rentangSelesai];
  let cogsFilterLokasi = "";
  if (filter.lokasiId !== undefined) {
    cogsParams.push(filter.lokasiId);
    cogsFilterLokasi = ` AND h.location_id = $${cogsParams.length}`;
  }

  const { rows: cogsRows } = await client.query<{
    pekan_ke: number;
    total_cogs: string;
    jumlah_baris: string;
    jumlah_baris_estimasi: string;
  }>(
    `SELECT (h.tanggal - $1::date) / 7 AS pekan_ke,
            SUM(COALESCE(b.qty * b.hpp_saat_transaksi, 0)) AS total_cogs,
            COUNT(*) AS jumlah_baris,
            COUNT(*) FILTER (WHERE b.hpp_sumber = 'snapshot_estimasi') AS jumlah_baris_estimasi
     FROM inventory_transaksi_penjualan h
     JOIN inventory_transaksi_penjualan_baris b ON b.header_id = h.id
     WHERE h.tanggal BETWEEN $1 AND $2${cogsFilterLokasi}
     GROUP BY (h.tanggal - $1::date) / 7`,
    cogsParams,
  );

  const cogsTren: AnalitikCogsMinggu[] = minggu.map((m, idx) => {
    const row = cogsRows.find((r) => Number(r.pekan_ke) === idx);
    return {
      minggu: m,
      totalCogs: row ? Number(row.total_cogs) : 0,
      jumlahBaris: row ? Number(row.jumlah_baris) : 0,
      jumlahBarisEstimasi: row ? Number(row.jumlah_baris_estimasi) : 0,
    };
  });

  // --- transparansi data estimasi (lintas waktu penuh, bukan cuma 8 minggu
  // di atas) -- lihat doc `AnalitikOperasional.adaDataEstimasi` &
  // `tanggalMulaiDataAsli`.
  const transparansiParams: unknown[] = [];
  let transparansiFilterLokasi = "";
  if (filter.lokasiId !== undefined) {
    transparansiParams.push(filter.lokasiId);
    transparansiFilterLokasi = ` AND h.location_id = $${transparansiParams.length}`;
  }

  const { rows: transparansiRows } = await client.query<{ ada_estimasi: boolean; tanggal_mulai_asli: string | null }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM inventory_transaksi_penjualan_baris b
         JOIN inventory_transaksi_penjualan h ON h.id = b.header_id
         WHERE b.hpp_sumber = 'snapshot_estimasi'${transparansiFilterLokasi}
       ) AS ada_estimasi,
       (
         SELECT to_char(MIN(h.tanggal), 'YYYY-MM-DD')
         FROM inventory_transaksi_penjualan_baris b
         JOIN inventory_transaksi_penjualan h ON h.id = b.header_id
         WHERE b.hpp_sumber = 'snapshot_asli'${transparansiFilterLokasi}
       ) AS tanggal_mulai_asli`,
    transparansiParams,
  );
  const adaDataEstimasi = transparansiRows[0]?.ada_estimasi ?? false;
  const tanggalMulaiDataAsli = transparansiRows[0]?.tanggal_mulai_asli ?? null;

  // --- insight ------------------------------------------------------------
  const rules = await readInsightRules(client);
  const insight: string[] = [];

  const ambangWaste = rules.get("waste_streak_minggu");
  if (ambangWaste !== undefined) {
    const n = Math.round(ambangWaste);
    // Lokasi yang muncul di MINGGU MANA PUN diperiksa; minggu yang lokasinya
    // tidak punya transaksi dihitung 0 (memang tidak ada waste tercatat),
    // jadi urutan nilainya tetap 8 titik yang sebanding.
    const lokasiWaste = new Map<number, string>();
    for (const w of wasteTren) for (const p of w.perLokasi) lokasiWaste.set(p.lokasiId, p.lokasiNama);

    for (const [lokasiId, lokasiNama] of [...lokasiWaste].sort((a, b) => a[1].localeCompare(b[1]))) {
      const nilai = wasteTren.map((w) => w.perLokasi.find((p) => p.lokasiId === lokasiId)?.nilai ?? 0);
      const potongan = n >= 2 && n <= nilai.length ? nilai.slice(nilai.length - n) : [];
      if (potongan.length !== n) continue; // data tren tidak cukup panjang -> lewati, jangan insight palsu
      const naikTerus = potongan.every((v, i) => i === 0 || v > potongan[i - 1]);
      const terakhir = potongan[potongan.length - 1];
      // `terakhir > 0` mencegah insight dari deret yang "naik" tapi masih nol
      // (mis. 0, 0, 0 -- tidak strictly naik, tapi juga dijaga eksplisit).
      if (naikTerus && terakhir > 0) {
        insight.push(`Nilai waste di ${lokasiNama} naik ${n} minggu berturut-turut (${formatRupiah(terakhir)}).`);
      }
    }
  }

  const ambangOpname = rules.get("opname_selisih_streak");
  if (ambangOpname !== undefined) {
    const n = Math.round(ambangOpname);
    for (const lokasi of [...opnameSelisihTren].sort((a, b) => a.lokasiNama.localeCompare(b.lokasiNama))) {
      // Siklus opname tidak punya ritme tetap (bukan per minggu), jadi yang
      // diperiksa N siklus PALING BARU -- dan kalau siklus yang tersedia
      // kurang dari N, dilewati (bukan dianggap streak dengan data sebagian).
      if (n < 1 || lokasi.siklus.length < n) continue;
      const potongan = lokasi.siklus.slice(lokasi.siklus.length - n);
      if (potongan.every((s) => s.selisihTotal < 0)) {
        insight.push(
          `Selisih opname di ${lokasi.lokasiNama} negatif ${n} siklus berturut-turut -- ` +
            `indikasi susut berulang, perlu ditelusuri.`,
        );
      }
    }
  }

  return {
    wasteTren,
    opnameSelisihTren,
    transferSusutTren,
    cogsTren,
    adaDataEstimasi,
    tanggalMulaiDataAsli,
    insight,
  };
}
