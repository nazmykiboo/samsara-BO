import { useEffect, useState, type FormEvent } from "react";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { useLokasiContext } from "../../data/LokasiContext";
import { ItemPicker } from "../../components/pickers/ItemPicker";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { PermintaanStatusBadge } from "../../components/ui/Badge";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { batalkanPermintaanTransfer, createPermintaanTransfer, listPermintaanTransfer } from "../../api/transaksi";
import { ApiError } from "../../api/client";
import type { PermintaanTransferListItem } from "../../api/types";
import { MOCK_ITEMS, type MockItemRef } from "../../mock/referenceData";
import { todayIso } from "../../utils/format";

interface Baris {
  item: MockItemRef;
  qty: string;
}

export function PermintaanTransferForm() {
  const options = useLokasiOptions();
  // Lokasi asal (Central Kitchen yang diminta mengirim) SENGAJA diambil dari daftar lokasi
  // LENGKAP (LokasiContext), bukan useLokasiOptions() yang dibatasi lokasi milik user --
  // backend tidak membatasi locationAsalId berdasarkan lokasi yang di-assign ke user (lihat
  // extractLocationIds POST /transaksi/permintaan-transfer di router.ts, cuma mengecek
  // locationTujuanId). Staf outlet yang hanya di-assign ke lokasi outletnya tetap harus bisa
  // memilih CK sebagai tujuan permintaan.
  const { lokasi: daftarLokasi } = useLokasiContext();
  const asalOptions = daftarLokasi.filter((l) => l.isActive && l.entitas === "samsara_ck");
  // Lokasi tujuan (outlet yang mengajukan) TETAP dibatasi ke lokasi milik user -- ini yang
  // discoped backend (locationTujuanId wajib salah satu lokasi milik staf/supervisor).
  const tujuanOptions = options.filter((l) => l.entitas !== "samsara_ck");

  const [locationAsalId, setLocationAsalId] = useState<number | null>(null);
  const [locationTujuanId, setLocationTujuanId] = useState<number | null>(null);

  // Daftar lokasi dimuat async -- lihat catatan sama di TransferKirimForm.tsx.
  useEffect(() => {
    if (locationAsalId === null && asalOptions.length > 0) setLocationAsalId(Number(asalOptions[0].id));
  }, [asalOptions, locationAsalId]);
  useEffect(() => {
    if (locationTujuanId === null && tujuanOptions.length > 0) setLocationTujuanId(Number(tujuanOptions[0].id));
  }, [tujuanOptions, locationTujuanId]);
  const [tanggal, setTanggal] = useState(todayIso());
  const [catatan, setCatatan] = useState("");
  const [baris, setBaris] = useState<Baris[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasilKode, setHasilKode] = useState<string[] | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  function handleAddItem(item: MockItemRef) {
    if (baris.some((b) => b.item.kode === item.kode)) return;
    setBaris((prev) => [...prev, { item, qty: "" }]);
  }

  function updateQty(kode: string, qty: string) {
    setBaris((prev) => prev.map((b) => (b.item.kode === kode ? { ...b, qty } : b)));
  }

  function removeBaris(kode: string) {
    setBaris((prev) => prev.filter((b) => b.item.kode !== kode));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setHasilKode(null);
    if (locationAsalId === null) {
      setError("Pilih Central Kitchen tujuan permintaan dulu.");
      return;
    }
    if (locationTujuanId === null) {
      setError("Lokasi outlet belum ditentukan. Hubungi owner untuk mengatur lokasi akun ini.");
      return;
    }
    if (baris.length === 0) {
      setError("Tambahkan minimal 1 item yang ingin diminta.");
      return;
    }
    for (const b of baris) {
      const q = Number(b.qty);
      if (!Number.isFinite(q) || q <= 0) {
        setError(`Qty untuk ${b.item.name} harus angka lebih besar dari 0.`);
        return;
      }
    }

    setSaving(true);
    const kodeBerhasil: string[] = [];
    try {
      for (const b of baris) {
        const res = await createPermintaanTransfer({
          locationAsalId,
          locationTujuanId,
          itemKode: b.item.kode,
          qtyDiminta: Number(b.qty),
          tanggalDiminta: tanggal,
          catatan: catatan || undefined,
        });
        kodeBerhasil.push(res.kode);
      }
      setHasilKode(kodeBerhasil);
      setBaris([]);
      setCatatan("");
      setReloadCounter((n) => n + 1);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Gagal mengajukan permintaan.";
      if (kodeBerhasil.length > 0) {
        setError(`${kodeBerhasil.length} permintaan berhasil diajukan (${kodeBerhasil.join(", ")}), tapi sisanya gagal: ${message}`);
        setReloadCounter((n) => n + 1);
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Minta dari (Central Kitchen)">
            <Select value={locationAsalId ?? ""} onChange={(e) => setLocationAsalId(Number(e.target.value))}>
              <option value="" disabled>
                Pilih Central Kitchen...
              </option>
              {asalOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Untuk lokasi (outlet saya)">
            {tujuanOptions.length <= 1 ? (
              <Input value={tujuanOptions[0]?.name ?? "Tidak ada lokasi"} disabled />
            ) : (
              <Select value={locationTujuanId ?? ""} onChange={(e) => setLocationTujuanId(Number(e.target.value))}>
                <option value="" disabled>
                  Pilih lokasi outlet...
                </option>
                {tujuanOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field label="Tanggal dibutuhkan">
          <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
        </Field>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Item yang diminta</h2>
          <ItemPicker label="Tambah item" value={null} onSelect={handleAddItem} excludeKodes={baris.map((b) => b.item.kode)} />

          <div className="mt-3 space-y-2">
            {baris.map((b) => (
              <div key={b.item.kode} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{b.item.name}</p>
                  <p className="text-xs text-slate-500">{b.item.recipeUnit}</p>
                </div>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="Qty"
                  value={b.qty}
                  onChange={(e) => updateQty(b.item.kode, e.target.value)}
                  className="w-24"
                />
                <button type="button" onClick={() => removeBaris(b.item.kode)} className="text-slate-400 hover:text-red-600">
                  ✕
                </button>
              </div>
            ))}
            {baris.length === 0 ? <p className="text-sm text-slate-500">Belum ada item ditambahkan.</p> : null}
          </div>
        </Card>

        <Field label="Catatan (opsional)">
          <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Contoh: butuh sebelum jam makan siang" />
        </Field>

        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {hasilKode && hasilKode.length > 0 ? (
          <ResultBox>
            Permintaan berhasil diajukan: {hasilKode.join(", ")}. Central Kitchen akan melihat permintaan ini dan mengirim
            barangnya lewat transfer.
          </ResultBox>
        ) : null}

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Mengajukan..." : "Ajukan permintaan"}
        </Button>
      </form>

      <RiwayatPermintaanSaya locationTujuanId={locationTujuanId} reloadCounter={reloadCounter} />
    </div>
  );
}

function RiwayatPermintaanSaya({
  locationTujuanId,
  reloadCounter,
}: {
  locationTujuanId: number | null;
  reloadCounter: number;
}) {
  const [rows, setRows] = useState<PermintaanTransferListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

  useEffect(() => {
    if (locationTujuanId === null) {
      setRows([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    listPermintaanTransfer({ lokasi: locationTujuanId })
      .then((res) => {
        if (active) setRows(res.filter((r) => r.locationTujuanId === String(locationTujuanId)));
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat riwayat permintaan.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locationTujuanId, reloadCounter, localReload]);

  async function handleBatalkan(id: string) {
    setCancelingId(id);
    setError(null);
    try {
      await batalkanPermintaanTransfer(id);
      setLocalReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal membatalkan permintaan.");
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-900">Riwayat permintaan saya</h2>
      {loading ? <Spinner label="Memuat riwayat..." /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {!loading && !error ? (
        rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Belum ada permintaan yang diajukan dari lokasi ini.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const item = MOCK_ITEMS.find((i) => i.kode === r.itemKode);
              return (
                <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {r.itemNama} &middot; {r.qtyDiminta} {item?.recipeUnit ?? ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        {r.kode} &middot; dibutuhkan {r.tanggalDiminta}
                        {r.catatan ? ` · ${r.catatan}` : ""}
                      </p>
                    </div>
                    <PermintaanStatusBadge status={r.status} />
                  </div>
                  {r.status === "diminta" ? (
                    <button
                      type="button"
                      disabled={cancelingId === r.id}
                      onClick={() => handleBatalkan(r.id)}
                      className="mt-2 text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                    >
                      {cancelingId === r.id ? "Membatalkan..." : "Batalkan permintaan"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </Card>
  );
}
