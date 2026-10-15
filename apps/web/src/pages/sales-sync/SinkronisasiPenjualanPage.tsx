import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";
import {
  getItemMapping,
  importBiayaPlatform,
  importLogPenjualan,
  importRawMajoo,
  importTransaksi,
} from "../../api/sales-sync";
import type { ItemMapping } from "../../api/types";
import { usePermission } from "../../auth/usePermission";
import { ItemBelumDipetakanSection } from "./ItemBelumDipetakanSection";
import { useMenuOptions } from "./MenuKodeCombobox";
import { ProsesSinkronisasiSection } from "./ProsesSinkronisasiSection";
import { UploadCsvCard, type SumberImport } from "./UploadCsvCard";

/**
 * Halaman "Sinkronisasi Penjualan" (modul sales-sync) -- owner/manajer_ops saja.
 *
 * Alurnya sengaja bernomor 1-2-3 dari atas ke bawah karena itu urutan kerja sebenarnya:
 * upload file -> pasangkan menu yang belum dikenal -> baru jalankan proses.
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
  const pemetaanRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (bisaKelola) void muatItems();
  }, [bisaKelola, muatItems]);

  function scrollKePemetaan() {
    pemetaanRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      // Import log penjualan bisa memunculkan kode item baru yang belum dikenal -> daftar di
      // Bagian 2 harus dimuat ulang supaya antriannya langsung terlihat.
      onBerhasil: () => void muatItems(),
    },
    {
      key: "transaksi",
      judul: "Transaksi (Rekonsiliasi Platform)",
      penjelasan: "Laporan pendapatan dan potongan per order dari aplikasi pesan-antar.",
      kirim: importTransaksi,
    },
    {
      key: "raw-majoo",
      judul: "Raw Transaksi Majoo",
      penjelasan: "Data transaksi mentah dari kasir Majoo.",
      kirim: importRawMajoo,
    },
    {
      key: "biaya-platform",
      judul: "Biaya Platform",
      penjelasan: "Rincian biaya iklan, komisi, dan potongan lain dari aplikasi pesan-antar.",
      kirim: importBiayaPlatform,
    },
  ];

  if (!bisaKelola) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Sinkronisasi Penjualan</h1>
        <p className="text-sm text-slate-500">
          Masukkan data penjualan dari aplikasi pesan-antar (ShopeeFood, GrabFood, GoFood) dan kasir Majoo,
          lalu ubah jadi transaksi penjualan supaya stok ikut terpotong otomatis.
        </p>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">1. Upload file CSV</h2>
          <p className="text-sm text-slate-500">
            Upload file sesuai kartunya masing-masing. Format file harus CSV. File yang sama boleh diupload
            ulang — data yang sudah ada tidak akan terhitung dua kali.
          </p>
        </div>
        <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
          {sumberImport.map((sumber) => (
            <UploadCsvCard key={sumber.key} sumber={sumber} />
          ))}
        </div>
      </section>

      <div ref={pemetaanRef} className="scroll-mt-4">
        <ItemBelumDipetakanSection
          items={items}
          loading={loadingItems}
          error={errorItems}
          menu={menu}
          onSelesaiPetakan={() => void muatItems()}
        />
      </div>

      <ProsesSinkronisasiSection
        onKeDaftarPemetaan={scrollKePemetaan}
        onSelesai={() => void muatItems()}
      />
    </div>
  );
}
