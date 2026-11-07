import { useEffect, useState } from "react";
import { listRefund, type RefundEntry } from "../api/sales-sync";
import { Card } from "./ui/Card";
import { formatRupiah } from "../utils/format";

/**
 * Kartu "Refund hari ini" -- dipakai Laporan Harian (tanggal = tanggal yang
 * dipilih user di halaman itu) dan Analitik (tanggal = hari ini, lepas dari
 * filter periode mingguan halaman itu, sesuai instruksi "Refund hari ini").
 *
 * Nominal Rupiah SAAT INI cuma tersedia untuk refund Majoo (lihat
 * `RefundEntry`/`listRefundRange` -- platform lain belum pernah punya kolom
 * nominal di arsip manapun) -- kartu ini JUJUR soal keterbatasan itu lewat
 * caption, BUKAN menyembunyikannya atau berpura-pura totalnya lengkap.
 *
 * `refundAmount` hilang dari SEMUA baris sekaligus untuk role tanpa
 * `hpp.lihat_harga` (supervisor) -- dideteksi lewat `"refundAmount" in r`
 * (key ada tapi `null` = data tidak tersedia; key TIDAK ADA = role tidak
 * boleh lihat), bukan nilai-nya, supaya tidak keliru dengan kasus di atas.
 */
export function RefundHariIniCard({ tanggal }: { tanggal: string }) {
  const [rows, setRows] = useState<RefundEntry[] | null>(null);

  useEffect(() => {
    let active = true;
    listRefund(tanggal, tanggal)
      .then((res) => {
        if (active) setRows(res);
      })
      .catch(() => {
        // Widget pendukung, non-kritis -- kegagalan di sini tidak boleh
        // mengganggu tampilan laporan utama, cukup diam (kartu tidak tampil).
        if (active) setRows(null);
      });
    return () => {
      active = false;
    };
  }, [tanggal]);

  if (rows === null) return null;

  const jumlah = rows.length;
  const bisaLihatRupiah = rows.some((r) => "refundAmount" in r);
  const totalRupiah = bisaLihatRupiah
    ? rows.reduce((sum, r) => sum + (r.refundAmount ?? 0), 0)
    : null;
  const adaYangTanpaNominal = bisaLihatRupiah && rows.some((r) => r.refundAmount === null);

  return (
    <Card>
      <h3 className="mb-1 text-sm font-semibold text-slate-900">Refund hari ini</h3>
      {jumlah === 0 ? (
        <p className="text-sm text-slate-500">Tidak ada refund tercatat hari ini.</p>
      ) : (
        <>
          <p className="text-sm text-slate-700">
            <span className="font-semibold">{jumlah}</span> refund tercatat
            {bisaLihatRupiah && totalRupiah !== null ? (
              <>
                {" "}
                &middot; total <span className="font-semibold">{formatRupiah(totalRupiah)}</span>
              </>
            ) : null}
          </p>
          {adaYangTanpaNominal ? (
            <p className="mt-1 text-xs text-slate-400">
              Nominal Rupiah baru tersedia untuk refund Majoo -- refund platform lain (Shopee/GrabFood/GoFood) di
              atas cuma tercatat jumlah unitnya, belum ada nominalnya di arsip.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
