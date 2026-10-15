import type { PoolClient } from "pg";
import { writeAuditLog } from "@samsara/core";
import { csvField, parseCsv } from "./csv.js";
import { getMenuHppReport, type HppMethod } from "./hpp.js";

/**
 * Harga jual per channel penjualan (`inventory_menu_harga_channel`) dan
 * rekomendasi harga berbasis target food cost % (`inventory_channel_komisi`
 * + `inventory_settings.target_food_cost_persen`). Lihat domain/hpp.ts
 * untuk breakdown harga per channel yang ditampilkan di GET /menu/:kode/hpp
 * -- fungsi di file ini yang MENGUBAH data (upsert) dan yang MENGHITUNG
 * saran harga (read-only, tidak menyimpan apa pun).
 */

export interface UpsertHargaChannelInput {
  menuKode: string;
  channel: string;
  hargaJual: number;
  userId?: number;
}

/**
 * Upsert harga jual satu menu untuk satu channel. Channel harus aktif di
 * `inventory_sales_channel` (channel nonaktif/tidak ada ditolak, bukan
 * dibuat diam-diam). Perubahan dicatat ke `core_audit_log` kalau nilainya
 * benar-benar beda dari sebelumnya (atau belum ada baris sama sekali).
 */
export async function upsertHargaChannel(client: PoolClient, input: UpsertHargaChannelInput): Promise<void> {
  const { rows: menuRows } = await client.query<{ id: number }>(`SELECT id FROM inventory_menu WHERE kode = $1`, [
    input.menuKode,
  ]);
  const menu = menuRows[0];
  if (!menu) throw new Error(`Menu dengan kode "${input.menuKode}" tidak ditemukan`);

  const { rows: channelRows } = await client.query(
    `SELECT 1 FROM inventory_sales_channel WHERE name = $1 AND is_active = true`,
    [input.channel],
  );
  if (channelRows.length === 0) {
    throw new Error(`Channel "${input.channel}" bukan channel penjualan aktif`);
  }

  const { rows: oldRows } = await client.query<{ harga_jual: string }>(
    `SELECT harga_jual FROM inventory_menu_harga_channel WHERE kode_menu = $1 AND channel = $2`,
    [input.menuKode, input.channel],
  );
  const oldValue = oldRows[0] === undefined ? null : Number(oldRows[0].harga_jual);

  const { rows: upserted } = await client.query<{ id: number }>(
    `INSERT INTO inventory_menu_harga_channel (kode_menu, channel, harga_jual, diubah_oleh, diubah_pada)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (kode_menu, channel)
     DO UPDATE SET harga_jual = EXCLUDED.harga_jual, diubah_oleh = EXCLUDED.diubah_oleh, diubah_pada = now()
     RETURNING id`,
    [input.menuKode, input.channel, input.hargaJual, input.userId ?? null],
  );

  if (oldValue !== input.hargaJual) {
    await writeAuditLog(client, {
      userId: input.userId ?? null,
      tableName: "inventory_menu_harga_channel",
      recordId: upserted[0].id,
      fieldName: "harga_jual",
      oldValue,
      newValue: input.hargaJual,
    });
  }
}

/**
 * Simpan harga jual BANYAK pasangan menu+channel sekaligus (tombol "Simpan
 * Semua" di grid edit harga).
 *
 * ATOMIK SUNGGUHAN -- SENGAJA BEDA dari pola batch lain di repo ini
 * (`POST /jadwal/batch` di modul HR dan import CSV sales-sync, yang keduanya
 * pakai "transaksi independen per item" / SAVEPOINT per baris sehingga satu
 * baris gagal tidak membatalkan baris lain). Di sini SATU baris gagal
 * membatalkan SELURUH batch: exception dari fungsi ini memicu ROLLBACK di
 * `withTransaction` pemanggil (router), dan karena fungsi ini TIDAK memakai
 * SAVEPOINT per baris, upsert baris-baris sebelumnya ikut hilang.
 *
 * Alasannya UX, bukan teknis: kalau sebagian baris grid tersimpan dan
 * sebagian tidak, user tidak punya cara tahu bagian mana yang berhasil.
 * Diminta owner eksplisit ("simpan semua dalam satu transaksi").
 * JANGAN "diperbaiki" jadi per-baris tanpa keputusan owner.
 *
 * Validasi per baris (menu ada, channel aktif) dan audit log tetap ditangani
 * `upsertHargaChannel` -- fungsi ini cuma loop + memperjelas pesan error
 * dengan nomor baris supaya user tahu baris mana yang bikin batch gagal.
 */
