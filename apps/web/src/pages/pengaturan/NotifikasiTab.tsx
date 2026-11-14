import { useEffect, useState, type FormEvent } from "react";
import {
  createAturanNotifikasi,
  deleteAturanNotifikasi,
  listAturanNotifikasi,
  updateAturanNotifikasi,
} from "../../api/notifikasi";
import { listUsers } from "../../api/auth";
import type {
  AturanNotifikasi,
  KanalNotifikasi,
  KejadianNotifikasi,
  Role,
  UserListItem,
} from "../../api/types";
import { KEJADIAN_AMBANG_JAM, LABEL_KEJADIAN } from "../../api/types";
import { useLokasiContext } from "../../data/LokasiContext";
import { ApiError } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorBox } from "../../components/ResultBox";

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  manajer_ops: "Manajer Ops",
  supervisor: "Supervisor",
  staf: "Staf",
  integrasi: "Integrasi",
};
const ROLE_OPTIONS: Role[] = ["owner", "manajer_ops", "supervisor", "staf"];
const KEJADIAN_OPTIONS = Object.keys(LABEL_KEJADIAN) as KejadianNotifikasi[];

/**
 * Tab "Notifikasi" (2026-11-14, BARU) di Pengaturan -- KHUSUS owner
 * (`notifikasi.manage`, lihat usePermission.ts). CRUD aturan notifikasi:
 * kejadian -> penerima (role ATAU satu user tertentu, opsional dipersempit
 * lokasi) -> kanal -> aktif -> ambang jam (cuma relevan 2 kejadian).
 */
export function NotifikasiTab() {
  const [aturan, setAturan] = useState<AturanNotifikasi[]>([]);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const { lokasi } = useLokasiContext();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function muatUlang() {
    setError(null);
    try {
      const [aturanRes, usersRes] = await Promise.all([listAturanNotifikasi(), listUsers()]);
      setAturan(aturanRes);
      setUsers(usersRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat aturan notifikasi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    muatUlang();
  }, []);

  async function handleToggleAktif(row: AturanNotifikasi) {
    setError(null);
    try {
      await updateAturanNotifikasi(row.id, { aktif: !row.aktif });
      await muatUlang();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengubah status aturan.");
    }
  }

  async function handleHapus(row: AturanNotifikasi) {
    if (!confirm(`Hapus aturan notifikasi "${LABEL_KEJADIAN[row.kejadian]}" ini?`)) return;
    setError(null);
    try {
      await deleteAturanNotifikasi(row.id);
      await muatUlang();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menghapus aturan.");
    }
  }

  if (loading) return <Spinner label="Memuat aturan notifikasi..." />;

  return (
    <div className="space-y-4">
      {error ? <ErrorBox>{error}</ErrorBox> : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Tambah Aturan Notifikasi</h2>
        <FormTambahAturan users={users} lokasi={lokasi} onSukses={muatUlang} onError={setError} />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Aturan Aktif ({aturan.length})</h2>
        {aturan.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada aturan notifikasi.</p>
        ) : (
          <div className="space-y-2">
            {aturan.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-sm"
              >
                <div>
                  <p className="font-medium text-slate-900">{LABEL_KEJADIAN[a.kejadian]}</p>
                  <p className="text-xs text-slate-500">
                    Penerima: {a.penerimaUserNama ?? (a.penerimaRole ? ROLE_LABEL[a.penerimaRole] : "-")}
                    {a.penerimaLokasiNama ? ` @ ${a.penerimaLokasiNama}` : ""} · Kanal: {a.kanal}
                    {a.ambangJam !== null ? ` · Ambang: ${a.ambangJam} jam` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={a.aktif ? "success" : "neutral"}>{a.aktif ? "Aktif" : "Nonaktif"}</Badge>
                  <Button variant="secondary" onClick={() => handleToggleAktif(a)}>
                    {a.aktif ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                  <Button variant="danger" onClick={() => handleHapus(a)}>
                    Hapus
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function FormTambahAturan({
  users,
  lokasi,
  onSukses,
  onError,
}: {
  users: UserListItem[];
  lokasi: { id: string; name: string }[];
  onSukses: () => void;
  onError: (msg: string) => void;
}) {
  const [kejadian, setKejadian] = useState<KejadianNotifikasi>(KEJADIAN_OPTIONS[0]);
  const [tipePenerima, setTipePenerima] = useState<"role" | "user">("role");
  const [penerimaRole, setPenerimaRole] = useState<Role>("owner");
  const [penerimaUserId, setPenerimaUserId] = useState<string>("");
  const [penerimaLokasiId, setPenerimaLokasiId] = useState<string>("");
  const [kanal, setKanal] = useState<KanalNotifikasi>("telegram");
  const [ambangJam, setAmbangJam] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const butuhAmbangJam = KEJADIAN_AMBANG_JAM.includes(kejadian);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (tipePenerima === "user" && !penerimaUserId) {
      onError("Pilih user tujuan dulu.");
      return;
    }
    if (butuhAmbangJam && !ambangJam) {
      onError("Kejadian ini butuh ambang jam diisi.");
      return;
    }
    setSaving(true);
    try {
      await createAturanNotifikasi({
        kejadian,
        ...(tipePenerima === "role" ? { penerimaRole } : { penerimaUserId: Number(penerimaUserId) }),
        ...(penerimaLokasiId ? { penerimaLokasiId: Number(penerimaLokasiId) } : {}),
        kanal,
        ...(butuhAmbangJam ? { ambangJam: Number(ambangJam) } : {}),
      });
      setAmbangJam("");
      setPenerimaUserId("");
      setPenerimaLokasiId("");
      onSukses();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Gagal menambah aturan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Kejadian">
        <Select value={kejadian} onChange={(e) => setKejadian(e.target.value as KejadianNotifikasi)}>
          {KEJADIAN_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {LABEL_KEJADIAN[k]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Kanal">
        <Select value={kanal} onChange={(e) => setKanal(e.target.value as KanalNotifikasi)}>
          <option value="telegram">Telegram</option>
          <option value="email">Email (implementasi SMTP ditunda)</option>
        </Select>
      </Field>

      <Field label="Penerima">
        <Select value={tipePenerima} onChange={(e) => setTipePenerima(e.target.value as "role" | "user")}>
          <option value="role">Semua user dengan role tertentu</option>
          <option value="user">Satu user tertentu</option>
        </Select>
      </Field>

      {tipePenerima === "role" ? (
        <Field label="Role">
          <Select value={penerimaRole} onChange={(e) => setPenerimaRole(e.target.value as Role)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="User">
          <Select value={penerimaUserId} onChange={(e) => setPenerimaUserId(e.target.value)}>
            <option value="">-- pilih user --</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({ROLE_LABEL[u.role]})
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Lokasi (opsional, kosongkan untuk semua lokasi)">
        <Select value={penerimaLokasiId} onChange={(e) => setPenerimaLokasiId(e.target.value)}>
          <option value="">Semua lokasi</option>
          {lokasi.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>

      {butuhAmbangJam ? (
        <Field label="Ambang jam (kirim notifikasi kalau sudah menunggu lebih dari N jam)">
          <Input
            type="number"
            min={0}
            step={0.5}
            value={ambangJam}
            onChange={(e) => setAmbangJam(e.target.value)}
            required
          />
        </Field>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Menyimpan..." : "Tambah Aturan"}
        </Button>
      </div>
    </form>
  );
}
