import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  qtyChange: string;
}

/** Enam kategori yang diterima backend (body `jenis`, WAJIB) beserta teksnya untuk staf.
 * Nilai di kiri HARUS sama persis dengan yang di JenisMutasiLain -- backend menolak 400
 * untuk nilai lain. Yang ditampilkan ke user cuma labelnya, kode mentahnya tidak pernah
 * muncul di layar.
 *
 * `arah` dipakai untuk menyaring dropdown ini sesuai tanda qty yang sudah diisi staf
 * (lihat `opsiJenis` di bawah) -- backend (modules/inventory/src/domain/stok.ts) menolak
 * kombinasi jenis & tanda qty yang tidak konsisten, jadi kita cegah dari awal di UI
 * supaya staf tidak sempat pilih kombinasi yang pasti ditolak. */
const JENIS_MUTASI_LAIN: Array<{ value: JenisMutasiLain; label: string; arah: "tambah" | "kurang" }> = [
  { value: "waste_rusak", label: "Rusak / Waste", arah: "kurang" },
  { value: "hilang_tidak_diketahui", label: "Hilang (tidak diketahui sebabnya)", arah: "kurang" },
  { value: "staff_meal", label: "Dipakai untuk makan staf", arah: "kurang" },
  { value: "sampel", label: "Dipakai untuk sampel/testing", arah: "kurang" },
  { value: "retur_supplier", label: "Dikembalikan ke supplier", arah: "kurang" },
  { value: "koreksi_tambah", label: "Koreksi / Tambah Stok (stok awal, temuan lebih opname, dll)", arah: "tambah" },
];

export function MutasiLainForm() {
  const options = useLokasiOptions();
  const [locationId, setLocationId] = useState<number | null>(options[0]?.id ?? null);
  // "" = belum dipilih. SENGAJA tidak ada kategori yang terpilih otomatis supaya staf
  // tidak asal mengirim kategori pertama yang kebetulan tampil.
  const [jenis, setJenis] = useState<JenisMutasiLain | "">("");
  const [alasan, setAlasan] = useState("");
  const [tanggal, setTanggal] = useState(todayIso());
  const [baris, setBaris] = useState<Baris[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ headerId: string } | null>(null);

  function handleAddItem(item: MockItemRef) {
    if (baris.some((b) => b.item.kode === item.kode)) return;
    setBaris((prev) => [...prev, { item, qtyChange: "" }]);
  }

  function updateQty(kode: string, qtyChange: string) {
    setBaris((prev) => prev.map((b) => (b.item.kode === kode ? { ...b, qtyChange } : b)));
  }

  function removeBaris(kode: string) {
    setBaris((prev) => prev.filter((b) => b.item.kode !== kode));
  }

  // Tanda qty yang SUDAH DIISI staf saat ini (baris kosong/0 diabaikan -- belum
  // menentukan arah apa pun). Dipakai untuk menyaring dropdown jenis di bawah
  // supaya staf tidak bisa pilih kombinasi jenis+tanda yang pasti ditolak backend
  // (lihat JENIS_MUTASI_LAIN_PENGURANGAN di modules/inventory/src/domain/stok.ts).
  const tandaTerisi = useMemo(() => {
    const set = new Set<"tambah" | "kurang">();
    for (const b of baris) {
      const q = Number(b.qtyChange);
      if (!Number.isFinite(q) || q === 0) continue;
      set.add(q > 0 ? "tambah" : "kurang");
    }
    return set;
  }, [baris]);

  // true kalau ada baris qty positif DAN baris qty negatif pada saat yang sama --
  // kombinasi ini akan selalu ditolak backend apa pun jenis yang dipilih.
  const tandaCampur = tandaTerisi.size > 1;

  // Opsi dropdown jenis yang ditampilkan: semua 6 kalau belum ada qty diisi,
  // disempitkan ke 1 arah begitu tandanya jelas, kosong total kalau campur.
  const opsiJenis = useMemo(() => {
    if (tandaCampur) return [];
    if (tandaTerisi.size === 0) return JENIS_MUTASI_LAIN;
    const arah = tandaTerisi.has("tambah") ? "tambah" : "kurang";
    return JENIS_MUTASI_LAIN.filter((j) => j.arah === arah);
  }, [tandaTerisi, tandaCampur]);

  // Kalau jenis yang sedang terpilih jadi tidak valid lagi (mis. staf ubah qty
  // dari negatif ke positif setelah sudah pilih "Rusak/Waste"), reset ke kosong
  // supaya tidak kebawa submit dengan kombinasi yang pasti ditolak backend.
  useEffect(() => {
    if (jenis !== "" && !opsiJenis.some((j) => j.value === jenis)) {
      setJenis("");
    }
  }, [opsiJenis, jenis]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (locationId === null) {
      setError("Pilih lokasi dulu.");
      return;
    }
    if (tandaCampur) {
      setError("Tidak bisa campur qty tambah dan kurang dalam satu mutasi -- pisahkan jadi dua transaksi terpisah.");
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
      const q = Number(b.qtyChange);
      if (!Number.isFinite(q) || q === 0) {
        setError(`Perubahan qty untuk ${b.item.name} harus angka bukan nol (boleh negatif untuk pengurangan).`);
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
        baris: baris.map((b) => ({ itemKode: b.item.kode, qtyChange: Number(b.qtyChange) })),
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
        koreksi manual. Isi qty negatif untuk mengurangi stok, positif untuk menambah.
      </p>

      <LokasiPicker value={locationId} onChange={setLocationId} />

      <div>
        <Field label="Jenis mutasi">
          <Select
            value={jenis}
            onChange={(e) => setJenis(e.target.value as JenisMutasiLain | "")}
            required
            disabled={tandaCampur}
          >
            <option value="">Pilih jenis...</option>
            {opsiJenis.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </Select>
        </Field>
        {tandaCampur ? (
          <ErrorBox>
            Tidak bisa campur qty tambah dan kurang dalam satu mutasi -- pisahkan jadi dua transaksi terpisah.
          </ErrorBox>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Wajib dipilih. Pilih yang paling mendekati, lalu jelaskan detailnya di kolom Alasan. Pilihan di atas
            otomatis menyesuaikan dengan qty yang kamu isi di daftar item di bawah (tambah atau kurang).
          </p>
        )}
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
                step="any"
                value={b.qtyChange}
                onChange={(e) => updateQty(b.item.kode, e.target.value)}
                className="w-24"
                placeholder="+/-"
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
