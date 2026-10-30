import type { PoolClient } from "pg";
import { getMenuHppReport, isPaketMenu, resolveItemCost, type HppMethod } from "./hpp.js";
import { getHppDefaultMethod } from "./pengaturan.js";
import { catatHargaDariPembelian } from "./vendor.js";

/**
 * Mesin stok. Stok TIDAK PERNAH diedit langsung -- semua fungsi di sini
 * menulis ke tabel transaksi lalu memposting baris ke `inventory_stock_ledger`
 * dalam transaksi DB yang sama (dikendalikan pemanggil, lihat hpp.ts).
 */

type LedgerTransactionType =
  | "pembelian"
  | "produksi"
  | "penjualan"
  | "transfer_keluar"
  | "transfer_masuk"
  | "mutasi_lain"
  | "opname";

async function postLedger(
  client: PoolClient,
  entry: {
    itemId: number;
    locationId: number;
    transactionType: LedgerTransactionType;
    referenceTable: string;
    referenceId: number;
    qtyChange: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO inventory_stock_ledger
      (item_id, location_id, transaction_type, reference_table, reference_id, qty_change)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entry.itemId, entry.locationId, entry.transactionType, entry.referenceTable, entry.referenceId, entry.qtyChange],
  );
}

/** Stok saat ini (recipe_unit item), 0 kalau belum pernah ada pergerakan. */
export async function getCurrentStock(client: PoolClient, itemId: number, locationId: number): Promise<number> {
  const { rows } = await client.query<{ qty: string | null }>(
    `SELECT qty FROM inventory_current_stock WHERE item_id = $1 AND location_id = $2`,
    [itemId, locationId],
  );
  return rows[0]?.qty ? Number(rows[0].qty) : 0;
}

