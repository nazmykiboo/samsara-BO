import { useEffect, useState, type FormEvent } from "react";
import { LokasiPicker, useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { createProduksi } from "../../api/transaksi";
import { listResepProduksi } from "../../api/master";
import { ApiError } from "../../api/client";
import type { ProduksiResult, ResepProduksiListItem } from "../../api/types";
import { todayIso } from "../../utils/format";

export function ProduksiForm() {
  const options = useLokasiOptions();
  const [locationId, setLocationId] = useState<number | null>(null);
  const [resepKode, setResepKode] = useState("");
  const [qtyBatch, setQtyBatch] = useState("1");
  const [hasilAktual, setHasilAktual] = useState("");
  const [tanggal, setTanggal] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProduksiResult | null>(null);

  const [resepList, setResepList] = useState<ResepProduksiListItem[]>([]);
  const [loadingResep, setLoadingResep] = useState(true);
  const [loadResepError, setLoadResepError] = useState<string | null>(null);

  // Daftar lokasi dimuat async (lihat LokasiContext) -- `options` masih
  // kosong di render pertama, jadi default "lokasi = yang pertama" tidak
  // bisa lagi diisi langsung di useState initializer. Cuma mengisi SEKALI
  // kalau belum pernah dipilih.
  useEffect(() => {
    if (locationId === null && options.length > 0) setLocationId(options[0].id);
  }, [options, locationId]);

  // Hanya resep AKTIF yang boleh muncul di dropdown -- resep nonaktif tetap
  // ada di response API (dipakai di Master > Resep Produksi untuk ditampilkan
  // dengan badge "Nonaktif"), tapi di sini harus disaring habis supaya staf
  // tidak bisa memilihnya lalu baru gagal saat submit.
  const resepAktif = resepList.filter((r) => r.isActive && r.kode !== null);

  useEffect(() => {
    let active = true;
    setLoadingResep(true);
    setLoadResepError(null);
    listResepProduksi()
      .then((res) => {
        if (active) setResepList(res);
      })
      .catch((err) => {
        if (active) setLoadResepError(err instanceof ApiError ? err.message : "Gagal memuat daftar resep produksi.");
      })
      .finally(() => {
        if (active) setLoadingResep(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (locationId === null || !resepKode) {
      setError("Pilih lokasi dan resep produksi dulu.");
      return;
    }
    const qty = Number(qtyBatch);
    const hasil = Number(hasilAktual);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Qty batch harus angka > 0.");
      return;
    }
    if (!Number.isFinite(hasil) || hasil < 0) {
      setError("Hasil aktual harus angka >= 0.");
      return;
    }
    setSaving(true);
    try {
      const res = await createProduksi({ resepKode, locationId, qtyBatch: qty, tanggal, hasilAktual: hasil });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan produksi.");
    } finally {
      setSaving(false);
    }
  }

  const resep = resepAktif.find((r) => r.kode === resepKode);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {loadResepError ? <ErrorBox>{loadResepError}</ErrorBox> : null}

      <LokasiPicker value={locationId} onChange={setLocationId} label="Lokasi produksi" />

      <Field label="Resep produksi">
        {loadingResep ? (
          <Spinner label="Memuat daftar resep..." />
        ) : (
          <Select value={resepKode} onChange={(e) => setResepKode(e.target.value)}>
            <option value="" disabled>
              Pilih resep...
            </option>
            {resepAktif.map((r) => (
              <option key={r.kode} value={r.kode ?? ""}>
                {r.kode} -- {r.outputItemName}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {resep ? (
        <p className="text-xs text-slate-500">
          1 batch resep ini menghasilkan {resep.yieldQty ?? "?"} {resep.yieldUnit} {resep.outputItemName} (yield teoretis).
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Qty batch">
          <Input type="number" min={0} step="any" value={qtyBatch} onChange={(e) => setQtyBatch(e.target.value)} required />
        </Field>
        <Field label={`Hasil aktual (${resep?.yieldUnit ?? "satuan resep"})`}>
          <Input type="number" min={0} step="any" value={hasilAktual} onChange={(e) => setHasilAktual(e.target.value)} required />
        </Field>
      </div>

      <Field label="Tanggal">
        <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
      </Field>

      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {result ? (
        <ResultBox>
          Produksi #{result.headerId} tersimpan.
          {result.yieldTeoretis !== null ? ` Yield teoretis: ${result.yieldTeoretis}.` : ""}
          {result.selisihYield !== null ? ` Selisih vs aktual: ${result.selisihYield}.` : ""}
        </ResultBox>
      ) : null}

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Menyimpan..." : "Simpan produksi"}
      </Button>
    </form>
  );
}
