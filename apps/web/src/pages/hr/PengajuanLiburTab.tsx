import { useEffect, useState, type FormEvent } from "react";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox, ResultBox, WarningBox } from "../../components/ResultBox";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Badge, PengajuanLiburStatusBadge } from "../../components/ui/Badge";
import { useAuth } from "../../auth/AuthContext";
import { usePermission } from "../../auth/usePermission";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { listStafAtLocation } from "../../api/auth";
import {
  createPengajuanLibur,
  getPengajuanLiburKuota,
  listPengajuanLibur,
  overridePengajuanLibur,
  putuskanPengajuanLibur,
} from "../../api/hr";
import { ApiError } from "../../api/client";
import { todayIso } from "../../utils/format";
import type {
  AturanCutiDilanggar,
  KeputusanPengajuanLibur,
  OverridePengajuanLiburResult,
  PengajuanLiburKuota,
  PengajuanLiburListItem,
  StafOption,
} from "../../api/types";

function formatTanggalSingkat(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Penjelasan kuota harian lokasi dalam bahasa staf -- kondisi NORMAL yang perlu diketahui, bukan error.
 * Aturan backend: maksimal 1 cuti disetujui per lokasi per tanggal. */
const PESAN_KUOTA_HARIAN_PENUH =
  "Di tanggal itu sudah ada staf lain di lokasimu yang cutinya disetujui, jadi kuota libur harian lokasi sudah penuh -- pengajuanmu tetap terkirim, tapi peluang disetujui lebih kecil. Kalau ada teman yang bersedia menggantikan, isi kolom \"Nama pengganti\" supaya atasan lebih mudah menyetujui.";

/** Nama aturan cuti dalam bahasa manusia -- jangan pernah tampilkan kode mentahnya ke manajer. */
const LABEL_ATURAN: Record<AturanCutiDilanggar, string> = {
  h2_minimum: "Kurang dari H-2",
  kuota_harian_lokasi: "Kuota harian lokasi penuh",
  kuota_bulanan_staf: "Melebihi kuota bulanan staf",
};

/** Selisih hari tanggal `iso` dari HARI INI (negatif = sudah lewat). Dipakai untuk memperkirakan
 * pelanggaran H-2 di sisi tampilan SEBELUM memanggil API -- murni dari tanggal yang diisi user,
 * tidak butuh data server. Aturan kuota (harian lokasi/bulanan staf) TIDAK bisa dihitung di sini. */
function selisihHariDariHariIni(iso: string): number {
  const target = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const hariIni = new Date(`${todayIso()}T00:00:00`);
  return Math.round((target.getTime() - hariIni.getTime()) / 86400000);
}

/** Warna badge mengikuti BANYAKNYA aturan yang ditembus (level dari backend): 1 kuning, 2 oranye,
 * 3 merah. Level 0 (tidak ada yang ditembus) tampil netral. */
function toneLevel(level: number): "neutral" | "warning" | "orange" | "danger" {
  if (level >= 3) return "danger";
  if (level === 2) return "orange";
  if (level === 1) return "warning";
  return "neutral";
}

/** Baris "Sisa cuti bulan ini" -- dipanggil sekali saat tab dibuka (dan tiap kali daftar di-reload,
 * supaya tetap sinkron kalau ada pengajuan lain yang disetujui/ditolak). `sisa` dari API bisa negatif
 * kalau sudah ada pengajuan DISETUJUI yang melebihi kuota -- tampilkan sebagai peringatan, bukan angka
 * minus mentah yang membingungkan staf. */
function KuotaInfo({ reloadCounter }: { reloadCounter: number }) {
  const [kuota, setKuota] = useState<PengajuanLiburKuota | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getPengajuanLiburKuota()
      .then((res) => {
        if (active) setKuota(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat sisa kuota cuti.");
      });
    return () => {
      active = false;
    };
  }, [reloadCounter]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!kuota) return null;

  const terpakaiTampil = Math.min(kuota.terpakai, kuota.kuotaBulanan);

  return (
    <Card>
      {kuota.sisa < 0 ? (
        <WarningBox>
          Sudah melebihi kuota cuti bulan ini sebanyak <strong>{Math.abs(kuota.sisa)} hari</strong> (kuota{" "}
          {kuota.kuotaBulanan} hari/bulan).
        </WarningBox>
      ) : (
        <p className="text-sm text-slate-700">
          Sisa cuti bulan ini: <strong>{kuota.kuotaBulanan - terpakaiTampil}</strong> dari {kuota.kuotaBulanan} hari.
        </p>
      )}
    </Card>
  );
}

