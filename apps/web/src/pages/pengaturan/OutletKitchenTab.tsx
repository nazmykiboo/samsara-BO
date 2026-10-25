import { useEffect, useState, type FormEvent } from "react";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  LokasiTidakBisaNonaktifError,
  createLokasi,
  listLokasiLengkap,
  salinKonfigurasiLokasi,
  updateLokasi,
} from "../../api/pengaturan";
import { ApiError } from "../../api/client";
import { useLokasiContext } from "../../data/LokasiContext";
import type { LokasiLengkap, LokasiTipe } from "../../api/types";

const TIPE_LABEL: Record<LokasiTipe, string> = { outlet: "Outlet", kitchen: "Kitchen" };

interface FormState {
  name: string;
  entitas: string;
  kode: string;
  tipe: LokasiTipe | "";
  alamat: string;
  kota: string;
  telepon: string;
  jamBuka: string;
  jamTutup: string;
  penanggungJawab: string;
  tanggalBuka: string;
  kitchenDefaultId: string;
}

const FORM_KOSONG: FormState = {
  name: "",
  entitas: "",
  kode: "",
  tipe: "",
  alamat: "",
  kota: "",
  telepon: "",
  jamBuka: "",
  jamTutup: "",
  penanggungJawab: "",
  tanggalBuka: "",
  kitchenDefaultId: "",
};

function lokasiToForm(l: LokasiLengkap): FormState {
  return {
    name: l.name,
    entitas: l.entitas,
    kode: l.kode ?? "",
    tipe: l.tipe ?? "",
    alamat: l.alamat ?? "",
    kota: l.kota ?? "",
    telepon: l.telepon ?? "",
    jamBuka: l.jamBuka ?? "",
    jamTutup: l.jamTutup ?? "",
    penanggungJawab: l.penanggungJawab ?? "",
    tanggalBuka: l.tanggalBuka ?? "",
    kitchenDefaultId: l.kitchenDefaultId ? String(l.kitchenDefaultId) : "",
  };
}

/** Body yang dikirim ke API dari FormState -- string kosong -> undefined (biarkan NULL di backend), bukan dikirim sebagai "". */
function formToPayload(f: FormState) {
  return {
    name: f.name.trim(),
    entitas: f.entitas.trim(),
    kode: f.kode.trim() || undefined,
    tipe: f.tipe || undefined,
    alamat: f.alamat.trim() || undefined,
    kota: f.kota.trim() || undefined,
    telepon: f.telepon.trim() || undefined,
    jamBuka: f.jamBuka || undefined,
    jamTutup: f.jamTutup || undefined,
    penanggungJawab: f.penanggungJawab.trim() || undefined,
    tanggalBuka: f.tanggalBuka || undefined,
    kitchenDefaultId: f.kitchenDefaultId ? Number(f.kitchenDefaultId) : undefined,
  };
}

