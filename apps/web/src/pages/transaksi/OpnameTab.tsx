import { useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { bisaSetujuiOpname } from "../../auth/permissions";
import { OpnameInputForm } from "./OpnameInputForm";
import { OpnameApprovalPanel } from "./OpnameApprovalPanel";

type SubTab = "input" | "persetujuan";

export function OpnameTab() {
  const { user } = useAuth();
  const canApprove = user ? bisaSetujuiOpname(user.role) : false;
  const [subTab, setSubTab] = useState<SubTab>("input");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-slate-200">
        <SubTabButton active={subTab === "input"} onClick={() => setSubTab("input")}>
          Input Hitungan
        </SubTabButton>
        {canApprove ? (
          <SubTabButton active={subTab === "persetujuan"} onClick={() => setSubTab("persetujuan")}>
            Persetujuan
          </SubTabButton>
        ) : null}
      </div>

      {subTab === "persetujuan" && canApprove ? <OpnameApprovalPanel /> : <OpnameInputForm />}
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
