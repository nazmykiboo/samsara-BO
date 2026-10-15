// Tipe-tipe ini mengikuti persis bentuk respons API (module.json + domain
// layer di modules/inventory/src/domain/*.ts) -- kalau backend berubah,
// sinkronkan di sini juga.

export type Role = "owner" | "manajer_ops" | "supervisor" | "staf";

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  allLocations: boolean;
  locationIds: number[];
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

/** GET /api/auth/staf?lokasi=<id> -- hanya staf AKTIF di lokasi itu, tanpa field sensitif.
 * id string karena kolomnya BIGINT (lihat catatan headerId di bawah) -- lempar balik apa
 * adanya (string) sebagai userId ke loginPin, jangan di-parse ke number. */
export interface StafOption {
  id: string;
  name: string;
}

/** POST /api/auth/users -- body request. Form "Kelola User" SENGAJA tidak pernah mengirim
 * field `pin` -- backend selalu auto-generate PIN 6 digit untuk role staf (lihat
 * CreateUserResult.generatedPin), supaya owner tidak bisa set PIN gampang ditebak. */
export interface CreateUserInput {
  name: string;
  role: Role;
  locationIds?: number[];
  username?: string;
  password?: string;
}

/** POST /api/auth/users -- generatedPin HANYA ada untuk role=staf, dan HANYA ditampilkan
 * satu kali di layar konfirmasi setelah create -- jangan disimpan di state lebih dari itu. */
export interface CreateUserResult {
  id: string;
  username: string;
  generatedPin?: string;
}

/** GET /api/auth/users -- owner-only. id string karena BIGINT. */
export interface UserListItem {
  id: string;
  username: string;
  name: string;
  role: Role;
  isActive: boolean;
  locationIds: number[];
  authMethod: "password" | "pin";
}

/** PATCH /api/auth/users/:id -- locationIds kalau dikirim berarti FULL REPLACE, bukan merge.
 * isActive bisa dua arah (true MAUPUN false) -- nonaktifkan dan aktifkan kembali. */
export interface UpdateUserInput {
  name?: string;
  isActive?: boolean;
  locationIds?: number[];
}

/** POST /api/auth/users/:id/reset -- ganti kredensial lama TOTAL (tidak bisa dipakai login lagi).
 * generatedPin ada kalau role staf, generatedPassword kalau role password (manajer_ops/supervisor).
 * Keduanya cuma muncul SEKALI di response ini -- tidak pernah disimpan ulang di state lebih dari
 * yang dibutuhkan untuk ditampilkan satu kali ke owner. */
export interface ResetCredentialResult {
  role: Role;
  generatedPin?: string;
  generatedPassword?: string;
}

export type HppMethod = "harga_master" | "harga_beli_terakhir";

export type ItemType = "bahan_baku" | "packaging" | "operasional" | "setengah_jadi";

/** GET /items -- daftar SEMUA item (aktif & nonaktif). `hargaMaster` tidak ada di
 * respons untuk role tanpa permission `hpp.lihat_harga` (supervisor/staf). */
export interface ItemListItem {
  kode: string | null;
  name: string;
  category: string | null;
  type: ItemType;
  status: "active" | "pending_data";
  recipeUnit: string;
  purchaseUnit: string | null;
  purchaseToRecipeFactor: number | null;
  hargaMaster?: number | null;
  isActive: boolean;
  minStok: number | null;
}

/** GET /items/:kode/hpp -- cost_per_recipe_unit tidak ada sama sekali di respons untuk role supervisor/staf. */
export interface ItemCostReport {
  kode: string | null;
  name: string;
  cost_per_recipe_unit?: number | null;
  status: "ok" | "pending_data";
}

/** Baris breakdown harga per channel penjualan aktif (bagian dari MenuHppReport.channels).
 * foodCostPct/markupPct/marginPct tidak ada di respons untuk role tanpa permission
 * `hpp.lihat_harga` (supervisor/staf) -- hargaJual dan status selalu ada untuk semua role. */
export interface MenuChannelInfo {
  channel: string;
  /** `null` kalau belum ada harga diisi untuk menu+channel ini -- bukan error. */
  hargaJual: number | null;
  foodCostPct?: number | null;
  markupPct?: number | null;
  marginPct?: number | null;
  /** `belum_diisi` cuma berarti belum ada harga diisi -- tidak terkait status HPP pending_data. */
  status: "ok" | "belum_diisi";
  /** true = menu ini TAYANG di channel itu. Sumbernya tabel pengecualian
   * inventory_menu_channel_visibilitas dengan semantik "tidak ada baris = tayang", jadi
   * `true` adalah kondisi default/normal untuk menu yang belum pernah diatur. Field ini
   * TETAP ada untuk semua role (info operasional, bukan data harga) -- yang dibatasi cuma
   * hak MENGUBAHnya (permission `menu_visibilitas.edit`, owner saja). */
  isVisible: boolean;
}

/** GET /menu/:kode/hpp -- hpp_per_porsi/food_cost_pct/margin tidak ada di respons untuk role supervisor/staf. harga_jual selalu ada.
 * harga_jual/food_cost_pct/margin top-level diisi dari baris channel "Offline" di `channels` (legacy, dipertahankan
 * untuk kompatibilitas). `channels` berisi breakdown SEMUA channel penjualan aktif. */
export interface MenuHppReport {
  kode: string;
  name: string;
  hpp_per_porsi?: number | null;
  status: "ok" | "pending_data";
  harga_jual: number | null;
  food_cost_pct?: number | null;
  margin?: number | null;
  channels: MenuChannelInfo[];
}

/** Satu baris body PATCH /menu/harga-channel/batch (tombol "Simpan Semua" di grid Edit Harga
 * Massal). Kombinasi kodeMenu+channel harus unik dalam satu kiriman; `hargaJual` angka rupiah
 * penuh (bukan string, bukan teks berpemisah ribuan).
 *
 * PERHATIAN: endpoint batch ini ATOMIK SUNGGUHAN -- kalau SATU baris ditolak (menu tidak ada,
 * channel nonaktif), SELURUH kiriman dibatalkan dan TIDAK ADA satu pun harga yang tersimpan,
 * dengan response error 400/404 yang sudah menyebut baris ke-berapa yang bermasalah. Ini
 * SENGAJA BEDA dari pola batch lain di app ini (POST /jadwal/batch modul HR dan import CSV
 * sales-sync yang "satu baris gagal tidak membatalkan baris lain") -- jadi di sini kegagalan
 * memang datang sebagai ApiError, bukan sebagai daftar hasil per baris. */
