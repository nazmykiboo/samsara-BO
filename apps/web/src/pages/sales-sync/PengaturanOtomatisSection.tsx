import { useState } from "react";
import { ApiError } from "../../api/client";
import { getPengaturanOtomatis, pratinjauProses, setPengaturanOtomatis, type HasilPratinjau, type PengaturanOtomatis } from "../../api/otomatis";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ErrorBox } from "../../components/ResultBox";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";

/**
 * Pengaturan pemrosesan sinkronisasi OTOMATIS -- bagian 3 dari 4. BEDA dari tombol manual "Proses
 * Sinkronisasi" (di Alat Manual): tanggal mulai di sini DISIMPAN dan dipakai berulang tiap kali
 * otomatis jalan (dipicu impor/pemetaan), BUKAN wajib diisi ulang tiap kali seperti tombol manual.
 *
 * Menyalakan toggle MEMINTA KONFIRMASI eksplisit (lewat ConfirmDialog) -- ini mengaktifkan
 * pemotongan stok otomatis di latar belakang, beda dari aksi UI biasa. Mematikan tidak perlu
 * konfirmasi (selalu aman, cuma menghentikan proses otomatis berikutnya).
 */
export function PengaturanOtomatisSection({
  pengaturan,
  loading,
  onBerubah,
}: {
  pengaturan: PengaturanOtomatis | null;
  loading: boolean;
  onBerubah: (p: PengaturanOtomatis) => void;
}) {
  const [tanggalMulai, setTanggalMulai] = useState("");
  const [menyimpan, setMenyimpan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [konfirmasiNyala, setKonfirmasiNyala] = useState(false);

  const [pratinjau, setPratinjau] = useState<HasilPratinjau | null>(null);
  const [loadingPratinjau, setLoadingPratinjau] = useState(false);
  const [errorPratinjau, setErrorPratinjau] = useState<string | null>(null);

  // Sinkronkan input lokal dengan nilai tersimpan SEKALI tiap kali `pengaturan` berubah dari
  // server (bukan tiap render) -- pola null-guard yang sama dipakai berulang di repo ini untuk
  // state yang diisi dari hook async (lihat docs/architecture-decisions.md § 30).
  const [tersinkronDari, setTersinkronDari] = useState<string | null>(null);
  if (pengaturan && tersinkronDari !== pengaturan.tanggalMulai) {
    setTersinkronDari(pengaturan.tanggalMulai);
    setTanggalMulai(pengaturan.tanggalMulai ?? "");
  }

  async function simpanTanggal() {
    setError(null);
    setMenyimpan(true);
    try {
      const hasil = await setPengaturanOtomatis({ tanggalMulai: tanggalMulai || null });
      onBerubah(hasil);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan tanggal mulai. Coba lagi.");
    } finally {
      setMenyimpan(false);
    }
  }

  async function ubahAktif(nilai: boolean) {
    setError(null);
    setMenyimpan(true);
    try {
      const hasil = await setPengaturanOtomatis({ aktif: nilai });
      onBerubah(hasil);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan pengaturan. Coba lagi.");
    } finally {
      setMenyimpan(false);
      setKonfirmasiNyala(false);
    }
  }

  async function muatPratinjau() {
    if (!tanggalMulai) {
      setErrorPratinjau("Isi dan simpan tanggal mulai dulu sebelum melihat pratinjau.");
      return;
    }
    setLoadingPratinjau(true);
    setErrorPratinjau(null);
    try {
      setPratinjau(await pratinjauProses(tanggalMulai));
    } catch (err) {
      setErrorPratinjau(err instanceof ApiError ? err.message : "Gagal memuat pratinjau. Coba lagi.");
    } finally {
      setLoadingPratinjau(false);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Pemrosesan otomatis</h2>
        <p className="text-sm text-slate-500">
          Kalau dinyalakan, sistem otomatis mengubah penjualan yang sudah terpetakan jadi transaksi (dan
          memotong stok) setiap kali ada data baru masuk atau item baru dipetakan -- tidak perlu klik
          &ldquo;Proses Sinkronisasi&rdquo; manual lagi.
        </p>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-900">
              {pengaturan?.aktif ? "Otomatis sedang AKTIF" : "Otomatis sedang MATI"}
            </p>
            <p className="text-xs text-slate-500">
              {pengaturan?.aktif
                ? "Penjualan yang terpetakan akan otomatis memotong stok."
                : "Pemotongan stok tetap manual lewat Alat Manual."}
            </p>
          </div>
          <Button
            type="button"
            variant={pengaturan?.aktif ? "secondary" : "primary"}
            disabled={loading || menyimpan || !pengaturan}
            onClick={() => (pengaturan?.aktif ? void ubahAktif(false) : setKonfirmasiNyala(true))}
          >
            {pengaturan?.aktif ? "Matikan" : "Nyalakan"}
          </Button>
        </div>

        <Field label="Mulai potong stok otomatis dari tanggal">
          <Input
            type="date"
            value={tanggalMulai}
            disabled={menyimpan}
            onChange={(e) => setTanggalMulai(e.target.value)}
          />
        </Field>
        <p className="text-xs text-slate-500">
          Penjualan sebelum tanggal ini TIDAK PERNAH dipotong otomatis (tetap tersimpan sebagai riwayat).
          Sama seperti tanggal di Alat Manual, tapi tersimpan dan dipakai berulang -- tidak perlu diisi
          ulang tiap kali.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={menyimpan || tanggalMulai === (pengaturan?.tanggalMulai ?? "")}
          onClick={() => void simpanTanggal()}
        >
          {menyimpan ? "Menyimpan..." : "Simpan tanggal"}
        </Button>

        {error ? <ErrorBox>{error}</ErrorBox> : null}
      </Card>

      <div>
        <Button type="button" variant="secondary" disabled={loadingPratinjau} onClick={() => void muatPratinjau()}>
          {loadingPratinjau ? "Memuat pratinjau..." : "Lihat pratinjau"}
        </Button>
        <p className="mt-1 text-xs text-slate-400">
          Menghitung apa yang AKAN terjadi kalau otomatis jalan sekarang, TANPA benar-benar memproses apa pun.
        </p>
      </div>

      {errorPratinjau ? <ErrorBox>{errorPratinjau}</ErrorBox> : null}

      {pratinjau ? (
        <Card className="space-y-1 text-sm">
          <p>
            <strong>{pratinjau.siapDiproses.length}</strong> order siap diproses
          </p>
          <p className="text-slate-600">{pratinjau.dilewatiBelumTerpetakan.length} order tertahan (belum terpetakan)</p>
          <p className="text-slate-600">{pratinjau.perluDitinjau.length} order perlu ditinjau (retur/refund)</p>
          <p className="text-slate-600">{pratinjau.dilewatiSebelumTanggalMulai.length} order sebelum tanggal mulai</p>
          {pratinjau.channelTidakDikenal.length > 0 ? (
            <p className="text-amber-700">{pratinjau.channelTidakDikenal.length} order dari channel tidak dikenal</p>
          ) : null}
        </Card>
      ) : null}

      {konfirmasiNyala ? (
        <ConfirmDialog
          title="Nyalakan pemrosesan otomatis?"
          message={`Mulai sekarang, penjualan yang terpetakan akan otomatis memotong stok tanpa Anda klik apa pun -- mengikuti tanggal mulai yang tersimpan (${pengaturan?.tanggalMulai ?? "belum diisi"}). Order dengan retur/refund tetap TIDAK PERNAH diproses otomatis, tetap perlu ditinjau manual.`}
          confirmLabel="Ya, nyalakan"
          loading={menyimpan}
          onConfirm={() => void ubahAktif(true)}
          onCancel={() => setKonfirmasiNyala(false)}
        />
      ) : null}
    </section>
  );
}
