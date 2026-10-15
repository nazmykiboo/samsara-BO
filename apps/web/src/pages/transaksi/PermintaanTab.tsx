import { useMemo, useState } from "react";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { PermintaanTransferForm } from "./PermintaanTransferForm";
import { PermintaanMasukPanel } from "./PermintaanMasukPanel";

type SubTab = "ajukan" | "masuk";

export function PermintaanTab() {
  const options = useLokasiOptions();
  const punyaLokasiCk = useMemo(() => options.some((l) => l.entitas === "samsara_ck"), [options]);

  const [subTab, setSubTab] = useState<SubTab>("ajukan");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-slate-200">
        <SubTabButton active={subTab === "ajukan"} onClick={() => setSubTab("ajukan")}>
          Ajukan
        </SubTabButton>
        {punyaLokasiCk ? (
          <SubTabButton active={subTab === "masuk"} onClick={() => setSubTab("masuk")}>
            Permintaan Masuk (CK)
          </SubTabButton>
        ) : null}
      </div>

      {subTab === "masuk" && punyaLokasiCk ? <PermintaanMasukPanel /> : <PermintaanTransferForm />}
    </div>
  );
}

function SubTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm font-medium ${
        active ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
