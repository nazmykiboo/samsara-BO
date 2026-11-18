import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { bisaMemenuhiPermintaan } from "../../auth/permissions";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { Badge, PermintaanStatusBadge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { createTransferKirim, getLayarCk, listPermintaanTransfer, tolakPermintaanTransfer } from "../../api/transaksi";
import { ApiError } from "../../api/client";
import type { LayarCkItem, PermintaanTransferListItem, PermintaanTransferStatus, TransferKirimResult } from "../../api/types";
import { MOCK_ITEMS } from "../../mock/referenceData";
import { todayIso } from "../../utils/format";

type StatusFilter = PermintaanTransferStatus | "semua";

/** Label shift Bahasa Indonesia -- sama dengan enum backend (pagi/siang/sore/malam, lihat
 * migrasi 0034), murni display, tidak ada logika di sini. */
const LABEL_SHIFT: Record<string, string> = { pagi: "Pagi", siang: "Siang", sore: "Sore", malam: "Malam" };

function formatWaktu(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Kelompokkan baris (1 baris = 1 item) jadi satu kartu per `kelompokId` (Tahap 1B, 2026-11-14)
 * -- tabel backend TETAP 1 baris = 1 item, ini murni pengelompokan TAMPILAN. Field yang sama
 * untuk semua baris dalam satu kelompok (tanggal/catatan/dibutuhkan-sebelum) diambil dari baris
 * PERTAMA; status/aksi tetap per-baris (item berbeda bisa dipenuhi/ditolak berbeda). */
function kelompokkan<T extends PermintaanTransferListItem>(rows: T[]): Array<{ kelompokId: number; baris: T[] }> {
  const peta = new Map<number, T[]>();
  for (const r of rows) {
    const list = peta.get(r.kelompokId) ?? [];
    list.push(r);
    peta.set(r.kelompokId, list);
  }
  return [...peta.entries()]
    .map(([kelompokId, baris]) => ({ kelompokId, baris }))
    .sort((a, b) => b.baris[0].createdAt.localeCompare(a.baris[0].createdAt));
}

export function PermintaanMasukPanel() {
  const { user } = useAuth();
  const options = useLokasiOptions();
  // Di-memo-kan (bukan .filter() polos tiap render): array baru tiap render
  // bikin useEffect di bawah yang bergantung ke ckOptions re-run tiap
  // render -- pola bug yang sama pernah ditemukan di StokPage.tsx (lihat
  // komentar di LokasiPicker.tsx), dicegah dari awal di sini.
  const ckOptions = useMemo(() => options.filter((l) => l.tipe === "kitchen"), [options]);
  const canPenuhi = user ? bisaMemenuhiPermintaan(user.role) : false;

  const [locationId, setLocationId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("diminta");
  const [rows, setRows] = useState<PermintaanTransferListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [penuhiTarget, setPenuhiTarget] = useState<{ permintaan: PermintaanTransferListItem; mode: "penuh" | "sebagian" } | null>(
    null,
  );
  const [tolakTarget, setTolakTarget] = useState<PermintaanTransferListItem | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (locationId === null && ckOptions.length > 0) setLocationId(ckOptions[0].id);
  }, [ckOptions, locationId]);

  useEffect(() => {
    if (locationId === null) {
      setRows([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    // "Layar CK" (status stok + saran) HANYA berlaku untuk permintaan yang
    // MASIH 'diminta' (lihat getLayarCk backend) -- status lain (riwayat
    // keputusan) pakai listPermintaanTransfer biasa, tidak perlu status stok.
    const permintaan =
      statusFilter === "diminta" ? getLayarCk(locationId) : listPermintaanTransfer({ lokasi: locationId, status: statusFilter === "semua" ? undefined : statusFilter });
    permintaan
      .then((res) => {
        if (active) setRows(res.filter((r) => r.locationAsalId === locationId));
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat permintaan masuk.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locationId, statusFilter, reloadCounter]);

  async function handleTolak(id: number, alasanTolak: string) {
    await tolakPermintaanTransfer(id, alasanTolak);
    setTolakTarget(null);
    setReloadCounter((n) => n + 1);
  }

  if (ckOptions.length === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-500">
          Akun ini tidak ditetapkan ke lokasi Central Kitchen manapun, jadi tidak bisa melihat permintaan masuk. Hubungi owner
          kalau seharusnya bisa.
        </p>
      </Card>
    );
  }

  const kelompok = kelompokkan(rows);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Lokasi Central Kitchen">
          <Select value={locationId ?? ""} onChange={(e) => setLocationId(Number(e.target.value))}>
            {ckOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="diminta">Menunggu dijawab</option>
            <option value="dipenuhi">Dipenuhi</option>
            <option value="dipenuhi_sebagian">Dipenuhi sebagian</option>
            <option value="ditolak">Ditolak</option>
            <option value="dibatalkan">Dibatalkan</option>
            <option value="semua">Semua status</option>
          </Select>
        </Field>
      </div>

      {loading ? <Spinner label="Memuat permintaan masuk..." /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {!loading && !error ? (
        kelompok.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Tidak ada permintaan dengan status ini.</p>
        ) : (
          <div className="space-y-3">
            {kelompok.map(({ kelompokId, baris }) => {
              const pertama = baris[0];
              return (
                <Card key={kelompokId}>
                  <div className="mb-2 flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        Dari {pertama.locationTujuanNama} &middot; diminta {formatWaktu(pertama.createdAt)}
                      </p>
                      {pertama.dibutuhkanSebelumTanggal ? (
                        <p className="text-xs text-slate-500">
                          Dibutuhkan sebelum {pertama.dibutuhkanSebelumTanggal}
                          {pertama.dibutuhkanSebelumShift ? ` (shift ${LABEL_SHIFT[pertama.dibutuhkanSebelumShift]})` : ""}
                        </p>
                      ) : null}
                      {pertama.catatan ? <p className="mt-0.5 text-xs text-slate-600">Catatan: {pertama.catatan}</p> : null}
                      {pertama.dimintaOlehUsername ? (
                        <p className="mt-0.5 text-xs text-slate-400">Diajukan oleh {pertama.dimintaOlehUsername}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {baris.map((r) => {
                      const item = MOCK_ITEMS.find((i) => i.kode === r.itemKode);
                      const layarItem = "statusStok" in r ? (r as LayarCkItem) : null;
                      return (
                        <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-slate-900">
                              {r.itemNama} &middot; {r.qtyDiminta} {item?.recipeUnit ?? ""}
                            </p>
                            <PermintaanStatusBadge status={r.status} />
                          </div>
                          <p className="text-xs text-slate-500">{r.kode}</p>

                          {layarItem ? (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <StatusStokBadge statusStok={layarItem.statusStok} stokSaatIni={layarItem.stokSaatIni} />
                              <span className="text-slate-500">
                                Saran: {layarItem.saran === "produksi" ? "Produksi dulu" : "Beli dari vendor"}
                              </span>
                            </div>
                          ) : null}

                          {r.status === "ditolak" && r.alasanTolak ? (
                            <p className="mt-1 text-xs text-red-600">Alasan ditolak: {r.alasanTolak}</p>
                          ) : null}
                          {r.status === "diminta" && r.diakuiPada ? (
                            <p className="mt-1 text-xs text-slate-400">
                              Diakui {formatWaktu(r.diakuiPada)}{r.diakuiOlehUsername ? ` oleh ${r.diakuiOlehUsername}` : ""}
                              {" "}(belum dipenuhi -- siapkan & kirim lewat tombol Penuhi)
                            </p>
                          ) : null}
                          {r.status !== "diminta" ? (
                            <p className="mt-1 text-xs text-slate-400">
                              {r.dijawabPada ? `Dijawab ${formatWaktu(r.dijawabPada)}${r.dijawabOlehUsername ? ` oleh ${r.dijawabOlehUsername}` : ""}` : null}
                              {r.dikirimPada ? ` · Dikirim ${formatWaktu(r.dikirimPada)}` : ""}
                              {r.diterimaPada ? ` · Diterima ${formatWaktu(r.diterimaPada)}` : ""}
                            </p>
                          ) : null}

                          {r.status === "diminta" && canPenuhi ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button className="flex-1" onClick={() => setPenuhiTarget({ permintaan: r, mode: "penuh" })}>
                                Penuhi
                              </Button>
                              <Button
                                variant="secondary"
                                className="flex-1"
                                onClick={() => setPenuhiTarget({ permintaan: r, mode: "sebagian" })}
                              >
                                Penuhi sebagian
                              </Button>
                              <Button variant="danger" className="flex-1" onClick={() => setTolakTarget(r)}>
                                Tolak
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      {penuhiTarget ? (
        <PenuhiPermintaanModal
          permintaan={penuhiTarget.permintaan}
          mode={penuhiTarget.mode}
          onClose={() => setPenuhiTarget(null)}
          onDone={() => {
            setPenuhiTarget(null);
            setReloadCounter((n) => n + 1);
          }}
        />
      ) : null}

      {tolakTarget ? (
        <TolakPermintaanModal permintaan={tolakTarget} onClose={() => setTolakTarget(null)} onTolak={handleTolak} />
      ) : null}
    </div>
  );
}

function StatusStokBadge({ statusStok, stokSaatIni }: { statusStok: LayarCkItem["statusStok"]; stokSaatIni: number }) {
  if (statusStok === "cukup") return <Badge tone="success">Stok cukup ({stokSaatIni})</Badge>;
  if (statusStok === "kurang") return <Badge tone="warning">Stok kurang ({stokSaatIni})</Badge>;
  return <Badge tone="danger">Stok habis ({stokSaatIni})</Badge>;
}

function PenuhiPermintaanModal({
  permintaan,
  mode,
  onClose,
  onDone,
}: {
  permintaan: PermintaanTransferListItem;
  mode: "penuh" | "sebagian";
  onClose: () => void;
  onDone: () => void;
}) {
  const item = MOCK_ITEMS.find((i) => i.kode === permintaan.itemKode);
  const [tanggal, setTanggal] = useState(todayIso());
  const [qtyKirim, setQtyKirim] = useState(mode === "penuh" ? String(permintaan.qtyDiminta) : "");
  const [unit, setUnit] = useState(item?.recipeUnit ?? "");
  const [hargaTransferPerSatuan, setHargaTransferPerSatuan] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferKirimResult | null>(null);

  async function handleSubmit() {
    setError(null);
    const qty = Number(qtyKirim);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Qty kirim harus angka lebih besar dari 0.");
      return;
    }
    if (!unit) {
      setError("Satuan wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      const res = await createTransferKirim({
        locationAsalId: permintaan.locationAsalId,
        locationTujuanId: permintaan.locationTujuanId,
        tanggal,
        baris: [
          {
            itemKode: permintaan.itemKode,
            qtyKirim: qty,
            unit,
            hargaTransferPerSatuan: hargaTransferPerSatuan ? Number(hargaTransferPerSatuan) : undefined,
          },
        ],
        permintaanId: permintaan.id,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengirim transfer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {result ? (
          <div className="space-y-3">
            <ResultBox>
              Transfer #{result.headerId} dikirim untuk memenuhi permintaan {permintaan.kode}. Stok {permintaan.locationAsalNama}{" "}
              sudah berkurang, menunggu diterima di {permintaan.locationTujuanNama}.
            </ResultBox>
            <Button className="w-full" onClick={onDone}>
              Selesai
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {mode === "penuh" ? "Penuhi" : "Penuhi sebagian"} {permintaan.kode}
                </h2>
                <p className="text-xs text-slate-500">
                  {permintaan.itemNama} untuk {permintaan.locationTujuanNama}
                </p>
              </div>
              <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <Field label="Tanggal kirim">
                <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Qty kirim">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={qtyKirim}
                    onChange={(e) => setQtyKirim(e.target.value)}
                    placeholder={mode === "sebagian" ? `Kurang dari ${permintaan.qtyDiminta}` : undefined}
                  />
                </Field>
                <Field label="Satuan">
                  <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
                </Field>
              </div>
              <Field label="Harga transfer per satuan (opsional)">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={hargaTransferPerSatuan}
                  onChange={(e) => setHargaTransferPerSatuan(e.target.value)}
                  placeholder="default: HPP lokasi asal"
                />
              </Field>
              <p className="text-xs text-slate-500">
                Diminta sebelumnya: {permintaan.qtyDiminta} {item?.recipeUnit ?? ""} -- kirim kurang dari ini akan tercatat
                sebagai "Dipenuhi sebagian", kirim sama/lebih tercatat "Dipenuhi".
              </p>
            </div>

            {error ? (
              <div className="mt-3">
                <ErrorBox>{error}</ErrorBox>
              </div>
            ) : null}

            <Button className="mt-4 w-full" disabled={saving} onClick={handleSubmit}>
              {saving ? "Mengirim..." : "Kirim transfer"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function TolakPermintaanModal({
  permintaan,
  onClose,
  onTolak,
}: {
  permintaan: PermintaanTransferListItem;
  onClose: () => void;
  onTolak: (id: number, alasanTolak: string) => Promise<void>;
}) {
  const [alasan, setAlasan] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!alasan.trim()) {
      setError("Alasan tolak wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      await onTolak(permintaan.id, alasan.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menolak permintaan.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Tolak {permintaan.kode}</h2>
            <p className="text-xs text-slate-500">
              {permintaan.itemNama} untuk {permintaan.locationTujuanNama}
            </p>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="text-lg text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <Field label="Alasan tolak (wajib)">
          <Input
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            placeholder="Contoh: stok bahan baku di CK juga sedang kosong"
          />
        </Field>

        {error ? (
          <div className="mt-3">
            <ErrorBox>{error}</ErrorBox>
          </div>
        ) : null}

        <Button variant="danger" className="mt-4 w-full" disabled={saving} onClick={handleSubmit}>
          {saving ? "Menolak..." : "Tolak permintaan"}
        </Button>
      </div>
    </div>
  );
}
