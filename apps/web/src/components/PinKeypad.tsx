const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Keypad numerik besar, gaya ATM/tablet -- dipakai di layar "Login Tim" (staf
 * tidak pernah mengetik lewat keyboard fisik/software biasa, cuma tap digit). */
export function PinKeypad({
  value,
  maxLength,
  onChange,
  disabled,
}: {
  value: string;
  maxLength: number;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  function press(digit: string) {
    if (disabled || value.length >= maxLength) return;
    onChange(value + digit);
  }

  function backspace() {
    if (disabled) return;
    onChange(value.slice(0, -1));
  }

  function clear() {
    if (disabled) return;
    onChange("");
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-center gap-3" aria-hidden>
        {Array.from({ length: maxLength }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 ${
              i < value.length ? "border-blue-600 bg-blue-600" : "border-slate-300 bg-white"
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {DIGITS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => press(d)}
            className="rounded-xl bg-slate-100 py-5 text-2xl font-semibold text-slate-900 transition-colors hover:bg-slate-200 disabled:opacity-50"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={clear}
          className="rounded-xl bg-slate-100 py-5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50"
        >
          Hapus semua
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => press("0")}
          className="rounded-xl bg-slate-100 py-5 text-2xl font-semibold text-slate-900 transition-colors hover:bg-slate-200 disabled:opacity-50"
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={backspace}
          aria-label="Hapus satu digit"
          className="rounded-xl bg-slate-100 py-5 text-2xl font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50"
        >
          &#9003;
        </button>
      </div>
    </div>
  );
}
