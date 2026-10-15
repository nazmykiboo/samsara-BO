import { useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import { setItemMapping } from "../../api/sales-sync";
import type { ItemMapping } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox } from "../../components/ResultBox";
import { MenuKodeCombobox, type MenuOption, type MenuOptionsState } from "./MenuKodeCombobox";

/**
 * Cari menu Samsara yang namanya SAMA PERSIS dengan nama item di platform (abaikan huruf
 * besar/kecil dan spasi di ujung). Hasilnya dipakai sebagai "saran pasti" yang boleh diterima
 * borongan tanpa user memeriksa satu-satu.
 *
 * Kalau ada LEBIH DARI SATU menu dengan nama sama persis, item itu TIDAK diberi saran sama sekali:
 * tidak ada cara otomatis menentukan mana yang benar, jadi biarkan user memilih manual. Secara
 * aturan bisnis nama menu seharusnya unik, tapi UI tidak boleh bergantung pada asumsi itu --
 * daftar menu di sini datang dari API dan bisa saja mengandung duplikat.
 */
function hitungSaranPasti(items: ItemMapping[], options: MenuOption[]): Map<string, MenuOption> {
  const perNama = new Map<string, MenuOption[]>();
  for (const option of options) {
    const kunci = option.name.trim().toLowerCase();
    const daftar = perNama.get(kunci);
    if (daftar) daftar.push(option);
    else perNama.set(kunci, [option]);
  }

  const saran = new Map<string, MenuOption>();
  for (const item of items) {
    const kandidat = perNama.get(item.namaEksternal.trim().toLowerCase());
    if (kandidat && kandidat.length === 1) saran.set(item.id, kandidat[0]);
  }
  return saran;
}

/**
 * Daftar item/kode platform yang belum punya pasangan menu Samsara.
 *
 * Daftar KOSONG = kondisi normal dan bagus (semua kode sudah dipetakan), bukan error -- pesannya
 * dibuat menenangkan, bukan peringatan.
 */