export function PengajuanLiburTab() {
  const { user } = useAuth();
  const [semua, setSemua] = useState<PengajuanLiburListItem[]>([]);
  const [antrian, setAntrian] = useState<PengajuanLiburListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [overrideOpen, setOverrideOpen] = useState(false);

  // Satu permission yang sama dipakai backend untuk menyetujui/menolak DAN untuk jalur darurat
  // "ajukan untuk staf" (pengajuan_libur.approve, owner/manajer_ops saja).
  const bisaApprove = usePermission("pengajuan_libur.approve");

  function reload() {
    setReloadCounter((n) => n + 1);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const tasks: Promise<void>[] = [
      listPengajuanLibur().then((res) => {
        if (active) setSemua(res);
      }),
    ];
    if (bisaApprove) {
      tasks.push(
        listPengajuanLibur({ status: "diajukan" }).then((res) => {
          if (active) setAntrian(res);
        }),
      );
    } else if (active) {
      setAntrian([]);
    }

    Promise.all(tasks)
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat pengajuan libur.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadCounter, bisaApprove]);

  const riwayatSaya = user ? semua.filter((r) => r.userId === String(user.id)) : [];

  return (
    <div className="space-y-4">
      <KuotaInfo reloadCounter={reloadCounter} />

      <PengajuanLiburForm onCreated={reload} />

      {bisaApprove ? (
        <Card>
          <h2 className="mb-1 text-base font-semibold text-slate-900">Ajukan libur untuk staf (darurat)</h2>
          <p className="mb-3 text-sm text-slate-500">
            Jalur darurat untuk kejadian mendadak (staf sakit, keluarga kena musibah). Cuti dibuatkan atas nama
            staf lain dan <strong>langsung disetujui</strong> -- tidak menunggu antrian, dan boleh kurang dari
            H-2. Aturan yang ditembus ikut dicatat sistem.
          </p>
          <Button variant="secondary" className="w-full" onClick={() => setOverrideOpen(true)}>
            Ajukan untuk staf (darurat)
          </Button>
        </Card>
      ) : null}

      {bisaApprove ? (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-slate-900">Menunggu Persetujuan</h2>
          {loading ? <Spinner label="Memuat..." /> : null}
          {!loading && antrian.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Tidak ada pengajuan yang menunggu persetujuan.</p>
          ) : null}
          {!loading && antrian.length > 0 ? <AntrianList rows={antrian} onDecided={reload} /> : null}
        </Card>
      ) : null}

      <Card>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Riwayat Pengajuan Saya</h2>
        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {loading ? <Spinner label="Memuat riwayat..." /> : null}
        {!loading && !error ? (
          riwayatSaya.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">Belum pernah mengajukan libur.</p>
          ) : (
            <div className="space-y-2">
              {riwayatSaya.map((r) => (
                <div key={r.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">
                      {formatTanggalSingkat(r.tanggalMulai)} - {formatTanggalSingkat(r.tanggalSelesai)}
                    </p>
                    <PengajuanLiburStatusBadge status={r.status} />
                  </div>
                  {r.alasan ? <p className="mt-1 text-sm text-slate-600">{r.alasan}</p> : null}
                </div>
              ))}
            </div>
          )
        ) : null}
      </Card>

      {overrideOpen && bisaApprove ? (
        <OverrideLiburDialog
          onClose={() => setOverrideOpen(false)}
          onSelesai={() => {
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function PengajuanLiburForm({ onCreated }: { onCreated: () => void }) {
  const [tanggalMulai, setTanggalMulai] = useState(todayIso());
  const [tanggalSelesai, setTanggalSelesai] = useState(todayIso());
  const [alasan, setAlasan] = useState("");
  // UI LOKAL saja: endpoint normal POST /pengajuan-libur TIDAK punya field pengganti, jadi isinya
  // digabungkan ke teks `alasan` sebelum dikirim (lihat handleSubmit) -- bukan field terpisah.
  const [penggantiNama, setPenggantiNama] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Peringatan NON-BLOKIR -- backend TETAP menyimpan pengajuan (201) walau melebihi kuota, ini
  // cuma info tambahan ditampilkan bersama `success`, bukan pengganti pesan sukses.
  const [peringatanKuota, setPeringatanKuota] = useState<number | null>(null);
  // Sama sifatnya: kuota libur harian lokasi penuh TIDAK menolak pengajuan, cuma menurunkan peluang.
  const [peringatanKuotaHarian, setPeringatanKuotaHarian] = useState(false);

  function resetPesan() {
    setSuccess(false);
    setPeringatanKuota(null);
    setPeringatanKuotaHarian(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    resetPesan();

    if (tanggalSelesai < tanggalMulai) {
      setError("Tanggal selesai tidak boleh sebelum tanggal mulai.");
      return;
    }

    const alasanBersih = alasan.trim();
    const penggantiBersih = penggantiNama.trim();
    const alasanFinal = penggantiBersih
      ? alasanBersih
        ? `${alasanBersih} (Pengganti: ${penggantiBersih})`
        : `Pengganti: ${penggantiBersih}`
      : alasanBersih;

    setSaving(true);
    try {
      const result = await createPengajuanLibur({
        tanggalMulai,
        tanggalSelesai,
        alasan: alasanFinal || undefined,
      });
      setSuccess(true);
      if (result.melebihiKuota) setPeringatanKuota(result.selisih);
      if (result.kuotaHarianPenuh) setPeringatanKuotaHarian(true);
      setAlasan("");
      setPenggantiNama("");
      onCreated();
    } catch (err) {
      // Pesan backend (termasuk aturan minimal H-2) sudah jelas dan actionable -- tampilkan APA ADANYA.
      setError(err instanceof ApiError ? err.message : "Gagal mengajukan libur.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-slate-900">Ajukan libur</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal mulai">
            <Input
              type="date"
              value={tanggalMulai}
              onChange={(e) => {
                setTanggalMulai(e.target.value);
                resetPesan();
              }}
              required
            />
          </Field>
          <Field label="Tanggal selesai">
            <Input
              type="date"
              value={tanggalSelesai}
              onChange={(e) => {
                setTanggalSelesai(e.target.value);
                resetPesan();
              }}
              required
            />
          </Field>
        </div>
        <Field label="Alasan (opsional)">
          <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Contoh: acara keluarga" />
        </Field>
        <Field label="Nama pengganti (opsional)">
          <Input
            value={penggantiNama}
            onChange={(e) => setPenggantiNama(e.target.value)}
            placeholder="Contoh: Rudi"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Isi kalau sudah ada teman yang bersedia menggantikan shift-mu. Namanya ikut ditulis di alasan supaya
            atasan lebih mudah menyetujui.
          </span>
        </Field>
        <p className="text-xs text-slate-500">
          Pengajuan libur paling lambat 2 hari sebelum tanggal mulai (H-2). Kalau mendadak (sakit/musibah),
          hubungi atasan -- mereka punya jalur darurat untuk membuatkan cutinya.
        </p>

        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {success ? <ResultBox>Pengajuan libur terkirim, menunggu persetujuan.</ResultBox> : null}
        {success && peringatanKuota !== null ? (
          <WarningBox>
            Pengajuan ini melebihi kuota bulanan sebanyak <strong>{peringatanKuota} hari</strong> -- tetap terkirim
            dan menunggu persetujuan, ini cuma info tambahan untuk kamu dan atasan.
          </WarningBox>
        ) : null}
        {success && peringatanKuotaHarian ? <WarningBox>{PESAN_KUOTA_HARIAN_PENUH}</WarningBox> : null}

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Mengirim..." : "Ajukan libur"}
        </Button>
      </form>
    </Card>
  );
}

function AntrianList({ rows, onDecided }: { rows: PengajuanLiburListItem[]; onDecided: () => void }) {
  const [confirm, setConfirm] = useState<{ row: PengajuanLiburListItem; keputusan: KeputusanPengajuanLibur } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!confirm) return;
    setSaving(true);
    setError(null);
    try {
      await putuskanPengajuanLibur(confirm.row.id, confirm.keputusan);
      setConfirm(null);
      onDecided();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memproses keputusan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {rows.map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-200 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-medium text-slate-900">{r.userName}</p>
                {r.melebihiKuota ? <Badge tone="warning">Melebihi kuota (+{r.selisihKuota} hari)</Badge> : null}
                {/* Dua badge boleh tampil bersamaan -- kuota bulanan staf dan kuota harian lokasi
                    adalah dua aturan berbeda, keduanya cuma peringatan untuk manajer. */}
                {r.kuotaHarianPenuh ? <Badge tone="warning">Kuota harian lokasi penuh</Badge> : null}
              </div>
              <p className="text-xs text-slate-500">
                {formatTanggalSingkat(r.tanggalMulai)} - {formatTanggalSingkat(r.tanggalSelesai)}
              </p>
              {r.alasan ? <p className="mt-1 text-sm text-slate-600">{r.alasan}</p> : null}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button variant="danger" className="text-xs" onClick={() => setConfirm({ row: r, keputusan: "ditolak" })}>
                Tolak
              </Button>
              <Button className="text-xs" onClick={() => setConfirm({ row: r, keputusan: "disetujui" })}>
                Setujui
              </Button>
            </div>
          </div>
        </div>
      ))}

      {confirm ? (
        <ConfirmDialog
          title={confirm.keputusan === "disetujui" ? "Setujui pengajuan libur?" : "Tolak pengajuan libur?"}
          message={`Pengajuan libur "${confirm.row.userName}" (${formatTanggalSingkat(confirm.row.tanggalMulai)} - ${formatTanggalSingkat(confirm.row.tanggalSelesai)}) akan ${
            confirm.keputusan === "disetujui" ? "disetujui" : "ditolak"
          }.`}
          danger={confirm.keputusan === "ditolak"}
          loading={saving}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Dialog jalur DARURAT "ajukan libur untuk staf" (owner/manajer_ops saja -- permission
 * pengajuan_libur.approve, digate di PengajuanLiburTab).
 *
 * ALUR YANG DIPILIH (2 langkah, lihat catatan di laporan):
 * 1. Konfirmasi SEBELUM kirim lewat ConfirmDialog. Yang bisa disebut pasti di tahap ini cuma aturan
 *    H-2, karena itu satu-satunya yang bisa dihitung dari tanggal yang diisi user tanpa data server
 *    (backend tidak punya endpoint dry-run/preview). Kuota harian lokasi & kuota bulanan staf JUJUR
 *    disebut "baru diketahui setelah dikirim", bukan ditebak-tebak di sisi tampilan.
 * 2. Setelah backend sukses (201), `level` + `aturanDilanggar` ditampilkan sebagai RINGKASAN HASIL
 *    (bukan konfirmasi, karena cutinya sudah tersimpan dan langsung disetujui) dengan badge warna
 *    sesuai tingkat keparahan dan nama aturan dalam bahasa manusia.
 *
 * Kalau backend MENOLAK (mis. nama pengganti wajib karena kuota harian lokasi penuh), pesannya
 * ditampilkan APA ADANYA supaya manajer tahu persis apa yang harus dilengkapi lalu kirim ulang.
 */
function OverrideLiburDialog({ onClose, onSelesai }: { onClose: () => void; onSelesai: () => void }) {
  const lokasiOptions = useLokasiOptions();
  const [lokasiId, setLokasiId] = useState<number | null>(null);
  const [staf, setStaf] = useState<StafOption[]>([]);
  const [stafLoading, setStafLoading] = useState(false);
  const [stafError, setStafError] = useState<string | null>(null);

  // Daftar lokasi dimuat async (lihat LokasiContext) -- `lokasiOptions` masih
  // kosong di render pertama, jadi default "lokasi = yang pertama" tidak
  // bisa lagi diisi langsung di useState initializer. Cuma mengisi SEKALI
  // kalau belum pernah dipilih.
  useEffect(() => {
    if (lokasiId === null && lokasiOptions.length > 0) setLokasiId(lokasiOptions[0].id);
  }, [lokasiOptions, lokasiId]);

  const [userId, setUserId] = useState("");
  const [tanggalMulai, setTanggalMulai] = useState(todayIso());
  const [tanggalSelesai, setTanggalSelesai] = useState(todayIso());
  const [alasan, setAlasan] = useState("");
  const [penggantiNama, setPenggantiNama] = useState("");

  const [konfirmasi, setKonfirmasi] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasil, setHasil] = useState<OverridePengajuanLiburResult | null>(null);

  // Daftar nama diambil per lokasi (endpoint staf memang per lokasi) -- manajer pilih lokasi dulu,
  // baru pilih orangnya. Owner/manajer_ops punya akses semua lokasi lewat useLokasiOptions.
  useEffect(() => {
    if (lokasiId === null) {
      setStaf([]);
      return;
    }
    let active = true;
    setStafLoading(true);
    setStafError(null);
    setUserId("");
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
  }, [lokasiId]);

  const stafTerpilih = staf.find((s) => s.id === userId) ?? null;
  const kurangDariH2 = selisihHariDariHariIni(tanggalMulai) < 2;

  function handleMintaKonfirmasi(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setHasil(null);

    if (!userId) {
      setError("Pilih staf yang mau dibuatkan cutinya.");
      return;
    }
    if (tanggalSelesai < tanggalMulai) {
      setError("Tanggal selesai tidak boleh sebelum tanggal mulai.");
      return;
    }
    setKonfirmasi(true);
  }

  async function handleKirim() {
    setSaving(true);
    setError(null);
    try {
      const res = await overridePengajuanLibur({
        userId: Number(userId),
        tanggalMulai,
        tanggalSelesai,
        alasan: alasan.trim() || undefined,
        penggantiNama: penggantiNama.trim() || undefined,
      });
      setHasil(res);
      setKonfirmasi(false);
      onSelesai();
    } catch (err) {
      // Termasuk penolakan "nama pengganti wajib" dan "tidak boleh untuk diri sendiri" --
      // pesan backend sudah jelas, tampilkan apa adanya supaya manajer bisa langsung memperbaiki.
      setError(err instanceof ApiError ? err.message : "Gagal membuatkan cuti untuk staf ini.");
      setKonfirmasi(false);
    } finally {
      setSaving(false);
    }
  }

  const rentangTeks = `${formatTanggalSingkat(tanggalMulai)} - ${formatTanggalSingkat(tanggalSelesai)}`;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">Ajukan libur untuk staf (darurat)</h2>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {hasil ? (
          <div className="space-y-3">
            <ResultBox>
              Cuti <strong>{stafTerpilih?.name ?? "staf"}</strong> ({rentangTeks}) sudah tersimpan dan{" "}
              <strong>langsung disetujui</strong> -- tidak perlu menunggu persetujuan lagi.
            </ResultBox>

            {hasil.aturanDilanggar.length > 0 ? (
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">Aturan yang ditembus</span>
                  <Badge tone={toneLevel(hasil.level)}>Tingkat {hasil.level} dari 3</Badge>
                </div>
                <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                  {hasil.aturanDilanggar.map((a) => (
                    <li key={a}>{LABEL_ATURAN[a] ?? a}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-500">
                  Semua ini sudah tercatat di riwayat sistem beserta nama kamu sebagai yang menyetujui.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                Tidak ada aturan yang ditembus -- cuti ini memenuhi semua ketentuan, cuma dipercepat
                persetujuannya.
              </p>
            )}

            <Button className="w-full" onClick={onClose}>
              Selesai
            </Button>
          </div>
        ) : (
          <form onSubmit={handleMintaKonfirmasi} className="space-y-3">
            <p className="text-sm text-slate-500">
              Cuti dibuatkan atas nama staf lain dan langsung berstatus disetujui. Pakai ini hanya untuk kejadian
              mendadak.
            </p>

            <Field label="Lokasi">
              <Select
                value={lokasiId ?? ""}
                onChange={(e) => {
                  setLokasiId(Number(e.target.value));
                  setError(null);
                }}
              >
                <option value="" disabled>
                  Pilih lokasi...
                </option>
                {lokasiOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Staf">
              {stafLoading ? (
                <p className="text-sm text-slate-500">Memuat daftar staf...</p>
              ) : stafError ? (
                <ErrorBox>{stafError}</ErrorBox>
              ) : staf.length === 0 ? (
                <p className="text-sm text-amber-700">Belum ada staf aktif di lokasi ini.</p>
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

            <div className="grid grid-cols-2 gap-3">
              <Field label="Tanggal mulai">
                <Input
                  type="date"
                  value={tanggalMulai}
                  onChange={(e) => {
                    setTanggalMulai(e.target.value);
                    setError(null);
                  }}
                  required
                />
              </Field>
              <Field label="Tanggal selesai">
                <Input
                  type="date"
                  value={tanggalSelesai}
                  onChange={(e) => {
                    setTanggalSelesai(e.target.value);
                    setError(null);
                  }}
                  required
                />
              </Field>
            </div>

            <Field label="Alasan (opsional)">
              <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Contoh: sakit" />
            </Field>

            <Field label="Nama pengganti (opsional)">
              <Input
                value={penggantiNama}
                onChange={(e) => setPenggantiNama(e.target.value)}
                placeholder="Contoh: Rudi"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Wajib diisi kalau di tanggal itu sudah ada staf lain di lokasi yang sama yang cutinya disetujui
                (kuota harian lokasi penuh). Kalau begitu, sistem akan minta nama penggantinya dulu.
              </span>
            </Field>

            {kurangDariH2 ? (
              <WarningBox>
                Tanggal mulai kurang dari 2 hari dari hari ini (H-2). Jalur darurat ini memang boleh menembusnya,
                tapi akan tercatat.
              </WarningBox>
            ) : null}

            {error ? <ErrorBox>{error}</ErrorBox> : null}

            <div className="flex gap-3">
              <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
                Batal
              </Button>
              <Button type="submit" className="flex-1" disabled={saving}>
                {saving ? "Memproses..." : "Ajukan override"}
              </Button>
            </div>
          </form>
        )}
      </div>

      {konfirmasi ? (
        <ConfirmDialog
          title="Buatkan cuti ini sekarang?"
          message={`Cuti "${stafTerpilih?.name ?? "staf"}" (${rentangTeks}) akan LANGSUNG DISETUJUI, bukan masuk antrian. ${
            kurangDariH2
              ? "Tanggalnya kurang dari H-2, jadi minimal 1 aturan ditembus."
              : "Tanggalnya sudah memenuhi minimal H-2."
          } Kuota harian lokasi dan kuota bulanan staf baru bisa dicek sistem setelah dikirim -- hasil lengkapnya ditampilkan sesudah ini.`}
          confirmLabel="Ya, buatkan"
          danger={kurangDariH2}
          loading={saving}
          onConfirm={handleKirim}
          onCancel={() => setKonfirmasi(false)}
        />
      ) : null}
    </div>
  );
}