export interface BarisHargaBatch {
  kodeMenu: string;
  channel: string;
  hargaJual: number;
}

/** Satu baris hasil POST /menu/harga-channel/import.
 *
 * Endpoint itu MURNI PREVIEW -- TIDAK menyimpan apa pun (meski method-nya POST: CSV-nya dikirim
 * di body). Penyimpanan sungguhan adalah panggilan TERPISAH ke PATCH /menu/harga-channel/batch,
 * dan frontend yang WAJIB menyaring dulu baris `sama`/`error` sebelum mengirimnya.
 *
 * `baris` = nomor baris DATA di CSV, mulai 1 untuk baris pertama SETELAH header.
 * `status: "error"` dipakai backend untuk SEMUA baris yang tidak bisa disimpan, termasuk kasus
 * ringan "Kolom harga_jual kosong" (harga kosong atau 0 di CSV). Kasus itu bukan kesalahan user:
 * di layar tampilkan netral sebagai "belum diisi", jangan sebagai kegagalan. */
export interface PreviewHargaChannel {
  baris: number;
  kodeMenu: string;
  channel: string;
  /** Harga yang tersimpan sekarang; `null` kalau kombinasi menu+channel ini belum pernah diisi. */
  hargaLama: number | null;
  /** Harga dari CSV. `0` kalau barisnya `status: "error"` karena angkanya tidak terbaca. */
  hargaBaru: number;
  status: "baru" | "berubah" | "sama" | "error";
  /** Terisi kalau `status: "error"` -- penjelasan apa adanya dari backend. */
  pesan?: string;
}

/** GET /menu/:kode/rekomendasi-harga -- read-only, tidak menyimpan apa pun. Semua field null/array kosong
 * (bukan error) kalau HPP menu ini masih `pending_data`. */
export interface RekomendasiHargaChannel {
  channel: string;
  hargaJual: number;
}
export interface RekomendasiHargaResult {
  kode: string;
  hppPerPorsi: number | null;
  targetFoodCostPersen: number;
  hargaDasar: number | null;
  rekomendasi: RekomendasiHargaChannel[];
}

/** GET /menu -- semua role login boleh akses, tanpa permission gate. Daftar SEMUA menu
 * (aktif & nonaktif). `status: "pending_data"` berarti HPP menu ini menunggu data (bukan error). */
export interface MenuListItem {
  kode: string | null;
  name: string;
  /** NAMA kategori (dari tabel referensi kategori menu). Tetap `null` untuk menu lama yang
   * belum punya kategori. */
  kategori: string | null;
  /** ID kategori menu -- dipakai menyusun SARAN kode menu otomatis di form menu baru
   * (prefix kode kategori dari GET /kategori-menu + nomor urut, dihitung dari daftar ini).
   * Backend sengaja tidak membuat kode otomatis, itu tugas tampilan. */
  kategoriId: number | null;
  isActive: boolean;
  status: "ok" | "pending_data";
}

/** GET /kategori-menu -- permission `master_menu.edit` (owner/manajer_ops), SAMA dengan
 * POST /menu (bukan `master_item.edit` yang dipakai /kategori & /satuan untuk ITEM).
 * Daftar SEMUA kategori (aktif & nonaktif), urut `urutanTampil` -- BUKAN alfabetis, karena
 * urutan kategori di daftar menu/kasir itu keputusan bisnis. `kode` (mis. "BURYAM") dipakai
 * sebagai prefix saran kode menu. */
export interface KategoriMenu {
  id: number;
  kode: string;
  nama: string;
  urutanTampil: number;
  aktif: boolean;
}

/** GET /menu/:kode/resep -- permission `resep.edit` (owner/manajer_ops). Baris resep menu
 * SAAT INI (sumber kebenaran ada di server -- selalu refetch lewat ini setelah simpan). */
export interface MenuResepBarisItem {
  itemKode: string | null;
  itemName: string;
  qty: number;
  unit: string;
}

/** GET /resep-produksi -- permission `resep.edit`. Daftar SEMUA resep produksi (aktif & nonaktif). */
export interface ResepProduksiListItem {
  kode: string | null;
  outputItemKode: string | null;
  outputItemName: string;
  yieldQty: number | null;
  yieldUnit: string | null;
  isActive: boolean;
}

/** GET /resep-produksi/:kode -- permission `resep.edit`. Baris bahan resep produksi SAAT INI. */
export interface ResepProduksiBarisItem {
  bahanItemKode: string | null;
  bahanItemName: string;
  qty: number;
  unit: string;
}

export interface StokResponse {
  itemKode: string;
  locationId: number;
  qty: number;
}

/** transferId/locationAsalId/locationTujuanId adalah string karena kolomnya BIGINT (lihat catatan headerId di atas). */
export interface DalamPerjalananRow {
  transferId: string;
  locationAsalId: string;
  locationTujuanId: string;
  itemKode: string | null;
  qtyKirim: number;
  unit: string;
  hargaTransferPerSatuan: number | null;
  nilai: number | null;
}

export interface PembelianBarisInput {
  itemKode: string;
  qtyBeli: number;
  satuanBeli: string;
  hargaSatuan: number;
}
export interface PembelianResult {
  headerId: string;
  baris: Array<{ itemKode: string; qtyRecipeUnit: number }>;
}

export interface ProduksiInput {
  resepKode: string;
  locationId: number;
  qtyBatch: number;
  tanggal: string;
  hasilAktual: number;
}
export interface ProduksiResult {
  headerId: string;
  outputItemKode: string | null;
  yieldTeoretis: number | null;
  selisihYield: number | null;
  bahanTerpakai: Array<{ itemKode: string | null; qty: number }>;
}

export interface PenjualanBarisInput {
  menuKode: string;
  qty: number;
}
export interface PenjualanResult {
  headerId: string;
  pemakaianBahan: Array<{ itemKode: string | null; qty: number }>;
}

