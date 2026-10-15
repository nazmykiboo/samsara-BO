import { useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { bisaPembelianProduksiPenjualan } from "../../auth/permissions";
import { usePermission } from "../../auth/usePermission";
import { PembelianForm } from "./PembelianForm";
import { ProduksiForm } from "./ProduksiForm";
import { PenjualanForm } from "./PenjualanForm";
import { TransferTab } from "./TransferTab";
import { PermintaanTab } from "./PermintaanTab";
import { MutasiLainForm } from "./MutasiLainForm";
import { OpnameTab } from "./OpnameTab";
import { RiwayatTransaksiTab } from "./RiwayatTransaksiTab";

type Tab =
  | "pembelian"
  | "produksi"
  | "penjualan"
  | "transfer"
  | "permintaan"
  | "mutasi_lain"
  | "opname"
  | "riwayat";

export function TransaksiIndexPage() {
  const { user } = useAuth();
  const canCoreTransaksi = user ? bisaPembelianProduksiPenjualan(user.role) : false;
  // GET /transaksi/penjualan memakai ULANG permission laporan_harian.lihat (owner/manajer_ops/
  // supervisor; staf TIDAK boleh) -- lihat modules/inventory/module.json.
  const bisaLihatRiwayat = usePermission("laporan_harian.lihat");

  const tabs = useMemo(() => {
    const list: { key: Tab; label: string }[] = [];
    if (canCoreTransaksi) {
      list.push({ key: "pembelian", label: "Pembelian" }, { key: "produksi", label: "Produksi" }, { key: "penjualan", label: "Penjualan" });
    }
    list.push(
      { key: "transfer", label: "Transfer" },
      { key: "permintaan", label: "Permintaan ke CK" },
      { key: "mutasi_lain", label: "Mutasi Lain" },
      { key: "opname", label: "Opname" },
    );
    if (bisaLihatRiwayat) {
      list.push({ key: "riwayat", label: "Riwayat Transaksi" });
    }
    return list;
  }, [canCoreTransaksi, bisaLihatRiwayat]);

  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? "transfer");
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Transaksi</h1>
        <p className="text-sm text-slate-500">
          Catat transaksi stok sesuai jenisnya{bisaLihatRiwayat ? ", atau lihat riwayat penjualan yang sudah tercatat" : ""}.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === t.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "pembelian" ? <PembelianForm /> : null}
      {activeTab === "produksi" ? <ProduksiForm /> : null}
      {activeTab === "penjualan" ? <PenjualanForm /> : null}
      {activeTab === "transfer" ? <TransferTab /> : null}
      {activeTab === "permintaan" ? <PermintaanTab /> : null}
      {activeTab === "mutasi_lain" ? <MutasiLainForm /> : null}
      {activeTab === "opname" ? <OpnameTab /> : null}
      {activeTab === "riwayat" ? <RiwayatTransaksiTab /> : null}
    </div>
  );
}
