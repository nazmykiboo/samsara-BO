import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox, ResultBox, WarningBox } from "../../components/ResultBox";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useAuth } from "../../auth/AuthContext";
import { usePermission } from "../../auth/usePermission";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { listStafAtLocation } from "../../api/auth";
import {
  batchCreateJadwalShift,
  batchDeleteJadwalShift,
  createJadwalShift,
  deleteJadwalShift,
  getJadwalGrid,
  listJadwalShift,
  listShiftTemplate,
  salinMingguJadwal,
  updateJadwalShift,
} from "../../api/hr";
import { ApiError } from "../../api/client";
import { todayIso } from "../../utils/format";
import type {
  BatchHapusHasil,
  BatchJadwalHasil,
  JadwalGridResponse,
  JadwalGridStaf,
  JadwalShiftListItem,
  SalinMingguJadwalResult,
  ShiftTemplateListItem,
  StafOption,
} from "../../api/types";

/** Format Date LOKAL jadi "YYYY-MM-DD" tanpa pernah lewat `.toISOString()` (yang
 * mengonversi ke UTC dan menggeser tanggal untuk timezone di depan UTC, lihat
 * catatan `addDaysIso` di bawah). */
function formatIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Senin minggu berjalan (acuan: tanggal hari ini di device user). Dipakai sebagai titik awal
 * navigasi minggu -- SELALU dipertahankan sebagai hari Senin karena navigasi selanjutnya cuma
 * geser +/-7 hari dari sini, jadi tidak perlu dihitung ulang mondaynya tiap kali. */
function mondayIso(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = copy.getDay(); // 0=Minggu
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return formatIsoLocal(copy);
}

/** BUG serius yang diperbaiki di sini (ditemukan lewat verifikasi live "Salin dari minggu lalu"):
 * versi lama parse `iso` sebagai tengah malam LOKAL lalu `.toISOString()` (konversi ke UTC) --
 * untuk Asia/Jakarta (UTC+7) ini menggeser tanggal MUNDUR satu hari di SETIAP pemanggilan (tengah
 * malam WIB = 17:00 hari sebelumnya UTC). Efeknya BUKAN cuma kosmetik: dialog konfirmasi "Salin
 * dari minggu lalu" menampilkan rentang minggu yang salah, dan nilai itu ikut dikirim ke
 * `salinMingguJadwal` -- backend `mondayOfWeek()` lalu membulatkan tanggal yang sudah salah itu ke
 * Senin minggu yang BERBEDA sama sekali (satu minggu lebih awal) dari yang dimaksud user, jadi
 * fitur salin-minggu bisa menyalin dari/ke minggu yang SALAH tanpa ada error apa pun.
 *
 * Perbaikan: `iso` diperlakukan sebagai nilai KALENDER murni lewat `Date.UTC` (bukan parse lokal),
 * jadi tidak pernah kena pergeseran timezone sama sekali -- pola identik dengan `addDaysUTC` di
 * `modules/hr/src/domain/jadwal.ts` (backend), supaya kedua sisi selalu sepakat. */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function defaultMinggu(): string {
  return mondayIso(new Date());
}

function jamLabel(hhmmss: string): string {
  return hhmmss.slice(0, 5);
}

