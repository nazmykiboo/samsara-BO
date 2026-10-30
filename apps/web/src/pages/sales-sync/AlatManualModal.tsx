import { Modal } from "../../components/Modal";
import { ProsesSinkronisasiSection } from "./ProsesSinkronisasiSection";
import { UploadCsvCard, type SumberImport } from "./UploadCsvCard";

/**
 * Popup "Alat manual" -- bagian 4 dari 4, berisi dua alat yang SEBELUMNYA jadi bagian utama
 * halaman ini (upload CSV + tombol "Proses Sinkronisasi" manual), dipindah ke popup supaya
 * halaman utama fokus ke ringkasan + pengaturan otomatis (2026-10-30, lihat
 * SinkronisasiPenjualanPage).
 *
 * Tombol "Proses Sinkronisasi" di dalam sini TETAP wajib isi tanggal mulai sendiri (TIDAK
 * memakai `tanggal_mulai_otomatis` yang tersimpan di Bagian 3) -- dua konsep yang sengaja
 * terpisah: ini untuk jalankan SEKALI SEKARANG dengan tanggal yang dipilih saat itu juga, beda
 * dari pengaturan otomatis yang tersimpan & dipakai berulang.
 */
export function AlatManualModal({
  sumberImport,
  onClose,
  onKeDaftarPemetaan,
  onSelesaiProses,
}: {
  sumberImport: SumberImport[];
  onClose: () => void;
  onKeDaftarPemetaan: () => void;
  onSelesaiProses: () => void;
}) {
  return (
    <Modal title="Alat manual" onClose={onClose}>
      <div className="max-h-[75vh] space-y-6 overflow-y-auto pr-1">
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Upload file CSV</h3>
            <p className="text-xs text-slate-500">
              Upload file sesuai kartunya masing-masing. Format file harus CSV. File yang sama boleh
              diupload ulang — data yang sudah ada tidak akan terhitung dua kali.
            </p>
          </div>
          <div className="space-y-3">
            {sumberImport.map((sumber) => (
              <UploadCsvCard key={sumber.key} sumber={sumber} />
            ))}
          </div>
        </section>

        <ProsesSinkronisasiSection onKeDaftarPemetaan={onKeDaftarPemetaan} onSelesai={onSelesaiProses} />
      </div>
    </Modal>
  );
}
