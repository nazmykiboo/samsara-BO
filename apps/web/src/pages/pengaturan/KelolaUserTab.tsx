import { useEffect, useState, type FormEvent } from "react";
import { Card } from "../../components/ui/Card";
import { Field, Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { ErrorBox, ResultBox } from "../../components/ResultBox";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { createUser, listUsers, resetUserCredential, updateUser } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useLokasiContext } from "../../data/LokasiContext";
import { useAuth } from "../../auth/AuthContext";
import type { CreateUserResult, LokasiPublik, Role, UserListItem } from "../../api/types";

const ROLE_OPTIONS: { value: Exclude<Role, "owner">; label: string }[] = [
  { value: "manajer_ops", label: "Manajer Ops" },
  { value: "supervisor", label: "Supervisor" },
  { value: "staf", label: "Staf" },
];

// Sengaja TIDAK ada "owner" di ROLE_OPTIONS -- cuma ada 1 akun owner by
// design, bukan sesuatu yang dibuat lewat UI self-service ini (lihat catatan
// tugas). Backend sebenarnya mengizinkan, tapi form ini tidak menawarkannya.
// "integrasi" juga TIDAK ada di ROLE_OPTIONS: itu akun bot (n8n) yang dibuat
// sekali lewat CLI (`npm run seed:integrasi -w @samsara/api`) supaya
// password acaknya cuma muncul sekali di terminal owner -- tapi labelnya
// tetap WAJIB ada di ROLE_LABEL di bawah, karena akun itu ikut muncul di
// DAFTAR user halaman ini.
const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  manajer_ops: "Manajer Ops",
  supervisor: "Supervisor",
  staf: "Staf",
  integrasi: "Integrasi (n8n)",
};

function lokasiNames(ids: number[], lokasi: LokasiPublik[]): string {
  if (ids.length === 0) return "Belum ada lokasi";
  return ids.map((id) => lokasi.find((l) => Number(l.id) === id)?.name ?? `Lokasi #${id}`).join(", ");
}

/** Role yang butuh locationIds (lokasi WAJIB diisi, dan dibatasi ke lokasi itu saja). */
function butuhLokasi(role: Role): boolean {
  return role === "staf" || role === "supervisor";
}

/** Role yang login pakai username+password -- cermin `PASSWORD_ROLES` di core/src/auth/users.ts.
 * SENGAJA beda dari `butuhLokasi`: staf DAN supervisor sama-sama butuh lokasi, tapi cuma staf yang login PIN. */
function isPasswordRole(role: Role): boolean {
  return role === "owner" || role === "manajer_ops" || role === "supervisor" || role === "integrasi";
}

interface CredentialConfirmation {
  name: string;
  label: string;
  value: string;
}