export function ItemBelumDipetakanSection({
  items,
  loading,
  error,
  menu,
  onSelesaiPetakan,
}: {
  items: ItemMapping[];
  loading: boolean;
  error: string | null;
  menu: MenuOptionsState;
  /** Dipanggil setelah satu baris berhasil dipetakan -- halaman memuat ulang daftarnya. */
  onSelesaiPetakan: () => void;
}) {
  // Baris mana yang sedang disimpan + error per baris. Pakai map id -> pesan supaya kegagalan di
  // satu baris tidak menghapus pesan di baris lain.
  const [menyimpanId, setMenyimpanId] = useState<string | null>(null);
  const [errorBaris, setErrorBaris] = useState<Record<string, string>>({});

  // Status tombol "Terima semua yang cocok": satu panggilan PATCH per item, SEKUENSIAL, jadi
  // perlu penanda jalan + ringkasan hasilnya.
  const [borongBerjalan, setBorongBerjalan] = useState(false);
  const [borongProgres, setBorongProgres] = useState({ selesai: 0, total: 0 });
  const [borongRingkasan, setBorongRingkasan] = useState<{
    berhasil: number;
    gagal: Array<{ nama: string; pesan: string }>;
  } | null>(null);

  const saranPasti = useMemo(() => hitungSaranPasti(items, menu.options), [items, menu.options]);

  async function handlePilih(item: ItemMapping, option: MenuOption) {
    setMenyimpanId(item.id);
    setErrorBaris((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    try {
      await setItemMapping(item.id, option.kode);
      // Muat ulang daftar dari server (bukan hapus baris di sisi klien): backend juga menyegarkan
      // antriannya saat daftar dibaca, jadi hasil muat ulang selalu yang paling akurat.
      onSelesaiPetakan();
    } catch (err) {
      setErrorBaris((prev) => ({
        ...prev,
        [item.id]: err instanceof ApiError ? err.message : "Gagal menyimpan pemetaan. Coba lagi.",
      }));
    } finally {
      setMenyimpanId(null);
    }
  }

  /**
   * Terima semua saran pasti sekaligus. SENGAJA satu per satu (await di dalam loop, bukan
   * Promise.all): kalau satu item gagal, sisanya tetap jalan dan kita tahu persis item mana yang
   * gagal. Jumlah itemnya kecil (maksimal ratusan) jadi tidak perlu endpoint khusus di backend.
   */
  async function handleTerimaSemua() {
    const pasangan = items
      .map((item) => ({ item, option: saranPasti.get(item.id) }))
      .filter((p): p is { item: ItemMapping; option: MenuOption } => p.option !== undefined);
    if (pasangan.length === 0) return;

    setBorongBerjalan(true);
    setBorongRingkasan(null);
    setBorongProgres({ selesai: 0, total: pasangan.length });
    setErrorBaris({});

    let berhasil = 0;
    const gagal: Array<{ nama: string; pesan: string }> = [];

    for (const { item, option } of pasangan) {
      try {
        await setItemMapping(item.id, option.kode);
        berhasil += 1;
      } catch (err) {
        gagal.push({
          nama: `${item.namaEksternal} (${item.platform})`,
          pesan: err instanceof ApiError ? err.message : "Gagal menyimpan pemetaan.",
        });
      }
      setBorongProgres((prev) => ({ ...prev, selesai: prev.selesai + 1 }));
    }

    setBorongRingkasan({ berhasil, gagal });
    setBorongBerjalan(false);
    // Muat ulang daftar dari server -- pola sama seperti pemetaan satu-satu.
    onSelesaiPetakan();
  }

  const jumlahSaran = saranPasti.size;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">2. Item belum dipetakan</h2>
        <p className="text-sm text-slate-500">
          Nama menu di aplikasi pesan-antar sering beda dengan nama menu Samsara. Pasangkan dulu di sini
          supaya penjualannya bisa dihitung ke stok yang benar.
        </p>
      </div>

      {/* Ringkasan hasil "Terima semua yang cocok" ditaruh DI LUAR cabang daftar: kalau borongannya
          memetakan semua item, daftarnya jadi kosong dan ringkasannya akan ikut hilang -- user
          kehilangan konfirmasi atas aksi yang baru saja dia lakukan. */}
      {borongRingkasan ? (
        <div className="space-y-2">
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {borongRingkasan.berhasil} item berhasil dipetakan otomatis.
          </p>
          {borongRingkasan.gagal.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <p className="font-medium">
                {borongRingkasan.gagal.length} item gagal dipetakan — masih ada di daftar di bawah dan
                bisa dipasangkan manual.
              </p>
              <ul className="mt-1 space-y-1 text-xs">
                {borongRingkasan.gagal.map((g) => (
                  <li key={g.nama} className="break-words">
                    <span className="font-medium">{g.nama}:</span> {g.pesan}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <Spinner label="Memuat daftar item..." />
      ) : error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm font-medium text-slate-900">Semua item sudah dipetakan.</p>
          <p className="mt-0.5 text-sm text-slate-500">
            Tidak ada yang perlu dikerjakan di bagian ini. Kode item baru akan muncul otomatis di sini
            setelah file Log Penjualan diupload.
          </p>
        </Card>
      ) : (
        <>
          <p className="text-sm font-medium text-amber-800">
            {items.length} item belum dipetakan — penjualannya belum bisa diproses.
          </p>

          {/* Tombol borongan hanya muncul kalau memang ada yang namanya sama persis. Kalau tidak ada,
              bagian ini hilang sama sekali supaya tidak ada tombol mati yang membingungkan. */}
          {jumlahSaran > 0 ? (
            <Card className="border-emerald-200 bg-emerald-50">
              <p className="text-sm font-semibold text-emerald-900">
                {jumlahSaran} item namanya sama persis dengan menu Samsara.
              </p>
              <p className="mt-0.5 text-sm text-emerald-800">
                Item ini hampir pasti menu yang sama, jadi bisa dipasangkan sekaligus tanpa dipilih
                satu-satu. Item yang namanya beda tetap harus Anda pasangkan sendiri di bawah.
              </p>
              <Button
                type="button"
                onClick={() => void handleTerimaSemua()}
                disabled={borongBerjalan || menyimpanId !== null}
                className="mt-3 w-full"
              >
                {borongBerjalan
                  ? `Memasangkan ${borongProgres.selesai} dari ${borongProgres.total}...`
                  : `Terima semua yang cocok (${jumlahSaran} item)`}
              </Button>
            </Card>
          ) : null}

          {/* Satu kartu per baris, BUKAN tabel <table>: target utamanya layar HP, dan tabel 4 kolom
              (termasuk kotak pencarian menu) akan memaksa geser ke samping. Di layar lebar, label
              dan isinya dirapikan jadi dua kolom. */}
          <div className="space-y-3">
            {items.map((item) => {
              const saran = saranPasti.get(item.id);
              return (
              <Card key={item.id} className={saran ? "border-emerald-300" : ""}>
                {saran ? (
                  <div className="mb-2">
                    <Badge tone="success">Nama sama persis</Badge>
                  </div>
                ) : null}
                <dl className="space-y-1.5 text-sm sm:grid sm:grid-cols-[9rem_1fr] sm:gap-x-3 sm:gap-y-1.5 sm:space-y-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm sm:normal-case sm:tracking-normal sm:text-slate-500">
                    Aplikasi / platform
                  </dt>
                  <dd className="font-medium text-slate-900">{item.platform}</dd>

                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm sm:normal-case sm:tracking-normal sm:text-slate-500">
                    Kode di platform
                  </dt>
                  <dd className="break-words text-slate-700">{item.kodeEksternal}</dd>

                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 sm:text-sm sm:normal-case sm:tracking-normal sm:text-slate-500">
                    Nama di platform
                  </dt>
                  <dd className="break-words text-slate-700">{item.namaEksternal}</dd>
                </dl>

                {/* Saran ditampilkan lengkap dengan kode menunya supaya user bisa memastikan sendiri
                    sebelum menerima, dan bisa menerima per item tanpa harus borongan. */}
                {saran ? (
                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <p className="text-sm text-emerald-900">
                      Cocok dengan menu Samsara <span className="font-semibold">{saran.name}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-800">
                      Kode menu: {saran.kode}
                      {saran.kategori ? ` · ${saran.kategori}` : ""}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void handlePilih(item, saran)}
                      disabled={menyimpanId === item.id || borongBerjalan}
                      className="mt-2 w-full"
                    >
                      Pakai menu ini
                    </Button>
                  </div>
                ) : null}

                <div className="mt-3">
                  <p className="mb-1 text-sm font-medium text-slate-700">
                    {saran ? "Atau pasangkan ke menu lain" : "Pasangkan ke menu Samsara"}
                  </p>
                  <MenuKodeCombobox
                    menu={menu}
                    ariaLabel={`Pasangkan "${item.namaEksternal}" (${item.platform}) ke menu Samsara`}
                    disabled={menyimpanId === item.id || borongBerjalan}
                    onPilih={(option) => void handlePilih(item, option)}
                  />
                  {menyimpanId === item.id ? (
                    <p className="mt-1 text-sm text-slate-500">Menyimpan...</p>
                  ) : null}
                  {errorBaris[item.id] ? (
                    <div className="mt-2">
                      <ErrorBox>{errorBaris[item.id]}</ErrorBox>
                    </div>
                  ) : null}
                </div>
              </Card>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