export interface TransferKirimBarisInput {
  itemKode: string;
  qtyKirim: number;
  unit: string;
  hargaTransferPerSatuan?: number;
}
export interface TransferKirimResult {
  headerId: string;
  antarEntitas: boolean;
  baris: Array<{ itemKode: string; qtyKirim: number; hargaTransferPerSatuan: number | null }>;
}

export interface TransferTerimaResult {
  headerId: string;
  baris: Array<{ itemKode: string; qtyKirim: number; qtyTerima: number; susut: number }>;
}

export interface MutasiLainBarisInput {
  itemKode: string;
  qtyChange: number;
}

/** Kategori terstruktur mutasi lain (body `jenis` POST /transaksi/mutasi-lain, WAJIB).
 * Dipakai backend untuk memisahkan waste sungguhan (`waste_rusak` +
 * `hilang_tidak_diketahui`) dari pemakaian yang bukan waste (`staff_meal`, `sampel`,
 * `retur_supplier`) saat menghitung insight waste di /analitik/operasional.
 *
 * `koreksi_tambah` adalah satu-satunya kategori PENAMBAHAN stok (stok awal, temuan lebih
 * opname, dll) -- 5 kategori lainnya semuanya untuk PENGURANGAN stok. Backend menolak 400
 * kalau tanda qtyChange di baris tidak konsisten dengan kategori yang dipilih (lihat
 * JENIS_MUTASI_LAIN_VALID / JENIS_MUTASI_LAIN_PENGURANGAN di modules/inventory/src/domain/stok.ts).
 *
 * Kolom `alasan` (teks bebas) TETAP WAJIB dan dikirim BERDAMPINGAN dengan ini -- `jenis`
 * kategorinya, `alasan` detailnya. Nilai di luar 6 ini ditolak 400. Jangan pernah
 * tampilkan nilai mentahnya ke staf: pakai label Bahasa Indonesia di JENIS_MUTASI_LAIN
 * (MutasiLainForm). */
export type JenisMutasiLain =
  | "waste_rusak"
  | "hilang_tidak_diketahui"
  | "staff_meal"
  | "sampel"
  | "retur_supplier"
  | "koreksi_tambah";

export type PermintaanTransferStatus = "diminta" | "dipenuhi" | "dibatalkan";

export interface CreatePermintaanTransferInput {
  locationAsalId: number;
  locationTujuanId: number;
  itemKode: string;
  qtyDiminta: number;
  tanggalDiminta: string;
  catatan?: string;
}

/** POST /transaksi/permintaan-transfer -- headerId string karena kolomnya BIGINT (lihat catatan headerId di atas). */
export interface CreatePermintaanTransferResult {
  headerId: string;
  kode: string;
  status: "diminta";
}

/** GET /transaksi/permintaan-transfer -- id/locationAsalId/locationTujuanId string karena BIGINT.
 * Baris yang sama dipakai dua arah: CK melihat permintaan masuk (filter lokasi = id CK, match ke
 * locationAsalId) dan outlet melihat permintaan yang mereka ajukan (filter lokasi = id outlet,
 * match ke locationTujuanId). */
export interface PermintaanTransferListItem {
  id: string;
  kode: string;
  locationAsalId: string;
  locationAsalNama: string;
  locationTujuanId: string;
  locationTujuanNama: string;
  itemKode: string;
  itemNama: string;
  qtyDiminta: number;
  status: PermintaanTransferStatus;
  tanggalDiminta: string;
  catatan: string | null;
  dimintaOlehUsername: string | null;
  createdAt: string;
}

/** PATCH /transaksi/permintaan-transfer/:id/batalkan -- id string karena BIGINT. */
export interface BatalkanPermintaanResult {
  id: string;
  kode: string;
  status: "dibatalkan";
}

/** Bagian "keluar" dari GET /laporan/harian -- ringkasan menu terjual hari itu, di-GROUP BY menu. */
export interface LaporanHarianKeluarItem {
  menuKode: string;
  menuNama: string;
  qtyTerjual: number;
}

/** Bagian "masuk" dari GET /laporan/harian -- baris pembelian hari itu. */
export interface LaporanHarianMasukBaris {
  itemKode: string;
  itemNama: string;
  qtyBeli: number;
  satuanBeli: string;
  hargaSatuan: number;
  supplier: string | null;
  noReferensi: string | null;
}

/** Bagian "perluDibeli" dari GET /laporan/harian -- SELALU kondisi Central Kitchen SAAT INI
 * (independen dari lokasi/tanggal yang difilter di halaman) -- lihat domain/laporan.ts. */
export interface LaporanHarianPerluDibeliItem {
  itemKode: string;
  itemNama: string;
  stokSaatIni: number;
  minStok: number;
  selisih: number;
}

/** GET /laporan/harian?lokasi=&tanggal= -- permission owner/manajer_ops/supervisor saja. */
export interface LaporanHarian {
  keluar: LaporanHarianKeluarItem[];
  masuk: LaporanHarianMasukBaris[];
  permintaanKeCk: PermintaanTransferListItem[];
  perluDibeli: LaporanHarianPerluDibeliItem[];
}

/** Asal pencatatan satu transaksi penjualan: diinput orang lewat form Penjualan ("manual") atau
 * dibuat modul Sinkronisasi Penjualan dari file platform ("sinkronisasi"). Dua-duanya kondisi
 * NORMAL -- bukan status baik/buruk, cuma penjelasan dari mana barisnya datang. */
export type SumberPencatatan = "manual" | "sinkronisasi";

/** Asal angka `hppSaatTransaksi` (migrasi 0028). `'snapshot_asli'` = dihitung otomatis PERSIS saat
 * transaksi dicatat -- akurat/historis asli. `'snapshot_estimasi'` = transaksi LAMA dari sebelum
 * fitur pelacakan HPP historis ada, HPP-nya diisi belakangan lewat backfill memakai harga SAAT INI
 * sebagai perkiraan (BUKAN harga asli saat itu) -- jadi kurang akurat untuk transaksi lama, tapi
 * BUKAN kesalahan, tampilkan sebagai keterangan netral ("Estimasi"). `null` = baris itu sendiri
 * belum pernah tersentuh proses snapshot/backfill -- seharusnya tidak terjadi untuk data baru,
 * tapi kalau muncul tangani sebagai "tidak diketahui", bukan error. */
