const RUPIAH = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });

export function formatRupiah(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return RUPIAH.format(value);
}

export function formatPersen(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${value.toFixed(1)}%`;
}

const ANGKA = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

/** Angka biasa (BUKAN rupiah): jumlah porsi, kuantitas, selisih opname. Pakai pemisah ribuan
 * gaya Indonesia ("1.250") dan maksimal 2 angka di belakang koma -- qty resep bisa pecahan
 * (mis. 0,5 butir telur), jadi jangan dibulatkan ke bilangan bulat. Bisa negatif (selisih
 * opname minus) -- tandanya ikut tampil apa adanya. */
export function formatAngka(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return ANGKA.format(value);
}

/** Rupiah versi SINGKAT -- khusus label sumbu grafik, yang ruangnya cuma beberapa puluh piksel
 * ("Rp 28,8 rb" / "Rp 1,2 jt" alih-alih "Rp 28.800" / "Rp 1.200.000"). Untuk angka yang dibaca
 * sebagai nilai sesungguhnya (tabel, ringkasan, tooltip) TETAP pakai formatRupiah supaya tidak
 * ada presisi yang hilang. */
export function formatRupiahSingkat(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  const abs = Math.abs(value);
  const tanda = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${tanda}Rp ${ANGKA.format(Math.round(abs / 100_000) / 10)} jt`;
  if (abs >= 1_000) return `${tanda}Rp ${ANGKA.format(Math.round(abs / 100) / 10)} rb`;
  return `${tanda}Rp ${ANGKA.format(abs)}`;
}

const TANGGAL_SINGKAT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
const TANGGAL_HARI_BULAN = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });

/** Ubah tanggal kalender "YYYY-MM-DD" dari API jadi teks yang enak dibaca staf ("8 Okt 2026").
 *
 * SENGAJA tidak pakai `new Date("2026-10-08")`: string ISO tanggal-saja diartikan JS sebagai
 * tengah malam UTC, jadi di timezone yang lebih lambat dari UTC tanggalnya bisa bergeser sehari.
 * Di sini angkanya dipecah manual lalu dibangun sebagai tanggal LOKAL, jadi yang tampil selalu
 * tanggal yang sama dengan yang dikirim backend. Format tidak dikenali -> dikembalikan apa adanya
 * (lebih baik menampilkan nilai mentah daripada "Invalid Date"). */
export function formatTanggalSingkat(iso: string | null | undefined): string {
  if (!iso) return "-";
  const cocok = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!cocok) return iso;
  const [, y, m, d] = cocok;
  return TANGGAL_SINGKAT.format(new Date(Number(y), Number(m) - 1, Number(d)));
}

/** Sama seperti formatTanggalSingkat tapi TANPA tahun ("6 Okt") -- dipakai sebagai label sumbu X
 * grafik tren, yang ruangnya sempit dan tahunnya sudah jelas dari konteks periode di atasnya.
 * Cara parse tanggalnya sengaja sama (dipecah manual, bukan new Date(iso)) dengan alasan timezone
 * yang dijelaskan di formatTanggalSingkat. */
export function formatTanggalHariBulan(iso: string | null | undefined): string {
  if (!iso) return "-";
  const cocok = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!cocok) return iso;
  const [, y, m, d] = cocok;
  return TANGGAL_HARI_BULAN.format(new Date(Number(y), Number(m) - 1, Number(d)));
}

/** Tanggal HARI INI di device user, "YYYY-MM-DD". SENGAJA pakai getter LOKAL
 * (bukan `new Date().toISOString().slice(0,10)`) -- `toISOString()` mengonversi
 * ke UTC, dan Samsara beroperasi di Asia/Jakarta (UTC+7): jam 00:00-06:59 WIB
 * (persis jam buka outlet, 06:00) masih tanggal KEMARIN di UTC, jadi versi UTC
 * salah selama ~7 jam tiap hari. Getter lokal mempercayai timezone device
 * (staf pakai perangkat sendiri di Malang, wajar diasumsikan benar). */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Jam SAAT INI di device user, "HH:MM" (format yang diterima `<input type="time">`
 * maupun field `jam` di API transaksi penjualan).
 *
 * Alasan pakai getter lokal sama dengan todayIso: Samsara beroperasi di Asia/Jakarta,
 * jam yang dimaksud staf selalu jam dinding di outlet, bukan UTC.
 *
 * SENGAJA dipanggil tepat sebelum request dikirim (bukan saat form dibuka) supaya jam
 * yang tersimpan adalah jam transaksi dicatat, bukan jam formnya dibuka -- mengisi form
 * penjualan bisa makan beberapa menit. */
export function jamSekarang(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
