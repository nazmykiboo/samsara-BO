import { useState, type FormEvent } from "react";
import { LokasiPicker, useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { ItemPicker } from "../../components/pickers/ItemPicker";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { createTransferKirim } from "../../api/transaksi";
import { ApiError } from "../../api/client";
import type { TransferKirimResult } from "../../api/types";
import { MOCK_LOKASI, type MockItemRef } from "../../mock/referenceData";
import { todayIso } from "../../utils/format";

interface Baris {
  item: MockItemRef;
  qtyKirim: string;
  unit: string;
  hargaTransferPerSatuan: string;
}

export function TransferKirimForm() {
  const options = useLokasiOptions();
  const [locationAsalId, setLocationAsalId] = useState<number | null>(options[0]?.id ?? null);
  const [locationTujuanId, setLocationTujuanId] = useState<number | null>(null);
  const [tanggal, setTanggal] = useState(todayIso());
  const [baris, setBaris] = useState<Baris[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferKirimResult | null>(null);

  const tujuanOptions = MOCK_LOKASI.filter((l) => l.id !== locationAsalId);

  function handleAddItem(item: MockItemRef) {
    if (baris.some((b) => b.item.kode === item.kode)) return;
    setBaris((prev) => [...prev, { item, qtyKirim: "", unit: item.recipeUnit, hargaTransferPerSatuan: "" }]);
  }

  function updateBaris(kode: string, patch: Partial<Baris>) {
    setBaris((prev) => prev.map((b) => (b.item.kode === kode ? { ...b, ...patch } : b)));
  }

  function removeBaris(kode: string) {
    setBaris((prev) => prev.filter((b) => b.item.kode !== kode));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (locationAsalId === null || locationTujuanId === null) {
      setError("Pilih lokasi asal dan tujuan dulu.");
      return;
    }
    if (baris.length === 0) {
      setError("Tambahkan minimal 1 item.");
      return;
    }
    for (const b of baris) {
      if (!b.qtyKirim || !b.unit) {
        setError(`Lengkapi qty dan satuan untuk ${b.item.name}.`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await createTransferKirim({
        locationAsalId,
        locationTujuanId,
        tanggal,
        baris: baris.map((b) => ({
          itemKode: b.item.kode,
          qtyKirim: Number(b.qtyKirim),
          unit: b.unit,
          hargaTransferPerSatuan: b.hargaTransferPerSatuan ? Number(b.hargaTransferPerSatuan) : undefined,
        })),
      });
      setResult(res);
      setBaris([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengirim transfer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <LokasiPicker value={locationAsalId} onChange={setLocationAsalId} label="Lokasi asal" />

      <Field label="Lokasi tujuan">
        <Select value={locationTujuanId ?? ""} onChange={(e) => setLocationTujuanId(Number(e.target.value))}>
          <option value="" disabled>
            Pilih lokasi tujuan...
          </option>
          {tujuanOptions.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.entitas})
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Tanggal">
        <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
      </Field>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Item dikirim</h2>
        <ItemPicker label="Tambah item" value={null} onSelect={handleAddItem} excludeKodes={baris.map((b) => b.item.kode)} />

        <div className="mt-3 space-y-3">
          {baris.map((b) => (
            <div key={b.item.kode} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-900">{b.item.name}</p>
                <button type="button" onClick={() => removeBaris(b.item.kode)} className="text-slate-400 hover:text-red-600">
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Qty kirim">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={b.qtyKirim}
                    onChange={(e) => updateBaris(b.item.kode, { qtyKirim: e.target.value })}
                  />
                </Field>
                <Field label="Satuan">
                  <Input value={b.unit} onChange={(e) => updateBaris(b.item.kode, { unit: e.target.value })} />
                </Field>
                <Field label="Harga transfer (opsional)">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={b.hargaTransferPerSatuan}
                    onChange={(e) => updateBaris(b.item.kode, { hargaTransferPerSatuan: e.target.value })}
                    placeholder="default: HPP asal"
                  />
                </Field>
              </div>
            </div>
          ))}
          {baris.length === 0 ? <p className="text-sm text-slate-500">Belum ada item ditambahkan.</p> : null}
        </div>
      </Card>

      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {result ? (
        <ResultBox>
          Transfer #{result.headerId} dikirim{result.antarEntitas ? " (antar entitas)" : ""} -- stok lokasi asal sudah
          berkurang, menunggu diterima di tujuan.
        </ResultBox>
      ) : null}

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Mengirim..." : "Kirim transfer"}
      </Button>
    </form>
  );
}