export type HppSumber = "snapshot_asli" | "snapshot_estimasi" | null;

/** GET /transaksi/penjualan -- SATU objek per BARIS menu, bukan per transaksi: satu transaksi
 * dengan 2 menu muncul sebagai 2 objek dengan `headerId` yang sama. Info header (tanggal, lokasi,
 * channel, no referensi) diulang di setiap baris supaya bisa ditampilkan datar tanpa request lain.
 *
 * Backend memotong hasil di 200 baris (tidak ada pagination di repo ini) -- kalau hasilnya pas 200,
 * jelaskan ke user bahwa daftarnya dibatasi dan minta dia mempersempit filter, JANGAN dianggap bug. */
export interface DetailTransaksiPenjualanBaris {
  headerId: number;
  /** "YYYY-MM-DD" (tanggal kalender transaksi, bukan timestamp input). */
  tanggal: string;
  lokasiId: number;
  lokasiNama: string;
  /** Channel penjualan apa adanya dari kolom `sumber` (mis. "Offline", "GrabFood"). */
  sumber: string;
  noReferensi: string | null;
  menuKode: string;
  menuNama: string;
  qty: number;
  sumberPencatatan: SumberPencatatan;
  /** HPP (rupiah) menu ini PADA SAAT transaksi dicatat. `null` kalau waktu itu HPP tidak bisa
   * dihitung (item resep datanya belum lengkap / `pending_data`) -- tampilkan sebagai "HPP belum
   * tersedia", bukan error. Lihat `HppSumber` untuk arti `hppSumber`. */
  hppSaatTransaksi: number | null;
  hppSumber: HppSumber;
}

/** Filter GET /transaksi/penjualan -- SEMUA opsional. Yang tidak dikirim diisi backend:
 * rentang tanggal kosong = 30 hari terakhir sampai hari ini (dihitung di database).
 *
 * `lokasiId` JANGAN pernah dikirim sebagai default dari UI: untuk role yang terbatas lokasi
 * (supervisor) backend sudah memaksa ke lokasi sendiri walau param ini kosong. Kirim hanya kalau
 * user owner/manajer_ops memang memilih satu lokasi tertentu. */
export interface DetailTransaksiPenjualanFilter {
  tanggalMulai?: string;
  tanggalSelesai?: string;
  channel?: string;
  kodeMenu?: string;
  lokasiId?: number;
}

export interface OpnameBarisInput {
  itemKode: string;
  qtyFisik: number;
}
export interface OpnameResult {
  headerId: string;
  status: "draft";
  baris: Array<{ itemKode: string; qtySistem: number; qtyFisik: number; selisih: number }>;
}

export type OpnameDecision = "setuju" | "tolak";
export interface DecideOpnameResult {
  headerId: string;
  status: "disetujui" | "ditolak";
  baris: Array<{ itemKode: string | null; selisih: number; diposting: boolean }>;
}

export type OpnameStatus = "draft" | "disetujui" | "ditolak";

/** GET /transaksi/opname?status=... -- headerId/locationId/dibuatOleh/diputuskanOleh string karena BIGINT. */
export interface OpnameListItem {
  headerId: string;
  locationId: string;
  tanggal: string;
  status: OpnameStatus;
  dibuatOleh: string | null;
  diputuskanOleh: string | null;
  createdAt: string;
  baris: Array<{ itemKode: string | null; itemName: string | null; qtySistem: number; qtyFisik: number; selisih: number }>;
}

/** GET /kategori, GET /satuan -- id string karena BIGINT. */
export interface RefItem {
  id: string;
  name: string;
  isActive: boolean;
}

/** GET /min-stok?location=... -- hanya item yang SUDAH punya ambang di lokasi itu yang muncul di daftar;
 * item yang tidak ada di daftar berarti belum diatur (perlakukan sebagai null, bukan 0). */
export interface MinStokEntry {
  itemKode: string;
  minStok: number;
}

/** PUT /min-stok -- id string karena kolomnya BIGINT (lihat catatan headerId di atas). */
export interface MinStokResult {
  id: string;
  itemKode: string;
  locationId: number;
  minStok: number;
}

export interface SetMinStokInput {
  itemKode: string;
  locationId: number;
  minStok: number;
}

/** GET /api/hr/jadwal-shift?dari=&sampai=&lokasiId=&userId= -- permission semua role. `dari`/`sampai` WAJIB.
 * owner/manajer_ops bebas isi lokasiId/userId (opsional, kosongkan untuk lihat semua). supervisor/staf:
 * lokasiId/userId yang dikirim DIABAIKAN backend (bukan ditolak) -- otomatis dipaksa ke jadwal mereka
 * sendiri, jadi untuk role itu jangan kirim lokasiId/userId sama sekali dari frontend. Semua id BIGINT
 * jadi STRING, jamMulai/jamSelesai format "HH:MM:SS" (diisi backend dari shift template, bukan input
 * manual lagi), tanggal ISO datetime string. shiftTemplateId/shiftTemplateNama `null` untuk baris jadwal
 * lama yang dibuat sebelum migrasi shift template -- tampilkan apa adanya (mis. "-"), bukan error.
 * `konflikCuti` true = staf itu punya pengajuan libur berstatus "disetujui" yang mencakup tanggal ini.
 * PERINGATAN SAJA: jadwalnya tetap valid dan tersimpan, jangan ditampilkan sebagai error/kegagalan. */
export interface JadwalShiftListItem {
  id: string;
  userId: string;
  userName: string;
  lokasiId: string;
  lokasiName: string;
  tanggal: string;
  jamMulai: string;
  jamSelesai: string;
  shiftTemplateId: string | null;
  shiftTemplateNama: string | null;
  dibuatOleh: string | null;
  konflikCuti: boolean;
}

/** POST /api/hr/jadwal-shift -- permission owner/manajer_ops saja. Body sekarang pakai shiftTemplateId
 * (jamMulai/jamSelesai manual SUDAH TIDAK DITERIMA -- jam diambil dari template di server). 400 kalau
 * shiftTemplateId tidak ditemukan, error "tidak ditemukan" kalau userId/lokasiId tidak valid. */
export interface CreateJadwalShiftInput {
  userId: number;
  lokasiId: number;
  tanggal: string;
  shiftTemplateId: number;
}

