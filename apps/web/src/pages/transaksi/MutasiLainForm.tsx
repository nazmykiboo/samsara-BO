import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../../auth/AuthContext";
import { LokasiPicker, useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { ItemPicker } from "../../components/pickers/ItemPicker";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { createMutasiLain } from "../../api/transaksi";
import { ApiError } from "../../api/client";
import type { JenisMutasiLain } from "../../api/types";
import type { MockItemRef } from "../../mock/referenceData";
import { todayIso } from "../../utils/format";

interface Baris {
  item: MockItemRef;
  qty: string;
}

/** Enam kategori yang diterima backend (body `jenis`, WAJIB) beserta teksnya untuk staf.
 * Nilai di kiri HARUS sama persis dengan yang di JenisMutasiLain -- backend menolak 400
 * untuk nilai lain. Yang ditampilkan ke user cuma labelnya, kode mentahnya tidak pernah
 * muncul di layar.
 *
 * `arah` cuma dipakai untuk teks bantu ("stok akan berkurang/bertambah") -- qty yang
 * diinput staf SELALU positif, backend yang menentukan tanda ledger dari `jenis` ini. */
const JENIS_MUTASI_LAIN: Array<{ value: JenisMutasiLain; label: string; arah: "tambah" | "kurang" }> = [
  { value: "waste_rusak", label: "Rusak / Waste", arah: "kurang" },
  { value: "hilang_tidak_diketahui", label: "Hilang (tidak diketahui sebabnya)", arah: "kurang" },
  { value: "staff_meal", label: "Dipakai untuk makan staf", arah: "kurang" },
  { value: "sampel", label: "Dipakai untuk sampel/testing", arah: "kurang" },
  { value: "retur_supplier", label: "Dikembalikan ke supplier", arah: "kurang" },
  { value: "koreksi_tambah", label: "Koreksi / Tambah Stok (stok awal, temuan lebih opname, dll)", arah: "tambah" },
];

/** Jenis yang boleh dipakai staf (2026-10-30) -- HARUS sama persis dengan
 * JENIS_MUTASI_LAIN_IZIN_STAF di modules/inventory/src/domain/stok.ts.
 * retur_supplier/koreksi_tambah disembunyikan total dari dropdown staf
 * (bukan "muncul lalu 403 setelah submit") -- backend tetap menolak 403
 * kalau somehow terkirim, ini cuma UX supaya staf tidak sempat pilih. */
const JENIS_MUTASI_LAIN_IZIN_STAF: readonly JenisMutasiLain[] = [
  "waste_rusak",
  "hilang_tidak_diketahui",
  "staff_meal",
  "sampel",
];

export function MutasiLainForm() {
  const { user } = useAuth();
  const options = useLokasiOptions();
  const [locationId, setLocationId] = useState<number | null>(null);
  // "" = belum dipilih. SENGAJA tidak ada kategori yang terpilih otomatis supaya staf
  // tidak asal mengirim kategori pertama yang kebetulan tampil.
  const [jenis, setJenis] = useState<JenisMutasiLain | "">("");
  const [alasan, setAlasan] = useState("");
  const [tanggal, setTanggal] = useState(todayIso());
  const [baris, setBaris] = useState<Baris[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ headerId: string } | null>(null);

  // Daftar lokasi dimuat async (lihat LokasiContext) -- `options` masih
  // kosong di render pertama, jadi default "lokasi = yang pertama" tidak
  // bisa lagi diisi langsung di useState initializer. Cuma mengisi SEKALI
  // kalau belum pernah dipilih.
  useEffect(() => {
    if (locationId === null && options.length > 0) setLocationId(options[0].id);
  }, [options, locationId]);

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

  // Opsi dropdown jenis: semua 6 untuk supervisor ke atas, cuma 4 pengurangan
  // sehari-hari untuk staf (JENIS_MUTASI_LAIN_IZIN_STAF). Qty tidak lagi
  // menyempitkan daftar ini -- arah ditentukan oleh jenis, bukan sebaliknya.
  const opsiJenis = useMemo(
    () => (user?.role === "staf" ? JENIS_MUTASI_LAIN.filter((j) => JENIS_MUTASI_LAIN_IZIN_STAF.includes(j.value)) : JENIS_MUTASI_LAIN),
    [user?.role],
  );

  const jenisTerpilih = useMemo(() => JENIS_MUTASI_LAIN.find((j) => j.value === jenis) ?? null, [jenis]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (locationId === null) {
      setError("Pilih lokasi dulu.");
      return;
    }
    if (jenis === "") {
      setError("Pilih jenis mutasi dulu.");
      return;
    }
    if (!alasan.trim()) {
      setError("Alasan wajib diisi.");
      return;
    }
    if (baris.length === 0) {
      setError("Tambahkan minimal 1 item.");
      return;
    }
    for (const b of baris) {
      const q = Number(b.qty);
      if (!Number.isFinite(q) || q <= 0) {
        setError(`Qty untuk ${b.item.name} wajib diisi angka lebih dari 0.`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await createMutasiLain({
        locationId,
        jenis,
        alasan,
        tanggal,
        baris: baris.map((b) => ({ itemKode: b.item.kode, qty: Number(b.qty) })),
      });
      setResult(res);
      setBaris([]);
      setJenis("");
      setAlasan("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan mutasi lain.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-slate-500">
        Untuk penyesuaian stok di luar pembelian/produksi/penjualan/transfer -- misalnya barang rusak, hilang, atau
        koreksi manual. Isi qty selalu angka positif -- arah tambah/kurang otomatis mengikuti jenis yang dipilih.
      </p>

      <LokasiPicker value={locationId} onChange={setLocationId} />

      <div>
        <Field label="Jenis mutasi">
          <Select value={jenis} onChange={(e) => setJenis(e.target.value as JenisMutasiLain | "")} required>
            <option value="">Pilih jenis...</option>
            {opsiJenis.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </Select>
        </Field>
        <p className="mt-1 text-xs text-slate-500">
          Wajib dipilih. Pilih yang paling mendekati, lalu jelaskan detailnya di kolom Alasan.
          {jenisTerpilih ? (
            <> Stok akan <strong>{jenisTerpilih.arah === "tambah" ? "BERTAMBAH" : "BERKURANG"}</strong> sesuai qty yang diisi.</>
          ) : null}
        </p>
      </div>

      <Field label="Alasan">
        <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Misal: rusak, hilang, koreksi stok" required />
      </Field>

      <Field label="Tanggal">
        <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
      </Field>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Item disesuaikan</h2>
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
                inputMode="decimal"
                step="any"
                min={0}
                value={b.qty}
                onChange={(e) => updateQty(b.item.kode, e.target.value)}
                className="w-24"
                placeholder="0"
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
      {result ? <ResultBox>Mutasi lain #{result.headerId} tersimpan.</ResultBox> : null}

      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Menyimpan..." : "Simpan mutasi"}
      </Button>
    </form>
  );
}
