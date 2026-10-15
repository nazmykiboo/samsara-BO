import { Card } from "../../components/ui/Card";

/**
 * Kartu "Hal yang Perlu Diperhatikan" -- menampilkan kalimat-kalimat temuan yang SUDAH disusun
 * backend (field `insight`), apa adanya. Jangan diolah/diterjemahkan ulang di sini: kalimatnya
 * sudah Bahasa Indonesia siap tampil, dan ambang "signifikan"-nya diatur dari data di backend.
 *
 * Daftar kosong BUKAN error dan BUKAN alasan menyembunyikan kartu: kartunya tetap tampil dengan
 * pesan netral, supaya jelas bahwa sistem sudah memeriksa dan memang tidak menemukan apa-apa
 * (kalau kartunya hilang, orang akan menyangka halamannya gagal memuat).
 */
export function InsightCard({
  insight,
  pesanKosong,
}: {
  insight: string[];
  pesanKosong: string;
}) {
  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Hal yang Perlu Diperhatikan</h2>
      <p className="mb-3 text-xs text-slate-500">
        Temuan yang dirangkum otomatis dari data. Dipakai sebagai petunjuk awal untuk ditelusuri, bukan
        kesimpulan akhir.
      </p>
      {insight.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{pesanKosong}</p>
      ) : (
        <ul className="space-y-1.5">
          {insight.map((baris, idx) => (
            <li key={idx} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span aria-hidden>•</span>
              <span>{baris}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