/** PATCH /api/hr/jadwal-shift/:id -- sama permission POST, field boleh sebagian. */
export interface UpdateJadwalShiftInput {
  lokasiId?: number;
  tanggal?: string;
  shiftTemplateId?: number;
}

/** Response POST dan PATCH /api/hr/jadwal-shift -- baris SELALU tersimpan walau `konflikCuti` true
 * (staf sedang cuti disetujui pada tanggal itu). `konflikCuti` cuma peringatan untuk ditampilkan
 * ke manajer, bukan indikasi gagal. */
export interface JadwalShiftMutasiResult {
  id: string;
  konflikCuti: boolean;
}

/** POST /api/hr/jadwal/salin-minggu -- permission jadwal.manage (owner/manajer_ops). mingguSumber/
 * mingguTujuan boleh tanggal MANA PUN dalam minggu target (YYYY-MM-DD), Senin-nya dihitung backend. */
export interface SalinMingguJadwalInput {
  lokasiId: number;
  mingguSumber: string;
  mingguTujuan: string;
}

/** Response POST /api/hr/jadwal/salin-minggu. IDEMPOTEN: baris yang sudah identik di minggu tujuan
 * dihitung di `dilewati` (bukan error) -- `disalin: 0` berarti minggu tujuan sudah sama isinya,
 * tampilkan sebagai info netral, bukan kegagalan. */
export interface SalinMingguJadwalResult {
  disalin: number;
  dilewati: number;
}

/** POST /api/hr/jadwal/batch -- permission jadwal.manage (sama dengan create/update/delete biasa).
 * Satu panggilan = SATU kombinasi lokasi+tanggal+shift, banyak staf sekaligus. */
export interface BatchJadwalInput {
  lokasiId: number;
  tanggal: string;
  shiftTemplateId: number;
  userIds: number[];
}

/** Satu entri hasil POST /api/hr/jadwal/batch.
 *
 * PENTING: endpoint ini SELALU membalas HTTP 200 -- bahkan kalau SEBAGIAN (atau semua) item gagal.
 * Backend memproses tiap userId di transaksi terpisah, jadi "request berhasil diproses" tidak sama
 * dengan "semua item tersimpan". Konsekuensinya `api.post()` TIDAK melempar ApiError untuk kegagalan
 * per item -- pemanggil WAJIB membaca array hasilnya dan cek `success` tiap entri sendiri (try/catch
 * di sini cuma menangkap kegagalan sungguhan: jaringan mati, 403, body tidak valid).
 *
 * Array hasil SEJAJAR urutan `userIds` yang dikirim. `konflikCuti` lihat catatan JadwalShiftListItem:
 * peringatan saja, barisnya TETAP tersimpan. */
export interface BatchJadwalHasil {
  userId: string;
  success: boolean;
  id?: string;
  konflikCuti?: boolean;
  error?: string;
}

/** Satu entri hasil POST /api/hr/jadwal/batch-hapus -- pola response IDENTIK dengan BatchJadwalHasil
 * (selalu HTTP 200, array sejajar urutan `ids` yang dikirim, cek `success` per entri). */
export interface BatchHapusHasil {
  id: string;
  success: boolean;
  error?: string;
}

/** Satu staf yang bertugas di satu sel grid (satu hari x satu shift). `konflikCuti` lihat
 * catatan JadwalShiftListItem -- peringatan saja, jadwal tetap valid. */
export interface JadwalGridStaf {
  userId: string;
  userName: string;
  konflikCuti: boolean;
}

/** Satu baris shift di dalam satu hari grid -- selalu ada untuk tiap shift template AKTIF
 * walau `staf` kosong (sel kosong, bukan baris hilang). */
export interface JadwalGridShiftCell {
  shiftTemplateId: string;
  shiftTemplateNama: string;
  jamMulai: string;
  jamSelesai: string;
  staf: JadwalGridStaf[];
}

export interface JadwalGridHari {
  tanggal: string;
  shift: JadwalGridShiftCell[];
}

/** GET /api/hr/jadwal?lokasi=&minggu= -- jadwal terstruktur 1 lokasi x 1 minggu (Senin-Minggu),
 * dipakai tampilan grid "siapa teman se-shift" (beda dari /jadwal-shift yang baris datar dipakai
 * form CRUD). `minggu` boleh tanggal mana pun dalam minggu target. Untuk owner/manajer_ops, query
 * `lokasi` WAJIB diisi. Untuk supervisor/staf, `lokasi` yang dikirim diabaikan kalau di luar lokasi
 * mereka sendiri -- backend otomatis memaksa ke lokasi mereka. */
export interface JadwalGridResponse {
  lokasiId: string;
  lokasiName: string;
  mingguMulai: string;
  mingguSelesai: string;
  hari: JadwalGridHari[];
}

/** GET /api/hr/shift-template -- permission owner/manajer_ops saja (shift_template.manage). SEMUA
 * shift template (aktif & nonaktif) -- caller/UI yang filter kalau cuma butuh yang aktif (mis. dropdown
 * "buat jadwal" di Jadwal & Izin). id string karena BIGINT, jamMulai/jamSelesai format "HH:MM:SS". */
export interface ShiftTemplateListItem {
  id: string;
  kode: string;
  nama: string;
  jamMulai: string;
  jamSelesai: string;
  aktif: boolean;
  urutanTampil: number;
}

/** POST /api/hr/shift-template -- permission sama. jamMulai/jamSelesai format "HH:MM". 400 kalau
 * jamSelesai <= jamMulai. */
export interface CreateShiftTemplateInput {
  kode: string;
  nama: string;
  jamMulai: string;
  jamSelesai: string;
  urutanTampil?: number;
}

/** PATCH /api/hr/shift-template/:id -- permission sama. `aktif` dua arah (nonaktifkan DAN aktifkan
 * lagi), bukan endpoint nonaktifkan terpisah. */
export interface UpdateShiftTemplateInput {
  nama?: string;
  jamMulai?: string;
  jamSelesai?: string;
  aktif?: boolean;
  urutanTampil?: number;
}

export type PengajuanLiburStatus = "diajukan" | "disetujui" | "ditolak";

