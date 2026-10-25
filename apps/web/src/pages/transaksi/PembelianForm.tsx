import { useEffect, useState, type FormEvent } from "react";
import { LokasiPicker, useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { ItemPicker } from "../../components/pickers/ItemPicker";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { ErrorBox, ResultBox, WarningBox } from "../../components/ResultBox";
import { createPembelian } from "../../api/transaksi";
import { getAmbangKenaikanHarga, getHargaTerakhir, listVendor } from "../../api/vendor";
import { ApiError } from "../../api/client";
import type { PembelianResult, Vendor } from "../../api/types";
import type { MockItemRef } from "../../mock/referenceData";
import { formatRupiah, todayIso } from "../../utils/format";

interface Baris {
  item: MockItemRef;
  qtyBeli: string;
  satuanBeli: string;
  hargaSatuan: string;
  /** Harga terakhir dari katalog vendor terpilih SAAT item ini ditambahkan/vendor dipilih -- dasar perbandingan peringatan kenaikan, BUKAN nilai yang dikirim ke server. */
  hargaTerakhirVendor: number | null;
}

export function PembelianForm() {
  const options = useLokasiOptions();
  const [locationId, setLocationId] = useState<number | null>(null);
  const [supplier, setSupplier] = useState("");
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [ambangPersen, setAmbangPersen] = useState(10);
  const [noReferensi, setNoReferensi] = useState("");
  const [tanggal, setTanggal] = useState(todayIso());
  const [baris, setBaris] = useState<Baris[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PembelianResult | null>(null);

  // Daftar lokasi dimuat async (lihat LokasiContext) -- `options` masih
  // kosong di render pertama, jadi default "lokasi = yang pertama" tidak
  // bisa lagi diisi langsung di useState initializer. Cuma mengisi SEKALI
  // kalau belum pernah dipilih.
  useEffect(() => {
    if (locationId === null && options.length > 0) setLocationId(Number(options[0].id));
  }, [options, locationId]);

  // Vendor & ambang kenaikan harga dimuat sekali -- dipakai dropdown vendor
  // (opsional, TERPISAH dari field "Supplier" teks bebas yang sudah ada,
  // lihat docs/architecture-decisions.md §28) dan perbandingan real-time
  // di bawah.
  useEffect(() => {
    listVendor()
      .then((res) => setVendors(res.filter((v) => v.isActive)))
      .catch(() => {
        /* dropdown vendor opsional -- gagal muat tidak menghalangi pembelian pakai field supplier teks biasa */
      });
    getAmbangKenaikanHarga()
      .then((res) => setAmbangPersen(res.persen))
      .catch(() => {
        /* fallback 10 (nilai awal state) kalau gagal muat */
      });
  }, []);

  async function isiHargaTerakhirUntuk(itemKode: string) {
    if (vendorId === null) return;
    try {
      const res = await getHargaTerakhir(vendorId, itemKode);
      setBaris((prev) =>
        prev.map((b) =>
          b.item.kode === itemKode
            ? { ...b, hargaTerakhirVendor: res.hargaTerakhir, hargaSatuan: b.hargaSatuan || (res.hargaTerakhir ? String(res.hargaTerakhir) : b.hargaSatuan) }
            : b,
        ),
      );
    } catch {
      // Gagal ambil harga terakhir (mis. role tidak punya izin) -- biarkan
      // field harga kosong, user isi manual seperti biasa.
    }
  }

  function handleAddItem(item: MockItemRef) {
    if (baris.some((b) => b.item.kode === item.kode)) return;
    setBaris((prev) => [
      ...prev,
      { item, qtyBeli: "", satuanBeli: item.purchaseUnit ?? "", hargaSatuan: "", hargaTerakhirVendor: null },
    ]);
    void isiHargaTerakhirUntuk(item.kode);
  }

  function updateBaris(kode: string, patch: Partial<Baris>) {
    setBaris((prev) => prev.map((b) => (b.item.kode === kode ? { ...b, ...patch } : b)));
  }

  function removeBaris(kode: string) {
    setBaris((prev) => prev.filter((b) => b.item.kode !== kode));
  }

  function handleVendorChange(value: string) {
    const id = value ? Number(value) : null;
    setVendorId(id);
    // Vendor baru dipilih -- ambil ulang harga terakhir untuk SEMUA baris
    // yang sudah ada (isiHargaTerakhirUntuk hanya mengisi field yang masih
    // kosong, tidak menimpa harga yang sudah diketik user).
    if (id !== null) {
      for (const b of baris) void isiHargaTerakhirUntuk(b.item.kode);
    }
  }

  function kenaikanPersen(b: Baris): number | null {
    const hargaBaru = Number(b.hargaSatuan);
    if (!b.hargaTerakhirVendor || !Number.isFinite(hargaBaru) || b.hargaTerakhirVendor <= 0) return null;
    return ((hargaBaru - b.hargaTerakhirVendor) / b.hargaTerakhirVendor) * 100;
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
        vendorId: vendorId ?? undefined,
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
        <Field label="Supplier (opsional, teks bebas)">
          <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label="Vendor (opsional, dari Master > Vendor)">
          <Select value={vendorId ?? ""} onChange={(e) => handleVendorChange(e.target.value)}>
            <option value="">- Tidak pakai vendor -</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
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
          {baris.map((b) => {
            const persen = kenaikanPersen(b);
            const naikDiAtasAmbang = persen !== null && persen > ambangPersen;
            return (
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
                {b.hargaTerakhirVendor ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Harga terakhir dari vendor ini: {formatRupiah(b.hargaTerakhirVendor)}
                  </p>
                ) : null}
                {naikDiAtasAmbang ? (
                  <p className="mt-1 text-xs font-medium text-amber-700">
                    ⚠ Naik {persen!.toFixed(1)}% dari harga terakhir (ambang {ambangPersen}%) -- cek lagi sebelum disimpan.
                  </p>
                ) : null}
              </div>
            );
          })}
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
      {result && result.peringatanHarga.length > 0 ? (
        <WarningBox>
          <div className="space-y-1">
            <p className="font-medium">Harga naik di atas {ambangPersen}% dibanding katalog vendor:</p>
            {result.peringatanHarga.map((p) => (
              <p key={p.itemKode}>
                {p.itemKode}: {formatRupiah(p.hargaLama)} → {formatRupiah(p.hargaBaru)} (+{p.persenKenaikan.toFixed(1)}%)
              </p>
            ))}
          </div>
        </WarningBox>
      ) : null}

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Menyimpan..." : "Simpan pembelian"}
      </Button>
    </form>
  );
}