export async function batchUpsertHargaChannel(
  client: PoolClient,
  baris: Array<{ kodeMenu: string; channel: string; hargaJual: number }>,
  userId?: number,
): Promise<void> {
  if (!Array.isArray(baris) || baris.length === 0) {
    throw new Error("Body 'baris' wajib berupa array dan tidak boleh kosong");
  }
  for (const [index, b] of baris.entries()) {
    try {
      await upsertHargaChannel(client, { menuKode: b.kodeMenu, channel: b.channel, hargaJual: b.hargaJual, userId });
    } catch (err) {
      const pesan = err instanceof Error ? err.message : "Gagal menyimpan";
      throw new Error(`Baris ke-${index + 1} (${b.kodeMenu} / ${b.channel}): ${pesan}`);
    }
  }
}

/**
 * Semua kombinasi menu aktif x channel penjualan aktif sebagai teks CSV
 * (header `kode_menu,channel,harga_jual`), untuk diedit massal di spreadsheet
 * lalu dikirim balik lewat POST /menu/harga-channel/import (preview) +
 * PATCH /menu/harga-channel/batch (simpan).
 *
 * CROSS JOIN, jadi kombinasi yang BELUM pernah diisi harga pun ikut keluar
 * dengan `harga_jual` kosong (string kosong, bukan 0) -- justru itu gunanya:
 * owner bisa lihat lubang harga yang belum diisi. Read-only, tidak menyimpan
 * apa pun.
 */
export async function exportHargaChannelCsv(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ kode_menu: string; channel: string; harga_jual: string | null }>(
    `SELECT m.kode AS kode_menu, c.name AS channel, h.harga_jual
     FROM inventory_menu m
     CROSS JOIN inventory_sales_channel c
     LEFT JOIN inventory_menu_harga_channel h ON h.kode_menu = m.kode AND h.channel = c.name
     WHERE m.is_active = true AND c.is_active = true
     ORDER BY m.kode, c.name`,
  );

  const baris = rows.map((row) => {
    // NUMERIC(18,2) dibaca pg sebagai string ("18000.00") -- dinormalkan lewat
    // Number() supaya CSV-nya berisi "18000", angka yang bisa langsung dipakai
    // di spreadsheet dan dibaca balik oleh previewImportHargaChannel.
    const harga = row.harga_jual === null ? "" : String(Number(row.harga_jual));
    return [csvField(row.kode_menu), csvField(row.channel), csvField(harga)].join(",");
  });

  return ["kode_menu,channel,harga_jual", ...baris].join("\n") + "\n";
}

export interface PreviewHargaChannel {
  /** Nomor baris CSV, mulai 1 untuk baris DATA pertama (header tidak dihitung). */
  baris: number;
  kodeMenu: string;
  channel: string;
  /** Harga yang tersimpan sekarang; `null` kalau kombinasi ini belum pernah diisi. */
  hargaLama: number | null;
  /** Harga dari CSV. 0 kalau barisnya `status: "error"` karena angkanya tidak bisa dibaca. */
  hargaBaru: number;
  status: "baru" | "berubah" | "sama" | "error";
  /** Terisi kalau `status: "error"` -- penjelasan kenapa baris itu tidak bisa dipakai. */
  pesan?: string;
}

/**
 * Baca CSV harga per channel dan laporkan apa yang AKAN terjadi kalau
 * disimpan -- preview, bukan eksekusi.
 *
 * PENTING: fungsi ini TIDAK MENULIS APA PUN ke database (tidak ada
 * INSERT/UPDATE/DELETE, murni SELECT + bandingkan). Endpoint yang memakainya
 * read-only meski menerima body CSV dan method POST (POST dipakai karena CSV
 * dikirim di body, bukan karena ada perubahan data). Penyimpanan sungguhan
 * adalah panggilan TERPISAH oleh frontend ke PATCH /menu/harga-channel/batch;
 * kedua fungsi ini TIDAK saling memanggil.
 *
 * SEMUA baris CSV diproses -- baris yang tidak valid ikut muncul di hasil
 * dengan `status: "error"` + `pesan`, bukan menghentikan baris lain. Tujuannya
 * supaya user lihat SELURUH masalah dalam sekali jalan sebelum memutuskan
 * (beda dari batch simpan yang justru all-or-nothing).
 */