async function findItemByKode(client: PoolClient, kode: string): Promise<{ id: number } > {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM inventory_items WHERE kode = $1`, [kode]);
  if (!rows[0]) throw new Error(`Item dengan kode "${kode}" tidak ditemukan`);
  return rows[0];
}

async function getItemKode(client: PoolClient, itemId: number): Promise<string | null> {
  const { rows } = await client.query<{ kode: string | null }>(`SELECT kode FROM inventory_items WHERE id = $1`, [itemId]);
  return rows[0]?.kode ?? null;
}

// ---------------------------------------------------------------------------
// Pembelian
// ---------------------------------------------------------------------------

export interface PembelianBarisInput {
  itemKode: string;
  qtyBeli: number;
  satuanBeli: string;
  hargaSatuan: number;
}

export interface PembelianInput {
  locationId: number;
  /** WAJIB sejak perbaikan vendor-pembelian (sebelumnya opsional di Tahap 3) --
   * lihat validasi di awal createPembelian. Kalau pembelian dadakan tanpa vendor
   * terstruktur (mis. beli di warung), pakai vendor seed "Pembelian Umum
   * (pasar/warung)" dari migrasi 0031, BUKAN dikosongkan. */
  vendorId: number;
  noReferensi?: string;
  tanggal: string;
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  createdByUserId?: number;
  baris: PembelianBarisInput[];
}

export interface PeringatanKenaikanHarga {
  itemKode: string;
  hargaLama: number;
  hargaBaru: number;
  persenKenaikan: number;
}

export interface PembelianResult {
  headerId: number;
  baris: Array<{ itemKode: string; qtyRecipeUnit: number }>;
  /** Terisi kalau ADA baris yang harganya naik melewati ambang `kenaikan_harga_vendor_persen` (inventory_insight_rules) dibanding harga terakhir di katalog vendor itu. Informasional -- TIDAK pernah menggagalkan pembelian. */
  peringatanHarga: PeringatanKenaikanHarga[];
}

/** Pembelian: qty diinput dalam satuan beli, dikonversi otomatis ke satuan resep. */
export async function createPembelian(client: PoolClient, input: PembelianInput): Promise<PembelianResult> {
  if (input.baris.length === 0) throw new Error("Pembelian harus punya minimal 1 baris");
  if (!input.vendorId) {
    throw new Error(
      "Vendor wajib dipilih untuk pembelian. Kalau pembelian dadakan tanpa vendor terstruktur (mis. di warung/pasar), pilih vendor \"Pembelian Umum (pasar/warung)\".",
    );
  }

  // `supplier` SENGAJA selalu NULL untuk baris baru -- kolom itu deprecated
  // sejak vendor_id diwajibkan (lihat COMMENT ON COLUMN di migrasi 0031).
  // Baris LAMA yang masih punya teks supplier dibiarkan apa adanya, dibaca
  // sebagai "Supplier (lama)" di Laporan Harian (domain/laporan.ts).
  const { rows: headerRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_transaksi_pembelian (location_id, supplier, vendor_id, no_referensi, tanggal, dibuat_oleh)
     VALUES ($1, NULL, $2, $3, $4, $5) RETURNING id`,
    [input.locationId, input.vendorId, input.noReferensi ?? null, input.tanggal, input.createdByUserId ?? null],
  );
  const headerId = headerRows[0].id;

  const resultBaris: PembelianResult["baris"] = [];
  const peringatanHarga: PeringatanKenaikanHarga[] = [];

  for (const baris of input.baris) {
    const { rows: itemRows } = await client.query<{ id: number; purchase_to_recipe_factor: string | null }>(
      `SELECT id, purchase_to_recipe_factor FROM inventory_items WHERE kode = $1`,
      [baris.itemKode],
    );
    const item = itemRows[0];
    if (!item) throw new Error(`Item dengan kode "${baris.itemKode}" tidak ditemukan`);
    if (item.purchase_to_recipe_factor === null) {
      throw new Error(
        `Item "${baris.itemKode}" belum punya konversi satuan beli (purchase_to_recipe_factor) -- lengkapi datanya dulu sebelum bisa diproses pembelian.`,
      );
    }

    const factor = Number(item.purchase_to_recipe_factor);
    const qtyRecipeUnit = baris.qtyBeli * factor;

    const { rows: barisRows } = await client.query<{ id: number }>(
      `INSERT INTO inventory_transaksi_pembelian_baris
        (header_id, item_id, qty_beli, satuan_beli, harga_satuan, qty_recipe_unit)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [headerId, item.id, baris.qtyBeli, baris.satuanBeli, baris.hargaSatuan, qtyRecipeUnit],
    );

    await postLedger(client, {
      itemId: item.id,
      locationId: input.locationId,
      transactionType: "pembelian",
      referenceTable: "inventory_transaksi_pembelian_baris",
      referenceId: barisRows[0].id,
      qtyChange: qtyRecipeUnit,
    });

    const hasil = await catatHargaDariPembelian(client, {
      vendorId: input.vendorId,
      itemId: item.id,
      hargaBaru: baris.hargaSatuan,
      pembelianHeaderId: headerId,
    });
    if (hasil.peringatanKenaikan) {
      peringatanHarga.push({ itemKode: baris.itemKode, ...hasil.peringatanKenaikan });
    }

    resultBaris.push({ itemKode: baris.itemKode, qtyRecipeUnit });
  }

  return { headerId, baris: resultBaris, peringatanHarga };
}

// ---------------------------------------------------------------------------
// Produksi
// ---------------------------------------------------------------------------

export interface ProduksiInput {
  resepKode: string;
  locationId: number;
  qtyBatch: number;
  tanggal: string;
  /** Qty hasil produksi yang benar-benar diukur -- ini yang masuk stok, bukan yield teoretis. */
  hasilAktual: number;
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  createdByUserId?: number;
}

export interface ProduksiResult {
  headerId: number;
  outputItemKode: string | null;
  yieldTeoretis: number | null;
  selisihYield: number | null;
  bahanTerpakai: Array<{ itemKode: string | null; qty: number }>;
}

/** Produksi: bahan terpakai dari resep x qty_batch (teoretis), hasil yang masuk stok = hasil_aktual. */
export async function createProduksi(client: PoolClient, input: ProduksiInput): Promise<ProduksiResult> {
  const { rows: recipeRows } = await client.query<{ id: number; output_item_id: number; yield_qty: string | null }>(
    `SELECT id, output_item_id, yield_qty FROM inventory_resep_produksi WHERE kode = $1`,
    [input.resepKode],
  );
  const recipe = recipeRows[0];
  if (!recipe) throw new Error(`Resep produksi dengan kode "${input.resepKode}" tidak ditemukan`);

  const { rows: headerRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_transaksi_produksi (resep_id, location_id, qty_batch, tanggal, hasil_aktual, dibuat_oleh)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [recipe.id, input.locationId, input.qtyBatch, input.tanggal, input.hasilAktual, input.createdByUserId ?? null],
  );
  const headerId = headerRows[0].id;

  const { rows: lines } = await client.query<{ bahan_item_id: number; qty: string }>(
    `SELECT bahan_item_id, qty FROM inventory_resep_produksi_baris WHERE resep_id = $1`,
    [recipe.id],
  );

  const bahanTerpakai: ProduksiResult["bahanTerpakai"] = [];
  for (const line of lines) {
    const qtyPakai = Number(line.qty) * input.qtyBatch;
    await postLedger(client, {
      itemId: line.bahan_item_id,
      locationId: input.locationId,
      transactionType: "produksi",
      referenceTable: "inventory_transaksi_produksi",
      referenceId: headerId,
      qtyChange: -qtyPakai,
    });
    bahanTerpakai.push({ itemKode: await getItemKode(client, line.bahan_item_id), qty: qtyPakai });
  }

  await postLedger(client, {
    itemId: recipe.output_item_id,
    locationId: input.locationId,
    transactionType: "produksi",
    referenceTable: "inventory_transaksi_produksi",
    referenceId: headerId,
    qtyChange: input.hasilAktual,
  });

  const yieldTeoretis = recipe.yield_qty === null ? null : Number(recipe.yield_qty) * input.qtyBatch;
  const selisihYield = yieldTeoretis === null ? null : input.hasilAktual - yieldTeoretis;

  return {
    headerId,
    outputItemKode: await getItemKode(client, recipe.output_item_id),
    yieldTeoretis,
    selisihYield,
    bahanTerpakai,
  };
}

// ---------------------------------------------------------------------------
// Penjualan
// ---------------------------------------------------------------------------

export interface PenjualanBarisInput {
  menuKode: string;
  qty: number;
}

export interface PenjualanInput {
  locationId: number;
  sumber: string;
  noReferensi?: string;
  tanggal: string;
  /**
   * Jam transaksi "HH:MM" atau "HH:MM:SS" (kolom `jam`, tipe TIME -- migrasi
   * 0026), OPSIONAL: data lama selalu NULL dan input manual boleh tidak
   * mengisinya. Diteruskan apa adanya ke Postgres tanpa validasi format di
   * sini -- tipe TIME sudah menolak nilai yang benar-benar rusak.
   */
  jam?: string;
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  createdByUserId?: number;
  baris: PenjualanBarisInput[];
}

export interface PenjualanResult {
  headerId: number;
  pemakaianBahan: Array<{ itemKode: string | null; qty: number }>;
}

async function getMenuResepLines(client: PoolClient, menuId: number): Promise<Array<{ itemId: number; qty: number }>> {
  const { rows } = await client.query<{ item_id: number; qty: string }>(
    `SELECT item_id, qty FROM inventory_menu_resep_baris WHERE menu_id = $1`,
    [menuId],
  );
  return rows.map((r) => ({ itemId: r.item_id, qty: Number(r.qty) }));
}

/**
 * Penjualan: bahan dikurangi sesuai resep menu x qty. Kalau menu-nya paket,
 * dipecah ke komponen (resep tiap komponen x qty komponen x qty paket)
 * DITAMBAH baris resep milik paket itu sendiri (mis. kemasan luar paket) --
 * lihat docs/architecture-decisions.md untuk catatan simplifikasi soal ini.
 *
 * Setiap baris JUGA menyimpan snapshot HPP (`hpp_saat_transaksi`,
 * `hpp_sumber`, migrasi 0028) -- dihitung OTOMATIS di sini lewat
 * `getMenuHppReport` (metode HPP GLOBAL yang aktif saat ini, dibaca sekali
 * per transaksi lewat `getHppDefaultMethod`, BUKAN override per-user: fungsi
 * ini dipanggil baik dari form manual maupun proses background sales-sync
 * yang tidak punya konteks role). `hpp_sumber` SELALU 'snapshot_asli' di
 * jalur ini (bukan 'snapshot_estimasi', yang cuma dipakai backfill data
 * lama) -- termasuk saat `hpp_saat_transaksi` hasilnya NULL karena menu itu
 * bergantung ke item `pending_data`: NULL di sini genuinely berarti "dihitung
 * PERSIS saat itu, hasilnya tidak diketahui", beda makna dari backfill yang
 * memakai harga SEKARANG sebagai tebakan. Dihitung per MENU per baris (bukan
 * diasumsikan sama untuk satu transaksi) karena satu transaksi bisa berisi
 * menu-menu yang berbeda. Field ini murni computed, TIDAK diterima dari
 * `PenjualanInput`/caller -- mencegah data dipalsukan lewat API langsung.
 */
export async function createPenjualan(client: PoolClient, input: PenjualanInput): Promise<PenjualanResult> {
  if (input.baris.length === 0) throw new Error("Penjualan harus punya minimal 1 baris");

  const { rows: headerRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_transaksi_penjualan (location_id, sumber, no_referensi, tanggal, jam, dibuat_oleh)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.locationId,
      input.sumber,
      input.noReferensi ?? null,
      input.tanggal,
      input.jam ?? null,
      input.createdByUserId ?? null,
    ],
  );
  const headerId = headerRows[0].id;

  const hppMethod: HppMethod = await getHppDefaultMethod(client);

  // Akumulasi per item supaya satu item yang muncul di beberapa baris/komponen
  // paket cuma diposting sekali ke ledger.
  const pemakaian = new Map<number, number>();
  const addPemakaian = (itemId: number, qty: number) => pemakaian.set(itemId, (pemakaian.get(itemId) ?? 0) + qty);

  for (const baris of input.baris) {
    const { rows: menuRows } = await client.query<{ id: number }>(`SELECT id FROM inventory_menu WHERE kode = $1`, [
      baris.menuKode,
    ]);
    const menu = menuRows[0];
    if (!menu) throw new Error(`Menu dengan kode "${baris.menuKode}" tidak ditemukan`);

    const hppReport = await getMenuHppReport(client, baris.menuKode, hppMethod);
    const hppSaatTransaksi = hppReport.status === "ok" ? hppReport.hpp_per_porsi : null;

    await client.query(
      `INSERT INTO inventory_transaksi_penjualan_baris (header_id, menu_id, qty, hpp_saat_transaksi, hpp_sumber)
       VALUES ($1, $2, $3, $4, 'snapshot_asli')`,
      [headerId, menu.id, baris.qty, hppSaatTransaksi],
    );

    if (await isPaketMenu(client, menu.id)) {
      for (const line of await getMenuResepLines(client, menu.id)) {
        addPemakaian(line.itemId, line.qty * baris.qty);
      }

      const { rows: komponen } = await client.query<{ item_menu_id: number; qty: string }>(
        `SELECT item_menu_id, qty FROM inventory_paket_menu_baris WHERE paket_menu_id = $1`,
        [menu.id],
      );
      for (const k of komponen) {
        const qtyKomponen = Number(k.qty) * baris.qty;
        for (const line of await getMenuResepLines(client, k.item_menu_id)) {
          addPemakaian(line.itemId, line.qty * qtyKomponen);
        }
      }
    } else {
      for (const line of await getMenuResepLines(client, menu.id)) {
        addPemakaian(line.itemId, line.qty * baris.qty);
      }
    }
  }

  const pemakaianBahan: PenjualanResult["pemakaianBahan"] = [];
  for (const [itemId, qty] of pemakaian) {
    await postLedger(client, {
      itemId,
      locationId: input.locationId,
      transactionType: "penjualan",
      referenceTable: "inventory_transaksi_penjualan",
      referenceId: headerId,
      qtyChange: -qty,
    });
    pemakaianBahan.push({ itemKode: await getItemKode(client, itemId), qty });
  }

  return { headerId, pemakaianBahan };
}

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

export interface TransferKirimBarisInput {
  itemKode: string;
  qtyKirim: number;
  unit: string;
  /** Override manual. Kalau tidak diisi & transfer antar entitas, dihitung otomatis (Skema A). */
  hargaTransferPerSatuan?: number;
}

export interface TransferKirimInput {
  locationAsalId: number;
  locationTujuanId: number;
  tanggal: string;
  /** Metode HPP untuk menghitung default harga transfer (Skema A). Default 'harga_master'. */
  method?: HppMethod;
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  createdByUserId?: number;
  /**
   * Opsional: link ke `inventory_permintaan_transfer` yang dipenuhi transfer
   * kirim ini (lihat domain/permintaan-transfer.ts). Kalau diisi, status
   * permintaan terkait diubah jadi 'dipenuhi' dalam transaksi yang sama --
   * ditolak kalau permintaan tidak ketemu atau statusnya sudah bukan
   * 'diminta' (sudah dibatalkan/dipenuhi transfer lain).
   */
  permintaanId?: number;
  baris: TransferKirimBarisInput[];
}

export interface TransferKirimResult {
  headerId: number;
  antarEntitas: boolean;
  baris: Array<{ itemKode: string; qtyKirim: number; hargaTransferPerSatuan: number | null }>;
}

/**
 * Tahap 1 (kirim): stok lokasi ASAL langsung berkurang sejumlah qty_kirim.
 * qty_terima belum diisi (NULL) -- barang "dalam perjalanan"
 * (`inventory_transfer_dalam_perjalanan`), TIDAK masuk stok lokasi manapun
 * sampai tahap terima. antar_entitas dideteksi otomatis oleh trigger DB.
 * harga_transfer_per_satuan dihitung SEKARANG (saat kirim, bukan saat
 * terima) -- "Skema A": HPP item di lokasi asal, kalau antar entitas & tidak
 * diisi manual.
 */
export async function createTransferKirim(client: PoolClient, input: TransferKirimInput): Promise<TransferKirimResult> {
  if (input.baris.length === 0) throw new Error("Transfer harus punya minimal 1 baris");

  const { rows: headerRows } = await client.query<{ id: number; antar_entitas: boolean }>(
    `INSERT INTO inventory_transaksi_transfer
      (location_asal_id, location_tujuan_id, tanggal, dibuat_oleh, status, permintaan_id)
     VALUES ($1, $2, $3, $4, 'dikirim', $5) RETURNING id, antar_entitas`,
    [input.locationAsalId, input.locationTujuanId, input.tanggal, input.createdByUserId ?? null, input.permintaanId ?? null],
  );
  const header = headerRows[0];
  const method: HppMethod = input.method ?? "harga_master";

  if (input.permintaanId !== undefined) {
    const { rowCount } = await client.query(
      `UPDATE inventory_permintaan_transfer SET status = 'dipenuhi' WHERE id = $1 AND status = 'diminta'`,
      [input.permintaanId],
    );
    if (rowCount === 0) {
      throw new Error(
        `Permintaan transfer id ${input.permintaanId} tidak ditemukan atau statusnya sudah bukan 'diminta' (mungkin sudah dibatalkan/dipenuhi transfer lain) -- tidak bisa dipakai untuk transfer kirim ini`,
      );
    }
  }

  const resultBaris: TransferKirimResult["baris"] = [];

  for (const baris of input.baris) {
    const item = await findItemByKode(client, baris.itemKode);

    let hargaTransfer = baris.hargaTransferPerSatuan ?? null;
    if (hargaTransfer === null && header.antar_entitas) {
      const cost = await resolveItemCost(client, item.id, method);
      hargaTransfer = cost.pending ? null : cost.cost;
    }

    const { rows: barisRows } = await client.query<{ id: number }>(
      `INSERT INTO inventory_transaksi_transfer_baris
        (header_id, item_id, qty_kirim, qty_terima, unit, harga_transfer_per_satuan)
       VALUES ($1, $2, $3, NULL, $4, $5) RETURNING id`,
      [header.id, item.id, baris.qtyKirim, baris.unit, hargaTransfer],
    );
    const barisId = barisRows[0].id;

    await postLedger(client, {
      itemId: item.id,
      locationId: input.locationAsalId,
      transactionType: "transfer_keluar",
      referenceTable: "inventory_transaksi_transfer_baris",
      referenceId: barisId,
      qtyChange: -baris.qtyKirim,
    });

    resultBaris.push({ itemKode: baris.itemKode, qtyKirim: baris.qtyKirim, hargaTransferPerSatuan: hargaTransfer });
  }

  return { headerId: header.id, antarEntitas: header.antar_entitas, baris: resultBaris };
}

export interface TransferTerimaBarisInput {
  itemKode: string;
  qtyTerima: number;
}

export interface TransferTerimaInput {
  transferId: number;
  baris: TransferTerimaBarisInput[];
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  receivedByUserId?: number;
}

export interface TransferTerimaResult {
  headerId: number;
  baris: Array<{ itemKode: string; qtyKirim: number; qtyTerima: number; susut: number }>;
}

/**
 * Tahap 2 (terima): isi qty_terima, tambah stok lokasi TUJUAN sejumlah
 * qty_terima (BUKAN qty_kirim -- susut = qty_kirim - qty_terima baru final
 * di sini). Header pindah status ke 'diterima', dicatat siapa & kapan.
 * Transfer yang sudah 'diterima' tidak bisa diterima ulang (dan tidak ada
 * endpoint hapus transfer sama sekali -- pembatalan lewat mutasi_lain,
 * lihat docs/architecture-decisions.md).
 */
export async function createTransferTerima(client: PoolClient, input: TransferTerimaInput): Promise<TransferTerimaResult> {
  if (input.baris.length === 0) throw new Error("Penerimaan transfer harus punya minimal 1 baris");

  const { rows: headerRows } = await client.query<{
    id: number;
    location_tujuan_id: number;
    status: "dikirim" | "diterima";
  }>(`SELECT id, location_tujuan_id, status FROM inventory_transaksi_transfer WHERE id = $1`, [input.transferId]);
  const header = headerRows[0];
  if (!header) throw new Error(`Transfer id ${input.transferId} tidak ditemukan`);
  if (header.status === "diterima") {
    throw new Error(`Transfer id ${input.transferId} sudah diterima sebelumnya, tidak bisa diterima ulang`);
  }

  const resultBaris: TransferTerimaResult["baris"] = [];

  for (const baris of input.baris) {
    const item = await findItemByKode(client, baris.itemKode);

    const { rows: barisRows } = await client.query<{ id: number; qty_kirim: string }>(
      `SELECT id, qty_kirim FROM inventory_transaksi_transfer_baris WHERE header_id = $1 AND item_id = $2`,
      [header.id, item.id],
    );
    const barisRow = barisRows[0];
    if (!barisRow) {
      throw new Error(`Item "${baris.itemKode}" tidak ada di baris transfer id ${input.transferId}`);
    }

    await client.query(`UPDATE inventory_transaksi_transfer_baris SET qty_terima = $1 WHERE id = $2`, [
      baris.qtyTerima,
      barisRow.id,
    ]);

    await postLedger(client, {
      itemId: item.id,
      locationId: header.location_tujuan_id,
      transactionType: "transfer_masuk",
      referenceTable: "inventory_transaksi_transfer_baris",
      referenceId: barisRow.id,
      qtyChange: baris.qtyTerima,
    });

    const qtyKirim = Number(barisRow.qty_kirim);
    resultBaris.push({
      itemKode: baris.itemKode,
      qtyKirim,
      qtyTerima: baris.qtyTerima,
      susut: qtyKirim - baris.qtyTerima,
    });
  }

  await client.query(
    `UPDATE inventory_transaksi_transfer SET status = 'diterima', diterima_oleh = $1, diterima_at = now() WHERE id = $2`,
    [input.receivedByUserId ?? null, header.id],
  );

  return { headerId: header.id, baris: resultBaris };
}

export interface DalamPerjalananRow {
  transferId: number;
  locationAsalId: number;
  locationTujuanId: number;
  itemKode: string | null;
  qtyKirim: number;
  unit: string;
  hargaTransferPerSatuan: number | null;
  nilai: number | null;
}

/** Barang yang sudah dikirim tapi belum diterima -- tidak ada di stok lokasi manapun. */
export async function getDalamPerjalanan(
  client: PoolClient,
  filter: { locationAsalId?: number; locationTujuanId?: number } = {},
): Promise<DalamPerjalananRow[]> {
  const conditions: string[] = [];
  const params: number[] = [];
  if (filter.locationAsalId !== undefined) {
    params.push(filter.locationAsalId);
    conditions.push(`v.location_asal_id = $${params.length}`);
  }
  if (filter.locationTujuanId !== undefined) {
    params.push(filter.locationTujuanId);
    conditions.push(`v.location_tujuan_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await client.query<{
    transfer_id: number;
    location_asal_id: number;
    location_tujuan_id: number;
    kode: string | null;
    qty_kirim: string;
    unit: string;
    harga_transfer_per_satuan: string | null;
    nilai: string | null;
  }>(
    `SELECT v.transfer_id, v.location_asal_id, v.location_tujuan_id, i.kode, v.qty_kirim, v.unit,
            v.harga_transfer_per_satuan, v.nilai
     FROM inventory_transfer_dalam_perjalanan v
     JOIN inventory_items i ON i.id = v.item_id
     ${where}
     ORDER BY v.transfer_id`,
    params,
  );

  return rows.map((r) => ({
    transferId: r.transfer_id,
    locationAsalId: r.location_asal_id,
    locationTujuanId: r.location_tujuan_id,
    itemKode: r.kode,
    qtyKirim: Number(r.qty_kirim),
    unit: r.unit,
    hargaTransferPerSatuan: r.harga_transfer_per_satuan === null ? null : Number(r.harga_transfer_per_satuan),
    nilai: r.nilai === null ? null : Number(r.nilai),
  }));
}

// ---------------------------------------------------------------------------
// Mutasi lain
// ---------------------------------------------------------------------------

export interface MutasiLainBarisInput {
  itemKode: string;
  /** Boleh +/- , langsung dipakai sebagai qty_change (arah sudah termasuk). */
  qtyChange: number;
}

/**
 * Kategori terstruktur mutasi non-standar (kolom `jenis`, migrasi 0026;
 * `koreksi_tambah` ditambahkan migrasi 0027). Dua nilai pertama = waste
 * sungguhan (dihitung di insight waste `GET /analitik/operasional`);
 * `staff_meal`/`sampel`/`retur_supplier` adalah pemakaian/pengembalian yang
 * BUKAN waste tapi tetap mengurangi stok; `koreksi_tambah` satu-satunya yang
 * MENAMBAH stok (stok awal saat mulai pakai sistem, atau temuan fisik lebih
 * banyak dari catatan sistem di luar jalur Opname resmi). Kolom `alasan`
 * TETAP hidup berdampingan sebagai catatan bebas, bukan digantikan oleh
 * `jenis`.
 */
export const JENIS_MUTASI_LAIN_VALID = [
  "waste_rusak",
  "hilang_tidak_diketahui",
  "staff_meal",
  "sampel",
  "retur_supplier",
  "koreksi_tambah",
] as const;

export type JenisMutasiLain = (typeof JENIS_MUTASI_LAIN_VALID)[number];

/**
 * Subset `JENIS_MUTASI_LAIN_VALID` yang artinya stok BERKURANG -- dipakai
 * untuk menegakkan konsistensi arah qty di `createMutasiLain`. Semua nilai
 * valid selain ini (saat ini cuma `koreksi_tambah`) artinya stok BERTAMBAH.
 */
const JENIS_MUTASI_LAIN_PENGURANGAN: readonly JenisMutasiLain[] = [
  "waste_rusak",
  "hilang_tidak_diketahui",
  "staff_meal",
  "sampel",
  "retur_supplier",
];

/**
 * Subset `JENIS_MUTASI_LAIN_VALID` yang boleh dipakai role `staf`
 * (2026-10-30) -- empat jenis pengurangan "sehari-hari" yang staf lapangan
 * wajar temui sendiri. `retur_supplier` (butuh koordinasi ke supplier) dan
 * `koreksi_tambah` (penambahan stok di luar jalur Pembelian/Produksi/Transfer,
 * berisiko disalahgunakan untuk menutupi kehilangan) SENGAJA dinaikkan ke
 * supervisor ke atas -- dicek di router (`POST /transaksi/mutasi-lain`),
 * bukan di sini, supaya konsisten dengan pola `locationScope` yang juga
 * dicek di router untuk endpoint lain.
 */
export const JENIS_MUTASI_LAIN_IZIN_STAF: readonly JenisMutasiLain[] = [
  "waste_rusak",
  "hilang_tidak_diketahui",
  "staff_meal",
  "sampel",
];

export interface MutasiLainInput {
  locationId: number;
  /** WAJIB. Kategori terstruktur, lihat `JENIS_MUTASI_LAIN_VALID`. */
  jenis: JenisMutasiLain;
  /** WAJIB. Catatan bebas -- tetap ada berdampingan dengan `jenis`. */
  alasan: string;
  tanggal: string;
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  createdByUserId?: number;
  baris: MutasiLainBarisInput[];
}

export interface MutasiLainResult {
  headerId: number;
}

export async function createMutasiLain(client: PoolClient, input: MutasiLainInput): Promise<MutasiLainResult> {
  if (input.baris.length === 0) throw new Error("Mutasi lain harus punya minimal 1 baris");

  // Wajib diisi ditegakkan di sini (bukan NOT NULL di skema) supaya pesannya
  // Bahasa Indonesia yang jelas -- lihat catatan di migrasi 0026. Dicek
  // runtime karena input bisa datang dari req.body yang tidak bertipe.
  if (!input.jenis || !JENIS_MUTASI_LAIN_VALID.includes(input.jenis)) {
    throw new Error(
      `Jenis mutasi wajib dipilih dan harus salah satu dari: ${JENIS_MUTASI_LAIN_VALID.join(", ")}` +
        `${input.jenis ? ` (dapat: "${input.jenis}")` : ""}`,
    );
  }

  // Arah qty harus konsisten dengan `jenis` (migrasi 0027: `koreksi_tambah`
  // adalah satu-satunya jenis yang MENAMBAH stok). Ditegakkan di sini, bukan
  // cuma di form frontend -- endpoint ini bisa dipanggil langsung, jadi
  // pengaman integritas data harus ada di level domain/API.
  //
  // Dua pengecekan di bawah SEKALIGUS menolak baris bertanda CAMPURAN
  // (sebagian +, sebagian -) dalam satu panggilan, jadi TIDAK perlu
  // pengecekan "mixed sign" terpisah: `jenis` cuma satu nilai per header,
  // jadi kalau jenis-nya pengurangan maka baris positifnya melanggar
  // `semuaQtyNegatif`, dan kalau jenis-nya `koreksi_tambah` maka baris
  // negatifnya melanggar `semuaQtyPositif`. Qty 0 juga ikut tertolak (bukan
  // negatif dan bukan positif) -- memang tidak ada gunanya mencatat mutasi 0.
  const semuaQtyNegatif = input.baris.every((b) => b.qtyChange < 0);
  const semuaQtyPositif = input.baris.every((b) => b.qtyChange > 0);

  if (JENIS_MUTASI_LAIN_PENGURANGAN.includes(input.jenis) && !semuaQtyNegatif) {
    throw new Error(
      `Jenis "${input.jenis}" untuk pengurangan stok -- semua baris qty harus negatif. ` +
        `Pakai jenis "koreksi_tambah" kalau mau menambah stok.`,
    );
  }
  if (input.jenis === "koreksi_tambah" && !semuaQtyPositif) {
    throw new Error(`Jenis "koreksi_tambah" untuk penambahan stok -- semua baris qty harus positif.`);
  }

  const { rows: headerRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_transaksi_mutasi_lain (location_id, jenis, alasan, tanggal, dibuat_oleh) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.locationId, input.jenis, input.alasan, input.tanggal, input.createdByUserId ?? null],
  );
  const headerId = headerRows[0].id;

  for (const baris of input.baris) {
    const item = await findItemByKode(client, baris.itemKode);
    const { rows: barisRows } = await client.query<{ id: number }>(
      `INSERT INTO inventory_transaksi_mutasi_lain_baris (header_id, item_id, qty_change) VALUES ($1, $2, $3) RETURNING id`,
      [headerId, item.id, baris.qtyChange],
    );
    await postLedger(client, {
      itemId: item.id,
      locationId: input.locationId,
      transactionType: "mutasi_lain",
      referenceTable: "inventory_transaksi_mutasi_lain_baris",
      referenceId: barisRows[0].id,
      qtyChange: baris.qtyChange,
    });
  }

  return { headerId };
}

