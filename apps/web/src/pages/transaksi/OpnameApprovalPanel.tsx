import { useEffect, useState } from "react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { listOpname, decideOpname } from "../../api/transaksi";
import { ApiError } from "../../api/client";
import type { DecideOpnameResult, OpnameDecision, OpnameListItem } from "../../api/types";
import { MOCK_LOKASI } from "../../mock/referenceData";

export function OpnameApprovalPanel() {
  const [drafts, setDrafts] = useState<OpnameListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OpnameListItem | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listOpname({ status: "draft" })
      .then((res) => {
        if (active) setDrafts(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat daftar opname draft.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadCounter]);

  if (selected) {
    return (
      <OpnameDecisionCard
        opname={selected}
        onBack={() => setSelected(null)}
        onDecided={() => {
          setSelected(null);
          setReloadCounter((n) => n + 1);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {loading ? <Spinner label="Memuat draft opname..." /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}

      {!loading && !error ? (
        <div className="space-y-2">
          {!drafts || drafts.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Tidak ada draft opname yang menunggu persetujuan.</p>
          ) : (
            drafts.map((d) => {
              const lokasi = MOCK_LOKASI.find((l) => l.id === Number(d.locationId));
              return (
                <button
                  key={d.headerId}
                  onClick={() => setSelected(d)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-blue-300"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">Opname #{d.headerId}</p>
                    <p className="text-xs text-slate-500">
                      {lokasi?.name ?? d.locationId} &middot; {d.tanggal} &middot; {d.baris.length} item
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
      ) : null}
    </div>
  );
}

function OpnameDecisionCard({
  opname,
  onBack,
  onDecided,
}: {
  opname: OpnameListItem;
  onBack: () => void;
  onDecided: () => void;
}) {
  const [saving, setSaving] = useState<OpnameDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DecideOpnameResult | null>(null);
  const lokasi = MOCK_LOKASI.find((l) => l.id === Number(opname.locationId));

  async function handleDecide(decision: OpnameDecision) {
    setError(null);
    setSaving(decision);
    try {
      const res = await decideOpname(Number(opname.headerId), decision);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memproses keputusan opname.");
    } finally {
      setSaving(null);
    }
  }

  if (result) {
    return (
      <Card>
        <ResultBox>
          Opname #{result.headerId} {result.status === "disetujui" ? "disetujui" : "ditolak"}.
          {result.status === "disetujui"
            ? ` Selisih diposting: ${result.baris.map((b) => `${b.itemKode ?? "-"} (${b.selisih})`).join(", ")}.`
            : " Stok tidak berubah."}
        </ResultBox>
        <Button className="mt-3 w-full" onClick={onDecided}>
          Kembali ke daftar
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Opname #{opname.headerId}</h2>
          <p className="text-xs text-slate-500">
            {lokasi?.name ?? opname.locationId} &middot; {opname.tanggal}
          </p>
        </div>
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline">
          Kembali
        </button>
      </div>

      <div className="space-y-2">
        {opname.baris.map((b) => (
          <div key={b.itemKode} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span className="font-medium text-slate-900">{b.itemName ?? b.itemKode}</span>
            <span className="text-slate-600">
              sistem {b.qtySistem} &rarr; fisik {b.qtyFisik} ({b.selisih > 0 ? "+" : ""}
              {b.selisih})
            </span>
          </div>
        ))}
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorBox>{error}</ErrorBox>
        </div>
      ) : null}

      <div className="mt-4 flex gap-3">
        <Button variant="danger" className="flex-1" disabled={saving !== null} onClick={() => handleDecide("tolak")}>
          {saving === "tolak" ? "Memproses..." : "Tolak"}
        </Button>
        <Button className="flex-1" disabled={saving !== null} onClick={() => handleDecide("setuju")}>
          {saving === "setuju" ? "Memproses..." : "Setujui"}
        </Button>
      </div>
    </Card>
  );
}
