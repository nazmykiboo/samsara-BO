import { useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { bisaMemenuhiPermintaan } from "../../auth/permissions";
import { useLokasiOptions } from "../../components/pickers/LokasiPicker";
import { PermintaanTransferForm } from "./PermintaanTransferForm";
import { PermintaanMasukPanel } from "./PermintaanMasukPanel";

type SubTab = "ajukan" | "masuk";

export function PermintaanTab() {
  const { user } = useAuth();
  const options = useLokasiOptions();
  // "Permintaan Masuk (CK)" (Layar CK) butuh DUA syarat: akun ditugaskan ke
  // lokasi Kitchen DAN role-nya berwenang memenuhi (transfer.kirim, lihat
  // GET .../layar-ck di backend) -- staf yang kebetulan ditugaskan ke CK
  // TETAP tidak boleh (backend selalu 403), jadi tab ini harus ikut
  // disembunyikan untuknya, bukan cuma menampilkan error 403 saat diklik.
  const punyaLokasiCk = useMemo(
    () => options.some((l) => l.tipe === "kitchen") && (user ? bisaMemenuhiPermintaan(user.role) : false),
    [options, user],
  );

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
