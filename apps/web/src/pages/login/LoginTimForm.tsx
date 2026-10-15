import { useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { listStafAtLocation } from "../../api/auth";
import { ApiError } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { ErrorBox } from "../../components/ResultBox";
import { PinKeypad } from "../../components/PinKeypad";
import { MOCK_LOKASI } from "../../mock/referenceData";
import type { StafOption } from "../../api/types";

type Step = "lokasi" | "nama" | "pin";

const PIN_LENGTH = 6;

/**
 * Flow 3 langkah untuk staf: pilih lokasi (dari snapshot MOCK_LOKASI, sama
 * seperti dipakai di tempat lain di app ini -- tidak ada endpoint publik
 * untuk list lokasi, dan TIDAK boleh pakai useLokasiOptions/LokasiPicker di
 * sini karena itu bergantung pada useAuth() yang belum ada user sebelum
 * login) -> pilih nama (dari GET /api/auth/staf, publik & live) -> PIN
 * (keypad besar, auto-submit begitu 6 digit terisi).
 */
export function LoginTimForm() {
  const { loginPin } = useAuth();
  const [step, setStep] = useState<Step>("lokasi");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [stafList, setStafList] = useState<StafOption[]>([]);
  const [loadingStaf, setLoadingStaf] = useState(false);
  const [stafError, setStafError] = useState<string | null>(null);
  const [selectedStaf, setSelectedStaf] = useState<StafOption | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (step !== "nama" || locationId === null) return;
    let active = true;
    setLoadingStaf(true);
    setStafError(null);
    listStafAtLocation(locationId)
      .then((list) => {
        if (active) setStafList(list);
      })
      .catch((err) => {
        if (active) setStafError(err instanceof ApiError ? err.message : "Gagal memuat daftar nama staf.");
      })
      .finally(() => {
        if (active) setLoadingStaf(false);
      });
    return () => {
      active = false;
    };
  }, [step, locationId]);

  async function submitPin(staf: StafOption, nextPin: string) {
    setSubmitting(true);
    setPinError(null);
    try {
      await loginPin(staf.id, nextPin);
      // Berhasil -> AuthContext sudah set user, LoginPage akan redirect lewat <Navigate>.
    } catch (err) {
      if (err instanceof ApiError) {
        setPinError(err.status === 401 ? "PIN salah. Coba lagi." : err.message);
      } else {
        setPinError("Gagal masuk. Coba lagi.");
      }
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  function handlePinChange(next: string) {
    setPin(next);
    setPinError(null);
    if (next.length === PIN_LENGTH && selectedStaf) {
      void submitPin(selectedStaf, next);
    }
  }

  if (step === "lokasi") {
    return (
      <Card>
        <h2 className="mb-1 text-base font-semibold text-slate-900">Pilih lokasi</h2>
        <p className="mb-4 text-sm text-slate-500">Pilih outlet tempat kamu bertugas hari ini.</p>
        <div className="space-y-2">
          {MOCK_LOKASI.map((lokasi) => (
            <button
              key={lokasi.id}
              type="button"
              onClick={() => {
                setLocationId(lokasi.id);
                setStafList([]);
                setStep("nama");
              }}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-4 text-left text-base font-medium text-slate-900 shadow-sm hover:border-blue-300"
            >
              {lokasi.name}
            </button>
          ))}
        </div>
      </Card>
    );
  }

  if (step === "nama") {
    const lokasiName = MOCK_LOKASI.find((l) => l.id === locationId)?.name ?? "";
    return (
      <Card>
        <button
          type="button"
          onClick={() => {
            setStep("lokasi");
            setLocationId(null);
            setStafList([]);
          }}
          className="mb-3 text-sm font-medium text-blue-700"
        >
          &larr; Ganti lokasi
        </button>
        <h2 className="mb-1 text-base font-semibold text-slate-900">Pilih nama kamu</h2>
        <p className="mb-4 text-sm text-slate-500">{lokasiName}</p>

        {loadingStaf ? <p className="py-6 text-center text-sm text-slate-500">Memuat daftar staf...</p> : null}
        {stafError ? <ErrorBox>{stafError}</ErrorBox> : null}

        {!loadingStaf && !stafError ? (
          <div className="space-y-2">
            {stafList.map((staf) => (
              <button
                key={staf.id}
                type="button"
                onClick={() => {
                  setSelectedStaf(staf);
                  setPin("");
                  setPinError(null);
                  setStep("pin");
                }}
                className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-4 text-left text-base font-medium text-slate-900 shadow-sm hover:border-blue-300"
              >
                {staf.name}
              </button>
            ))}
            {stafList.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Belum ada staf aktif terdaftar di lokasi ini.</p>
            ) : null}
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => {
          setStep("nama");
          setPin("");
          setPinError(null);
        }}
        disabled={submitting}
        className="mb-3 text-sm font-medium text-blue-700 disabled:opacity-50"
      >
        &larr; Ganti nama
      </button>
      <h2 className="mb-1 text-base font-semibold text-slate-900">Masukkan PIN</h2>
      <p className="mb-5 text-sm text-slate-500">Halo, {selectedStaf?.name}. Masukkan 6 digit PIN kamu.</p>

      <PinKeypad value={pin} maxLength={PIN_LENGTH} onChange={handlePinChange} disabled={submitting} />

      {submitting ? <p className="mt-4 text-center text-sm text-slate-500">Memeriksa PIN...</p> : null}
      {pinError ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700" role="alert">
          {pinError}
        </p>
      ) : null}
    </Card>
  );
}
