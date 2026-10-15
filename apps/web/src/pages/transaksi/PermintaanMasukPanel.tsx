import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { bisaMemenuhiPermintaan } from "../../auth/permissions";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { PermintaanStatusBadge } from "../../components/ui/Badge";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { createTransferKirim, listPermintaanTransfer } from "../../api/transaksi";
import { ApiError } from "../../api/client";
import type { PermintaanTransferListItem, PermintaanTransferStatus, TransferKirimResult } from "../../api/types";
import { MOCK_ITEMS } from "../../mock/referenceData";
import { todayIso } from "../../utils/format";

type StatusFilter = PermintaanTransferStatus | "semua";

export function PermintaanMasukPanel() {
  const { user } = useAuth();
  const options = useLokasiOptions();
  const ckOptions = options.filter((l) => l.entitas === "samsara_ck");
  const canPenuhi = user ? bisaMemenuhiPermintaan(user.role) : false;

  const [locationId, setLocationId] = useState<number | null>(ckOptions[0]?.id ?? null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("diminta");
  const [rows, setRows] = useState<PermintaanTransferListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PermintaanTransferListItem | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (locationId === null) {
      setRows([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    listPermintaanTransfer({ lokasi: locationId, status: statusFilter === "semua" ? undefined : statusFilter })
      .then((res) => {
        if (active) setRows(res.filter((r) => r.locationAsalId === String(locationId)));
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
            <option value="diminta">Menunggu dipenuhi</option>
            <option value="dipenuhi">Sudah dipenuhi</option>
            <option value="dibatalkan">Dibatalkan</option>
            <option value="semua">Semua status</option>
          </Select>
        </Field>
      </div>

      {loading ? <Spinner label="Memuat permintaan masuk..." /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {!loading && !error ? (
        rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Tidak ada permintaan dengan status ini.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const item = MOCK_ITEMS.find((i) => i.kode === r.itemKode);
              return (
                <Card key={r.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {r.itemNama} &middot; {r.qtyDiminta} {item?.recipeUnit ?? ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        {r.kode} &middot; dari {r.locationTujuanNama} &middot; dibutuhkan {r.tanggalDiminta}
                      </p>
                      {r.catatan ? <p className="mt-1 text-xs text-slate-600">Catatan: {r.catatan}</p> : null}
                      {r.dimintaOlehUsername ? (
                        <p className="mt-0.5 text-xs text-slate-400">Diajukan oleh {r.dimintaOlehUsername}</p>
                      ) : null}
                    </div>
                    <PermintaanStatusBadge status={r.status} />
                  </div>
                  {r.status === "diminta" && canPenuhi ? (
                    <Button className="mt-3 w-full" onClick={() => setSelected(r)}>
                      Penuhi permintaan
                    </Button>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      {selected ? (
        <PenuhiPermintaanModal
          permintaan={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            setSelected(null);
            setReloadCounter((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function PenuhiPermintaanModal({
  permintaan,
  onClose,
  onDone,
}: {
  permintaan: PermintaanTransferListItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const item = MOCK_ITEMS.find((i) => i.kode === permintaan.itemKode);
  const [tanggal, setTanggal] = useState(todayIso());
  const [qtyKirim, setQtyKirim] = useState(String(permintaan.qtyDiminta));
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
        locationAsalId: Number(permintaan.locationAsalId),
        locationTujuanId: Number(permintaan.locationTujuanId),
        tanggal,
        baris: [
          {
            itemKode: permintaan.itemKode,
            qtyKirim: qty,
            unit,
            hargaTransferPerSatuan: hargaTransferPerSatuan ? Number(hargaTransferPerSatuan) : undefined,
          },
        ],
        permintaanId: Number(permintaan.id),
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
                <h2 className="text-base font-semibold text-slate-900">Penuhi permintaan {permintaan.kode}</h2>
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
                  <Input type="number" min={0} step="any" value={qtyKirim} onChange={(e) => setQtyKirim(e.target.value)} />
                </Field>
                <Field label="Satuan">
                  <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
                </Field>
              </div>
              <Field label="Harga transfer per satuan (opsional)">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={hargaTransferPerSatuan}
                  onChange={(e) => setHargaTransferPerSatuan(e.target.value)}
                  placeholder="default: HPP lokasi asal"
                />
              </Field>
              <p className="text-xs text-slate-500">
                Diminta sebelumnya: {permintaan.qtyDiminta} {item?.recipeUnit ?? ""} -- qty kirim bisa diubah kalau mau mengirim
                jumlah berbeda.
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