export function KelolaUserTab() {
  const { user: currentUser } = useAuth();
  const { lokasi } = useLokasiContext();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [credentialConfirmation, setCredentialConfirmation] = useState<CredentialConfirmation | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);

  function refreshUsers() {
    setLoading(true);
    setListError(null);
    listUsers()
      .then(setUsers)
      .catch((err) => setListError(err instanceof ApiError ? err.message : "Gagal memuat daftar user."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refreshUsers();
  }, []);

  async function handleDeactivate(id: string) {
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await updateUser(id, { isActive: false });
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isActive: false } : u)));
      setDeactivatingId(null);
    } catch (err) {
      setDeactivateError(err instanceof ApiError ? err.message : "Gagal menonaktifkan user.");
    } finally {
      setDeactivating(false);
    }
  }

  async function handleActivate(id: string) {
    setActivatingId(id);
    setActivateError(null);
    try {
      await updateUser(id, { isActive: true });
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, isActive: true } : u)));
    } catch (err) {
      setActivateError(err instanceof ApiError ? err.message : "Gagal mengaktifkan user.");
    } finally {
      setActivatingId(null);
    }
  }

  async function handleReset(user: UserListItem) {
    setResetting(true);
    setResetError(null);
    try {
      const result = await resetUserCredential(user.id);
      setResettingId(null);
      if (result.generatedPin) {
        setCredentialConfirmation({ name: user.name, label: "PIN baru", value: result.generatedPin });
      } else if (result.generatedPassword) {
        setCredentialConfirmation({ name: user.name, label: "Password baru", value: result.generatedPassword });
      }
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : "Gagal reset kredensial.");
    } finally {
      setResetting(false);
    }
  }

  const deactivatingUser = users.find((u) => u.id === deactivatingId) ?? null;
  const resettingUser = users.find((u) => u.id === resettingId) ?? null;

  return (
    <div className="space-y-4">
      <CreateUserForm
        onCreated={(result, createdName, createdRole) => {
          refreshUsers();
          if (createdRole === "staf" && result.generatedPin) {
            setCredentialConfirmation({ name: createdName, label: "PIN login", value: result.generatedPin });
          }
        }}
      />

      <Card>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Daftar user</h2>

        {listError ? (
          <div className="mb-3">
            <ErrorBox>{listError}</ErrorBox>
          </div>
        ) : null}
        {deactivateError ? (
          <div className="mb-3">
            <ErrorBox>{deactivateError}</ErrorBox>
          </div>
        ) : null}
        {activateError ? (
          <div className="mb-3">
            <ErrorBox>{activateError}</ErrorBox>
          </div>
        ) : null}
        {resetError ? (
          <div className="mb-3">
            <ErrorBox>{resetError}</ErrorBox>
          </div>
        ) : null}

        {loading ? <p className="py-6 text-center text-sm text-slate-500">Memuat...</p> : null}

        {!loading ? (
          <div className="space-y-2">
            {users.map((u) => {
              const isSelf = String(currentUser?.id) === u.id;
              const isBot = u.role === "integrasi";

              if (editingId === u.id) {
                return (
                  <EditUserForm
                    key={u.id}
                    user={u}
                    onDone={() => {
                      setEditingId(null);
                      refreshUsers();
                    }}
                    onCancel={() => setEditingId(null)}
                    onCredentialGenerated={(label, value) => setCredentialConfirmation({ name: u.name, label, value })}
                  />
                );
              }

              return (
                <div key={u.id} className="rounded-xl border border-slate-200 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {u.name} {!u.isActive ? <Badge tone="neutral">Nonaktif</Badge> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {ROLE_LABEL[u.role]} &middot;{" "}
                        {/* Tiga role ini all-locations di backend (isAllLocationsRole di
                            core/src/auth/users.ts) jadi locationIds-nya selalu kosong --
                            tanpa "integrasi" di sini, akun bot tampil "Belum ada lokasi"
                            yang menyesatkan (seolah setupnya belum selesai). */}
                        {u.role === "owner" || u.role === "manajer_ops" || u.role === "integrasi"
                          ? "Semua lokasi"
                          : lokasiNames(u.locationIds, lokasi)}
                      </p>
                      <p className="text-xs text-slate-400">
                        Login pakai {u.authMethod === "pin" ? "PIN" : "username & password"}
                        {u.nomorWhatsapp ? ` · WA: ${u.nomorWhatsapp}` : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {isSelf ? <span className="text-xs text-slate-400">Akun kamu</span> : null}
                      {/* Akun bot (integrasi) dibuat/dikelola lewat CLI, bukan form ini -- tidak ada Edit/Hapus/Reset untuknya di sini. */}
                      {!isBot ? (
                        <>
                          <Button variant="secondary" className="text-xs" onClick={() => setEditingId(u.id)}>
                            Edit
                          </Button>
                          {!isSelf ? (
                            <>
                              {u.isActive ? (
                                <Button variant="danger" className="text-xs" onClick={() => setDeactivatingId(u.id)}>
                                  Hapus
                                </Button>
                              ) : (
                                <Button
                                  variant="secondary"
                                  className="text-xs"
                                  disabled={activatingId === u.id}
                                  onClick={() => handleActivate(u.id)}
                                >
                                  {activatingId === u.id ? "Mengaktifkan..." : "Aktifkan"}
                                </Button>
                              )}
                              <Button variant="ghost" className="text-xs" onClick={() => setResettingId(u.id)}>
                                Reset {u.authMethod === "pin" ? "PIN" : "password"}
                              </Button>
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {users.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Belum ada user.</p> : null}
          </div>
        ) : null}
      </Card>

      {deactivatingUser ? (
        <ConfirmDialog
          title="Hapus user?"
          message={`"${deactivatingUser.name}" akan dinonaktifkan -- tidak bisa login lagi sampai diaktifkan kembali (datanya tidak dihapus permanen).`}
          confirmLabel="Ya, hapus"
          danger
          loading={deactivating}
          onConfirm={() => handleDeactivate(deactivatingUser.id)}
          onCancel={() => setDeactivatingId(null)}
        />
      ) : null}

      {resettingUser ? (
        <ConfirmDialog
          title={`Reset ${resettingUser.authMethod === "pin" ? "PIN" : "password"}?`}
          message={`${resettingUser.authMethod === "pin" ? "PIN" : "Password"} lama "${resettingUser.name}" akan langsung tidak bisa dipakai login lagi, diganti dengan yang baru.`}
          danger
          loading={resetting}
          onConfirm={() => handleReset(resettingUser)}
          onCancel={() => setResettingId(null)}
        />
      ) : null}

      {credentialConfirmation ? (
        <CredentialConfirmationDialog
          {...credentialConfirmation}
          onClose={() => setCredentialConfirmation(null)}
        />
      ) : null}
    </div>
  );
}

function CreateUserForm({
  onCreated,
}: {
  onCreated: (result: CreateUserResult, name: string, role: Exclude<Role, "owner">) => void;
}) {
  const { lokasi } = useLokasiContext();
  const lokasiAktif = lokasi.filter((l) => l.isActive);
  const [name, setName] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("staf");
  const [locationIds, setLocationIds] = useState<number[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsLokasi = role === "supervisor" || role === "staf";
  const needsCredential = role === "manajer_ops" || role === "supervisor";

  function toggleLokasi(id: number) {
    setLocationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function resetForm() {
    setName("");
    setRole("staf");
    setLocationIds([]);
    setUsername("");
    setPassword("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Nama wajib diisi.");
      return;
    }
    if (role === "staf" && locationIds.length === 0) {
      setError("Pilih minimal 1 lokasi untuk staf.");
      return;
    }
    if (needsCredential && (!username.trim() || !password.trim())) {
      setError("Username dan password wajib diisi untuk role ini.");
      return;
    }

    setSaving(true);
    try {
      const result = await createUser({
        name: trimmedName,
        role,
        locationIds: needsLokasi && locationIds.length > 0 ? locationIds : undefined,
        username: needsCredential ? username.trim() : undefined,
        password: needsCredential ? password : undefined,
      });
      onCreated(result, trimmedName, role);
      resetForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal membuat user.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-slate-900">Tambah user baru</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Nama">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Role">
          <Select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Exclude<Role, "owner">);
              setLocationIds([]);
            }}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>

        {role === "manajer_ops" ? (
          <p className="text-xs text-slate-500">Manajer Ops otomatis punya akses ke semua lokasi.</p>
        ) : (
          <Field label={role === "staf" ? "Lokasi (wajib, minimal 1)" : "Lokasi (opsional)"}>
            <div className="space-y-2">
              {lokasiAktif.map((l) => (
                <label
                  key={l.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={locationIds.includes(Number(l.id))}
                    onChange={() => toggleLokasi(Number(l.id))}
                  />
                  <span className="text-sm text-slate-800">{l.name}</span>
                </label>
              ))}
            </div>
          </Field>
        )}

        {needsCredential ? (
          <>
            <Field label="Username">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
          </>
        ) : (
          <p className="text-xs text-slate-500">
            Staf tidak pakai username/password -- login lewat PIN 6 digit yang dibuat otomatis oleh sistem begitu
            user ini dibuat (ditampilkan sekali setelah disimpan).
          </p>
        )}

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Menyimpan..." : "Buat user"}
        </Button>
      </form>
    </Card>
  );
}

/**
 * Form edit user existing -- nama, lokasi tugas, nomor WhatsApp, dan ubah
 * role (semuanya owner-only, digerbang backend). Ubah role LINTAS keluarga
 * auth (staf/PIN <-> password, mis. staf jadi supervisor) otomatis
 * menghasilkan kredensial baru (PIN/password lama sudah tidak relevan) --
 * ditampilkan sekali lewat `onCredentialGenerated`, pola sama seperti
 * create/reset.
 */
function EditUserForm({
  user,
  onDone,
  onCancel,
  onCredentialGenerated,
}: {
  user: UserListItem;
  onDone: () => void;
  onCancel: () => void;
  onCredentialGenerated: (label: string, value: string) => void;
}) {
  const { lokasi } = useLokasiContext();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [locationIds, setLocationIds] = useState<number[]>(user.locationIds);
  const [nomorWhatsapp, setNomorWhatsapp] = useState(user.nomorWhatsapp ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Role yang bisa dipilih: 3 role manusia non-owner, PLUS "owner" itu
  // sendiri KALAU memang role user ini SEKARANG owner -- sengaja TIDAK
  // menawarkan cara MEMPROMOSIKAN user lain jadi owner lewat form ini
  // (preseden sama seperti ROLE_OPTIONS di CreateUserForm: "cuma ada 1
  // akun owner by design, bukan sesuatu yang dibuat lewat UI self-service
  // ini"), tapi tetap bisa MENURUNKAN owner existing ke role lain.
  const roleOptions = user.role === "owner" ? [{ value: "owner" as const, label: "Owner" }, ...ROLE_OPTIONS] : ROLE_OPTIONS;

  function toggleLokasi(id: number) {
    setLocationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Nama tidak boleh kosong.");
      return;
    }
    if (butuhLokasi(role) && locationIds.length === 0) {
      setError("Pilih minimal 1 lokasi untuk role ini.");
      return;
    }

    setSaving(true);
    try {
      const result = await updateUser(user.id, {
        name: name.trim(),
        nomorWhatsapp: nomorWhatsapp.trim() || null,
        role: role !== user.role ? role : undefined,
        // Lokasi cuma dikirim untuk role yang memang butuh lokasi -- role
        // all-locations (owner/manajer_ops) mengabaikan field ini di backend.
        locationIds: butuhLokasi(role) ? locationIds : undefined,
      });
      if (result.generatedPassword) onCredentialGenerated("Password baru", result.generatedPassword);
      else if (result.generatedPin) onCredentialGenerated("PIN baru", result.generatedPin);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan perubahan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-slate-900">Edit: {user.name}</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Nama">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roleOptions.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        {role !== user.role ? (
          <p className="text-xs text-amber-700">
            Mengubah role akan langsung membatalkan sesi login saat ini.
            {isPasswordRole(role) !== isPasswordRole(user.role)
              ? " Role ini pindah metode login (PIN/password) -- kredensial BARU akan dibuat otomatis dan ditampilkan sekali setelah disimpan."
              : ""}
          </p>
        ) : null}

        {butuhLokasi(role) ? (
          <Field label="Lokasi (wajib, minimal 1)">
            <div className="space-y-2">
              {lokasi
                .filter((l) => l.isActive)
                .map((l) => (
                  <label key={l.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={locationIds.includes(Number(l.id))}
                      onChange={() => toggleLokasi(Number(l.id))}
                    />
                    <span className="text-sm text-slate-800">{l.name}</span>
                  </label>
                ))}
            </div>
          </Field>
        ) : (
          <p className="text-xs text-slate-500">Role ini otomatis punya akses ke semua lokasi.</p>
        )}

        <Field label="Nomor WhatsApp (opsional)">
          <Input
            type="tel"
            value={nomorWhatsapp}
            onChange={(e) => setNomorWhatsapp(e.target.value)}
            placeholder="mis. 081234567890"
          />
        </Field>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Batal
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Dipakai untuk PIN/password baru setelah create ATAU reset -- selalu "tampil sekali, lalu hilang". */
function CredentialConfirmationDialog({
  name,
  label,
  value,
  onClose,
}: {
  name: string;
  label: string;
  value: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="mb-2 text-base font-semibold text-slate-900">
          {label} untuk {name}
        </h2>
        <p className="mb-3 break-all text-center text-2xl font-bold tracking-wide text-blue-700">{value}</p>
        <ResultBox>Catat {label.toLowerCase()} ini sekarang -- tidak akan ditampilkan lagi setelah ditutup.</ResultBox>
        <Button className="mt-4 w-full" onClick={onClose}>
          Sudah dicatat, tutup
        </Button>
      </div>
    </div>
  );
}
