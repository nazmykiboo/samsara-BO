import { useEffect, useState, type FormEvent } from "react";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Spinner } from "../../components/ui/Spinner";
import { createShiftTemplate, listShiftTemplate, updateShiftTemplate } from "../../api/hr";
import { ApiError } from "../../api/client";
import type { ShiftTemplateListItem } from "../../api/types";

function jamLabel(hhmmss: string): string {
  return hhmmss.slice(0, 5);
}

/** Tab "Shift" di halaman Pengaturan -- kelola jenis shift (Pagi, Siang, dst) yang dipakai saat
 * membuat jadwal di halaman Jadwal & Izin. Dibuka Owner & Manajer Ops (lihat bisaKelolaShiftTemplate
 * di auth/permissions.ts dan permission shift_template.manage di modules/hr/module.json). List SELALU
 * dari listShiftTemplate() + refetch setelah mutasi, sama pola dengan ItemTab/ResepProduksiTab --
 * bukan state lokal sebagai pengganti sumber kebenaran server. */
export function ShiftTab() {
  const [templates, setTemplates] = useState<ShiftTemplateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function reload() {
    setReloadCounter((n) => n + 1);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    listShiftTemplate()
      .then((res) => {
        if (active) setTemplates(res);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : "Gagal memuat daftar shift.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadCounter]);

  const sorted = templates.slice().sort((a, b) => a.urutanTampil - b.urutanTampil);
  const editing = templates.find((t) => t.id === editingId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          Jenis shift (mis. Pagi, Siang) yang dipilih saat membuat jadwal di halaman Jadwal & Izin.
        </p>
        <Button onClick={() => setCreating(true)} className="shrink-0">
          + Shift
        </Button>
      </div>

      {loadError ? <ErrorBox>{loadError}</ErrorBox> : null}
      {loading ? <Spinner label="Memuat daftar shift..." /> : null}

      {!loading ? (
        <div className="space-y-2">
          {sorted.map((t) => (
            <button
              key={t.id}
              onClick={() => setEditingId(t.id)}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-blue-300"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {t.nama} {!t.aktif ? <Badge tone="neutral">Nonaktif</Badge> : null}
                </p>
                <p className="text-xs text-slate-500">
                  {t.kode} &middot; {jamLabel(t.jamMulai)}-{jamLabel(t.jamSelesai)}
                </p>
              </div>
            </button>
          ))}
          {sorted.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Belum ada shift. Tambahkan dulu lewat tombol di atas.</p>
          ) : null}
        </div>
      ) : null}

      {creating ? (
        <ShiftTemplateCreateSheet
          onClose={() => setCreating(false)}
          onCreated={() => {
            reload();
            setCreating(false);
          }}
        />
      ) : null}

      {editing ? (
        <ShiftTemplateEditSheet template={editing} onClose={() => setEditingId(null)} onSaved={reload} />
      ) : null}
    </div>
  );
}

function ShiftTemplateCreateSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [kode, setKode] = useState("");
  const [nama, setNama] = useState("");
  const [jamMulai, setJamMulai] = useState("");
  const [jamSelesai, setJamSelesai] = useState("");
  const [urutanTampil, setUrutanTampil] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!kode.trim() || !nama.trim() || !jamMulai || !jamSelesai) {
      setError("Kode, nama, jam mulai, dan jam selesai wajib diisi.");
      return;
    }
    if (jamSelesai <= jamMulai) {
      setError("Jam selesai harus lebih besar dari jam mulai.");
      return;
    }
    setSaving(true);
    try {
      await createShiftTemplate({
        kode: kode.trim(),
        nama: nama.trim(),
        jamMulai,
        jamSelesai,
        urutanTampil: urutanTampil ? Number(urutanTampil) : undefined,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal membuat shift.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">Tambah shift baru</h2>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kode">
              <Input value={kode} onChange={(e) => setKode(e.target.value)} placeholder="Misal: PAGI" required />
            </Field>
            <Field label="Nama">
              <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Misal: Pagi" required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Jam mulai">
              <Input type="time" value={jamMulai} onChange={(e) => setJamMulai(e.target.value)} required />
            </Field>
            <Field label="Jam selesai">
              <Input type="time" value={jamSelesai} onChange={(e) => setJamSelesai(e.target.value)} required />
            </Field>
          </div>
          <Field label="Urutan tampil (opsional)">
            <Input
              type="number"
              min={0}
              step={1}
              value={urutanTampil}
              onChange={(e) => setUrutanTampil(e.target.value)}
              placeholder="Menentukan urutan di dropdown, kecil tampil duluan"
            />
          </Field>

          {error ? <ErrorBox>{error}</ErrorBox> : null}

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Menyimpan..." : "Buat shift"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function ShiftTemplateEditSheet({
  template,
  onClose,
  onSaved,
}: {
  template: ShiftTemplateListItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nama, setNama] = useState(template.nama);
  const [jamMulai, setJamMulai] = useState(jamLabel(template.jamMulai));
  const [jamSelesai, setJamSelesai] = useState(jamLabel(template.jamSelesai));
  const [urutanTampil, setUrutanTampil] = useState(String(template.urutanTampil));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [togglingAktif, setTogglingAktif] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [confirmingNonaktif, setConfirmingNonaktif] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (!nama.trim() || !jamMulai || !jamSelesai) {
      setError("Nama, jam mulai, dan jam selesai wajib diisi.");
      return;
    }
    if (jamSelesai <= jamMulai) {
      setError("Jam selesai harus lebih besar dari jam mulai.");
      return;
    }
    setSaving(true);
    try {
      await updateShiftTemplate(template.id, {
        nama: nama.trim(),
        jamMulai,
        jamSelesai,
        urutanTampil: urutanTampil ? Number(urutanTampil) : undefined,
      });
      onSaved();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan perubahan shift.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleAktif() {
    setTogglingAktif(true);
    setToggleError(null);
    try {
      await updateShiftTemplate(template.id, { aktif: !template.aktif });
      onSaved();
      setConfirmingNonaktif(false);
      onClose();
    } catch (err) {
      setToggleError(err instanceof ApiError ? err.message : "Gagal mengubah status aktif shift.");
    } finally {
      setTogglingAktif(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{template.nama}</h2>
            <p className="text-xs text-slate-500">
              {template.kode} {!template.aktif ? <Badge tone="neutral">Nonaktif</Badge> : null}
            </p>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Nama">
            <Input value={nama} onChange={(e) => setNama(e.target.value)} required />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Jam mulai">
              <Input type="time" value={jamMulai} onChange={(e) => setJamMulai(e.target.value)} required />
            </Field>
            <Field label="Jam selesai">
              <Input type="time" value={jamSelesai} onChange={(e) => setJamSelesai(e.target.value)} required />
            </Field>
          </div>
          <Field label="Urutan tampil">
            <Input type="number" min={0} step={1} value={urutanTampil} onChange={(e) => setUrutanTampil(e.target.value)} />
          </Field>

          {error ? <ErrorBox>{error}</ErrorBox> : null}
          {success ? <ResultBox>Tersimpan.</ResultBox> : null}

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? "Menyimpan..." : "Simpan perubahan"}
          </Button>
        </form>

        <div className="mt-4 border-t border-slate-100 pt-4">
          {toggleError ? (
            <div className="mb-3">
              <ErrorBox>{toggleError}</ErrorBox>
            </div>
          ) : null}
          <p className="mb-2 text-xs text-slate-500">
            {template.aktif
              ? "Shift nonaktif tidak akan muncul lagi di dropdown pembuatan jadwal baru -- jadwal lama yang sudah memakai shift ini tetap tidak berubah."
              : "Shift ini sedang nonaktif, tidak muncul di dropdown pembuatan jadwal baru. Aktifkan lagi kalau mau dipakai."}
          </p>
          <Button
            variant={template.aktif ? "danger" : "secondary"}
            className="w-full"
            disabled={togglingAktif}
            onClick={() => (template.aktif ? setConfirmingNonaktif(true) : handleToggleAktif())}
          >
            {togglingAktif ? "Memproses..." : template.aktif ? "Nonaktifkan shift" : "Aktifkan shift"}
          </Button>
        </div>
      </div>

      {confirmingNonaktif ? (
        <ConfirmDialog
          title="Nonaktifkan shift?"
          message={`"${template.nama}" tidak akan muncul lagi di dropdown pembuatan jadwal baru. Jadwal yang sudah memakai shift ini tidak berubah. Bisa diaktifkan lagi kapan saja.`}
          danger
          loading={togglingAktif}
          onConfirm={handleToggleAktif}
          onCancel={() => setConfirmingNonaktif(false)}
        />
      ) : null}
    </div>
  );
}
