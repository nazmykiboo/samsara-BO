import { useEffect, useState, type FormEvent } from "react";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { ItemPicker } from "../../components/pickers/ItemPicker";
import {
  catatHargaKatalog,
  createVendor,
  laporkanSupplierLama,
  listKatalogByVendor,
  listVendor,
  updateVendor,
} from "../../api/vendor";
import { ApiError } from "../../api/client";
import { usePermission } from "../../auth/usePermission";
import type { KatalogItem, SupplierLamaItem, Vendor } from "../../api/types";
import { formatRupiah } from "../../utils/format";
import type { MockItemRef } from "../../mock/referenceData";

export function VendorTab() {
  const canEdit = usePermission("vendor.edit");
  const canLihatHarga = usePermission("hpp.lihat_harga");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [cari, setCari] = useState("");
  const [reloadCounter, setReloadCounter] = useState(0);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [katalogVendorId, setKatalogVendorId] = useState<number | null>(null);
  const [showTambah, setShowTambah] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError(null);
    listVendor(cari.trim() || undefined)
      .then((res) => {
        if (active) setVendors(res);
      })
      .catch((err) => {
        if (active) setListError(err instanceof ApiError ? err.message : "Gagal memuat daftar vendor.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cari, reloadCounter]);

  return (
    <div className="space-y-4">
      <Card>
        <Field label="Cari vendor">
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Ketik nama vendor..." />
        </Field>
      </Card>

      {loading ? <Spinner label="Memuat daftar vendor..." /> : null}
      {listError ? <ErrorBox>{listError}</ErrorBox> : null}

      {!loading && !listError ? (
        <div className="space-y-3">
          {vendors.map((v) =>
            editingId === v.id ? (
              <VendorForm
                key={v.id}
                initial={v}
                onDone={() => {
                  setEditingId(null);
                  setReloadCounter((n) => n + 1);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <Card key={v.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {v.name} {!v.isActive ? <Badge tone="neutral">Nonaktif</Badge> : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      {[v.kontakNama, v.telepon, v.alamat, v.termin ? `Termin: ${v.termin}` : null]
                        .filter(Boolean)
                        .join(" · ") || "Belum ada detail kontak"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Button
                      variant="secondary"
                      className="text-xs"
                      onClick={() => setKatalogVendorId(katalogVendorId === v.id ? null : v.id)}
                    >
                      {katalogVendorId === v.id ? "Tutup katalog" : "Lihat katalog"}
                    </Button>
                    {canEdit ? (
                      <Button variant="ghost" className="text-xs" onClick={() => setEditingId(v.id)}>
                        Edit
                      </Button>
                    ) : null}
                  </div>
                </div>
                {katalogVendorId === v.id ? (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <KatalogSection vendorId={v.id} canEdit={canEdit} canLihatHarga={canLihatHarga} />
                  </div>
                ) : null}
              </Card>
            ),
          )}
          {vendors.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Belum ada vendor.</p> : null}
        </div>
      ) : null}

      {canEdit ? (
        showTambah ? (
          <VendorForm
            initial={null}
            onDone={() => {
              setShowTambah(false);
              setReloadCounter((n) => n + 1);
            }}
            onCancel={() => setShowTambah(false)}
          />
        ) : (
          <Button onClick={() => setShowTambah(true)}>+ Tambah vendor</Button>
        )
      ) : null}

      {canEdit ? <SupplierLamaCard /> : null}
    </div>
  );
}

function VendorForm({
  initial,
  onDone,
  onCancel,
}: {
  initial: Vendor | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kontakNama, setKontakNama] = useState(initial?.kontakNama ?? "");
  const [telepon, setTelepon] = useState(initial?.telepon ?? "");
  const [alamat, setAlamat] = useState(initial?.alamat ?? "");
  const [termin, setTermin] = useState(initial?.termin ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Nama vendor wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        kontakNama: kontakNama.trim() || null,
        telepon: telepon.trim() || null,
        alamat: alamat.trim() || null,
        termin: termin.trim() || null,
      };
      if (initial) await updateVendor(initial.id, payload);
      else await createVendor(payload);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan vendor.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleAktif() {
    if (!initial) return;
    setSaving(true);
    setError(null);
    try {
      await updateVendor(initial.id, { isActive: !initial.isActive });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengubah status vendor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-slate-900">{initial ? `Edit: ${initial.name}` : "Tambah vendor baru"}</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Nama">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Nama kontak (opsional)">
          <Input value={kontakNama} onChange={(e) => setKontakNama(e.target.value)} />
        </Field>
        <Field label="Telepon (opsional)">
          <Input value={telepon} onChange={(e) => setTelepon(e.target.value)} />
        </Field>
        <Field label="Alamat (opsional)">
          <Input value={alamat} onChange={(e) => setAlamat(e.target.value)} />
        </Field>
        <Field label="Termin pembayaran (opsional)">
          <Input value={termin} onChange={(e) => setTermin(e.target.value)} placeholder="mis. Tunai, Net 30" />
        </Field>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Batal
          </Button>
          {initial ? (
            <Button type="button" variant={initial.isActive ? "danger" : "secondary"} onClick={toggleAktif} disabled={saving}>
              {initial.isActive ? "Nonaktifkan" : "Aktifkan"}
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function KatalogSection({
  vendorId,
  canEdit,
  canLihatHarga,
}: {
  vendorId: number;
  canEdit: boolean;
  canLihatHarga: boolean;
}) {
  const [katalog, setKatalog] = useState<KatalogItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  const [itemKode, setItemKode] = useState<string | null>(null);
  const [harga, setHarga] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listKatalogByVendor(vendorId)
      .then((res) => {
        if (active) setKatalog(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat katalog.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [vendorId, reloadCounter]);

  async function handleTambahHarga(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const hargaNum = Number(harga);
    if (!itemKode) {
      setFormError("Pilih item dulu.");
      return;
    }
    if (!Number.isFinite(hargaNum) || hargaNum < 0) {
      setFormError("Harga wajib angka >= 0.");
      return;
    }
    setSaving(true);
    try {
      await catatHargaKatalog(vendorId, itemKode, hargaNum);
      setItemKode(null);
      setHarga("");
      setReloadCounter((n) => n + 1);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Gagal menyimpan harga.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Katalog</h3>
      {loading ? <Spinner label="Memuat katalog..." /> : null}
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      {!loading && !error && katalog ? (
        <div className="space-y-1">
          {katalog.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada item di katalog vendor ini.</p>
          ) : (
            katalog.map((k) => (
              <div key={k.itemId} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span>
                  {k.itemName} {k.itemKode ? <span className="text-slate-400">({k.itemKode})</span> : null}
                </span>
                {canLihatHarga && k.hargaTerakhir !== undefined ? (
                  <span className="font-medium text-slate-900">{formatRupiah(k.hargaTerakhir)}</span>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}

      {canEdit ? (
        <form onSubmit={handleTambahHarga} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <div className="min-w-[200px] flex-1">
            <ItemPicker
              label="Tambah/perbarui harga item"
              value={itemKode}
              onSelect={(item: MockItemRef) => setItemKode(item.kode)}
            />
          </div>
          <Field label="Harga">
            <Input type="number" min={0} value={harga} onChange={(e) => setHarga(e.target.value)} className="w-32" />
          </Field>
          <Button type="submit" disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan harga"}
          </Button>
        </form>
      ) : null}
      {formError ? <ErrorBox>{formError}</ErrorBox> : null}
    </div>
  );
}

function SupplierLamaCard() {
  const [data, setData] = useState<SupplierLamaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    laporkanSupplierLama()
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat laporan supplier lama.");
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data || data.length === 0) return null;

  return (
    <Card>
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Teks supplier lama (belum jadi vendor)</h2>
      <p className="mb-3 text-sm text-slate-500">
        Nama supplier dari riwayat pembelian SEBELUM ada master vendor. Murni daftar untuk ditinjau manual -- TIDAK
        digabung otomatis ke vendor manapun, karena teks yang mirip belum tentu benar-benar vendor yang sama.
      </p>
      <ResultBox>
        <div className="space-y-1">
          {data.map((s) => (
            <div key={s.supplier} className="flex items-center justify-between text-sm">
              <span>{s.supplier}</span>
              <span className="text-slate-500">
                {s.jumlahPembelian}x · terakhir {s.pembelianTerakhir}
              </span>
            </div>
          ))}
        </div>
      </ResultBox>
    </Card>
  );
}
