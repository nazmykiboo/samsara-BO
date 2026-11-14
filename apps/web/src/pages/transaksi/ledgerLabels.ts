import type { JenisTransaksiLedger } from "../../api/types";

/** Label Bahasa Indonesia untuk tiap nilai enum `inventory_transaction_type` --
 * dipakai KartuStokTab & RiwayatSemuaJenisTab (Tahap 1D). Nilai mentahnya
 * TIDAK PERNAH ditampilkan langsung ke user, sama pola dengan JENIS_MUTASI_LAIN. */
export const LABEL_JENIS_LEDGER: Record<JenisTransaksiLedger, string> = {
  pembelian: "Pembelian",
  produksi: "Produksi",
  penjualan: "Penjualan",
  transfer_keluar: "Transfer (kirim)",
  transfer_masuk: "Transfer (terima)",
  mutasi_lain: "Mutasi Lain",
  opname: "Opname",
};

export const JENIS_LEDGER_URUT: JenisTransaksiLedger[] = [
  "pembelian",
  "produksi",
  "penjualan",
  "transfer_keluar",
  "transfer_masuk",
  "mutasi_lain",
  "opname",
];
