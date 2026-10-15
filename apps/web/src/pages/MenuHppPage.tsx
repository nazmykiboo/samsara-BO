import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { bisaKelolaPengaturan, bisaOverrideMetodeHpp, bisaUbahHargaJual } from "../auth/permissions";
import { listMenu, setVisibilitasChannel } from "../api/master";
import { getMenuHpp, getRekomendasiHarga, setMenuHargaChannel, setMenuHargaJual } from "../api/hpp";
import { getTargetFoodCostPersen } from "../api/pengaturan";
import { ApiError } from "../api/client";
import { usePermission } from "../auth/usePermission";
import type { HppMethod, MenuChannelInfo, MenuHppReport, MenuListItem } from "../api/types";
import { Input, Field } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { Badge, StatusPendingBadge } from "../components/ui/Badge";
import { ErrorBox } from "../components/ResultBox";
import { formatPersen, formatRupiah } from "../utils/format";
// Urutan tampil channel dipakai juga oleh grid Edit Harga Massal, jadi konstantanya dipindah ke
// utils/channel.ts (satu sumber, bukan dua daftar yang bisa berbeda). Channel aktif lain yang
// belum terdaftar di sana tampil di akhir.
import { URUTAN_CHANNEL } from "../utils/channel";
import { EditHargaMassalSection } from "./menu/EditHargaMassalSection";

/** Keterangan toggle tampil/sembunyi yang dinonaktifkan -- backend `menu_visibilitas.edit`
 * = owner SAJA (lebih sempit dari hak mengubah harga jual, yang juga dipegang manajer_ops). */
const ALASAN_TIDAK_BOLEH_UBAH_TAYANG =
  "Hanya Owner yang bisa menampilkan/menyembunyikan menu di channel penjualan.";

function urutkanChannel(channels: MenuChannelInfo[]): MenuChannelInfo[] {
  return [...channels].sort((a, b) => {
    const ia = URUTAN_CHANNEL.indexOf(a.channel);
    const ib = URUTAN_CHANNEL.indexOf(b.channel);
    const ra = ia === -1 ? URUTAN_CHANNEL.length : ia;
    const rb = ib === -1 ? URUTAN_CHANNEL.length : ib;
    return ra - rb;
  });
}

export function MenuHppPage() {
  const [menuList, setMenuList] = useState<MenuListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKode, setSelectedKode] = useState<string | null>(null);
  // Mode edit harga massal (grid menu x channel). Permission `harga_jual.edit` = OWNER SAJA --
  // sama dengan form harga per channel di detail menu, bukan permission baru.
  const bisaEditHarga = usePermission("harga_jual.edit");
  const [modeMassal, setModeMassal] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    listMenu()
      .then((res) => {
        if (active) setMenuList(res);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : "Gagal memuat daftar menu.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return menuList;
    return menuList.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.kategori ?? "").toLowerCase().includes(q) ||
        (m.kode ?? "").toLowerCase().includes(q),
    );
  }, [menuList, query]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Menu & HPP</h1>
          <p className="text-sm text-slate-500">Daftar menu dan harga pokok penjualan per porsi.</p>
        </div>
        {bisaEditHarga && !modeMassal ? (
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => setModeMassal(true)}>
            Edit Harga Massal
          </Button>
        ) : null}
      </div>

      {loadError ? <ErrorBox>{loadError}</ErrorBox> : null}

      {modeMassal ? (
        <EditHargaMassalSection menuList={menuList} onTutup={() => setModeMassal(false)} />
      ) : (
        <>
          <Input
            placeholder="Cari nama menu, kategori, atau kode..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {loading ? <Spinner label="Memuat daftar menu..." /> : null}

          <div className="space-y-2">
            {filtered.map((m) => (
              <button
                key={m.kode ?? m.name}
                onClick={() => (m.kode ? setSelectedKode(m.kode) : undefined)}
                disabled={!m.kode}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {m.name} {!m.isActive ? <Badge tone="neutral">Nonaktif</Badge> : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {m.kode ?? "-"} &middot; {m.kategori ?? "-"}
                  </p>
                </div>
                {m.status === "pending_data" ? (
                  <StatusPendingBadge status="pending_data" />
                ) : (
                  <span aria-hidden className="text-slate-400">
                    ›
                  </span>
                )}
              </button>
            ))}
            {!loading && filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Tidak ada menu yang cocok.</p>
            ) : null}
          </div>
        </>
      )}

      {selectedKode ? <MenuDetailSheet kode={selectedKode} onClose={() => setSelectedKode(null)} /> : null}
    </div>
  );
}

