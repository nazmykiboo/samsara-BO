import { useState, type ChangeEvent, type FormEvent } from "react";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { setIdentitasBisnisLogo, setIdentitasBisnisNama } from "../../api/identitas-bisnis";
import { ApiError } from "../../api/client";
import { useIdentitasBisnis } from "../../data/IdentitasBisnisContext";

const TIPE_DIIZINKAN = ["image/png", "image/jpeg", "image/webp"];
const UKURAN_MAKS_BYTES = 500 * 1024;

export function IdentitasBisnisTab() {
  const { displayName, logoUrl, muatUlang } = useIdentitasBisnis();
  const [nama, setNama] = useState(displayName);
  const [savingNama, setSavingNama] = useState(false);
  const [errorNama, setErrorNama] = useState<string | null>(null);
  const [suksesNama, setSuksesNama] = useState(false);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [errorLogo, setErrorLogo] = useState<string | null>(null);

  async function handleSubmitNama(e: FormEvent) {
    e.preventDefault();
    setErrorNama(null);
    setSuksesNama(false);
    if (!nama.trim()) {
      setErrorNama("Nama tidak boleh kosong.");
      return;
    }
    setSavingNama(true);
    try {
      await setIdentitasBisnisNama(nama.trim());
      setSuksesNama(true);
      muatUlang();
    } catch (err) {
      setErrorNama(err instanceof ApiError ? err.message : "Gagal menyimpan nama.");
    } finally {
      setSavingNama(false);
    }
  }

  async function handlePilihLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErrorLogo(null);

    if (!TIPE_DIIZINKAN.includes(file.type)) {
      setErrorLogo("Tipe file wajib PNG, JPG, atau WebP.");
      return;
    }
    if (file.size > UKURAN_MAKS_BYTES) {
      setErrorLogo(`Ukuran file maksimal 500KB (file ini ${Math.ceil(file.size / 1024)}KB).`);
      return;
    }

    setUploadingLogo(true);
    try {
      await setIdentitasBisnisLogo(file);
      muatUlang();
    } catch (err) {
      setErrorLogo(err instanceof ApiError ? err.message : "Gagal mengunggah logo.");
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Nama tampilan</h2>
        <p className="mb-3 text-sm text-slate-500">
          Tampil di sidebar, halaman login, dan judul tab browser.
        </p>
        <form onSubmit={handleSubmitNama} className="space-y-2">
          <Field label="Nama">
            <Input
              value={nama}
              onChange={(e) => {
                setNama(e.target.value);
                setSuksesNama(false);
              }}
              required
            />
          </Field>
          {errorNama ? <ErrorBox>{errorNama}</ErrorBox> : null}
          {suksesNama ? <ResultBox>Tersimpan.</ResultBox> : null}
          <Button type="submit" disabled={savingNama}>
            {savingNama ? "Menyimpan..." : "Simpan nama"}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Logo</h2>
        <p className="mb-3 text-sm text-slate-500">PNG, JPG, atau WebP, maksimal 500KB.</p>
        <div className="mb-3 flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt="Logo saat ini" className="h-16 w-16 rounded border border-slate-200 object-contain" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-slate-300 text-xs text-slate-400">
              Belum ada
            </div>
          )}
          <label>
            <span className="inline-block cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              {uploadingLogo ? "Mengunggah..." : "Pilih file logo"}
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={uploadingLogo}
              onChange={handlePilihLogo}
            />
          </label>
        </div>
        {errorLogo ? <ErrorBox>{errorLogo}</ErrorBox> : null}
      </Card>
    </div>
  );
}