export async function previewImportHargaChannel(client: PoolClient, csvText: string): Promise<PreviewHargaChannel[]> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error("CSV kosong (tidak ada baris sama sekali)");

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    kode: header.indexOf("kode_menu"),
    channel: header.indexOf("channel"),
    harga: header.indexOf("harga_jual"),
  };
  if (idx.kode === -1 || idx.channel === -1 || idx.harga === -1) {
    throw new Error('CSV harus punya kolom "kode_menu", "channel", dan "harga_jual" di baris header');
  }

  // Referensi dimuat sekali di depan (bukan query per baris CSV): jumlah menu
  // x channel masih ratusan baris, dan karena fungsi ini read-only hasilnya
  // identik dengan SELECT per baris -- tidak ada tulisan yang bisa mengubah
  // nilai "harga saat ini" di tengah jalan.
  const { rows: menuRows } = await client.query<{ kode: string }>(`SELECT kode FROM inventory_menu`);
  const menuKodes = new Set(menuRows.map((r) => r.kode));

  const { rows: channelRows } = await client.query<{ name: string }>(
    `SELECT name FROM inventory_sales_channel WHERE is_active = true`,
  );
  const channelAktif = new Set(channelRows.map((r) => r.name));

  const { rows: hargaRows } = await client.query<{ kode_menu: string; channel: string; harga_jual: string }>(
    `SELECT kode_menu, channel, harga_jual FROM inventory_menu_harga_channel`,
  );
  // Kunci map pakai pemisah U+0000 (bukan spasi/strip) supaya tidak pernah
  // ambigu kalau nama channel mengandung spasi (mis. "GoFood Promo").
  const hargaSekarang = new Map<string, number>(
    hargaRows.map((r) => [`${r.kode_menu}\u0000${r.channel}`, Number(r.harga_jual)]),
  );

  const hasil: PreviewHargaChannel[] = [];

  for (const [i, cols] of rows.slice(1).entries()) {
    const nomorBaris = i + 1;
    const kodeMenu = (cols[idx.kode] ?? "").trim();
    const channel = (cols[idx.channel] ?? "").trim();
    const hargaRaw = (cols[idx.harga] ?? "").trim();

    const error = (pesan: string, hargaBaru = 0): void => {
      hasil.push({ baris: nomorBaris, kodeMenu, channel, hargaLama: null, hargaBaru, status: "error", pesan });
    };

    if (!kodeMenu) {
      error("Kolom kode_menu kosong");
      continue;
    }
    if (!menuKodes.has(kodeMenu)) {
      error(`Menu dengan kode "${kodeMenu}" tidak ditemukan`);
      continue;
    }
    if (!channel) {
      error("Kolom channel kosong");
      continue;
    }
    if (!channelAktif.has(channel)) {
      error(`Channel "${channel}" bukan channel penjualan aktif`);
      continue;
    }
    if (!hargaRaw) {
      error("Kolom harga_jual kosong");
      continue;
    }

    // Parsing SENGAJA ketat (tanpa membuang karakter non-angka seperti
    // apps/api/src/import-harga-jual.ts): "18.000" ala pemisah ribuan kalau
    // dipaksa jadi angka terbaca 18 rupiah -- lebih baik ditandai error dan
    // diperbaiki user daripada diam-diam menyimpan harga yang salah.
    const hargaBaru = Number(hargaRaw);
    if (!Number.isFinite(hargaBaru) || hargaBaru <= 0) {
      // 0 juga ditolak di sini (beda dari PATCH /menu/:kode/harga-channel yang
      // mengizinkan >= 0): di CSV massal, 0 nyaris selalu kolom yang salah
      // ketik/kosong, bukan keputusan harga.
      error(`harga_jual "${hargaRaw}" bukan angka positif yang valid`);
      continue;
    }

    const hargaLama = hargaSekarang.get(`${kodeMenu}\u0000${channel}`) ?? null;
    const status = hargaLama === null ? "baru" : hargaLama === hargaBaru ? "sama" : "berubah";
    hasil.push({ baris: nomorBaris, kodeMenu, channel, hargaLama, hargaBaru, status });
  }

  return hasil;
}

/**
 * Tayang/sembunyikan satu menu di satu channel penjualan
 * (`inventory_menu_channel_visibilitas`, migrasi 0024). SENGAJA fungsi
 * TERPISAH dari `upsertHargaChannel` dan tabelnya pun terpisah: harga dan
 * visibilitas punya siklus hidup berbeda -- menu bisa disembunyikan sementara
 * di GoFood tanpa kehilangan harga yang sudah disetel, dan sebaliknya.
 * Memanggil fungsi ini TIDAK menyentuh `harga_jual` menu (baik kolom legacy
 * `inventory_menu.harga_jual` maupun `inventory_menu_harga_channel`).
 *
 * Ingat semantik tabelnya (tabel PENGECUALIAN): `aktif = true` di sini sama
 * artinya dengan tidak ada baris sama sekali. Barisnya tetap di-upsert (bukan
 * dihapus saat `aktif = true`) supaya `diubah_oleh`/`diubah_pada` tetap jadi
 * jejak siapa yang menayangkan ulang.
 */
