import { useState, type FormEvent } from "react";
import { LokasiPicker, useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { ItemPicker } from "../../components/pickers/ItemPicker";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { createPembelian } from "../../api/transaksi";
import { ApiError } from "../../api/client";
import type { PembelianResult } from "../../api/types";
import type { MockItemRef } from "../../mock/referenceData";
import { todayIso } from "../../utils/format";

interface Baris {
  item: MockItemRef;
  qtyBeli: string;
  satuanBeli: string;
  hargaSatuan: string;
}

export function PembelianForm() {
  const options = useLokasiOptions();
  const [locationId, setLocationId] = useState<number | null>(options[0]?.id ?? null);
  const [supplier, setSupplier] = useState("");
  const [noReferensi, setNoReferensi] = useState("");
  const [tanggal, setTanggal] = useState(todayIso());
  const [baris, setBaris] = useState<Baris[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PembelianResult | null>(null);

  function handleAddItem(item: MockItemRef) {
    if (baris.some((b) => b.item.kode === item.kode)) return;
    setBaris((prev) => [...prev, { item, qtyBeli: "", satuanBeli: item.purchaseUnit ?? "", hargaSatuan: "" }]);
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
    if (locationId === null) {
      setError("Pilih lokasi dulu.");
      return;
    }
    if (baris.length === 0) {
      setError("Tambahkan minimal 1 item.");
      return;
    }
    for (const b of baris) {
      if (!b.qtyBeli || !b.satuanBeli || !b.hargaSatuan) {
        setError(`Lengkapi qty, satuan, dan harga untuk ${b.item.name}.`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await createPembelian({
        locationId,
        supplier: supplier || undefined,
        noReferensi: noReferensi || undefined,
        tanggal,
        baris: baris.map((b) => ({
          itemKode: b.item.kode,
          qtyBeli: Number(b.qtyBeli),
          satuanBeli: b.satuanBeli,
          hargaSatuan: Number(b.hargaSatuan),
        })),
      });
      setResult(res);
      setBaris([]);
      setSupplier("");
      setNoReferensi("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan pembelian.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <LokasiPicker value={locationId} onChange={setLocationId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Supplier (opsional)">
          <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label="No. referensi (opsional)">
          <Input value={noReferensi} onChange={(e) => setNoReferensi(e.target.value)} />
        </Field>
      </div>

      <Field label="Tanggal">
        <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
      </Field>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Item dibeli</h2>
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
                <Field label="Qty beli">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={b.qtyBeli}
                    onChange={(e) => updateBaris(b.item.kode, { qtyBeli: e.target.value })}
                  />
                </Field>
                <Field label="Satuan beli">
                  <Input value={b.satuanBeli} onChange={(e) => updateBaris(b.item.kode, { satuanBeli: e.target.value })} />
                </Field>
                <Field label="Harga/satuan">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={b.hargaSatuan}
                    onChange={(e) => updateBaris(b.item.kode, { hargaSatuan: e.target.value })}
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
          Pembelian #{result.headerId} tersimpan -- {result.baris.length} baris item, stok bertambah sesuai konversi ke
          satuan resep.
        </ResultBox>
      ) : null}

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Menyimpan..." : "Simpan pembelian"}
      </Button>
    </form>
  );
}