/** GET /api/hr/pengajuan-libur?status=&userId= -- permission semua role. owner/manajer_ops lihat semua
 * (biasa dipakai dengan status=diajukan untuk antrian approval, TIDAK self-scoped untuk role ini --
 * termasuk pengajuan milik sendiri tetap muncul). supervisor/staf: userId yang dikirim DIABAIKAN,
 * dipaksa ke riwayat sendiri. `melebihiKuota`/`selisihKuota` dihitung ulang tiap baca terhadap kuota
 * cuti bulanan user itu (0/false kalau tidak melebihi) -- dipakai badge "Melebihi kuota" di antrian
 * approval, BUKAN penolakan/error. */
export interface PengajuanLiburListItem {
  id: string;
  userId: string;
  userName: string;
  tanggalMulai: string;
  tanggalSelesai: string;
  alasan: string | null;
  status: PengajuanLiburStatus;
  diputuskanOleh: string | null;
  diputuskanPada: string | null;
  createdAt: string;
  melebihiKuota: boolean;
  selisihKuota: number;
  /** true = di lokasi staf itu sudah ada cuti LAIN berstatus "disetujui" yang tanggalnya overlap
   * (aturan maksimal 1 cuti disetujui per lokasi per tanggal). Peringatan untuk manajer, BUKAN
   * penolakan. Selalu false untuk user tanpa lokasi tetap (owner/manajer_ops, allLocations). */
  kuotaHarianPenuh: boolean;
}

/** POST /api/hr/pengajuan-libur -- permission SEMUA role (termasuk owner/manajer_ops, ajukan untuk diri
 * sendiri). userId SELALU dari token login, tidak ada di body. 400 kalau tanggalSelesai < tanggalMulai,
 * ATAU kalau tanggalMulai kurang dari H-2 (2 hari) dari hari ini -- pesan error backend sudah jelas,
 * tampilkan `err.message` APA ADANYA (jangan diganti pesan generic). Tidak ada field "pengganti" di
 * jalur normal ini; nama pengganti cuma dipakai jalur override (OverridePengajuanLiburInput). */
export interface CreatePengajuanLiburInput {
  tanggalMulai: string;
  tanggalSelesai: string;
  alasan?: string;
}

/** Response POST /api/hr/pengajuan-libur -- pengajuan SELALU tersimpan (201) kalau lolos aturan H-2,
 * walau `melebihiKuota`/`kuotaHarianPenuh` true: backend TIDAK PERNAH menolak karena kuota.
 * `melebihiKuota`/`selisih`/`kuotaHarianPenuh` cuma peringatan tambahan untuk ditampilkan ke user,
 * bukan indikasi gagal. */
export interface CreatePengajuanLiburResult {
  id: string;
  melebihiKuota: boolean;
  selisih: number;
  kuotaHarianPenuh: boolean;
}

/** Aturan cuti yang ditembus jalur darurat (POST /pengajuan-libur/override) -- dipetakan ke bahasa
 * manusia di UI, jangan tampilkan kode mentahnya ke staf/manajer. */
export type AturanCutiDilanggar = "h2_minimum" | "kuota_harian_lokasi" | "kuota_bulanan_staf";

/** POST /api/hr/pengajuan-libur/override -- permission pengajuan_libur.approve (owner/manajer_ops).
 * Jalur DARURAT: membuatkan cuti untuk staf LAIN, langsung berstatus "disetujui" (bukan "diajukan")
 * dan menembus aturan H-2. DITOLAK (400) kalau userId = user yang login sendiri, userId tidak ada,
 * atau kuota harian cuti lokasi sudah penuh TAPI penggantiNama kosong. */
export interface OverridePengajuanLiburInput {
  userId: number;
  tanggalMulai: string;
  tanggalSelesai: string;
  alasan?: string;
  penggantiNama?: string;
}

/** Response POST /api/hr/pengajuan-libur/override (201) -- cuti SUDAH TERSIMPAN & LANGSUNG DISETUJUI.
 * `level` = jumlah aturan yang ditembus (0-3) sebagai tingkat keparahan, `aturanDilanggar` daftar
 * aturannya. Keduanya catatan HASIL, bukan pertanyaan/konfirmasi -- aksinya sudah terjadi. */
export interface OverridePengajuanLiburResult {
  id: string;
  level: number;
  aturanDilanggar: AturanCutiDilanggar[];
}

/** GET /api/hr/pengajuan-libur/kuota -- sisa kuota cuti BULAN KALENDER INI untuk user yang login
 * (semua role, selalu untuk diri sendiri, tanpa parameter). `sisa` bisa negatif kalau sudah ada
 * pengajuan disetujui yang melebihi kuota -- tampilkan sebagai peringatan "sudah melebihi kuota",
 * jangan tampilkan angka minus mentah. */
export interface PengajuanLiburKuota {
  bulan: string;
  kuotaBulanan: number;
  terpakai: number;
  sisa: number;
}

/** PATCH /api/hr/pengajuan-libur/:id/keputusan -- permission owner/manajer_ops saja. Ditolak (error, pesan
 * ditampilkan apa adanya) kalau pengajuan sudah diputuskan sebelumnya, ATAU approver mencoba memutuskan
 * pengajuan MILIK SENDIRI -- backend yang menolak, frontend cukup tampilkan error-nya (jangan sembunyikan
 * baris pengajuan sendiri dari daftar antrian). */
export type KeputusanPengajuanLibur = "disetujui" | "ditolak";

// ---------------------------------------------------------------------------
// Modul sales-sync (Sinkronisasi Penjualan)
// ---------------------------------------------------------------------------

/** Response SEMUA endpoint POST /api/sales-sync/import/* (log-penjualan, transaksi, raw-majoo,
 * biaya-platform) -- bentuknya identik untuk keempatnya.
 *
 * SELALU HTTP 200 walau sebagian baris gagal: satu baris bermasalah TIDAK menghentikan baris lain
 * (tiap insert dilindungi SAVEPOINT di backend). Jadi JANGAN andalkan try/catch untuk tahu ada baris
 * yang gagal -- baca `errors`. `dilewati` = baris duplikat yang isinya identik dengan yang sudah ada
 * di arsip (bukan kegagalan). `baris` di `errors` = nomor baris DATA di CSV, mulai 1 untuk baris
 * pertama SETELAH header. */