function formatTanggalIndo(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatTanggalSingkat(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Pesan tooltip untuk nama staf yang bentrok dengan cuti yang SUDAH disetujui. Kondisi normal yang
 * perlu dicek manusia, BUKAN error: backend tetap menyimpan jadwalnya. */
const PESAN_KONFLIK_CUTI =
  "Staf ini sedang cuti yang sudah disetujui pada tanggal ini -- jadwal tetap tersimpan, cek lagi sebelum shift berjalan.";

/** Kunci satu SEL grid = satu hari x satu shift. Dipakai sebagai kunci map chip "belum tersimpan"
 * (pending) dan penanda sel mana yang sedang disimpan. Sengaja sama bentuknya dengan satu panggilan
 * `batchCreateJadwalShift` (satu tanggal + satu shift + banyak staf) -- satu sel = satu batch. */
function kunciSel(tanggal: string, shiftTemplateId: string): string {
  return `${tanggal}|${shiftTemplateId}`;
}

/** Pindahkan staf yang userId-nya = user yang login ke INDEX 0 tanpa mengubah urutan nama lain
 * (sengaja bukan `.sort()` supaya urutan dari backend tetap utuh untuk nama-nama sisanya). */
function urutkanNamaSendiriDulu(staf: JadwalGridStaf[], userIdSendiri: string | null): JadwalGridStaf[] {
  if (!userIdSendiri) return staf;
  const idx = staf.findIndex((s) => s.userId === userIdSendiri);
  if (idx <= 0) return staf;
  const urut = staf.slice();
  const [milikSendiri] = urut.splice(idx, 1);
  urut.unshift(milikSendiri);
  return urut;
}

export function JadwalTab() {
  const { user } = useAuth();
  const bisaKelola = usePermission("jadwal.manage");
  if (!user) return null;
  // Staf/supervisor TIDAK pernah mendapat tampilan kelola -- tidak ada tombol tambah/ubah/pindah/
  // hapus/salin minggu sama sekali untuk mereka (backend jadwal.manage juga menolak).
  return bisaKelola ? <JadwalKelolaView /> : <JadwalReadOnlyView />;
}

/** Kartu navigasi minggu (Minggu sebelumnya/berikutnya + rentang tanggal) -- dipakai sama-sama oleh
 * tampilan read-only (staf/supervisor) dan tampilan kelola (owner/manajer_ops). `anak` opsional untuk
 * menyisipkan kontrol tambahan di atas navigasi (mis. picker lokasi). */
function NavigasiMinggu({
  minggu,
  grid,
  onPrev,
  onNext,
  anak,
}: {
  minggu: string;
  grid: JadwalGridResponse | null;
  onPrev: () => void;
  onNext: () => void;
  anak?: ReactNode;
}) {
  const mulai = grid?.mingguMulai ?? minggu;
  const selesai = grid?.mingguSelesai ?? addDaysIso(minggu, 6);
  return (
    <Card>
      <div className="space-y-3">
        {anak}
        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" className="px-3 py-2 text-sm" onClick={onPrev}>
            &lsaquo; Minggu sebelumnya
          </Button>
          <Button variant="secondary" className="px-3 py-2 text-sm" onClick={onNext}>
            Minggu berikutnya &rsaquo;
          </Button>
        </div>
        <p className="text-center text-sm font-medium text-slate-700">
          {formatTanggalSingkat(mulai)} - {formatTanggalSingkat(selesai)}
          {grid ? <span className="block text-xs font-normal text-slate-400">{grid.lokasiName}</span> : null}
        </p>
      </div>
    </Card>
  );
}

/** Aksi yang tersedia saat nama staf di grid diketuk (mode kelola saja). "Pindah" secara teknis sama
 * dengan "ubah tanggal/shift" (PATCH yang sama) -- dipisah cuma supaya maksudnya jelas untuk manajer. */
interface AksiStafGrid {
  onUbah: () => void;
  onPindah: () => void;
  onHapus: () => void;
}

/** Kontrol tambahan mode kelola untuk grid, di luar menu per nama (`getActionsFor`):
 *  1. "+ tambah staf" per sel -- input ketik + autocomplete nama staf di lokasi itu, hasil ketikan jadi
 *     chip PENDING (belum dikirim ke server) sampai tombol "Simpan" di sel itu ditekan.
 *  2. Mode pilih-banyak -- chip TERSIMPAN jadi bisa dicentang untuk dihapus massal.
 *
 * Sengaja opsional dan dikumpulkan jadi SATU objek (bukan sederet prop lepas) supaya tampilan
 * read-only/cetak cukup tidak mengirimnya sama sekali, persis seperti `getActionsFor`. */
interface AksiBatchGrid {
  /** Daftar staf aktif di lokasi yang sedang dilihat -- sumber saran autocomplete, difilter di sisi
   * UI (dataset per lokasi kecil, 5-10 orang, jadi tidak perlu endpoint pencarian). */
  stafLokasi: StafOption[];
  stafLokasiLoading: boolean;
  stafLokasiError: string | null;
  /** Kunci `kunciSel(tanggal, shiftTemplateId)` -> staf yang sudah diketik tapi BELUM disimpan. */
  pendingPerSel: Record<string, StafOption[]>;
  onTambahPending: (kunci: string, staf: StafOption) => void;
  onHapusPending: (kunci: string, userId: string) => void;
  onSimpanSel: (tanggal: string, shiftTemplateId: string) => void;
  /** Kunci sel yang panggilan batch-nya sedang jalan (null = tidak ada) -- sel lain tetap bisa dipakai. */
  selSedangSimpan: string | null;
  modePilihBanyak: boolean;
  /** id baris jadwal yang tercentang, lintas SEMUA hari/shift di grid yang sedang tampil. */
  terpilih: Set<string>;
  onTogglePilih: (idJadwal: string) => void;
  /** id baris jadwal untuk satu nama di satu sel, atau null kalau barisnya tidak ketemu di daftar
   * datar (chip itu lalu tidak bisa dicentang -- sama alasannya dengan getActionsFor yang null). */
  idJadwalUntuk: (tanggal: string, shiftTemplateId: string, userId: string) => string | null;
}

/** Tampilan grid mingguan (kolom hari x baris shift), dipakai sama-sama oleh tampilan read-only
 * dan kelola -- untuk mobile-first, tiap hari dirender sebagai kartu terpisah (scroll vertikal),
 * dengan baris per shift di dalamnya, bukan tabel lebar yang perlu scroll horizontal.
 * `getActionsFor` opsional: kalau diisi, nama staf bisa diketuk untuk membuka menu kecil
 * "Ubah / Pindah / Hapus" (mode kelola); kalau TIDAK diisi, nama tampil polos tanpa aksi apa pun
 * -- ini juga yang dipakai "tampilan ringkas/cetak" supaya grid otomatis read-only.
 * `batch` opsional: kontrol tambah-banyak-staf per sel + mode pilih-banyak (lihat AksiBatchGrid).
 *
 * Highlight "nama kamu sendiri" sengaja ditaruh di SINI (bukan di pemanggil) supaya otomatis berlaku
 * untuk SEMUA role -- staf/supervisor yang cuma punya tampilan read-only ikut kebagian. */
function JadwalGridView({
  grid,
  getActionsFor,
  batch,
}: {
  grid: JadwalGridResponse;
  getActionsFor?: (tanggal: string, shiftTemplateId: string, staf: JadwalGridStaf) => AksiStafGrid | null;
  batch?: AksiBatchGrid;
}) {
  const { user } = useAuth();
  // id BIGINT dari backend selalu string di grid, sedangkan AuthUser.id number -- samakan bentuknya
  // dulu, kalau tidak perbandingannya selalu false dan highlight tidak pernah muncul.
  const userIdSendiri = user ? String(user.id) : null;

  // Menu per nama staf: cuma satu yang terbuka sekaligus, dikunci pakai tanggal+shift+user supaya
  // orang yang sama di dua hari berbeda tidak ikut terbuka bersamaan.
  const [menuTerbuka, setMenuTerbuka] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {/* Lapisan transparan untuk menutup menu saat user mengetuk di luar menu. */}
      {menuTerbuka !== null ? (
        <div className="fixed inset-0 z-10" aria-hidden onClick={() => setMenuTerbuka(null)} />
      ) : null}

      {grid.hari.map((hari) => (
        <Card key={hari.tanggal}>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">{formatTanggalIndo(hari.tanggal)}</h3>
          <div className="space-y-2">
            {hari.shift.map((shift) => {
              const kunciSelIni = kunciSel(hari.tanggal, shift.shiftTemplateId);
              const pending = batch?.pendingPerSel[kunciSelIni] ?? [];
              // Nama user sendiri selalu paling depan supaya staf langsung lihat shift-nya sendiri.
              const stafUrut = urutkanNamaSendiriDulu(shift.staf, userIdSendiri);
              // Jangan tawarkan nama yang sudah ada di sel ini -- baik yang sudah tersimpan maupun
              // yang masih berstatus pending.
              const sudahAdaDiSel = new Set<string>([
                ...shift.staf.map((s) => s.userId),
                ...pending.map((p) => p.id),
              ]);
              const sedangSimpanSel = batch?.selSedangSimpan === kunciSelIni;
              const adaIsi = stafUrut.length > 0 || pending.length > 0;
              // Tombol "+ tambah" disembunyikan selama mode pilih-banyak supaya sel tidak ramai dan
              // dropdown saran tidak menutupi centang. Chip pending + tombol Simpan tetap tampil.
              const adaTombolTambah = batch !== undefined && !batch.modePilihBanyak;
              return (
                <div key={shift.shiftTemplateId} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-xs font-medium text-slate-500">
                    {shift.shiftTemplateNama} ({jamLabel(shift.jamMulai)}-{jamLabel(shift.jamSelesai)})
                  </p>
                  {!adaIsi && !adaTombolTambah ? (
                    <p className="mt-1.5 text-sm text-slate-400">Belum ada staf dijadwalkan</p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {stafUrut.map((s) => {
                        const milikSendiri = s.userId === userIdSendiri;
                        const idJadwal =
                          batch?.idJadwalUntuk(hari.tanggal, shift.shiftTemplateId, s.userId) ?? null;
                        const bisaDipilih = batch?.modePilihBanyak === true && idJadwal !== null;
                        const tercentang = bisaDipilih && batch!.terpilih.has(idJadwal!);
                        // Selama mode pilih-banyak, menu Ubah/Pindah/Hapus DIMATIKAN -- ketukan chip
                        // dipakai untuk mencentang, supaya dua perilaku itu tidak tabrakan.
                        const actions = batch?.modePilihBanyak
                          ? null
                          : getActionsFor?.(hari.tanggal, shift.shiftTemplateId, s) ?? null;
                        const kunci = `${hari.tanggal}|${shift.shiftTemplateId}|${s.userId}`;
                        const gayaChip = gayaChipTersimpan(s.konflikCuti, milikSendiri, tercentang);
                        const isiChip = (
                          <>
                            {bisaDipilih ? <span aria-hidden>{tercentang ? "☑" : "☐"}</span> : null}
                            {s.konflikCuti ? <span aria-hidden>⚠</span> : null}
                            {s.userName}
                            {milikSendiri ? (
                              <span className="text-[11px] font-semibold">(Kamu)</span>
                            ) : null}
                          </>
                        );
                        const kelasChip = `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm ${gayaChip}`;
                        return (
                          <span key={s.userId} className="relative inline-flex">
                            {bisaDipilih ? (
                              <button
                                type="button"
                                aria-pressed={tercentang}
                                title={
                                  s.konflikCuti
                                    ? PESAN_KONFLIK_CUTI
                                    : "Ketuk untuk memilih/batal memilih jadwal ini"
                                }
                                onClick={() => batch!.onTogglePilih(idJadwal!)}
                                className={kelasChip}
                              >
                                {isiChip}
                              </button>
                            ) : actions ? (
                              <button
                                type="button"
                                title={s.konflikCuti ? PESAN_KONFLIK_CUTI : "Ketuk untuk ubah, pindahkan, atau hapus jadwal ini"}
                                onClick={() => setMenuTerbuka((cur) => (cur === kunci ? null : kunci))}
                                className={kelasChip}
                              >
                                {isiChip}
                                <span aria-hidden className="text-[10px] opacity-60">
                                  ▾
                                </span>
                              </button>
                            ) : (
                              <span title={s.konflikCuti ? PESAN_KONFLIK_CUTI : undefined} className={kelasChip}>
                                {isiChip}
                              </span>
                            )}

                            {actions && menuTerbuka === kunci ? (
                              <div className="absolute left-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg">
                                <MenuAksiItem
                                  label="Ubah"
                                  onClick={() => {
                                    setMenuTerbuka(null);
                                    actions.onUbah();
                                  }}
                                />
                                <MenuAksiItem
                                  label="Pindah"
                                  onClick={() => {
                                    setMenuTerbuka(null);
                                    actions.onPindah();
                                  }}
                                />
                                <MenuAksiItem
                                  label="Hapus"
                                  danger
                                  onClick={() => {
                                    setMenuTerbuka(null);
                                    actions.onHapus();
                                  }}
                                />
                              </div>
                            ) : null}
                          </span>
                        );
                      })}

                      {/* Nama yang sudah diketik tapi BELUM dikirim ke server -- garis putus-putus. */}
                      {pending.map((p) => (
                        <span
                          key={`pending-${p.id}`}
                          title="Belum tersimpan -- tekan Simpan di bawah untuk menyimpan"
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-blue-400 bg-white px-2.5 py-1 text-sm text-blue-700"
                        >
                          {p.name}
                          <button
                            type="button"
                            aria-label={`Batalkan ${p.name}`}
                            title={`Batalkan ${p.name} (belum tersimpan)`}
                            onClick={() => batch?.onHapusPending(kunciSelIni, p.id)}
                            className="text-xs leading-none text-blue-500 hover:text-blue-800"
                          >
                            ✕
                          </button>
                        </span>
                      ))}

                      {batch && adaTombolTambah ? (
                        <TambahStafSel
                          label={adaIsi ? "+ tambah" : "+ Tambah staf"}
                          stafLokasi={batch.stafLokasi}
                          stafLokasiLoading={batch.stafLokasiLoading}
                          stafLokasiError={batch.stafLokasiError}
                          sudahAda={sudahAdaDiSel}
                          onPilih={(staf) => batch.onTambahPending(kunciSelIni, staf)}
                        />
                      ) : null}
                    </div>
                  )}

                  {batch && pending.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      <Button
                        className="px-3 py-1.5 text-xs"
                        disabled={sedangSimpanSel}
                        onClick={() => batch.onSimpanSel(hari.tanggal, shift.shiftTemplateId)}
                      >
                        {sedangSimpanSel
                          ? "Menyimpan..."
                          : `Simpan ${pending.length} nama ke shift ini`}
                      </Button>
                      <p className="text-xs text-slate-500">
                        Nama bergaris putus-putus belum tersimpan. Tekan Simpan supaya masuk jadwal.
                      </p>
                    </div>
                  ) : null}

                  {shift.staf.some((s) => s.konflikCuti) ? (
                    <p className="mt-1.5 text-xs text-amber-700">
                      Nama bertanda ⚠ sedang cuti yang sudah disetujui pada tanggal ini.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Gaya chip nama yang SUDAH tersimpan. Tiga penanda bisa menumpuk sekaligus dan SEMUANYA harus tetap
 * kebaca -- sengaja digabung, bukan saling menimpa:
 *  - `konflikCuti` -> border/latar amber (peringatan, bukan error),
 *  - `milikSendiri` -> tebal + warna biru (pola "milik sendiri" yang sama dengan nav aktif) + label "(Kamu)",
 *  - `tercentang` (mode pilih-banyak) -> cincin biru di luar border asal. */
function gayaChipTersimpan(konflikCuti: boolean, milikSendiri: boolean, tercentang: boolean): string {
  const dasar = konflikCuti
    ? `border-amber-400 bg-amber-50 ${milikSendiri ? "font-semibold text-blue-800" : "text-amber-900"}`
    : milikSendiri
      ? "border-blue-300 bg-blue-50 font-semibold text-blue-700"
      : "border-transparent bg-slate-100 text-slate-800";
  return `border ${dasar}${tercentang ? " ring-2 ring-blue-500" : ""}`;
}

/** Input ketik + daftar saran nama staf, DI DALAM satu sel shift (mode kelola). Nama yang dipilih
 * TIDAK langsung dikirim ke server -- dilempar ke pemanggil jadi chip "pending" dulu, supaya manajer
 * bisa mengetik beberapa nama lalu menyimpannya sekali jalan (satu panggilan batch per sel).
 *
 * Saran diambil dari daftar staf lokasi yang sudah di-fetch sekali di level atas lalu DIFILTER di sini
 * (dataset per lokasi cuma 5-10 orang) -- tidak ada endpoint pencarian dan tidak perlu ada.
 * Input tetap terbuka setelah satu nama dipilih supaya bisa langsung ketik nama berikutnya. */
function TambahStafSel({
  label,
  stafLokasi,
  stafLokasiLoading,
  stafLokasiError,
  sudahAda,
  onPilih,
}: {
  label: string;
  stafLokasi: StafOption[];
  stafLokasiLoading: boolean;
  stafLokasiError: string | null;
  /** userId yang sudah ada di sel ini (tersimpan + pending) -- tidak ikut jadi saran. */
  sudahAda: Set<string>;
  onPilih: (staf: StafOption) => void;
}) {
  const [terbuka, setTerbuka] = useState(false);
  const [query, setQuery] = useState("");
  const [sorotan, setSorotan] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const q = query.trim().toLowerCase();
  const saran = stafLokasi
    .filter((s) => !sudahAda.has(s.id) && (q === "" || s.name.toLowerCase().includes(q)))
    .slice(0, 8);
  // Sorotan bisa menggantung di luar jangkauan setelah daftar menyusut (ketikan bertambah) -- jepit
  // di sini supaya Enter tidak pernah memilih undefined.
  const idxSorotan = saran.length === 0 ? -1 : Math.min(sorotan, saran.length - 1);

  function pilih(staf: StafOption) {
    onPilih(staf);
    setQuery("");
    setSorotan(0);
    // Tetap terbuka + fokus dikembalikan ke input: manajer biasanya mengetik beberapa nama berurutan.
    inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSorotan((n) => (saran.length === 0 ? 0 : Math.min(n + 1, saran.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSorotan((n) => Math.max(n - 1, 0));
    } else if (e.key === "Enter") {
      // Form terdekat TIDAK boleh ikut tersubmit -- sel ini bukan bagian dari form, tapi jaga-jaga.
      e.preventDefault();
      if (idxSorotan >= 0) pilih(saran[idxSorotan]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      tutup();
    }
  }

  function tutup() {
    setTerbuka(false);
    setQuery("");
    setSorotan(0);
  }

  if (!terbuka) {
    return (
      <button
        type="button"
        onClick={() => setTerbuka(true)}
        className="inline-flex items-center rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-sm text-blue-700 hover:border-blue-400 hover:bg-blue-50"
      >
        {label}
      </button>
    );
  }

  return (
    <span className="relative inline-block w-full max-w-[16rem]">
      <span className="flex items-center gap-1">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSorotan(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ketik nama staf..."
          aria-label="Ketik nama staf untuk ditambahkan ke shift ini"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={tutup}
          className="shrink-0 px-1 text-xs text-slate-500 hover:text-slate-800"
        >
          Tutup
        </button>
      </span>

      <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg">
        {stafLokasiLoading ? (
          <p className="px-3 py-2 text-xs text-slate-500">Memuat daftar staf...</p>
        ) : stafLokasiError ? (
          <p className="px-3 py-2 text-xs text-red-600">{stafLokasiError}</p>
        ) : saran.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-500">
            {q === ""
              ? "Semua staf di lokasi ini sudah ada di shift ini."
              : "Tidak ada nama yang cocok di lokasi ini."}
          </p>
        ) : (
          saran.map((s, i) => (
            <button
              key={s.id}
              type="button"
              // onMouseDown (bukan onClick): input kehilangan fokus dulu kalau pakai onClick, dan di
              // beberapa browser blur bisa menutup daftar sebelum kliknya terbaca.
              onMouseDown={(e) => {
                e.preventDefault();
                pilih(s);
              }}
              onMouseEnter={() => setSorotan(i)}
              className={`block w-full px-3 py-2 text-left text-sm ${
                i === idxSorotan ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {s.name}
            </button>
          ))
        )}
      </div>
    </span>
  );
}

function MenuAksiItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
        danger ? "text-red-600" : "text-slate-700"
      }`}
    >
      {label}
    </button>
  );
}

/** Tampilan read-only untuk supervisor/staf -- grid mingguan "siapa teman se-shift", lokasi otomatis
 * diambil dari lokasi user sendiri (dikirim sekadar informasi, backend tetap memaksa ke lokasi user
 * kalau beda/kosong). JANGAN kirim lokasiId lokasi lain dari sini. */
function JadwalReadOnlyView() {
  const { user } = useAuth();
  const [minggu, setMinggu] = useState(defaultMinggu());
  const [grid, setGrid] = useState<JadwalGridResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modeCetak, setModeCetak] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getJadwalGrid({ lokasi: user?.locationIds[0], minggu })
      .then((res) => {
        if (active) setGrid(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat jadwal.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [minggu, user]);

  return (
    <div className="space-y-4">
      {!modeCetak ? (
        <NavigasiMinggu
          minggu={minggu}
          grid={grid}
          onPrev={() => setMinggu((m) => addDaysIso(m, -7))}
          onNext={() => setMinggu((m) => addDaysIso(m, 7))}
        />
      ) : null}

      <TombolModeCetak modeCetak={modeCetak} onToggle={() => setModeCetak((v) => !v)} />

      {modeCetak ? <JudulMingguRingkas minggu={minggu} grid={grid} /> : null}

      {loading ? <Spinner label="Memuat jadwal..." /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {!loading && !error && grid ? <JadwalGridView grid={grid} /> : null}
    </div>
  );
}

/** Tombol kecil untuk masuk/keluar "tampilan ringkas" (grid tanpa kontrol apa pun, enak
 * discreenshot/dicetak lalu dikirim ke grup outlet). */
function TombolModeCetak({ modeCetak, onToggle }: { modeCetak: boolean; onToggle: () => void }) {
  return (
    <Button variant="secondary" className="w-full px-3 py-2 text-sm" onClick={onToggle}>
      {modeCetak ? "Kembali ke tampilan biasa" : "Tampilan ringkas (untuk dicetak/difoto)"}
    </Button>
  );
}

/** Judul minggu + nama lokasi saat mode ringkas aktif -- pengganti kartu navigasi yang disembunyikan,
 * supaya hasil screenshot tetap jelas minggu dan lokasi mana. */
function JudulMingguRingkas({ minggu, grid }: { minggu: string; grid: JadwalGridResponse | null }) {
  const mulai = grid?.mingguMulai ?? minggu;
  const selesai = grid?.mingguSelesai ?? addDaysIso(minggu, 6);
  return (
    <div className="text-center">
      <p className="text-base font-semibold text-slate-900">Jadwal Shift</p>
      <p className="text-sm text-slate-600">
        {formatTanggalSingkat(mulai)} - {formatTanggalSingkat(selesai)}
      </p>
      {grid ? <p className="text-xs text-slate-500">{grid.lokasiName}</p> : null}
    </div>
  );
}

/** Ringkasan hasil satu panggilan batch (simpan banyak nama / hapus banyak jadwal), dalam bahasa yang
 * dipakai tim outlet. `nada` menentukan kotak mana yang dipakai:
 *  - "ok": semua tersimpan/terhapus (hijau, ResultBox),
 *  - "perhatian": sebagian berhasil, atau berhasil tapi ada yang bentrok cuti (kuning, WarningBox --
 *    bentrok cuti BUKAN kegagalan, barisnya tetap tersimpan),
 *  - "gagal": tidak ada satu pun yang berhasil (merah, ErrorBox). */
interface PesanBatch {
  nada: "ok" | "perhatian" | "gagal";
  teks: string;
}

/** Terjemahkan array hasil POST /jadwal/batch jadi satu kalimat ringkas.
 * Array hasil dibaca PER ITEM -- endpoint selalu balas 200, jadi tidak ada error yang terlempar untuk
 * item yang gagal (lihat catatan BatchJadwalHasil). */
function ringkasHasilSimpanBatch(hasil: BatchJadwalHasil[], namaPerUserId: Map<string, string>): PesanBatch {
  const sukses = hasil.filter((h) => h.success);
  const gagal = hasil.filter((h) => !h.success);
  const bentrok = sukses.filter((h) => h.konflikCuti).length;

  const bagian: string[] = [`${sukses.length} nama tersimpan`];
  if (bentrok > 0) {
    bagian.push(
      `${bentrok} di antaranya sedang cuti yang sudah disetujui (jadwalnya TETAP tersimpan, cek lagi sebelum shift berjalan)`,
    );
  }
  if (gagal.length > 0) {
    const rincian = gagal
      .map((g) => `${namaPerUserId.get(g.userId) ?? `staf #${g.userId}`}: ${g.error ?? "sebab tidak diketahui"}`)
      .join("; ");
    bagian.push(`${gagal.length} gagal (${rincian})`);
  }

  return {
    nada: sukses.length === 0 ? "gagal" : gagal.length > 0 || bentrok > 0 ? "perhatian" : "ok",
    teks: `${bagian.join(", ")}.`,
  };
}

/** Versi hapus massal dari ringkasHasilSimpanBatch -- pola response-nya identik. */
function ringkasHasilHapusBatch(hasil: BatchHapusHasil[]): PesanBatch {
  const sukses = hasil.filter((h) => h.success).length;
  const gagal = hasil.filter((h) => !h.success);
  if (gagal.length === 0) return { nada: "ok", teks: `${sukses} jadwal dihapus.` };
  const rincian = gagal.map((g) => g.error ?? "sebab tidak diketahui").join("; ");
  return {
    nada: sukses === 0 ? "gagal" : "perhatian",
    teks: `${sukses} jadwal dihapus, ${gagal.length} gagal dihapus (${rincian}).`,
  };
}

/** Kotak pesan untuk ringkasan batch -- warna mengikuti `nada` (lihat PesanBatch). */
function KotakPesanBatch({ pesan }: { pesan: PesanBatch }) {
  if (pesan.nada === "ok") return <ResultBox>{pesan.teks}</ResultBox>;
  if (pesan.nada === "perhatian") return <WarningBox>{pesan.teks}</WarningBox>;
  return <ErrorBox>{pesan.teks}</ErrorBox>;
}

/** Tampilan kelola untuk owner/manajer_ops -- pilih lokasi + navigasi minggu, grid mingguan yang nama
 * stafnya bisa diketuk untuk menu "Ubah / Pindah / Hapus", plus tombol "+ Tambah shift" dan "Salin dari
 * minggu lalu". Form tambah/ubah/pindah/hapus tetap pakai endpoint /jadwal-shift (baris datar) yang sudah
 * ada -- grid cuma TAMPILAN-nya, bukan sumber datanya untuk aksi tulis (grid tidak punya id baris, jadi
 * diambil dari daftar datar `listJadwalShift` yang di-fetch diam-diam untuk rentang minggu yang sama,
 * lalu dicocokkan lewat tanggal+shiftTemplateId+userId). */
function JadwalKelolaView() {
  const options = useLokasiOptions();
  const [lokasiId, setLokasiId] = useState<number | null>(options[0]?.id ?? null);
  const [minggu, setMinggu] = useState(defaultMinggu());
  const [grid, setGrid] = useState<JadwalGridResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flatRows, setFlatRows] = useState<JadwalShiftListItem[]>([]);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [modeCetak, setModeCetak] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [modeForm, setModeForm] = useState<ModeFormJadwal>("tambah");
  const [editing, setEditing] = useState<JadwalShiftListItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Peringatan NON-BLOKIR setelah simpan: baris jadwalnya TETAP tersimpan walau bentrok cuti.
  const [peringatanKonflik, setPeringatanKonflik] = useState<string | null>(null);

  // "Salin dari minggu lalu" -- idempoten di backend, jadi aman kalau manajer menekannya dua kali.
  const [salinKonfirmasi, setSalinKonfirmasi] = useState(false);
  const [salinLoading, setSalinLoading] = useState(false);
  const [salinHasil, setSalinHasil] = useState<SalinMingguJadwalResult | null>(null);
  const [salinError, setSalinError] = useState<string | null>(null);

  // --- Tambah banyak staf sekaligus per sel ("chip pending" yang belum dikirim ke server) ---
  // Kunci map = kunciSel(tanggal, shiftTemplateId), SATU sel = SATU panggilan batch. State-nya ditaruh
  // di level ini (bukan di dalam sel) supaya bisa dibuang serentak saat lokasi/minggu berganti --
  // kalau disimpan di dalam komponen sel, chip yang belum disimpan bisa "nyasar" ke tanggal lain.
  const [pendingPerSel, setPendingPerSel] = useState<Record<string, StafOption[]>>({});
  const [selSedangSimpan, setSelSedangSimpan] = useState<string | null>(null);
  const [hasilBatch, setHasilBatch] = useState<PesanBatch | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  // Daftar staf lokasi untuk saran autocomplete di dalam sel -- di-fetch SEKALI per lokasi di level ini
  // (bukan per sel), lalu difilter di sisi UI. Tidak ada endpoint pencarian staf, dan tidak perlu:
  // satu lokasi cuma 5-10 orang.
  const [stafLokasi, setStafLokasi] = useState<StafOption[]>([]);
  const [stafLokasiLoading, setStafLokasiLoading] = useState(false);
  const [stafLokasiError, setStafLokasiError] = useState<string | null>(null);

  // --- Mode pilih-banyak + hapus massal ---
  const [modePilihBanyak, setModePilihBanyak] = useState(false);
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [hapusMassalKonfirmasi, setHapusMassalKonfirmasi] = useState(false);
  const [hapusMassalLoading, setHapusMassalLoading] = useState(false);

  /** Bersihkan pesan hasil/peringatan yang cuma relevan untuk minggu/lokasi yang sedang dilihat. */
  function resetPesan() {
    setSalinHasil(null);
    setSalinError(null);
    setPeringatanKonflik(null);
    setHasilBatch(null);
    setBatchError(null);
  }

  // Dropdown "Shift" di form tambah/ubah -- cuma template AKTIF, diurutkan urutanTampil. Diambil sekali
  // di level ini (bukan di dalam dialog) karena tidak terikat lokasi, supaya tidak fetch ulang tiap
  // dialog dibuka.
  const [shiftTemplates, setShiftTemplates] = useState<ShiftTemplateListItem[]>([]);
  const [shiftTemplatesLoading, setShiftTemplatesLoading] = useState(true);
  const [shiftTemplatesError, setShiftTemplatesError] = useState<string | null>(null);

  function reload() {
    setReloadCounter((n) => n + 1);
  }

  useEffect(() => {
    let active = true;
    setShiftTemplatesLoading(true);
    setShiftTemplatesError(null);
    listShiftTemplate()
      .then((res) => {
        if (active) setShiftTemplates(res);
      })
      .catch((err) => {
        if (active) setShiftTemplatesError(err instanceof ApiError ? err.message : "Gagal memuat daftar shift.");
      })
      .finally(() => {
        if (active) setShiftTemplatesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadCounter]);

  const shiftTemplateOptions = shiftTemplates
    .filter((t) => t.aktif)
    .slice()
    .sort((a, b) => a.urutanTampil - b.urutanTampil);

  // Grid untuk tampilan utama.
  useEffect(() => {
    if (lokasiId === null) {
      setGrid(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    getJadwalGrid({ lokasi: lokasiId, minggu })
      .then((res) => {
        if (active) setGrid(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat jadwal.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [lokasiId, minggu, reloadCounter]);

  // Daftar datar untuk rentang minggu yang sama -- dipakai cuma untuk mencari id baris jadwal saat
  // user klik "Ubah"/"Hapus" di grid (grid sendiri tidak membawa id).
  useEffect(() => {
    if (lokasiId === null) {
      setFlatRows([]);
      return;
    }
    let active = true;
    listJadwalShift({ dari: minggu, sampai: addDaysIso(minggu, 6), lokasiId })
      .then((res) => {
        if (active) setFlatRows(res);
      })
      .catch(() => {
        // Diam-diam gagal -- grid tetap tampil, cuma tombol Ubah/Hapus per nama jadi tidak muncul
        // (lihat getActionsFor, mengembalikan null kalau baris tidak ketemu di flatRows).
        if (active) setFlatRows([]);
      });
    return () => {
      active = false;
    };
  }, [lokasiId, minggu, reloadCounter]);

  // Daftar staf lokasi untuk saran autocomplete di dalam sel. Sengaja TIDAK ikut `reloadCounter`:
  // daftar staf tidak berubah gara-gara jadwal berubah.
  useEffect(() => {
    if (lokasiId === null) {
      setStafLokasi([]);
      return;
    }
    let active = true;
    setStafLokasiLoading(true);
    setStafLokasiError(null);
    listStafAtLocation(lokasiId)
      .then((res) => {
        if (active) setStafLokasi(res);
      })
      .catch((err) => {
        if (active) setStafLokasiError(err instanceof ApiError ? err.message : "Gagal memuat daftar staf.");
      })
      .finally(() => {
        if (active) setStafLokasiLoading(false);
      });
    return () => {
      active = false;
    };
  }, [lokasiId]);

  // Ganti lokasi atau minggu = semua yang BELUM tersimpan dibuang, dan semua centang dilepas.
  // SENGAJA tanpa `reloadCounter` di dependency: reload setelah menyimpan satu sel tidak boleh ikut
  // menghapus chip pending di sel LAIN yang belum disimpan.
  useEffect(() => {
    setPendingPerSel({});
    setTerpilih(new Set());
  }, [lokasiId, minggu]);

  const flatMap = new Map<string, JadwalShiftListItem>();
  for (const r of flatRows) {
    if (!r.shiftTemplateId) continue;
    flatMap.set(`${r.tanggal.slice(0, 10)}|${r.shiftTemplateId}|${r.userId}`, r);
  }

  function getActionsFor(tanggal: string, shiftTemplateId: string, staf: JadwalGridStaf): AksiStafGrid | null {
    const row = flatMap.get(`${tanggal}|${shiftTemplateId}|${staf.userId}`);
    if (!row) return null;
    return {
      onUbah: () => {
        resetPesan();
        setEditing(row);
        setModeForm("ubah");
        setFormOpen(true);
      },
      // "Pindah" = ubah tanggal/shift baris yang sama (PATCH /jadwal-shift/:id), bukan endpoint baru.
      onPindah: () => {
        resetPesan();
        setEditing(row);
        setModeForm("pindah");
        setFormOpen(true);
      },
      onHapus: () => {
        resetPesan();
        setDeletingId(row.id);
      },
    };
  }

  const deletingRow = flatRows.find((r) => r.id === deletingId) ?? null;

  async function handleDelete(id: string) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteJadwalShift(id);
      setDeletingId(null);
      reload();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Gagal menghapus jadwal shift.");
    } finally {
      setDeleting(false);
    }
  }

  function idJadwalUntuk(tanggal: string, shiftTemplateId: string, userId: string): string | null {
    return flatMap.get(`${tanggal}|${shiftTemplateId}|${userId}`)?.id ?? null;
  }

  function tambahPending(kunci: string, staf: StafOption) {
    setHasilBatch(null);
    setBatchError(null);
    setPendingPerSel((prev) => {
      const isi = prev[kunci] ?? [];
      // Jaga-jaga kalau nama yang sama tetap masuk dua kali (mis. ketikan sangat cepat sebelum daftar
      // saran di-filter ulang) -- satu orang cukup sekali per sel.
      if (isi.some((s) => s.id === staf.id)) return prev;
      return { ...prev, [kunci]: [...isi, staf] };
    });
  }

  function hapusPending(kunci: string, userId: string) {
    setPendingPerSel((prev) => {
      const isi = (prev[kunci] ?? []).filter((s) => s.id !== userId);
      const next = { ...prev };
      if (isi.length === 0) delete next[kunci];
      else next[kunci] = isi;
      return next;
    });
  }

  /** Simpan semua chip pending di SATU sel lewat satu panggilan batch (satu tanggal + satu shift).
   * Chip pending dibersihkan begitu ada response -- termasuk yang gagal: manajer mengetik ulang
   * sendiri kalau mau coba lagi, tidak ada percobaan ulang otomatis. */
  async function handleSimpanSel(tanggal: string, shiftTemplateId: string) {
    if (lokasiId === null) return;
    const kunci = kunciSel(tanggal, shiftTemplateId);
    const pending = pendingPerSel[kunci] ?? [];
    if (pending.length === 0) return;

    setSelSedangSimpan(kunci);
    setHasilBatch(null);
    setBatchError(null);
    try {
      const hasil = await batchCreateJadwalShift({
        lokasiId,
        tanggal,
        shiftTemplateId: Number(shiftTemplateId),
        userIds: pending.map((s) => Number(s.id)),
      });
      // Endpoint SELALU 200 -- keberhasilan dibaca per entri di sini, bukan dari throw/catch.
      const namaPerUserId = new Map(pending.map((s) => [s.id, s.name]));
      setHasilBatch(ringkasHasilSimpanBatch(hasil, namaPerUserId));
      setPendingPerSel((prev) => {
        const next = { ...prev };
        delete next[kunci];
        return next;
      });
      // Ambil ulang grid supaya data tersimpan (termasuk konflikCuti yang dihitung backend) terlihat.
      reload();
    } catch (err) {
      // Sampai sini cuma kalau permintaannya sendiri gagal total (jaringan mati, 403, body ditolak) --
      // chip pending DIBIARKAN supaya tidak hilang sia-sia dan bisa dicoba simpan ulang.
      setBatchError(
        err instanceof ApiError ? err.message : "Gagal menyimpan nama-nama ini. Coba lagi sebentar.",
      );
    } finally {
      setSelSedangSimpan(null);
    }
  }

  function togglePilih(idJadwal: string) {
    setTerpilih((prev) => {
      const next = new Set(prev);
      if (next.has(idJadwal)) next.delete(idJadwal);
      else next.add(idJadwal);
      return next;
    });
  }

  function keluarModePilihBanyak() {
    setModePilihBanyak(false);
    setTerpilih(new Set());
    setHapusMassalKonfirmasi(false);
  }

  async function handleHapusMassal() {
    const ids = [...terpilih];
    if (ids.length === 0) return;
    setHapusMassalLoading(true);
    setHasilBatch(null);
    setBatchError(null);
    try {
      const hasil = await batchDeleteJadwalShift(ids.map((id) => Number(id)));
      setHasilBatch(ringkasHasilHapusBatch(hasil));
      setHapusMassalKonfirmasi(false);
      setTerpilih(new Set());
      reload();
    } catch (err) {
      setBatchError(
        err instanceof ApiError ? err.message : "Gagal menghapus jadwal terpilih. Coba lagi sebentar.",
      );
      setHapusMassalKonfirmasi(false);
    } finally {
      setHapusMassalLoading(false);
    }
  }

  const mingguSumber = addDaysIso(minggu, -7);

  async function handleSalinMinggu() {
    if (lokasiId === null) return;
    setSalinLoading(true);
    setSalinError(null);
    setSalinHasil(null);
    try {
      const res = await salinMingguJadwal({ lokasiId, mingguSumber, mingguTujuan: minggu });
      setSalinHasil(res);
      setSalinKonfirmasi(false);
      reload();
    } catch (err) {
      setSalinError(err instanceof ApiError ? err.message : "Gagal menyalin jadwal dari minggu lalu.");
      setSalinKonfirmasi(false);
    } finally {
      setSalinLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {!modeCetak ? (
        <>
          <NavigasiMinggu
            minggu={minggu}
            grid={grid}
            onPrev={() => {
              resetPesan();
              setMinggu((m) => addDaysIso(m, -7));
            }}
            onNext={() => {
              resetPesan();
              setMinggu((m) => addDaysIso(m, 7));
            }}
            anak={
              <Field label="Lokasi">
                <Select
                  value={lokasiId ?? ""}
                  onChange={(e) => {
                    resetPesan();
                    setLokasiId(Number(e.target.value));
                  }}
                >
                  <option value="" disabled>
                    Pilih lokasi...
                  </option>
                  {options.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
            }
          />

          <div className="space-y-2">
            <Button
              className="w-full"
              disabled={lokasiId === null}
              onClick={() => {
                resetPesan();
                setEditing(null);
                setModeForm("tambah");
                setFormOpen(true);
              }}
            >
              + Tambah shift
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              disabled={lokasiId === null || salinLoading}
              onClick={() => {
                resetPesan();
                setSalinKonfirmasi(true);
              }}
            >
              {salinLoading ? "Menyalin..." : "Salin dari minggu lalu"}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              disabled={lokasiId === null}
              onClick={() => {
                resetPesan();
                if (modePilihBanyak) keluarModePilihBanyak();
                else setModePilihBanyak(true);
              }}
            >
              {modePilihBanyak ? "Selesai memilih" : "Pilih banyak (untuk hapus sekaligus)"}
            </Button>
            {modePilihBanyak ? (
              <>
                <p className="text-xs text-slate-500">
                  Ketuk nama di jadwal untuk memilihnya. Selama mode ini aktif, menu Ubah/Pindah/Hapus
                  per nama dimatikan dulu.
                </p>
                {terpilih.size > 0 ? (
                  <Button
                    variant="danger"
                    className="w-full"
                    disabled={hapusMassalLoading}
                    onClick={() => setHapusMassalKonfirmasi(true)}
                  >
                    {hapusMassalLoading ? "Menghapus..." : `Hapus terpilih (${terpilih.size})`}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </>
      ) : null}

      <TombolModeCetak
        modeCetak={modeCetak}
        onToggle={() => {
          // Mode ringkas/cetak = tampilan read-only: mode pilih-banyak ikut dimatikan supaya tidak ada
          // centang yang menggantung saat kontrolnya disembunyikan.
          keluarModePilihBanyak();
          setModeCetak((v) => !v);
        }}
      />

      {modeCetak ? <JudulMingguRingkas minggu={minggu} grid={grid} /> : null}

      {!modeCetak && salinError ? <ErrorBox>{salinError}</ErrorBox> : null}
      {!modeCetak && salinHasil ? (
        salinHasil.disalin > 0 ? (
          <ResultBox>
            {salinHasil.disalin} jadwal disalin dari minggu lalu
            {salinHasil.dilewati > 0 ? `, ${salinHasil.dilewati} dilewati karena sudah ada` : ""}.
          </ResultBox>
        ) : (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status">
            {salinHasil.dilewati > 0
              ? `Tidak ada jadwal baru yang ditambahkan -- ${salinHasil.dilewati} jadwal minggu lalu sudah ada di minggu ini.`
              : "Minggu lalu belum ada jadwal di lokasi ini, jadi tidak ada yang bisa disalin."}
          </p>
        )
      ) : null}
      {!modeCetak && peringatanKonflik ? <WarningBox>{peringatanKonflik}</WarningBox> : null}
      {!modeCetak && hasilBatch ? <KotakPesanBatch pesan={hasilBatch} /> : null}
      {!modeCetak && batchError ? <ErrorBox>{batchError}</ErrorBox> : null}

      {loading ? <Spinner label="Memuat jadwal..." /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {deleteError ? <ErrorBox>{deleteError}</ErrorBox> : null}

      {!loading && !error && grid ? (
        <JadwalGridView
          grid={grid}
          getActionsFor={modeCetak ? undefined : getActionsFor}
          // Mode ringkas/cetak: TIDAK dikirim sama sekali, jadi grid otomatis jadi tampilan polos --
          // alasan sama dengan getActionsFor di atas.
          batch={
            modeCetak || lokasiId === null
              ? undefined
              : {
                  stafLokasi,
                  stafLokasiLoading,
                  stafLokasiError,
                  pendingPerSel,
                  onTambahPending: tambahPending,
                  onHapusPending: hapusPending,
                  onSimpanSel: handleSimpanSel,
                  selSedangSimpan,
                  modePilihBanyak,
                  terpilih,
                  onTogglePilih: togglePilih,
                  idJadwalUntuk,
                }
          }
        />
      ) : null}

      {formOpen && lokasiId !== null ? (
        <JadwalShiftFormDialog
          lokasiId={lokasiId}
          mode={modeForm}
          editing={editing}
          shiftTemplates={shiftTemplateOptions}
          shiftTemplatesLoading={shiftTemplatesLoading}
          shiftTemplatesError={shiftTemplatesError}
          onClose={() => setFormOpen(false)}
          onSaved={(konflikCuti) => {
            setFormOpen(false);
            setPeringatanKonflik(konflikCuti ? PESAN_KONFLIK_CUTI : null);
            reload();
          }}
        />
      ) : null}

      {salinKonfirmasi && lokasiId !== null ? (
        <ConfirmDialog
          title="Salin jadwal dari minggu lalu?"
          message={`Semua jadwal lokasi ini pada minggu ${formatTanggalSingkat(mingguSumber)} - ${formatTanggalSingkat(
            addDaysIso(mingguSumber, 6),
          )} akan disalin ke minggu ${formatTanggalSingkat(minggu)} - ${formatTanggalSingkat(
            addDaysIso(minggu, 6),
          )}. Jadwal yang sudah ada tidak diduplikasi.`}
          confirmLabel="Ya, salin"
          loading={salinLoading}
          onConfirm={handleSalinMinggu}
          onCancel={() => setSalinKonfirmasi(false)}
        />
      ) : null}

      {deletingRow ? (
        <ConfirmDialog
          title="Hapus jadwal shift?"
          message={`Shift "${deletingRow.userName}" pada ${formatTanggalIndo(deletingRow.tanggal)} akan dihapus.`}
          danger
          loading={deleting}
          onConfirm={() => handleDelete(deletingRow.id)}
          onCancel={() => setDeletingId(null)}
        />
      ) : null}

      {hapusMassalKonfirmasi && terpilih.size > 0 ? (
        <ConfirmDialog
          title={`Hapus ${terpilih.size} jadwal shift?`}
          message={`${terpilih.size} jadwal yang kamu pilih di minggu ini akan dihapus. Jadwal yang sudah dihapus tidak bisa dikembalikan -- harus dibuat ulang.`}
          confirmLabel={`Ya, hapus ${terpilih.size}`}
          danger
          loading={hapusMassalLoading}
          onConfirm={handleHapusMassal}
          onCancel={() => setHapusMassalKonfirmasi(false)}
        />
      ) : null}
    </div>
  );
}

/** "pindah" memakai PATCH yang SAMA dengan "ubah" -- yang beda cuma judul/label supaya maksudnya jelas
 * untuk manajer ("pindahkan orang ini ke tanggal/shift lain" vs "perbaiki isi baris ini"). */
type ModeFormJadwal = "tambah" | "ubah" | "pindah";

const JUDUL_FORM: Record<ModeFormJadwal, string> = {
  tambah: "Tambah jadwal shift",
  ubah: "Ubah jadwal shift",
  pindah: "Pindahkan jadwal shift",
};

function JadwalShiftFormDialog({
  lokasiId,
  mode,
  editing,
  shiftTemplates,
  shiftTemplatesLoading,
  shiftTemplatesError,
  onClose,
  onSaved,
}: {
  lokasiId: number;
  mode: ModeFormJadwal;
  editing: JadwalShiftListItem | null;
  shiftTemplates: ShiftTemplateListItem[];
  shiftTemplatesLoading: boolean;
  shiftTemplatesError: string | null;
  onClose: () => void;
  /** `konflikCuti` dari response backend -- diteruskan ke pemanggil untuk ditampilkan sebagai
   * peringatan non-blokir (baris jadwalnya sendiri SUDAH tersimpan). */
  onSaved: (konflikCuti: boolean) => void;
}) {
  const pindah = mode === "pindah";
  const [staf, setStaf] = useState<StafOption[]>([]);
  const [stafLoading, setStafLoading] = useState(!editing);
  const [stafError, setStafError] = useState<string | null>(null);

  const [userId, setUserId] = useState(editing?.userId ?? "");
  const [tanggal, setTanggal] = useState(editing ? editing.tanggal.slice(0, 10) : todayIso());
  // Baris jadwal lama (dibuat sebelum migrasi shift template) punya shiftTemplateId null -- dropdown
  // dibiarkan kosong/placeholder, user WAJIB pilih salah satu sebelum simpan (lihat validasi di handleSubmit).
  const [shiftTemplateId, setShiftTemplateId] = useState(editing?.shiftTemplateId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return; // staf tidak bisa diganti saat edit, tidak perlu daftar staf
    let active = true;
    setStafLoading(true);
    setStafError(null);
    listStafAtLocation(lokasiId)
      .then((res) => {
        if (active) setStaf(res);
      })
      .catch((err) => {
        if (active) setStafError(err instanceof ApiError ? err.message : "Gagal memuat daftar staf.");
      })
      .finally(() => {
        if (active) setStafLoading(false);
      });
    return () => {
      active = false;
    };
  }, [lokasiId, editing]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!editing && !userId) {
      setError("Pilih staf dulu.");
      return;
    }
    if (!tanggal) {
      setError("Lengkapi tanggal.");
      return;
    }
    if (!shiftTemplateId) {
      setError("Pilih shift dulu.");
      return;
    }

    setSaving(true);
    try {
      const hasil = editing
        ? await updateJadwalShift(editing.id, { lokasiId, tanggal, shiftTemplateId: Number(shiftTemplateId) })
        : await createJadwalShift({
            userId: Number(userId),
            lokasiId,
            tanggal,
            shiftTemplateId: Number(shiftTemplateId),
          });
      onSaved(hasil.konflikCuti);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan jadwal shift.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold text-slate-900">{JUDUL_FORM[mode]}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          {editing ? (
            <p className="text-sm text-slate-600">
              Staf: <span className="font-medium text-slate-900">{editing.userName}</span>
              <br />
              <span className="text-xs text-slate-400">
                {pindah
                  ? "Pilih tanggal dan/atau shift yang baru. Jadwal ini berpindah -- bukan menambah jadwal baru. Kalau mau mengganti orangnya, hapus jadwal ini lalu buat baru."
                  : "Staf tidak bisa diganti saat ubah -- hapus shift ini lalu buat baru kalau salah staf."}
              </span>
            </p>
          ) : (
            <Field label="Staf">
              {stafLoading ? (
                <p className="text-sm text-slate-500">Memuat daftar staf...</p>
              ) : stafError ? (
                <ErrorBox>{stafError}</ErrorBox>
              ) : (
                <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                  <option value="" disabled>
                    Pilih staf...
                  </option>
                  {staf.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <Field label={pindah ? "Tanggal baru" : "Tanggal"}>
            <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
          </Field>

          <Field label={pindah ? "Shift baru" : "Shift"}>
            {shiftTemplatesLoading ? (
              <p className="text-sm text-slate-500">Memuat daftar shift...</p>
            ) : shiftTemplatesError ? (
              <ErrorBox>{shiftTemplatesError}</ErrorBox>
            ) : shiftTemplates.length === 0 ? (
              <p className="text-sm text-amber-700">
                Belum ada jenis shift aktif -- tambahkan dulu di menu Pengaturan {">"} Shift sebelum bisa
                membuat jadwal.
              </p>
            ) : (
              <Select value={shiftTemplateId} onChange={(e) => setShiftTemplateId(e.target.value)}>
                <option value="" disabled>
                  Pilih shift...
                </option>
                {shiftTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nama} ({jamLabel(t.jamMulai)}-{jamLabel(t.jamSelesai)})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {error ? <ErrorBox>{error}</ErrorBox> : null}

          <div className="flex gap-3">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
              Batal
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? (pindah ? "Memindahkan..." : "Menyimpan...") : pindah ? "Pindahkan" : "Simpan"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