export async function setVisibilitasChannel(
  client: PoolClient,
  kodeMenu: string,
  channel: string,
  aktif: boolean,
  userId?: number,
): Promise<void> {
  const { rows: menuRows } = await client.query<{ id: number }>(`SELECT id FROM inventory_menu WHERE kode = $1`, [
    kodeMenu,
  ]);
  if (!menuRows[0]) throw new Error(`Menu dengan kode "${kodeMenu}" tidak ditemukan`);

  const { rows: channelRows } = await client.query(
    `SELECT 1 FROM inventory_sales_channel WHERE name = $1 AND is_active = true`,
    [channel],
  );
  if (channelRows.length === 0) {
    throw new Error(`Channel "${channel}" bukan channel penjualan aktif`);
  }

  const { rows: oldRows } = await client.query<{ aktif: boolean }>(
    `SELECT aktif FROM inventory_menu_channel_visibilitas WHERE kode_menu = $1 AND channel = $2`,
    [kodeMenu, channel],
  );
  // Belum ada baris = menu TERLIHAT (default tabel pengecualian), jadi nilai
  // "lama" untuk keperluan audit adalah true, bukan null.
  const oldValue = oldRows[0] === undefined ? true : oldRows[0].aktif;

  const { rows: upserted } = await client.query<{ id: number }>(
    `INSERT INTO inventory_menu_channel_visibilitas (kode_menu, channel, aktif, diubah_oleh, diubah_pada)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (kode_menu, channel)
     DO UPDATE SET aktif = EXCLUDED.aktif, diubah_oleh = EXCLUDED.diubah_oleh, diubah_pada = now()
     RETURNING id`,
    [kodeMenu, channel, aktif, userId ?? null],
  );

  if (oldValue !== aktif) {
    await writeAuditLog(client, {
      userId: userId ?? null,
      tableName: "inventory_menu_channel_visibilitas",
      recordId: upserted[0].id,
      fieldName: "aktif",
      oldValue,
      newValue: aktif,
    });
  }
}

export interface RekomendasiHargaChannel {
  channel: string;
  hargaJual: number;
}

export interface RekomendasiHargaResult {
  kode: string;
  /** `null` kalau HPP `pending_data`. */
  hppPerPorsi: number | null;
  targetFoodCostPersen: number;
  /** `null` kalau HPP `pending_data`. */
  hargaDasar: number | null;
  /** Array kosong kalau HPP `pending_data` (bukan error). */
  rekomendasi: RekomendasiHargaChannel[];
}

/** Rupiah tidak pakai sub-unit (sen) dalam praktik -- dibulatkan ke rupiah
 * penuh, bukan 2 desimal, supaya hasil rekomendasi langsung valid dipakai
 * input harga di frontend (step=1, lihat MenuHppPage.tsx) tanpa penyesuaian
 * manual. */
function roundRupiah(value: number): number {
  return Math.round(value);
}

/**
 * Saran harga jual per channel supaya food cost % menu ini ketemu
 * `targetFoodCostPersen` (default dari `inventory_settings` kalau pemanggil
 * tidak mengirim target eksplisit -- lihat pengaturan.ts/getTargetFoodCostPersen).
 *
 * `hargaDasar = HPP / (target% / 100)`; per channel:
 * `hargaChannel = (hargaDasar + potongan_tetap) / (1 - persen_komisi/100)`
 * -- rumus yang sama dipakai untuk SEMUA channel di `inventory_channel_komisi`
 * (termasuk "Offline" yang komisi/potongannya 0, jadi hasilnya = hargaDasar
 * tanpa perlu cabang khusus).
 */
export async function getRekomendasiHarga(
  client: PoolClient,
  menuKode: string,
  targetFoodCostPersen: number,
  method: HppMethod = "harga_master",
): Promise<RekomendasiHargaResult> {
  const report = await getMenuHppReport(client, menuKode, method);

  if (report.status === "pending_data" || report.hpp_per_porsi === null) {
    return {
      kode: menuKode,
      hppPerPorsi: null,
      targetFoodCostPersen,
      hargaDasar: null,
      rekomendasi: [],
    };
  }

  const hpp = report.hpp_per_porsi;
  const hargaDasar = hpp / (targetFoodCostPersen / 100);

  const { rows } = await client.query<{ channel: string; persen_komisi: string; potongan_tetap: string }>(
    `SELECT channel, persen_komisi, potongan_tetap FROM inventory_channel_komisi ORDER BY channel`,
  );

  const rekomendasi = rows.map((row) => {
    const persenKomisi = Number(row.persen_komisi);
    const potonganTetap = Number(row.potongan_tetap);
    const hargaChannel = (hargaDasar + potonganTetap) / (1 - persenKomisi / 100);
    return { channel: row.channel, hargaJual: roundRupiah(hargaChannel) };
  });

  return {
    kode: menuKode,
    hppPerPorsi: hpp,
    targetFoodCostPersen,
    hargaDasar: roundRupiah(hargaDasar),
    rekomendasi,
  };
}
