import { useRef, useState } from "react";
import { ApiError } from "../../api/client";
import type { HasilImportCsv } from "../../api/types";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ErrorBox } from "../../components/ResultBox";

export interface SumberImport {
  key: string;
  /** Judul = nama sheet/file sumber supaya staf gampang mencocokkan file mana ke kartu mana. */
  judul: string;
  penjelasan: string;
  kirim: (csvText: string) => Promise<HasilImportCsv>;
  /** Dipanggil setelah import BERHASIL. Dipakai kartu "Log Penjualan": import log bisa menambah
   * kode item baru ke antrian pemetaan, jadi daftarnya perlu dimuat ulang. */
  onBerhasil?: () => void;
}

export function UploadCsvCard({ sumber }: { sumber: SumberImport }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [hasil, setHasil] = useState<HasilImportCsv | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rincianErrorTerbuka, setRincianErrorTerbuka] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    if (!file) {
      setError("Pilih file CSV dulu.");
      return;
    }
    setError(null);
    setHasil(null);
    setRincianErrorTerbuka(false);
    setUploading(true);
    try {
      // File.text() -- API bawaan browser, mengembalikan isi file sebagai string. Yang dikirim ke
      // server adalah TEKS CSV-nya, bukan objek File (endpoint-nya menerima body text/csv).
      const csvText = await file.text();
      const res = await sumber.kirim(csvText);
      setHasil(res);
      if (sumber.onBerhasil) sumber.onBerhasil();
      // Kosongkan pilihan file supaya file yang sama tidak terunggah dua kali karena salah klik.
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "File gagal diunggah. Periksa koneksi internet lalu coba lagi.",
      );
    } finally {
      setUploading(false);
    }
  }

  const jumlahError = hasil?.errors.length ?? 0;

  return (
    <Card>
      <h3 className="text-sm font-semibold text-slate-900">{sumber.judul}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{sumber.penjelasan}</p>

      <div className="mt-3 space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          aria-label={`Pilih file CSV ${sumber.judul}`}
          disabled={uploading}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
            setHasil(null);
          }}
          className="block w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 disabled:opacity-60"
        />
        <Button type="button" onClick={handleUpload} disabled={uploading || !file} className="w-full">
          {uploading ? "Mengupload..." : "Upload"}
        </Button>
      </div>

      {error ? (
        <div className="mt-2">
          <ErrorBox>{error}</ErrorBox>
        </div>
      ) : null}

      {hasil ? (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <p className="font-medium">File selesai diproses.</p>
            <p className="mt-0.5">
              {hasil.dibuat} baris baru, {hasil.diperbarui} diperbarui, {hasil.dilewati} dilewati (duplikat).
            </p>
          </div>

          {jumlahError > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {/* Sengaja TIDAK otomatis terbuka: file bisa punya ratusan baris gagal dan daftarnya
                  akan mendorong seluruh halaman turun di layar HP. */}
              <button
                type="button"
                onClick={() => setRincianErrorTerbuka((v) => !v)}
                aria-expanded={rincianErrorTerbuka}
                className="flex w-full items-center justify-between gap-2 text-left font-medium"
              >
                <span>{jumlahError} baris gagal diproses</span>
                <span aria-hidden>{rincianErrorTerbuka ? "▲" : "▼"}</span>
              </button>
              <p className="mt-0.5 text-xs">
                Baris lain tetap tersimpan. Perbaiki baris ini di file sumber, lalu upload ulang filenya.
              </p>
              {rincianErrorTerbuka ? (
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto border-t border-amber-200 pt-2 text-xs">
                  {hasil.errors.map((e, idx) => (
                    <li key={`${e.baris}-${idx}`} className="flex gap-2">
                      <span className="shrink-0 font-medium">Baris {e.baris}:</span>
                      <span className="break-words">{e.pesan}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