export interface HasilImportCsv {
  dibuat: number;
  diperbarui: number;
  dilewati: number;
  errors: Array<{ baris: number; pesan: string }>;
}

/** Satu baris antrian pemetaan kode item platform -> kode menu internal Samsara.
 * GET /api/sales-sync/item-mapping dan response PATCH /api/sales-sync/item-mapping/:id.
 *
 * Antrian ini TIDAK diisi manual: backend menyegarkannya sendiri dari arsip log penjualan tiap kali
 * daftar dibaca, jadi daftar kosong = memang tidak ada yang perlu dipetakan (bukan error).
 * `kodeMenu`/`dipetakanOleh`/`dipetakanPada` masih `null` selama `status` = "belum_dipetakan".
 * Timestamp dikirim sebagai ISO datetime string (bukan objek Date). */
export interface ItemMapping {
  id: string;
  platform: string;
  kodeEksternal: string;
  namaEksternal: string;
  kodeMenu: string | null;
  status: "belum_dipetakan" | "dipetakan";
  dipetakanOleh: string | null;
  dipetakanPada: string | null;
  createdAt: string;
}

/** Satu order yang tidak jadi diproses / gagal diproses. `tanggal` tanggal kalender "YYYY-MM-DD". */
export interface OrderSinkronisasi {
  platform: string;
  orderId: string;
  tanggal: string;
}

/** Response POST /api/sales-sync/proses. BUKAN operasi atomik: satu transaksi database terpisah per
 * order, jadi hasilnya bisa sebagian sukses sebagian tidak -- dan itu BUKAN kegagalan endpoint
 * (selalu HTTP 200). Order yang masuk `dilewatiBelumTerpetakan`/`channelTidakDikenal`/`gagal` tidak
 * ditandai sudah-diproses, jadi otomatis ikut lagi di proses berikutnya setelah penyebabnya dibenahi.
 *
 * Kategori sengaja DIPISAH karena tindak lanjutnya beda:
 * - `dilewatiSebelumTanggalMulai`: tanggalnya lebih awal dari `tanggalMulai` yang dikirim user.
 *   BUKAN masalah dan BUKAN butuh tindakan -- ini memang efek dari tanggal yang dipilih sendiri.
 *   Catatan penting: di backend order ini TETAP ditandai sudah-diproses, jadi tidak akan ikut lagi
 *   di proses berikutnya walau nanti dipanggil dengan tanggal mulai yang lebih awal.
 * - `dilewatiBelumTerpetakan`: ada item yang kode menunya belum dipetakan -> petakan dulu di
 *   halaman ini, lalu proses ulang.
 * - `channelTidakDikenal`: nama platform di file belum terdaftar sebagai sumber penjualan ->
 *   butuh pendaftaran channel oleh owner, tidak bisa dibereskan dari halaman ini.
 * - `gagal`: ditolak modul Inventory (mis. stok/menu bermasalah), `pesan` diteruskan apa adanya. */
export interface HasilProsesSinkronisasi {
  transaksiDibuat: number;
  barisDiproses: number;
  dilewatiSebelumTanggalMulai: OrderSinkronisasi[];
  dilewatiBelumTerpetakan: OrderSinkronisasi[];
  channelTidakDikenal: OrderSinkronisasi[];
  gagal: Array<OrderSinkronisasi & { pesan: string }>;
}

/** Satu BARIS arsip penjualan yang BELUM diproses jadi transaksi Penjualan Inventory
 * (GET /api/sales-sync/belum-diproses). Belum memotong stok -- ini kondisi NORMAL, bukan kegagalan:
 * baris ini akan ikut terpotong saat "Proses Sinkronisasi" dijalankan untuk rentang tanggalnya.
 *
 * Bentuknya FLAT PER BARIS, belum dikelompokkan per order: satu order dengan 3 menu datang sebagai
 * 3 objek dengan `platform`/`orderId`/`tanggal` yang sama. Pengelompokan per order dilakukan di
 * sisi tampilan (lihat RiwayatTransaksiTab).
 *
 * `menuId` BUKAN kode menu Samsara (`inventory_menu.kode`) -- ini kode item dari platform sebelum
 * dipetakan, jadi JANGAN dicocokkan ke daftar menu Inventory. Nama yang dipakai di layar adalah
 * `itemName` (nama item apa adanya dari file platform).
 *
 * Tidak ada data LOKASI di sini: lokasi baru ditentukan saat baris diproses jadi transaksi. */
