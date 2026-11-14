import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { listRiwayatSemuaJenis } from "../../api/ledger";
import type { JenisTransaksiLedger, LedgerBaris } from "../../api/types";
import { ApiError } from "../../api/client";
import { DateRangePicker, type RentangTanggal } from "../../components/DateRangePicker";
import { LokasiPicker } from "../../components/pickers/LokasiPicker";
import { ErrorBox } from "../../components/ResultBox";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { formatRupiah, formatTanggalSingkat, todayIso } from "../../utils/format";
import { JENIS_LEDGER_URUT, LABEL_JENIS_LEDGER } from "./ledgerLabels";

function awal30HariLalu(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

/** Riwayat Transaksi LINTAS SEMUA JENIS (Tahap 1D, 2026-11-14) -- generalisasi dari
 * RiwayatTransaksiTab (yang cuma Penjualan). TIDAK ada kolom saldo di sini (saldo cuma
 * masuk akal per item, lihat KartuStokTab). Pakai komponen DateRangePicker yang sudah ada. */
export function RiwayatSemuaJenisTab() {
  const { user } = useAuth();
  const [rentang, setRentang] = useState<RentangTanggal>({ mulai: awal30HariLalu(), selesai: todayIso() });
  const [locationId, setLocationId] = useState<number | null>(null);
  const [jenis, setJenis] = useState<JenisTransaksiLedger | "">("");
  const [rows, setRows] = useState<LedgerBaris[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rentang.mulai || !rentang.selesai) return;
    let active = true;
    setLoading(true);
    setError(null);
    listRiwayatSemuaJenis({
      tanggalMulai: rentang.mulai,
      tanggalSelesai: rentang.selesai,
      locationId: locationId ?? undefined,
      jenis: jenis || undefined,
    })
      .then((res) => {
        if (active) {
          setRows(res.rows);
          setTotal(res.total);
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat Riwayat Transaksi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rentang, locationId, jenis]);

  const bisaLihatRupiah = useMemo(() => rows !== null && rows.some((r) => "hargaPerSatuan" in r), [rows]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Riwayat lintas semua jenis transaksi (bukan cuma penjualan) -- filter jenis dan lokasi di bawah.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* owner/manajer_ops bebas pilih lokasi apa pun (termasuk "semua" lewat tidak mengisi);
            role location-scoped TETAP dibatasi ke lokasinya sendiri di backend walau picker ini
            tidak dipakai -- picker tetap ditampilkan supaya supervisor dengan >1 lokasi bisa
            mempersempit. */}
        <LokasiPicker value={locationId} onChange={setLocationId} label={user?.allLocations ? "Lokasi (opsional, semua kalau kosong)" : "Lokasi"} />
        <Field label="Jenis (opsional, semua kalau kosong)">
          <Select value={jenis} onChange={(e) => setJenis(e.target.value as JenisTransaksiLedger | "")}>
            <option value="">Semua jenis</option>
            {JENIS_LEDGER_URUT.map((j) => (
              <option key={j} value={j}>
                {LABEL_JENIS_LEDGER[j]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <DateRangePicker value={rentang} onChange={setRentang} />

      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {loading ? <Spinner /> : null}

      {rows !== null ? (
        <p className="text-xs text-slate-500">
          Menampilkan {rows.length} dari {total} baris.
        </p>
      ) : null}

      {rows !== null && rows.length === 0 ? (
        <p className="text-sm text-slate-500">Tidak ada transaksi di rentang/filter ini.</p>
      ) : rows !== null ? (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <Card key={i}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {LABEL_JENIS_LEDGER[r.jenis]} &middot; {r.itemNama}
                  </p>
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
                {bisaLihatRupiah && "hargaPerSatuan" in r && r.hargaPerSatuan != null ? (
                  <span>Harga/satuan: {formatRupiah(r.hargaPerSatuan)}</span>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