function MenuDetailSheet({ kode, onClose }: { kode: string; onClose: () => void }) {
  const { user } = useAuth();
  // Dipakai cuma untuk keterangan sekali di atas daftar channel -- gate togglenya sendiri ada
  // di ChannelHargaRow.
  const bisaUbahVisibilitas = usePermission("menu_visibilitas.edit");
  const [metode, setMetode] = useState<HppMethod | undefined>(undefined);
  const [data, setData] = useState<MenuHppReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [targetFoodCostPersen, setTargetFoodCostPersen] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getMenuHpp(kode, metode)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat HPP.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [kode, metode, reloadCounter]);

  // Target food cost standar cuma dipakai untuk peringatan di sisi tampilan -- endpoint-nya
  // owner-only, jadi role lain cukup lewati (bukan dianggap error).
  useEffect(() => {
    if (!user || !bisaKelolaPengaturan(user.role)) return;
    let active = true;
    getTargetFoodCostPersen()
      .then((res) => {
        if (active) setTargetFoodCostPersen(res.targetFoodCostPersen);
      })
      .catch(() => {
        // Diamkan -- peringatan target food cost sifatnya tambahan, bukan inti modal ini.
      });
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">{data?.name ?? kode}</h2>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {user && bisaOverrideMetodeHpp(user.role) ? (
          <div className="mb-4">
            <Field label="Metode HPP (khusus tampilan ini)">
              <Select value={metode ?? ""} onChange={(e) => setMetode(e.target.value ? (e.target.value as HppMethod) : undefined)}>
                <option value="">Default sistem</option>
                <option value="harga_master">Harga Master</option>
                <option value="harga_beli_terakhir">Harga Beli Terakhir</option>
              </Select>
            </Field>
          </div>
        ) : null}

        {loading ? <Spinner label="Memuat HPP..." /> : null}
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        {data && !loading ? (
          <div className="space-y-4">
            <StatusPendingBadge status={data.status} />

            <dl className="space-y-2 text-sm">
              {data.hpp_per_porsi !== undefined ? <Row label="HPP per porsi" value={formatRupiah(data.hpp_per_porsi)} /> : null}
              <Row label="Harga jual" value={formatRupiah(data.harga_jual)} />
              {data.food_cost_pct !== undefined ? <Row label="Food cost %" value={formatPersen(data.food_cost_pct)} /> : null}
              {data.margin !== undefined ? <Row label="Margin" value={formatRupiah(data.margin)} /> : null}
            </dl>

            {user && bisaUbahHargaJual(user.role) ? (
              <HargaJualForm
                kode={kode}
                currentHargaJual={data.harga_jual}
                onSaved={() => setReloadCounter((n) => n + 1)}
              />
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-900">Harga jual per channel</h3>
              {/* Keterangan ditaruh SEKALI di sini, bukan diulang di setiap baris channel --
                  tooltip tidak bisa diandalkan di HP, jadi alasannya tetap perlu tertulis. */}
              {!bisaUbahVisibilitas ? (
                <p className="mb-2 text-xs text-slate-500">{ALASAN_TIDAK_BOLEH_UBAH_TAYANG}</p>
              ) : null}
              <div className="space-y-3">
                {urutkanChannel(data.channels).map((ch) => (
                  <ChannelHargaRow
                    key={`${kode}-${ch.channel}`}
                    kode={kode}
                    channel={ch}
                    hppPerPorsi={data.hpp_per_porsi}
                    canEdit={Boolean(user && bisaUbahHargaJual(user.role))}
                    targetFoodCostPersen={targetFoodCostPersen}
                    onSaved={() => setReloadCounter((n) => n + 1)}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function HargaJualForm({
  kode,
  currentHargaJual,
  onSaved,
}: {
  kode: string;
  currentHargaJual: number | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(currentHargaJual !== null ? String(currentHargaJual) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      setError("Harga jual harus berupa angka >= 0.");
      return;
    }
    setSaving(true);
    try {
      await setMenuHargaJual(kode, num);
      onSaved();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan harga jual.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-slate-200 p-3">
      <Field label="Ubah harga jual">
        <Input type="number" min={0} step={100} value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">Tersimpan.</p> : null}
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Menyimpan..." : "Simpan harga jual"}
      </Button>
    </form>
  );
}

/** Dihitung di sisi tampilan saja dari HPP yang sudah ada di response (tanpa panggil API lagi),
 * supaya angka ikut berubah live saat staf mengetik harga. */
function hitungLiveMetrics(
  hppPerPorsi: number | null | undefined,
  hargaInput: string,
): { foodCostPct: number; markupPct: number; marginPct: number } | null {
  if (typeof hppPerPorsi !== "number" || hppPerPorsi <= 0) return null;
  const harga = Number(hargaInput);
  if (!Number.isFinite(harga) || harga <= 0) return null;
  const foodCostPct = (hppPerPorsi / harga) * 100;
  const markupPct = ((harga - hppPerPorsi) / hppPerPorsi) * 100;
  const marginPct = 100 - foodCostPct;
  return { foodCostPct, markupPct, marginPct };
}

function ChannelHargaRow({
  kode,
  channel,
  hppPerPorsi,
  canEdit,
  targetFoodCostPersen,
  onSaved,
}: {
  kode: string;
  channel: MenuChannelInfo;
  hppPerPorsi: number | null | undefined;
  canEdit: boolean;
  targetFoodCostPersen: number | null;
  onSaved: () => void;
}) {
  // Visibilitas channel pakai permission SENDIRI yang LEBIH SEMPIT dari harga jual:
  // `menu_visibilitas.edit` = owner saja (manajer_ops ditolak 403 oleh backend). Untuk role
  // lain togglenya tetap DITAMPILKAN tapi dinonaktifkan -- supaya mereka tahu menu ini sedang
  // tayang atau disembunyikan, tanpa bisa mengubahnya.
  const bisaUbahVisibilitas = usePermission("menu_visibilitas.edit");
  const [value, setValue] = useState(channel.hargaJual !== null ? String(channel.hargaJual) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [recoLoading, setRecoLoading] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);
  // "Tidak ada baris di tabel visibilitas" = TAYANG, jadi nilai yang tidak terkirim
  // diperlakukan sebagai tayang (bukan error, bukan tersembunyi).
  const [tayang, setTayang] = useState(channel.isVisible !== false);
  const [savingTayang, setSavingTayang] = useState(false);
  const [errorTayang, setErrorTayang] = useState<string | null>(null);

  // Ikut nilai server lagi kalau data HPP dimuat ulang (mis. setelah harga disimpan) --
  // bukan loop: hanya dipicu kalau nilai dari server memang berubah.
  useEffect(() => {
    setTayang(channel.isVisible !== false);
  }, [channel.isVisible]);

  const liveMetrics = hitungLiveMetrics(hppPerPorsi, value);
  const overTarget =
    liveMetrics && targetFoodCostPersen !== null && liveMetrics.foodCostPct > targetFoodCostPersen;

  async function handleSimpan(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      setError("Harga jual harus berupa angka >= 0.");
      return;
    }
    setSaving(true);
    try {
      await setMenuHargaChannel(kode, channel.channel, num);
      onSaved();
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan harga jual channel ini.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Tayang/sembunyi langsung disimpan saat toggle diubah (tanpa tombol simpan terpisah).
   *
   * PENTING: ini panggilan TERPISAH dari form harga di baris yang sama -- `hargaJual` tidak
   * dikirim/disentuh sama sekali, dan isian harga yang sedang diketik user tidak ikut tersimpan.
   * Sengaja juga TIDAK memanggil `onSaved()`: memuat ulang data HPP di sini akan menimpa angka
   * harga yang mungkin sedang diketik tapi belum disimpan.
   */
  async function handleUbahTayang() {
    if (!bisaUbahVisibilitas || savingTayang) return;
    const target = !tayang;
    setErrorTayang(null);
    setSavingTayang(true);
    setTayang(target);
    try {
      await setVisibilitasChannel(kode, channel.channel, target);
    } catch (err) {
      // Dibalikkan ke keadaan sebelumnya supaya tampilan tidak membohongi staf.
      setTayang(!target);
      setErrorTayang(
        err instanceof ApiError ? err.message : "Gagal mengubah pengaturan tampil di channel ini.",
      );
    } finally {
      setSavingTayang(false);
    }
  }

  async function handleIsiRekomendasi() {
    setRecoError(null);
    setRecoLoading(true);
    try {
      const res = await getRekomendasiHarga(kode);
      const found = res.rekomendasi.find((r) => r.channel === channel.channel);
      if (!found) {
        setRecoError("Rekomendasi belum tersedia (HPP menunggu data).");
        return;
      }
      setValue(String(found.hargaJual));
      setSuccess(false);
    } catch (err) {
      setRecoError(err instanceof ApiError ? err.message : "Gagal mengambil rekomendasi harga.");
    } finally {
      setRecoLoading(false);
    }
  }

  return (
    <form onSubmit={handleSimpan} className="space-y-2 rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium text-slate-900">{channel.channel}</span>
          {channel.status === "belum_diisi" ? (
            <span className="ml-2 text-xs text-slate-400">Harga belum diisi</span>
          ) : null}
        </div>
        <label className="flex shrink-0 items-center gap-2" title={bisaUbahVisibilitas ? undefined : ALASAN_TIDAK_BOLEH_UBAH_TAYANG}>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={tayang}
            disabled={!bisaUbahVisibilitas || savingTayang}
            onChange={handleUbahTayang}
          />
          <span className="text-xs text-slate-600">Tampil di channel ini</span>
        </label>
      </div>

      {!tayang ? (
        <p className="text-xs text-slate-500">
          Menu ini sedang disembunyikan di {channel.channel} — harganya tetap tersimpan dan dipakai lagi begitu
          ditampilkan ulang.
        </p>
      ) : null}
      {errorTayang ? <p className="text-sm text-red-600">{errorTayang}</p> : null}

      {canEdit ? (
        <Input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSuccess(false);
          }}
          placeholder="Belum diisi"
        />
      ) : (
        <p className="text-sm text-slate-700">{formatRupiah(channel.hargaJual)}</p>
      )}

      {liveMetrics ? (
        <dl className="grid grid-cols-3 gap-2 text-xs text-slate-600">
          <div>
            <dt className="text-slate-400">Food cost</dt>
            <dd className="font-medium text-slate-900">{formatPersen(liveMetrics.foodCostPct)}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Markup</dt>
            <dd className="font-medium text-slate-900">{formatPersen(liveMetrics.markupPct)}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Margin</dt>
            <dd className="font-medium text-slate-900">{formatPersen(liveMetrics.marginPct)}</dd>
          </div>
        </dl>
      ) : null}

      {overTarget ? (
        <p className="text-sm text-amber-700">
          Food cost di atas target {formatPersen(targetFoodCostPersen)}.
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-600">Tersimpan.</p> : null}
      {recoError ? <p className="text-sm text-red-600">{recoError}</p> : null}

      {canEdit ? (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={recoLoading}
            onClick={handleIsiRekomendasi}
            className="flex-1"
          >
            {recoLoading ? "Memuat..." : "Isi dari rekomendasi"}
          </Button>
          <Button type="submit" disabled={saving} className="flex-1">
            {saving ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