export interface BarisBelumDiproses {
  platform: string;
  orderId: string;
  /** "YYYY-MM-DD" (tanggal kalender transaksi di platform). */
  tanggal: string;
  menuId: string | null;
  itemName: string;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Analitik (GET /api/inventory/analitik/*) -- permission analitik.lihat,
// owner/manajer_ops saja. Bentuk di bawah mengikuti module.json § api.endpoints.
// ---------------------------------------------------------------------------

/** Rentang satu minggu kalender (Senin-Minggu), dua-duanya "YYYY-MM-DD". */
export interface RentangMinggu {
  mulai: string;
  selesai: string;
}

/** Satu menu di daftar top/bottom analitik penjualan. Yang dibandingkan QTY PORSI, bukan rupiah
 * (baris penjualan tidak menyimpan nilai uang).
 *
 * `persenPerubahan` = null kalau minggu lalu qty-nya 0 -- persentase dari nol tidak terdefinisi,
 * jadi JANGAN ditampilkan sebagai 0% atau "Infinity%". Di layar ini kondisi NORMAL untuk menu
 * yang baru mulai terjual, tampilkan sebagai "Baru". */
export interface AnalitikProduk {
  kodeMenu: string;
  namaMenu: string;
  qtyMingguIni: number;
  qtyMingguLalu: number;
  persenPerubahan: number | null;
}

/** Satu jam di heatmap "jam ramai": qty porsi terjual pada jam itu, dipisah penjualan di tempat
 * (`offline`) vs pesanan antar (`online` = GrabFood + GoFood + ShopeeFood yang SUDAH digabung
 * backend -- jangan dicoba dipisah lagi per aplikasi di frontend). */
export interface AnalitikHeatmapJamEntri {
  /** 0..23, jam apa adanya sesuai yang dicatat kasir (tanpa konversi timezone). */
  jam: number;
  offline: number;
  online: number;
}

/** Heatmap jam ramai, cakupan MINGGU INI SAJA (beda dari field lain di AnalitikPenjualan yang
 * membandingkan dua minggu).
 *
 * `data` SELALU 24 entri (jam 0..23 berurutan); jam tanpa transaksi dikirim bernilai 0, bukan
 * entri yang hilang. Isinya nol semua = KONDISI NORMAL (jam transaksi baru mulai dikumpulkan),
 * bukan kegagalan memuat data -- grafiknya tetap digambar.
 *
 * `totalTransaksiMingguIni` vs `transaksiDenganJam` dipakai untuk transparansi cakupan: transaksi
 * yang jamnya tidak tercatat TIDAK ikut ke `data` (jam sengaja tidak diperkirakan dari waktu input
 * kasir), jadi selama dua angka ini masih berbeda jauh, pola jamnya belum mewakili semua penjualan. */
export interface AnalitikHeatmapJam {
  /** Jumlah transaksi penjualan minggu ini (per struk, bukan per baris menu), termasuk yang jamnya kosong. */
  totalTransaksiMingguIni: number;
  /** Bagian dari `totalTransaksiMingguIni` yang jamnya terisi -- hanya ini yang masuk `data`. */
  transaksiDenganJam: number;
  data: AnalitikHeatmapJamEntri[];
}

/** Response GET /analitik/penjualan. `insight` berisi kalimat Bahasa Indonesia SIAP TAMPIL dari
 * backend (bukan data mentah) -- tampilkan apa adanya, jangan diolah lagi. `insight` kosong =
 * tidak ada perubahan signifikan (bukan error). */
export interface AnalitikPenjualan {
  mingguIni: RentangMinggu;
  mingguLalu: RentangMinggu;
  totalQtyMingguIni: number;
  totalQtyMingguLalu: number;
  topProduk: AnalitikProduk[];
  bottomProduk: AnalitikProduk[];
  heatmapJam: AnalitikHeatmapJam;
  insight: string[];
}

/** Nilai waste satu minggu. `nilaiTotal` RUPIAH (qty keluar x harga master item; item yang
 * harganya belum diisi dihitung 0, bukan dibuang). Bisa 0 kalau minggu itu tidak ada kejadian. */
export interface AnalitikWasteMinggu {
  minggu: RentangMinggu;
  nilaiTotal: number;
  perLokasi: Array<{ lokasiId: number; lokasiNama: string; nilai: number }>;
}

/** Riwayat selisih opname satu lokasi, satu entri per siklus opname yang sudah DISETUJUI,
 * kronologis dari paling lama. `selisihTotal` = jumlah (fisik - sistem) seluruh baris siklus itu:
 * SATUAN CAMPUR antar item, jadi cuma untuk melihat arah tren. Negatif = fisik lebih sedikit
 * dari catatan sistem. */
export interface AnalitikOpnameLokasi {
  lokasiId: number;
  lokasiNama: string;
  siklus: Array<{ tanggal: string; selisihTotal: number }>;
}

/** Response GET /analitik/operasional. `wasteTren` & `transferSusutTren` selalu 8 titik, indeks 0 =
 * minggu PALING LAMA, indeks terakhir = minggu periode yang diminta.
 *
 * `transferSusutTren` SENGAJA TIDAK ikut filter ?lokasi= -- satu transfer menyentuh dua lokasi
 * (asal & tujuan), jadi angkanya selalu agregat CK -> semua outlet. `susutTotal` = jumlah
 * (qty kirim - qty terima), SATUAN CAMPUR antar item (bukan rupiah). */
/** Satu titik tren HPP/cost-of-goods-sold penjualan (migrasi 0028), bagian dari `cogsTren` di
 * `AnalitikOperasional` -- pola IDENTIK dengan `wasteTren`/`transferSusutTren` (8 titik, indeks 0 =
 * minggu paling lama). `totalCogs` = SUM(qty x hppSaatTransaksi) baris penjualan minggu itu; baris
 * dengan `hppSaatTransaksi` null (HPP pending saat transaksi, atau baris lama belum di-backfill)
 * dihitung 0, bukan dibuang -- barisnya TETAP ikut `jumlahBaris`. `jumlahBarisEstimasi` = subset
 * `jumlahBaris` yang `hppSumber` = 'snapshot_estimasi' (lihat `HppSumber`). */
export interface AnalitikCogsMinggu {
  minggu: RentangMinggu;
  totalCogs: number;
  jumlahBaris: number;
  jumlahBarisEstimasi: number;
}

export interface AnalitikOperasional {
  wasteTren: AnalitikWasteMinggu[];
  opnameSelisihTren: AnalitikOpnameLokasi[];
  transferSusutTren: Array<{ minggu: RentangMinggu; susutTotal: number }>;
  /** Tren HPP/cost of goods sold penjualan, 8 minggu sama seperti tren lain di atas. */
  cogsTren: AnalitikCogsMinggu[];
  /** `true` kalau ADA baris penjualan (lintas waktu PENUH, bukan cuma jendela 8 minggu `cogsTren`,
   * dibatasi `lokasiId` kalau filter itu diisi) yang `hppSumber` = 'snapshot_estimasi'. Dipakai
   * untuk catatan transparansi "sebagian data di bawah ini adalah estimasi dari harga saat ini,
   * bukan harga historis asli" -- bukan indikasi kegagalan. */
  adaDataEstimasi: boolean;
  /** Tanggal ("YYYY-MM-DD") transaksi penjualan PALING AWAL yang `hppSumber` = 'snapshot_asli'.
   * `null` kalau belum ada satu pun baris `snapshot_asli` (mis. seluruh data yang ada masih
   * estimasi) -- SENGAJA lintas waktu penuh, tidak dibatasi jendela 8 minggu `cogsTren`. */
  tanggalMulaiDataAsli: string | null;
  insight: string[];
}

/** Filter bersama kedua endpoint analitik. Dua-duanya opsional: `periode` kosong = minggu hari ini
 * menurut server, `lokasi` null/undefined = agregat semua lokasi. */
export interface AnalitikFilter {
  /** Tanggal MANA PUN dalam minggu yang mau dilihat, "YYYY-MM-DD". */
  periode?: string;
  lokasi?: number | null;
}

export interface ApiErrorBody {
  error: string;
}