export function OutletKitchenTab() {
  const { muatUlang: muatUlangPublik } = useLokasiContext();
  const [daftar, setDaftar] = useState<LokasiLengkap[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showTambah, setShowTambah] = useState(false);

  function muatUlangSemua() {
    setReloadCounter((n) => n + 1);
    muatUlangPublik();
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError(null);
    listLokasiLengkap()
      .then((res) => {
        if (active) setDaftar(res);
      })
      .catch((err) => {
        if (active) setListError(err instanceof ApiError ? err.message : "Gagal memuat daftar lokasi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadCounter]);

  const kitchenList = (daftar ?? []).filter((l) => l.tipe === "kitchen");

  return (
    <div className="space-y-4">
      {loading ? <Spinner label="Memuat daftar lokasi..." /> : null}
      {listError ? <ErrorBox>{listError}</ErrorBox> : null}

      {!loading && !listError && daftar ? (
        <div className="space-y-3">
          {daftar.map((l) =>
            editingId === l.id ? (
              <LokasiForm
                key={l.id}
                initial={lokasiToForm(l)}
                lokasiId={l.id}
                kitchenOptions={kitchenList.filter((k) => k.id !== l.id)}
                isActive={l.isActive}
                onDone={() => {
                  setEditingId(null);
                  muatUlangSemua();
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <Card key={l.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {l.name} {!l.isActive ? <Badge tone="neutral">Nonaktif</Badge> : null}{" "}
                      {l.tipe ? <Badge tone="info">{TIPE_LABEL[l.tipe]}</Badge> : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      {l.kode ? `${l.kode} · ` : ""}
                      {l.entitas}
                      {l.alamat ? ` · ${l.alamat}` : ""}
                      {l.kota ? `, ${l.kota}` : ""}
                    </p>
                    {l.jamBuka || l.jamTutup ? (
                      <p className="text-xs text-slate-500">
                        Jam buka: {l.jamBuka ?? "-"} &ndash; {l.jamTutup ?? "-"}
                      </p>
                    ) : null}
                    {l.penanggungJawab ? <p className="text-xs text-slate-500">PIC: {l.penanggungJawab}</p> : null}
                  </div>
                  <Button variant="secondary" onClick={() => setEditingId(l.id)}>
                    Edit
                  </Button>
                </div>
              </Card>
            ),
          )}
        </div>
      ) : null}

      {showTambah ? (
        <LokasiForm
          initial={FORM_KOSONG}
          lokasiId={null}
          kitchenOptions={kitchenList}
          isActive={true}
          onDone={() => {
            setShowTambah(false);
            muatUlangSemua();
          }}
          onCancel={() => setShowTambah(false)}
        />
      ) : (
        <Button onClick={() => setShowTambah(true)}>+ Tambah lokasi</Button>
      )}

      {daftar && daftar.length >= 2 ? <SalinKonfigurasiCard daftar={daftar} /> : null}
    </div>
  );
}

function LokasiForm({
  initial,
  lokasiId,
  kitchenOptions,
  isActive,
  onDone,
  onCancel,
}: {
  initial: FormState;
  lokasiId: number | null;
  kitchenOptions: LokasiLengkap[];
  isActive: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [penghalang, setPenghalang] = useState<string[] | null>(null);
  const [confirmNonaktif, setConfirmNonaktif] = useState(false);

  function patch(p: Partial<FormState>) {
    setForm((f) => ({ ...f, ...p }));
  }

  async function simpan(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPenghalang(null);
    if (!form.name.trim() || !form.entitas.trim()) {
      setError("Nama dan entitas wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      if (lokasiId === null) {
        await createLokasi(formToPayload(form) as { name: string; entitas: string });
      } else {
        await updateLokasi(lokasiId, formToPayload(form));
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan lokasi.");
    } finally {
      setSaving(false);
    }
  }

  async function nonaktifkan() {
    if (lokasiId === null) return;
    setSaving(true);
    setError(null);
    setPenghalang(null);
    try {
      await updateLokasi(lokasiId, { isActive: false });
      setConfirmNonaktif(false);
      onDone();
    } catch (err) {
      setConfirmNonaktif(false);
      if (err instanceof LokasiTidakBisaNonaktifError) {
        setPenghalang(err.penghalang);
      } else {
        setError(err instanceof ApiError ? err.message : "Gagal menonaktifkan lokasi.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function aktifkan() {
    if (lokasiId === null) return;
    setSaving(true);
    setError(null);
    try {
      await updateLokasi(lokasiId, { isActive: true });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengaktifkan lokasi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-slate-900">
        {lokasiId === null ? "Tambah lokasi baru" : `Edit: ${initial.name}`}
      </h2>
      <form onSubmit={simpan} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nama">
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} required />
          </Field>
          <Field label="Entitas (kode internal, mis. samsara_outlet)">
            <Input value={form.entitas} onChange={(e) => patch({ entitas: e.target.value })} required />
          </Field>
          <Field label="Kode singkat (opsional)">
            <Input value={form.kode} onChange={(e) => patch({ kode: e.target.value })} placeholder="mis. OUT-01" />
          </Field>
          <Field label="Tipe">
            <Select value={form.tipe} onChange={(e) => patch({ tipe: e.target.value as LokasiTipe })}>
              <option value="">- Pilih -</option>
              <option value="outlet">Outlet</option>
              <option value="kitchen">Kitchen</option>
            </Select>
          </Field>
          <Field label="Alamat">
            <Input value={form.alamat} onChange={(e) => patch({ alamat: e.target.value })} />
          </Field>
          <Field label="Kota">
            <Input value={form.kota} onChange={(e) => patch({ kota: e.target.value })} />
          </Field>
          <Field label="Telepon">
            <Input value={form.telepon} onChange={(e) => patch({ telepon: e.target.value })} />
          </Field>
          <Field label="Penanggung jawab">
            <Input value={form.penanggungJawab} onChange={(e) => patch({ penanggungJawab: e.target.value })} />
          </Field>
          <Field label="Jam buka">
            <Input type="time" value={form.jamBuka} onChange={(e) => patch({ jamBuka: e.target.value })} />
          </Field>
          <Field label="Jam tutup">
            <Input type="time" value={form.jamTutup} onChange={(e) => patch({ jamTutup: e.target.value })} />
          </Field>
          <Field label="Tanggal buka">
            <Input type="date" value={form.tanggalBuka} onChange={(e) => patch({ tanggalBuka: e.target.value })} />
          </Field>
          {form.tipe === "outlet" ? (
            <Field label="Kitchen pemasok default (opsional)">
              <Select
                value={form.kitchenDefaultId}
                onChange={(e) => patch({ kitchenDefaultId: e.target.value })}
              >
                <option value="">- Tidak ada -</option>
                {kitchenOptions.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>

        {error ? <ErrorBox>{error}</ErrorBox> : null}
        {penghalang ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            <p className="mb-1 font-medium">Lokasi tidak bisa dinonaktifkan:</p>
            <ul className="list-inside list-disc">
              {penghalang.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Batal
          </Button>
          {lokasiId !== null ? (
            isActive ? (
              <Button type="button" variant="danger" onClick={() => setConfirmNonaktif(true)} disabled={saving}>
                Nonaktifkan
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={aktifkan} disabled={saving}>
                Aktifkan kembali
              </Button>
            )
          ) : null}
        </div>
      </form>

      {confirmNonaktif ? (
        <ConfirmDialog
          title="Nonaktifkan lokasi?"
          message={`"${initial.name}" tidak akan muncul lagi di pilihan lokasi aktif. Ditolak kalau masih ada stok/transfer/opname/jadwal yang menyangkut lokasi ini.`}
          danger
          loading={saving}
          onConfirm={nonaktifkan}
          onCancel={() => setConfirmNonaktif(false)}
        />
      ) : null}
    </Card>
  );
}

function SalinKonfigurasiCard({ daftar }: { daftar: LokasiLengkap[] }) {
  const [dari, setDari] = useState<string>("");
  const [ke, setKe] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sukses, setSukses] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSukses(false);
    if (!dari || !ke || dari === ke) {
      setError("Pilih dua lokasi yang berbeda.");
      return;
    }
    setSaving(true);
    try {
      await salinKonfigurasiLokasi(Number(dari), Number(ke));
      setSukses(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyalin konfigurasi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Salin konfigurasi channel antar lokasi</h2>
      <p className="mb-3 text-sm text-slate-500">
        Menyalin pengaturan channel penjualan aktif/nonaktif dari satu lokasi ke lokasi lain -- mempercepat setup
        outlet baru.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <Field label="Dari">
          <Select value={dari} onChange={(e) => setDari(e.target.value)}>
            <option value="">- Pilih -</option>
            {daftar.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ke">
          <Select value={ke} onChange={(e) => setKe(e.target.value)}>
            <option value="">- Pilih -</option>
            {daftar.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={saving}>
          {saving ? "Menyalin..." : "Salin"}
        </Button>
      </form>
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {sukses ? <ResultBox>Konfigurasi channel tersalin.</ResultBox> : null}
    </Card>
  );
}
