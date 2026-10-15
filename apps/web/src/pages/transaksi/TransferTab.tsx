import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { bisaTransferKirim } from "../../auth/permissions";
import { TransferKirimForm } from "./TransferKirimForm";
import { TransferTerimaPanel } from "./TransferTerimaPanel";

type SubTab = "kirim" | "terima";

export function TransferTab() {
  const { user } = useAuth();
  const canKirim = user ? bisaTransferKirim(user.role) : false;
  const [subTab, setSubTab] = useState<SubTab>(canKirim ? "kirim" : "terima");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-slate-200">
        {canKirim ? (
          <SubTabButton active={subTab === "kirim"} onClick={() => setSubTab("kirim")}>
            Kirim
          </SubTabButton>
        ) : null}
        <SubTabButton active={subTab === "terima"} onClick={() => setSubTab("terima")}>
          Terima
        </SubTabButton>
      </div>

      {subTab === "kirim" && canKirim ? <TransferKirimForm /> : <TransferTerimaPanel />}
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
