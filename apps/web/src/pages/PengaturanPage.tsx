import { useEffect, useMemo, useState, type FormEvent } from "react";
import { KelolaUserTab } from "./pengaturan/KelolaUserTab";
import { ShiftTab } from "./pengaturan/ShiftTab";
import { PlaceholderPage } from "../components/PlaceholderPage";
import { Card } from "../components/ui/Card";
import { Field, Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { usePermission } from "../auth/usePermission";
import { getTargetFoodCostPersen, setTargetFoodCostPersen } from "../api/pengaturan";
import { ApiError } from "../api/client";

type Tab = "user" | "shift" | "lainnya";

export function PengaturanPage() {
  const canKelolaUser = usePermission("user.manage");
  const canKelolaShift = usePermission("shift_template.manage");
  // Semua kontrol di tab "Lainnya" (target food cost, metode HPP default, lokasi, channel) adalah
  // `pengaturan.manage` = OWNER SAJA. Sebelumnya tab-nya tetap tampil untuk Manajer Ops padahal
  // isinya kosong/ditolak backend -- sekarang tabnya tidak ditampilkan sama sekali untuk dia.
  const canPengaturanSistem = usePermission("pengaturan.manage");

  // Tab "Kelola User" cuma untuk Owner (backend user.manage owner-only) -- Manajer Ops yang masuk ke
  // halaman ini tidak boleh melihat tab-nya sama sekali (bukan cuma kontennya disembunyikan), jadi
  // untuk dia "Shift" jadi tab default/satu-satunya yang relevan.
  const tabs = useMemo<{ key: Tab; label: string }[]>(
    () => [
      ...(canKelolaUser ? [{ key: "user" as const, label: "Kelola User" }] : []),
      ...(canKelolaShift ? [{ key: "shift" as const, label: "Shift" }] : []),
      ...(canPengaturanSistem ? [{ key: "lainnya" as const, label: "Lainnya" }] : []),
    ],
    [canKelolaUser, canKelolaShift, canPengaturanSistem],
  );
  const [tab, setTab] = useState<Tab>(canKelolaUser ? "user" : "shift");
  const tabAktif = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Pengaturan</h1>
        <p className="text-sm text-slate-500">Kelola akun tim yang boleh login, jenis shift, dan pengaturan sistem lainnya.</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tabAktif === t.key ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tabAktif === "user" && canKelolaUser ? <KelolaUserTab /> : null}
      {tabAktif === "shift" && canKelolaShift ? <ShiftTab /> : null}
      {tabAktif === "lainnya" && canPengaturanSistem ? (
        <div className="space-y-4">
          <TargetFoodCostCard />
          <PlaceholderPage
            title="Pengaturan lainnya"
            rencana={[
              "Metode HPP default global (harga_master / harga_beli_terakhir)",
              "Kelola lokasi: tambah, ubah nama/entitas, nonaktifkan (butuh GET /lokasi, lihat catatan struktur)",
              "Kelola channel penjualan: tambah, ubah nama/status (butuh GET /channel, lihat catatan struktur)",
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

function TargetFoodCostCard() {
  // Lapis kedua (tab-nya sendiri sudah disembunyikan untuk non-owner) -- backend pengaturan.manage.
  const canPengaturanSistem = usePermission("pengaturan.manage");
  if (!canPengaturanSistem) return null;
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Target Food Cost Standar (%)</h2>
      <p className="mb-3 text-sm text-slate-500">
        Dipakai sebagai patokan default saat menghitung rekomendasi harga jual per channel, kalau target
        tidak diisi manual saat menghitung rekomendasi.
      </p>
      <TargetFoodCostForm />
    </Card>
  );
}

function TargetFoodCostForm() {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    getTargetFoodCostPersen()
      .then((res) => {
        if (active) setValue(String(res.targetFoodCostPersen));
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat target food cost.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0 || num > 100) {
      setError("Target food cost harus berupa angka lebih dari 0 dan maksimal 100.");
      return;
    }
    setSaving(true);
    try {
      await setTargetFoodCostPersen(num);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan target food cost.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner label="Memuat target food cost..." />;

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Field label="Target food cost (%)">
        <Input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSuccess(false);
          }}
        />
      </Field>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">Tersimpan.</p> : null}
      <Button type="submit" disabled={saving}>
        {saving ? "Menyimpan..." : "Simpan target food cost"}
      </Button>
    </form>
  );
}