// ---------------------------------------------------------------------------
// Opname
// ---------------------------------------------------------------------------

export interface OpnameBarisInput {
  itemKode: string;
  qtyFisik: number;
}

export interface OpnameInput {
  locationId: number;
  tanggal: string;
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  createdByUserId?: number;
  baris: OpnameBarisInput[];
}

export interface OpnameResult {
  headerId: number;
  status: "draft";
  baris: Array<{ itemKode: string; qtySistem: number; qtyFisik: number; selisih: number }>;
}

/**
 * Tahap 1 (input hitungan): qty_sistem = snapshot stok saat opname dibuat,
 * disimpan sebagai "draft" -- BELUM memposting apa pun ke ledger. Semua
 * role boleh memanggil ini (lihat permission `opname.input`). Selisih baru
 * benar-benar mengubah stok setelah `decideOpname` menyetujuinya.
 */
export async function createOpname(client: PoolClient, input: OpnameInput): Promise<OpnameResult> {
  if (input.baris.length === 0) throw new Error("Opname harus punya minimal 1 baris");

  const { rows: headerRows } = await client.query<{ id: number }>(
    `INSERT INTO inventory_transaksi_opname (location_id, tanggal, dibuat_oleh, status)
     VALUES ($1, $2, $3, 'draft') RETURNING id`,
    [input.locationId, input.tanggal, input.createdByUserId ?? null],
  );
  const headerId = headerRows[0].id;

  const resultBaris: OpnameResult["baris"] = [];

  for (const baris of input.baris) {
    const item = await findItemByKode(client, baris.itemKode);
    const qtySistem = await getCurrentStock(client, item.id, input.locationId);
    const selisih = baris.qtyFisik - qtySistem;

    await client.query(
      `INSERT INTO inventory_transaksi_opname_baris (header_id, item_id, qty_sistem, qty_fisik) VALUES ($1, $2, $3, $4)`,
      [headerId, item.id, qtySistem, baris.qtyFisik],
    );

    resultBaris.push({ itemKode: baris.itemKode, qtySistem, qtyFisik: baris.qtyFisik, selisih });
  }

  return { headerId, status: "draft", baris: resultBaris };
}

