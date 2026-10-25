import { api } from "./client";
import type {
  BatalkanPermintaanResult,
  CreatePermintaanTransferInput,
  CreatePermintaanTransferResult,
  DecideOpnameResult,
  JenisMutasiLain,
  MutasiLainBarisInput,
  OpnameBarisInput,
  OpnameDecision,
  OpnameListItem,
  OpnameResult,
  OpnameStatus,
  PembelianBarisInput,
  PembelianResult,
  PenjualanBarisInput,
  PenjualanResult,
  PermintaanTransferListItem,
  PermintaanTransferStatus,
  ProduksiInput,
  ProduksiResult,
  TransferKirimBarisInput,
  TransferKirimResult,
  TransferTerimaResult,
} from "./types";

export function createPembelian(input: {
  locationId: number;
  supplier?: string;
  /** Tahap 3, opsional -- BEDA dari `supplier` (teks bebas), lihat docs/architecture-decisions.md §28. */
  vendorId?: number;
  noReferensi?: string;
  tanggal: string;
  baris: PembelianBarisInput[];
}): Promise<PembelianResult> {
  return api.post("/api/inventory/transaksi/pembelian", input);
}

export function createProduksi(input: ProduksiInput): Promise<ProduksiResult> {
  return api.post("/api/inventory/transaksi/produksi", input);
}

export function createPenjualan(input: {
  locationId: number;
  sumber: string;
  noReferensi?: string;
  tanggal: string;
  /** Jam transaksi, "HH:MM" atau "HH:MM:SS". OPSIONAL di backend (tidak dikirim =
   * tersimpan kosong, bukan error). Form Penjualan tetap selalu mengisinya dengan jam
   * saat submit kalau user membiarkan kosong -- lihat PenjualanForm. */
  jam?: string;
  baris: PenjualanBarisInput[];
}): Promise<PenjualanResult> {
  return api.post("/api/inventory/transaksi/penjualan", input);
}

export function createTransferKirim(input: {
  locationAsalId: number;
  locationTujuanId: number;
  tanggal: string;
  baris: TransferKirimBarisInput[];
  /** Diisi kalau transfer ini memenuhi permintaan transfer outlet -- lihat createPermintaanTransfer/
   * listPermintaanTransfer di bawah. Backend otomatis mengubah status permintaan terkait jadi 'dipenuhi'. */
  permintaanId?: number;
}): Promise<TransferKirimResult> {
  return api.post("/api/inventory/transaksi/transfer", input);
}

export function createTransferTerima(
  transferId: number | string,
  baris: Array<{ itemKode: string; qtyTerima: number }>,
): Promise<TransferTerimaResult> {
  return api.post(`/api/inventory/transaksi/transfer/${transferId}/terima`, { baris });
}

export function createMutasiLain(input: {
  locationId: number;
  /** WAJIB. Kategori mutasi -- tanpa ini (atau nilai di luar 5 pilihan) backend menolak 400. */
  jenis: JenisMutasiLain;
  /** WAJIB, tetap ada berdampingan dengan `jenis`: catatan bebas detail kejadiannya. */
  alasan: string;
  tanggal: string;
  baris: MutasiLainBarisInput[];
}): Promise<{ headerId: string }> {
  return api.post("/api/inventory/transaksi/mutasi-lain", input);
}

export function createOpname(input: {
  locationId: number;
  tanggal: string;
  baris: OpnameBarisInput[];
}): Promise<OpnameResult> {
  return api.post("/api/inventory/transaksi/opname", input);
}

export function decideOpname(opnameId: number, decision: OpnameDecision): Promise<DecideOpnameResult> {
  return api.post(`/api/inventory/transaksi/opname/${opnameId}/keputusan`, { decision });
}

export function listOpname(filter: { status?: OpnameStatus; locationId?: number } = {}): Promise<OpnameListItem[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.locationId !== undefined) params.set("location", String(filter.locationId));
  const qs = params.toString();
  return api.get<OpnameListItem[]>(`/api/inventory/transaksi/opname${qs ? `?${qs}` : ""}`);
}

// --- Permintaan transfer (outlet mengajukan ke CK, sebelum transfer kirim) ---

export function createPermintaanTransfer(input: CreatePermintaanTransferInput): Promise<CreatePermintaanTransferResult> {
  return api.post("/api/inventory/transaksi/permintaan-transfer", input);
}

export function listPermintaanTransfer(
  filter: { lokasi?: number; status?: PermintaanTransferStatus } = {},
): Promise<PermintaanTransferListItem[]> {
  const params = new URLSearchParams();
  if (filter.lokasi !== undefined) params.set("lokasi", String(filter.lokasi));
  if (filter.status) params.set("status", filter.status);
  const qs = params.toString();
  return api.get<PermintaanTransferListItem[]>(`/api/inventory/transaksi/permintaan-transfer${qs ? `?${qs}` : ""}`);
}

export function batalkanPermintaanTransfer(id: number | string): Promise<BatalkanPermintaanResult> {
  return api.patch(`/api/inventory/transaksi/permintaan-transfer/${id}/batalkan`);
}
