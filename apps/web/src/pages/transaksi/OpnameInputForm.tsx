import { useState, type FormEvent } from "react";
import { LokasiPicker, useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { ItemPicker } from "../../components/pickers/ItemPicker";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { createOpname } from "../../api/transaksi";
import { ApiError } from "../../api/client";
import type { OpnameResult } from "../../api/types";
import type { MockItemRef } from "../../mock/referenceData";
import { todayIso } from "../../utils/format";

interface Baris {
  item: MockItemRef;
  qtyFisik: string;
}

export function OpnameInputForm() {
  const options = useLokasiOptions();
  const [locationId, setLocationId] = useState<number | null>(options[0]?.id ?? null);
  const [tanggal, setTanggal] = useState(todayIso());
  const [baris, setBaris] = useState<Baris[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OpnameResult | null>(null);

  function handleAddItem(item: MockItemRef) {
    if (baris.some((b) => b.item.kode === item.kode)) return;
    setBaris((prev) => [...prev, { item, qtyFisik: "" }]);
  }

  function updateQty(kode: string, qtyFisik: string) {
    setBaris((prev) => prev.map((b) => (b.item.kode === kode ? { ...b, qtyFisik } : b)));
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
      if (b.qtyFisik === "" || Number(b.qtyFisik) < 0) {
        setError(`Isi qty fisik untuk ${b.item.name}.`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await createOpname({
        locationId,
        tanggal,
        baris: baris.map((b) => ({ itemKode: b.item.kode, qtyFisik: Number(b.qtyFisik) })),
      });
      setResult(res);
      setBaris([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan opname.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-slate-500">
        Catat hasil hitung fisik di sini. Status masih <strong>draft</strong> -- stok BELUM berubah sampai owner/manajer
        ops menyetujui di tab Persetujuan.
      </p>

      <LokasiPicker value={locationId} onChange={setLocationId} />

      <Field label="Tanggal">
        <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
      </Field>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Hasil hitung fisik</h2>
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
                value={b.qtyFisik}
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

      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {result ? (
        <ResultBox>
          Opname #{result.headerId} tersimpan sebagai draft. Selisih: {result.baris.map((b) => `${b.itemKode} (${b.selisih})`).join(", ")}.
          Sampaikan nomor draft ini ke owner/manajer ops untuk disetujui.
        </ResultBox>
      ) : null}

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Menyimpan..." : "Simpan sebagai draft"}
      </Button>
    </form>
  );
}