export type OpnameDecision = "setuju" | "tolak";

export interface DecideOpnameInput {
  opnameId: number;
  decision: OpnameDecision;
  /** Diisi otomatis dari user yang login (lihat api/router.ts), bukan input client. */
  decidedByUserId?: number;
}

export interface DecideOpnameResult {
  headerId: number;
  status: "disetujui" | "ditolak";
  /** Kosong kalau ditolak (tidak ada yang diposting). */
  baris: Array<{ itemKode: string | null; selisih: number; diposting: boolean }>;
}

/**
 * Tahap 2 (keputusan): owner/manajer_ops saja (permission `opname.approve`).
 * Kalau "setuju": selisih (qty_fisik - qty_sistem) tiap baris diposting ke
 * ledger (cuma yang selisihnya != 0). Kalau "tolak": tidak ada perubahan
 * stok sama sekali. Draft yang sudah diputuskan tidak bisa diputuskan ulang.
 */
export async function decideOpname(client: PoolClient, input: DecideOpnameInput): Promise<DecideOpnameResult> {
  const { rows: headerRows } = await client.query<{ id: number; location_id: number; status: string }>(
    `SELECT id, location_id, status FROM inventory_transaksi_opname WHERE id = $1`,
    [input.opnameId],
  );
  const header = headerRows[0];
  if (!header) throw new Error(`Opname id ${input.opnameId} tidak ditemukan`);
  if (header.status !== "draft") {
    throw new Error(`Opname id ${input.opnameId} sudah diputuskan sebelumnya (status: ${header.status})`);
  }

  const { rows: barisRows } = await client.query<{ id: number; item_id: number; qty_sistem: string; qty_fisik: string }>(
    `SELECT id, item_id, qty_sistem, qty_fisik FROM inventory_transaksi_opname_baris WHERE header_id = $1`,
    [header.id],
  );

  const resultBaris: DecideOpnameResult["baris"] = [];
  const newStatus: "disetujui" | "ditolak" = input.decision === "setuju" ? "disetujui" : "ditolak";

  for (const baris of barisRows) {
    const selisih = Number(baris.qty_fisik) - Number(baris.qty_sistem);
    let diposting = false;
    if (input.decision === "setuju" && selisih !== 0) {
      await postLedger(client, {
        itemId: baris.item_id,
        locationId: header.location_id,
        transactionType: "opname",
        referenceTable: "inventory_transaksi_opname_baris",
        referenceId: baris.id,
        qtyChange: selisih,
      });
      diposting = true;
    }
    resultBaris.push({ itemKode: await getItemKode(client, baris.item_id), selisih, diposting });
  }

  await client.query(
    `UPDATE inventory_transaksi_opname SET status = $1, diputuskan_oleh = $2, diputuskan_at = now() WHERE id = $3`,
    [newStatus, input.decidedByUserId ?? null, header.id],
  );

  return { headerId: header.id, status: newStatus, baris: resultBaris };
}

