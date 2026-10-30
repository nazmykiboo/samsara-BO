import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { getStatusOtomatis, type PengaturanOtomatis, type StatusOtomatis } from "../../api/otomatis";
import {
  getItemMapping,
  importBiayaPlatform,
  importLogPenjualan,
  importRawMajoo,
  importTransaksi,
} from "../../api/sales-sync";
import type { ItemMapping } from "../../api/types";
import { usePermission } from "../../auth/usePermission";
import { Button } from "../../components/ui/Button";
import { AlatManualModal } from "./AlatManualModal";
import { DashboardSinkronisasiSection } from "./DashboardSinkronisasiSection";
import { ItemBelumDipetakanSection } from "./ItemBelumDipetakanSection";
import { useMenuOptions } from "./MenuKodeCombobox";
import { PengaturanOtomatisSection } from "./PengaturanOtomatisSection";
import type { SumberImport } from "./UploadCsvCard";

/**
 * Halaman "Sinkronisasi Penjualan" (modul sales-sync) -- owner/manajer_ops saja.
 *
 * SUSUNAN BARU (2026-10-30, sebelumnya 3 bagian linear "upload -> petakan -> proses"):
 * 1. Ringkasan -- status impor terakhir + angka yang perlu perhatian (tidak ada aksi).
 * 2. Item belum dipetakan -- sama seperti sebelumnya, cuma pindah urutan.
 * 3. Pengaturan pemrosesan otomatis -- BARU, toggle nyala/mati + tanggal mulai tersimpan.
 * 4. Alat manual (popup) -- upload CSV + tombol "Proses Sinkronisasi" manual, SEBELUMNYA bagian
 *    utama halaman ini, sekarang disembunyikan di belakang tombol supaya tidak mendominasi
 *    halaman yang sekarang fokusnya ke ringkasan & pengaturan otomatis.
 *
 * Route-nya sudah digate `RequireAuth roles={["owner","manajer_ops"]}` di App.tsx; pengecekan
 * `usePermission` di sini lapis kedua (pola sama seperti TargetFoodCostCard di PengaturanPage).
 */
export function SinkronisasiPenjualanPage() {
  const bisaKelola = usePermission("sales_sync.manage");

  const [items, setItems] = useState<ItemMapping[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [errorItems, setErrorItems] = useState<string | null>(null);
  const menu = useMenuOptions();

  const [status, setStatus] = useState<StatusOtomatis | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  const [alatManualTerbuka, setAlatManualTerbuka] = useState(false);

  const muatItems = useCallback(async () => {
    setLoadingItems(true);
    setErrorItems(null);
    try {
      const rows = await getItemMapping("belum_dipetakan");
      setItems(rows);
    } catch (err) {
      setErrorItems(
        err instanceof ApiError ? err.message : "Gagal memuat daftar item. Muat ulang halaman lalu coba lagi.",
      );
    } finally {
      setLoadingItems(false);
    }
  }, []);

  const muatStatus = useCallback(async () => {
    setLoadingStatus(true);
    setErrorStatus(null);
    try {
      setStatus(await getStatusOtomatis());
    } catch (err) {
      setErrorStatus(
        err instanceof ApiError ? err.message : "Gagal memuat ringkasan. Muat ulang halaman lalu coba lagi.",
      );
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (bisaKelola) {
      void muatItems();
      void muatStatus();
    }
  }, [bisaKelola, muatItems, muatStatus]);

  function terimaPengaturanBaru(p: PengaturanOtomatis) {
    // Update OPTIMISTIK lokal (tidak perlu round-trip /otomatis/status lagi) -- field lain di
    // `status` (imporTerakhir, otomatisTerakhir) tidak berubah akibat ubah pengaturan, jadi aman
    // cuma menimpa `pengaturan`-nya saja.
    setStatus((prev) => (prev ? { ...prev, pengaturan: p } : prev));
  }

  // Dipanggil setelah import CSV / pemetaan / proses manual selesai -- status bisa saja berubah
  // (impor baru, otomatis ikut jalan di latar belakang kalau aktif) jadi disegarkan lagi.
  function setelahAdaPerubahan() {
    void muatItems();
    void muatStatus();
  }

  // Keempat sumber = keempat sheet/file yang dikirim platform & POS. Judulnya dibuat sama dengan
  // nama file sumber supaya staf tidak perlu menebak file mana untuk kartu mana.
  const sumberImport: SumberImport[] = [
    {
      key: "log-penjualan",
      judul: "Log Penjualan",
      penjelasan:
        "Rincian item yang terjual per order. File ini yang dipakai untuk menghitung pengurangan stok.",
      kirim: importLogPenjualan,
      // Import log penjualan bisa memunculkan kode item baru yang belum dikenal (dan memicu
      // pemrosesan otomatis kalau aktif) -> ringkasan & daftar pemetaan harus dimuat ulang.
      onBerhasil: setelahAdaPerubahan,
    },
    {
      key: "transaksi",
      judul: "Transaksi (Rekonsiliasi Platform)",
      penjelasan: "Laporan pendapatan dan potongan per order dari aplikasi pesan-antar.",
      kirim: importTransaksi,
      onBerhasil: () => void muatStatus(),
    },
    {
      key: "raw-majoo",
      judul: "Raw Transaksi Majoo",
      penjelasan: "Data transaksi mentah dari kasir Majoo.",
      kirim: importRawMajoo,
      onBerhasil: () => void muatStatus(),
    },
    {
      key: "biaya-platform",
      judul: "Biaya Platform",
      penjelasan: "Rincian biaya iklan, komisi, dan potongan lain dari aplikasi pesan-antar.",
      kirim: importBiayaPlatform,
      onBerhasil: () => void muatStatus(),
    },
  ];

  if (!bisaKelola) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Sinkronisasi Penjualan</h1>
          <p className="text-sm text-slate-500">
            Data penjualan dari aplikasi pesan-antar (ShopeeFood, GrabFood, GoFood) dan kasir Majoo masuk
            otomatis lewat jadwal n8n. Halaman ini untuk memantau statusnya, memetakan item baru, dan
            mengatur pemrosesan ke stok.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => setAlatManualTerbuka(true)} className="shrink-0">
          Alat manual
        </Button>
      </div>

      <DashboardSinkronisasiSection
        status={status}
        loading={loadingStatus}
        error={errorStatus}
        jumlahBelumDipetakan={items.length}
      />

      <ItemBelumDipetakanSection
        items={items}
        loading={loadingItems}
        error={errorItems}
        menu={menu}
        onSelesaiPetakan={setelahAdaPerubahan}
      />

      <PengaturanOtomatisSection pengaturan={status?.pengaturan ?? null} loading={loadingStatus} onBerubah={terimaPengaturanBaru} />

      {alatManualTerbuka ? (
        <AlatManualModal
          sumberImport={sumberImport}
          onClose={() => setAlatManualTerbuka(false)}
          onKeDaftarPemetaan={() => setAlatManualTerbuka(false)}
          onSelesaiProses={setelahAdaPerubahan}
        />
      ) : null}
    </div>
  );
}
