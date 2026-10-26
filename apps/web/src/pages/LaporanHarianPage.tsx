import { useEffect, useState } from "react";
import { useLokasiOptions } from "../components/pickers/LokasiPicker";
import { Card } from "../components/ui/Card";
import { Field, Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Spinner } from "../components/ui/Spinner";
import { Badge, PermintaanStatusBadge } from "../components/ui/Badge";
import { ErrorBox } from "../components/ResultBox";
import { getLaporanHarian } from "../api/laporan";
import { ApiError } from "../api/client";
import type { LaporanHarian } from "../api/types";
import { formatRupiah, todayIso } from "../utils/format";

export function LaporanHarianPage() {
  const options = useLokasiOptions();
  const [locationId, setLocationId] = useState<number | null>(null);
  const [tanggal, setTanggal] = useState(todayIso());
  const [data, setData] = useState<LaporanHarian | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Daftar lokasi dimuat async (lihat LokasiContext) -- `options` masih
  // kosong di render pertama, jadi default "lokasi = yang pertama" tidak
  // bisa lagi diisi langsung di useState initializer (bug nyata: dropdown
  // TAMPAK terisi lokasi pertama secara visual -- quirk <select> native
  // kalau controlled value tidak cocok opsi manapun -- padahal locationId
  // sungguhan tetap null, jadi laporan tidak pernah di-fetch). Cuma mengisi
  // SEKALI kalau belum pernah dipilih, pola sama seperti LokasiPicker.
  useEffect(() => {
    if (locationId === null && options.length > 0) setLocationId(options[0].id);
  }, [options, locationId]);

  useEffect(() => {
    if (locationId === null) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    getLaporanHarian({ lokasi: locationId, tanggal })
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat laporan harian.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locationId, tanggal]);

  if (options.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold text-slate-900">Laporan Harian</h1>
        <Card>
          <p className="text-sm text-slate-500">Akun ini belum ditetapkan ke lokasi manapun. Hubungi owner.</p>
        </Card>
      </div>
    );
  }

  const lokasiTerpilih = options.find((l) => l.id === locationId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Laporan Harian</h1>
        <p className="text-sm text-slate-500">Ringkasan transaksi satu lokasi pada satu tanggal, plus kondisi stok Central Kitchen saat ini.</p>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Lokasi">
            <Select value={locationId ?? ""} onChange={(e) => setLocationId(Number(e.target.value))}>
              {options.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tanggal">
            <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
          </Field>
        </div>
      </Card>

      {loading ? <Spinner label="Memuat laporan..." /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {!loading && !error && data ? (
        <div className="space-y-4">
          <KeluarSection data={data} />
          <MasukSection data={data} />
          <PermintaanSection data={data} />
          <PerluDibeliSection data={data} />
        </div>
      ) : null}

      {!loading && !error && data && lokasiTerpilih ? (
        <p className="text-xs text-slate-400">
          Menampilkan data untuk {lokasiTerpilih.name}, tanggal {tanggal}. Bagian "Perlu Dibeli" selalu menunjukkan kondisi
          Central Kitchen saat ini (bukan histori tanggal di atas).
        </p>
      ) : null}
    </div>
  );
}

function KeluarSection({ data }: { data: LaporanHarian }) {
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Keluar (menu terjual)</h2>
      <p className="mb-3 text-xs text-slate-500">Ringkasan menu yang terjual pada tanggal ini, dijumlah per menu.</p>
      {data.keluar.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Belum ada penjualan tercatat pada tanggal ini.</p>
      ) : (
        <div className="space-y-1.5">
          {data.keluar.map((row) => (
            <div key={row.menuKode} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span className="font-medium text-slate-900">{row.menuNama}</span>
              <span className="text-slate-600">{row.qtyTerjual} porsi</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MasukSection({ data }: { data: LaporanHarian }) {
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Masuk (pembelian)</h2>
      <p className="mb-3 text-xs text-slate-500">Barang yang dibeli pada tanggal ini.</p>
      {data.masuk.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Belum ada pembelian tercatat pada tanggal ini.</p>
      ) : (
        <div className="space-y-1.5">
          {data.masuk.map((row, idx) => (
            <div key={`${row.itemKode}-${idx}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{row.itemNama}</span>
                <span className="text-slate-600">
                  {row.qtyBeli} {row.satuanBeli}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-xs text-slate-500">
                <span>
                  {row.vendorNama ?? (row.supplier ? `Supplier (lama): ${row.supplier}` : "Vendor tidak diisi")}
                </span>
                <span>{formatRupiah(row.hargaSatuan)} / {row.satuanBeli}</span>
              </div>
              {row.noReferensi ? <p className="mt-0.5 text-xs text-slate-400">Ref: {row.noReferensi}</p> : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PermintaanSection({ data }: { data: LaporanHarian }) {
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Permintaan ke CK</h2>
      <p className="mb-3 text-xs text-slate-500">Permintaan transfer yang diajukan lokasi ini ke Central Kitchen pada tanggal ini.</p>
      {data.permintaanKeCk.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Belum ada permintaan diajukan pada tanggal ini.</p>
      ) : (
        <div className="space-y-1.5">
          {data.permintaanKeCk.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-slate-900">
                  {row.itemNama} &middot; {row.qtyDiminta}
                </p>
                <p className="text-xs text-slate-500">{row.kode}</p>
              </div>
              <PermintaanStatusBadge status={row.status} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PerluDibeliSection({ data }: { data: LaporanHarian }) {
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Perlu Dibeli (Central Kitchen)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Item di Central Kitchen yang stoknya sekarang sudah di bawah stok minimum -- kondisi saat ini, tidak terkait tanggal yang
        dipilih di atas.
      </p>
      {data.perluDibeli.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Tidak ada item yang stoknya di bawah minimum saat ini. Aman.</p>
      ) : (
        <div className="space-y-1.5">
          {data.perluDibeli.map((row) => {
            const kurang = row.minStok - row.stokSaatIni;
            const parah = row.stokSaatIni <= 0;
            return (
              <div
                key={row.itemKode}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  parah ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"
                }`}
              >
                <div>
                  <p className="font-medium text-slate-900">{row.itemNama}</p>
                  <p className="text-xs text-slate-600">
                    Stok sekarang: {row.stokSaatIni} &middot; Minimum: {row.minStok}
                  </p>
                </div>
                <Badge tone={parah ? "danger" : "warning"}>Kurang {kurang}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
