import { useEffect, useMemo, useState } from "react";
import { getKartuStok } from "../../api/ledger";
import type { KartuStokBaris } from "../../api/types";
import { ApiError } from "../../api/client";
import { DateRangePicker, type RentangTanggal } from "../../components/DateRangePicker";
import { ItemPicker } from "../../components/pickers/ItemPicker";
import { LokasiPicker } from "../../components/pickers/LokasiPicker";
import { ErrorBox } from "../../components/ResultBox";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { formatRupiah, formatTanggalSingkat, todayIso } from "../../utils/format";
import { LABEL_JENIS_LEDGER } from "./ledgerLabels";

function awal30HariLalu(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

/** Kartu Stok (Tahap 1D, 2026-11-14): ledger satu item di satu lokasi -- waktu, jenis,
 * referensi, qty, SALDO BERJALAN, oleh siapa. Pakai komponen DateRangePicker yang sudah
 * ada (instruksi eksplisit). Rupiah (hargaPerSatuan) HANYA untuk owner/manajer_ops --
 * field-nya hilang sama sekali dari respons untuk supervisor (bukan null), dideteksi
 * lewat `"hargaPerSatuan" in baris`. Staf TIDAK PUNYA AKSES ke tab ini sama sekali
 * (digate di TransaksiIndexPage lewat usePermission("kartu_stok.lihat")). */
export function KartuStokTab() {
  const [itemKode, setItemKode] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [rentang, setRentang] = useState<RentangTanggal>({ mulai: awal30HariLalu(), selesai: todayIso() });
  const [rows, setRows] = useState<KartuStokBaris[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!itemKode || !locationId || !rentang.mulai || !rentang.selesai) {
      setRows(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    getKartuStok({ itemKode, locationId, tanggalMulai: rentang.mulai, tanggalSelesai: rentang.selesai })
      .then((res) => {
        if (active) setRows(res.rows);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat Kartu Stok.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [itemKode, locationId, rentang]);

  const bisaLihatRupiah = useMemo(() => rows !== null && rows.some((r) => "hargaPerSatuan" in r), [rows]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Riwayat stok satu item di satu lokasi, lengkap dengan saldo berjalan -- pilih item dan lokasi dulu.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ItemPicker label="Item" value={itemKode} onSelect={(item) => setItemKode(item.kode)} />
        <LokasiPicker value={locationId} onChange={setLocationId} />
      </div>

      <DateRangePicker value={rentang} onChange={setRentang} />

      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {loading ? <Spinner /> : null}

      {!itemKode || !locationId ? (
        <p className="text-sm text-slate-500">Pilih item dan lokasi untuk melihat Kartu Stok.</p>
      ) : rows !== null && rows.length === 0 ? (
        <p className="text-sm text-slate-500">Tidak ada pergerakan stok di rentang tanggal ini.</p>
      ) : rows !== null ? (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <Card key={i}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{LABEL_JENIS_LEDGER[r.jenis]}</p>
                  <p className="text-xs text-slate-500">
                    {formatTanggalSingkat(r.waktu)} &middot; {r.referensi}
                  </p>
                </div>
                <p className={`text-sm font-semibold ${r.qtyChange < 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {r.qtyChange > 0 ? "+" : ""}
                  {r.qtyChange}
                </p>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>Oleh {r.olehUsername ?? "-"}</span>
                <span className="flex gap-3">
                  {bisaLihatRupiah && "hargaPerSatuan" in r && r.hargaPerSatuan != null ? (
                    <span>Harga/satuan: {formatRupiah(r.hargaPerSatuan)}</span>
                  ) : null}
                  <span className="font-semibold text-slate-700">Saldo: {r.saldo}</span>
                </span>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