export type OpnameStatus = "draft" | "disetujui" | "ditolak";

export interface OpnameListItem {
  headerId: number;
  locationId: number;
  tanggal: string;
  status: OpnameStatus;
  dibuatOleh: number | null;
  diputuskanOleh: number | null;
  createdAt: string;
  baris: Array<{ itemKode: string | null; itemName: string | null; qtySistem: number; qtyFisik: number; selisih: number }>;
}

/**
 * Daftar opname, difilter status (default: semua) dan/atau lokasi. Dipakai
 * untuk tab Persetujuan (status=draft) maupun riwayat (status lain/kosong).
 * Satu query gabungan header+baris+item supaya tidak N+1.
 */
export async function listOpname(
  client: PoolClient,
  filter: { status?: OpnameStatus; locationId?: number } = {},
): Promise<OpnameListItem[]> {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (filter.status !== undefined) {
    params.push(filter.status);
    conditions.push(`h.status = $${params.length}`);
  }
  if (filter.locationId !== undefined) {
    params.push(filter.locationId);
    conditions.push(`h.location_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows: headers } = await client.query<{
    id: number;
    location_id: number;
    tanggal: string;
    status: OpnameStatus;
    dibuat_oleh: number | null;
    diputuskan_oleh: number | null;
    created_at: string;
  }>(
    `SELECT id, location_id, to_char(tanggal, 'YYYY-MM-DD') AS tanggal, status, dibuat_oleh, diputuskan_oleh, created_at
     FROM inventory_transaksi_opname h
     ${where}
     ORDER BY h.created_at DESC`,
    params,
  );
  if (headers.length === 0) return [];

  const { rows: barisRows } = await client.query<{
    header_id: number;
    item_kode: string | null;
    item_name: string | null;
    qty_sistem: string;
    qty_fisik: string;
  }>(
    `SELECT b.header_id, i.kode AS item_kode, i.name AS item_name, b.qty_sistem, b.qty_fisik
     FROM inventory_transaksi_opname_baris b
     JOIN inventory_items i ON i.id = b.item_id
     WHERE b.header_id = ANY($1)`,
    [headers.map((h) => h.id)],
  );

  const barisByHeader = new Map<number, OpnameListItem["baris"]>();
  for (const b of barisRows) {
    const list = barisByHeader.get(b.header_id) ?? [];
    list.push({
      itemKode: b.item_kode,
      itemName: b.item_name,
      qtySistem: Number(b.qty_sistem),
      qtyFisik: Number(b.qty_fisik),
      selisih: Number(b.qty_fisik) - Number(b.qty_sistem),
    });
    barisByHeader.set(b.header_id, list);
  }

  return headers.map((h) => ({
    headerId: h.id,
    locationId: h.location_id,
    tanggal: h.tanggal,
    status: h.status,
    dibuatOleh: h.dibuat_oleh,
    diputuskanOleh: h.diputuskan_oleh,
    createdAt: h.created_at,
    baris: barisByHeader.get(h.id) ?? [],
  }));
}
