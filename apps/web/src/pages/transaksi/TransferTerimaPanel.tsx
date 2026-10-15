import { useEffect, useMemo, useState } from "react";
import { LokasiPicker, useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { getDalamPerjalanan } from "../../api/stok";
import { createTransferTerima } from "../../api/transaksi";
import { ApiError } from "../../api/client";
import type { DalamPerjalananRow, TransferTerimaResult } from "../../api/types";
import { MOCK_ITEMS, MOCK_LOKASI } from "../../mock/referenceData";

interface TransferGroup {
  transferId: string;
  locationAsalId: string;
  baris: DalamPerjalananRow[];
}

export function TransferTerimaPanel() {
  const options = useLokasiOptions();
  const [locationTujuanId, setLocationTujuanId] = useState<number | null>(options[0]?.id ?? null);
  const [rows, setRows] = useState<DalamPerjalananRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    if (locationTujuanId === null) return;
    let active = true;
    setLoading(true);
    setError(null);
    setSelectedTransferId(null);
    getDalamPerjalanan({ locationTujuan: locationTujuanId })
      .then((res) => {
        if (active) setRows(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat transfer dalam perjalanan.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locationTujuanId, reloadCounter]);

  const groups = useMemo<TransferGroup[]>(() => {
    const map = new Map<string, TransferGroup>();
    for (const row of rows) {
      const existing = map.get(row.transferId);
      if (existing) existing.baris.push(row);
      else map.set(row.transferId, { transferId: row.transferId, locationAsalId: row.locationAsalId, baris: [row] });
    }
    return [...map.values()];
  }, [rows]);

  const selectedGroup = groups.find((g) => g.transferId === selectedTransferId) ?? null;

  return (
    <div className="space-y-4">
      <LokasiPicker value={locationTujuanId} onChange={setLocationTujuanId} label="Lokasi tujuan (lokasi saya)" />

      {loading ? <Spinner label="Memuat transfer masuk..." /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {!loading && !error ? (
        selectedGroup ? (
          <TerimaForm
            group={selectedGroup}
            onBack={() => setSelectedTransferId(null)}
            onDone={() => {
              setSelectedTransferId(null);
              setReloadCounter((n) => n + 1);
            }}
          />
        ) : (
          <div className="space-y-2">
            {groups.length === 0 ? (
              <p className="text-sm text-slate-500">Tidak ada transfer yang menunggu diterima di lokasi ini.</p>
            ) : (
              groups.map((g) => {
                const asal = MOCK_LOKASI.find((l) => l.id === Number(g.locationAsalId));
                return (
                  <button
                    key={g.transferId}
                    onClick={() => setSelectedTransferId(g.transferId)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-blue-300"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">Transfer #{g.transferId}</p>
                      <p className="text-xs text-slate-500">
                        Dari {asal?.name ?? g.locationAsalId} &middot; {g.baris.length} item
                      </p>
                    </div>
                    <span aria-hidden className="text-slate-400">
                      ›
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )
      ) : null}
    </div>
  );
}

function TerimaForm({ group, onBack, onDone }: { group: TransferGroup; onBack: () => void; onDone: () => void }) {
  const [qtyTerima, setQtyTerima] = useState<Record<string, string>>(() =>
    Object.fromEntries(group.baris.map((b) => [b.itemKode ?? "", String(b.qtyKirim)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferTerimaResult | null>(null);

  async function handleSubmit() {
    setError(null);
    for (const b of group.baris) {
      const kode = b.itemKode ?? "";
      const val = Number(qtyTerima[kode]);
      if (!Number.isFinite(val) || val < 0) {
        setError(`Qty diterima untuk ${kode} harus angka >= 0.`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await createTransferTerima(
        group.transferId,
        group.baris.map((b) => ({ itemKode: b.itemKode ?? "", qtyTerima: Number(qtyTerima[b.itemKode ?? ""]) })),
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menerima transfer.");
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <Card>
        <ResultBox>
          Transfer #{result.headerId} diterima. Susut per item:{" "}
          {result.baris.map((b) => `${b.itemKode} (${b.susut})`).join(", ")}.
        </ResultBox>
        <Button className="mt-3 w-full" onClick={onDone}>
          Kembali ke daftar
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Terima transfer #{group.transferId}</h2>
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
          Kembali
        </button>
      </div>

      <div className="space-y-3">
        {group.baris.map((b) => {
          const item = MOCK_ITEMS.find((i) => i.kode === b.itemKode);
          return (
            <div key={b.itemKode} className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium text-slate-900">{item?.name ?? b.itemKode}</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label={`Qty dikirim (${b.unit})`}>
                  <Input value={b.qtyKirim} disabled />
                </Field>
                <Field label={`Qty diterima (${b.unit})`}>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={qtyTerima[b.itemKode ?? ""] ?? ""}
                    onChange={(e) => setQtyTerima((prev) => ({ ...prev, [b.itemKode ?? ""]: e.target.value }))}
                  />
                </Field>
              </div>
            </div>
          );
        })}
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorBox>{error}</ErrorBox>
        </div>
      ) : null}

      <Button className="mt-3 w-full" disabled={saving} onClick={handleSubmit}>
        {saving ? "Menyimpan..." : "Konfirmasi terima"}
      </Button>
    </Card>
  );
}
