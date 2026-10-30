import { Field, Input } from "./ui/Input";
import { Button } from "./ui/Button";

/** Rentang tanggal kalender, dua-duanya "YYYY-MM-DD" atau "" (kosong = belum dipilih). */
export interface RentangTanggal {
  mulai: string;
  selesai: string;
}

function keTanggalIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Senin minggu yang memuat `d` -- minggu MULAI SENIN (bukan Minggu/Sunday), sesuai konvensi
 * kalender Indonesia. `getDay()` JS: 0=Minggu, 1=Senin, ..., 6=Sabtu. */
function seninMingguIni(d: Date): Date {
  const hasil = new Date(d);
  const hari = hasil.getDay();
  const mundur = hari === 0 ? 6 : hari - 1; // Minggu mundur 6 hari ke Senin sebelumnya
  hasil.setDate(hasil.getDate() - mundur);
  return hasil;
}

function awalBulan(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function akhirBulanLalu(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 0);
}

function awalBulanLalu(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
}

/** Lima preset rentang: Hari ini, Minggu ini (Senin-hari ini), Bulan ini (tanggal 1-hari ini),
 * Bulan lalu (tanggal 1 sampai akhir bulan lalu), plus input dari-sampai manual untuk rentang
 * bebas. Perhitungan "hari ini" pakai jam lokal device (pola sama dengan `todayIso()` di
 * utils/format.ts -- sengaja TIDAK pakai math offset WIB eksplisit, staf dianggap memakai
 * perangkat sendiri dengan jam yang benar). */
export function DateRangePicker({
  value,
  onChange,
}: {
  value: RentangTanggal;
  onChange: (value: RentangTanggal) => void;
}) {
  const sekarang = new Date();
  const hariIniIso = keTanggalIso(sekarang);

  const preset = {
    hariIni: { mulai: hariIniIso, selesai: hariIniIso },
    mingguIni: { mulai: keTanggalIso(seninMingguIni(sekarang)), selesai: hariIniIso },
    bulanIni: { mulai: keTanggalIso(awalBulan(sekarang)), selesai: hariIniIso },
    bulanLalu: { mulai: keTanggalIso(awalBulanLalu(sekarang)), selesai: keTanggalIso(akhirBulanLalu(sekarang)) },
  };

  // Preset AKTIF kalau value PERSIS sama dengan salah satu preset -- dipakai menyorot tombolnya,
  // bukan logika tersendiri (rentang custom yang kebetulan sama dengan preset dianggap preset itu,
  // dan itu tidak masalah).
  function namaPresetAktif(): keyof typeof preset | null {
    for (const [nama, rentang] of Object.entries(preset)) {
      if (rentang.mulai === value.mulai && rentang.selesai === value.selesai) return nama as keyof typeof preset;
    }
    return null;
  }
  const aktif = namaPresetAktif();

  const rentangTerbalik = value.mulai !== "" && value.selesai !== "" && value.mulai > value.selesai;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["hariIni", "Hari ini"],
            ["mingguIni", "Minggu ini"],
            ["bulanIni", "Bulan ini"],
            ["bulanLalu", "Bulan lalu"],
          ] as const
        ).map(([nama, label]) => (
          <Button
            key={nama}
            type="button"
            variant={aktif === nama ? "primary" : "secondary"}
            className="px-3 py-1.5 text-xs"
            onClick={() => onChange(preset[nama])}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Tanggal mulai">
          <Input
            type="date"
            value={value.mulai}
            onChange={(e) => onChange({ ...value, mulai: e.target.value })}
            max={value.selesai || undefined}
          />
        </Field>
        <Field label="Tanggal selesai">
          <Input
            type="date"
            value={value.selesai}
            onChange={(e) => onChange({ ...value, selesai: e.target.value })}
            min={value.mulai || undefined}
          />
        </Field>
      </div>

      {rentangTerbalik ? (
        <p className="text-xs text-red-600">Tanggal mulai lebih akhir daripada tanggal selesai.</p>
      ) : null}
    </div>
  );
}
