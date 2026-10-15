import { useState, type FormEvent } from "react";
import { LokasiPicker, useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { MenuPicker } from "../../components/pickers/MenuPicker";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { createPenjualan } from "../../api/transaksi";
import { ApiError } from "../../api/client";
import type { PenjualanResult } from "../../api/types";
import { MOCK_CHANNEL, type MockMenuRef } from "../../mock/referenceData";
import { jamSekarang, todayIso } from "../../utils/format";

interface Baris {
  menu: MockMenuRef;
  qty: string;
}

export function PenjualanForm() {
  const options = useLokasiOptions();
  const [locationId, setLocationId] = useState<number | null>(options[0]?.id ?? null);
  const [sumber, setSumber] = useState(MOCK_CHANNEL[0]?.name ?? "");
  const [noReferensi, setNoReferensi] = useState("");
  const [tanggal, setTanggal] = useState(todayIso());
  // SENGAJA dibiarkan kosong saat form dibuka (tidak di-prefill jam saat ini): kalau
  // kolomnya sudah terisi, staf gampang mengira "ini pasti jam sekarang" padahal
  // mengisi form bisa makan beberapa menit. Yang kosong diisi jam saat SUBMIT.
  const [jam, setJam] = useState("");
  const [baris, setBaris] = useState<Baris[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PenjualanResult | null>(null);

  function handleAddMenu(menu: MockMenuRef) {
    if (baris.some((b) => b.menu.kode === menu.kode)) return;
    setBaris((prev) => [...prev, { menu, qty: "1" }]);
  }

  function updateQty(kode: string, qty: string) {
    setBaris((prev) => prev.map((b) => (b.menu.kode === kode ? { ...b, qty } : b)));
  }

  function removeBaris(kode: string) {
    setBaris((prev) => prev.filter((b) => b.menu.kode !== kode));
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
      setError("Tambahkan minimal 1 menu.");
      return;
    }
    for (const b of baris) {
      const q = Number(b.qty);
      if (!Number.isFinite(q) || q <= 0) {
        setError(`Qty untuk ${b.menu.name} harus angka > 0.`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await createPenjualan({
        locationId,
        sumber,
        noReferensi: noReferensi || undefined,
        tanggal,
        // Jam dihitung ULANG di sini (bukan saat form dibuka) supaya yang tersimpan
        // adalah jam transaksi dicatat. Kalau user sudah mengisi manual, dipakai apa
        // adanya -- jangan ditimpa.
        jam: jam || jamSekarang(),
        baris: baris.map((b) => ({ menuKode: b.menu.kode, qty: Number(b.qty) })),
      });
      setResult(res);
      setBaris([]);
      setNoReferensi("");
      // Dikosongkan lagi supaya entri BERIKUTNYA kembali ke perilaku "pakai jam saat
      // ini otomatis", bukan mewarisi jam transaksi sebelumnya.
      setJam("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan penjualan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <LokasiPicker value={locationId} onChange={setLocationId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Channel penjualan">
          <Select value={sumber} onChange={(e) => setSumber(e.target.value)}>
            {MOCK_CHANNEL.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="No. referensi (opsional)">
          <Input value={noReferensi} onChange={(e) => setNoReferensi(e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Tanggal">
          <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
        </Field>
        <div>
          <Field label="Jam penjualan">
            <Input type="time" value={jam} onChange={(e) => setJam(e.target.value)} />
          </Field>
          <p className="mt-1 text-xs text-slate-500">Opsional. Kosongkan untuk pakai jam saat ini otomatis.</p>
        </div>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Menu terjual</h2>
        <MenuPicker label="Tambah menu" value={null} onSelect={handleAddMenu} excludeKodes={baris.map((b) => b.menu.kode)} />

        <div className="mt-3 space-y-2">
          {baris.map((b) => (
            <div key={b.menu.kode} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
              <p className="flex-1 text-sm font-medium text-slate-900">{b.menu.name}</p>
              <Input
                type="number"
                min={1}
                step={1}
                value={b.qty}
                onChange={(e) => updateQty(b.menu.kode, e.target.value)}
                className="w-20"
              />
              <button type="button" onClick={() => removeBaris(b.menu.kode)} className="text-slate-400 hover:text-red-600">
                ✕
              </button>
            </div>
          ))}
          {baris.length === 0 ? <p className="text-sm text-slate-500">Belum ada menu ditambahkan.</p> : null}
        </div>
      </Card>

      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {result ? (
        <ResultBox>Penjualan #{result.headerId} tersimpan -- stok bahan otomatis berkurang sesuai resep menu.</ResultBox>
      ) : null}

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Menyimpan..." : "Simpan penjualan"}
      </Button>
    </form>
  );
}
