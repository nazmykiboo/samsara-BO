# Spesifikasi Module Manifest

Kontrak yang wajib dipenuhi setiap modul di `modules/*`: satu file
`module.json` di root package modul, ditambah kode yang mengekspornya lewat
`src/index.ts`.

## `module.json` — skema data

```json
{
  "name": "inventory",
  "version": "0.1.0",
  "description": "Manajemen stok, resep, HPP, dan transaksi bahan baku untuk outlet Samsara.",
  "enabled": true,
  "dependsOn": [],
  "tablePrefix": "inventory_",
  "tables": ["inventory_items", "..."],
  "api": {
    "basePath": "/api/inventory",
    "endpoints": [
      {
        "method": "GET",
        "path": "/status",
        "description": "Health check modul.",
        "permission": { "action": "inventory.status", "roles": ["owner", "manajer_ops", "supervisor", "staf"] }
      }
    ]
  },
  "permissions": [
    { "action": "hpp.lihat_harga", "roles": ["owner", "manajer_ops"] }
  ],
  "migrationsDir": "src/db/migrations"
}
```

| Field | Tipe | Keterangan |
|---|---|---|
| `name` | string | Unik antar modul. Dipakai juga sebagai identitas di `/health` dan tracking migrasi. |
| `version` | string (semver) | Versi modul sendiri, independen dari modul lain. |
| `description` | string | Penjelasan singkat untuk dokumentasi/non-engineer. |
| `enabled` | boolean | Status aktif/nonaktif. Modul nonaktif tidak dimount ke server, tapi tetap tampil di `/health`. |
| `dependsOn` | string[] | Nama modul lain yang jadi prasyarat (urutan load & migrasi). |
| `tablePrefix` | string | Prefix nama tabel milik modul ini. Harus unik antar modul. |
| `tables` | string[] | Tabel yang dimiliki modul ini (dokumentasi kepemilikan data, lengkap dengan prefix). |
| `api.basePath` | string | Path dasar tempat router modul dipasang, mis. `/api/inventory`. |
| `api.endpoints` | array | Daftar endpoint yang diekspos ke modul/klien lain (dokumentasi kontrak, bukan sumber kebenaran routing — routing sungguhan ada di kode). |
| `api.endpoints[].permission` | object, opsional | `{ action, roles, locationScope? }` — deklarasi siapa yang boleh memanggil endpoint ini (lihat § "Auth & permission" di bawah). Endpoint tanpa field ini cuma butuh login, tidak ada gate role. |
| `permissions` | array, opsional | Permission yang TIDAK terikat ke satu endpoint tertentu — dipakai untuk filter field di response (`hasPermission`, bukan gate akses) atau mendokumentasikan aksi yang direncanakan tapi endpoint-nya belum dibangun. |
| `migrationsDir` | string | Path relatif (dari root package modul) ke folder berisi `*.sql`. |

## Auth & permission (dibangun di `core`, Tahap 3 — lihat `docs/architecture-decisions.md` § 12)

Semua endpoint (kecuali `/health` dan `POST /api/auth/login`) wajib login
(`Authorization: Bearer <token JWT>`) — ini ditegakkan GLOBAL oleh
`core/src/server/build-server.ts`, modul tidak perlu mengurusnya sendiri.

Role yang tersedia (tetap, didefinisikan di `core_roles`): `owner`,
`manajer_ops`, `supervisor`, `staf`.

Untuk MEMBATASI AKSES ke satu endpoint per role (dan opsional per lokasi),
deklarasikan `permission` di entry `api.endpoints` yang relevan:

```json
{
  "method": "POST",
  "path": "/transaksi/pembelian",
  "description": "...",
  "permission": {
    "action": "pembelian.create",
    "roles": ["owner", "manajer_ops", "supervisor"],
    "locationScope": { "supervisor": "own" }
  }
}
```

Lalu di router modul, pasang middleware-nya (diimpor dari `@samsara/core`,
BUKAN dibangun sendiri per modul):

```ts
import { requirePermission } from "@samsara/core";

router.post(
  "/transaksi/pembelian",
  requirePermission("pembelian.create", {
    extractLocationIds: (req) => [Number(req.body.locationId)],
  }),
  handler,
);
```

`action` di kode HARUS sama persis dengan yang dideklarasikan di
`module.json` — kalau tidak terdaftar di manapun, `requirePermission`/`hasPermission`
melempar error saat request masuk (bukan gagal diam-diam). `locationScope`
per role: `"any"` (default kalau role tidak disebut) atau `"own"` (request
harus merujuk lokasi yang ada di `user.locationIds`, dicek lewat
`extractLocationIds`).

Untuk FILTER FIELD di response (bukan gate akses endpoint — mis. sembunyikan
kolom harga untuk role tertentu tapi endpoint-nya tetap bisa diakses),
deklarasikan aksinya di `permissions` (bukan di dalam satu `api.endpoints`
tertentu), lalu cek dengan `hasPermission` (non-blocking) di handler:

```ts
import { getAuthUser, hasPermission } from "@samsara/core";

const user = getAuthUser(req);
if (!hasPermission(user, "hpp.lihat_harga")) {
  delete responseBody.hpp_per_porsi; // dihapus dari objek, bukan di-null-kan
}
```

`module.json` sengaja **murni data** — tidak boleh berisi kode (JSON tidak
bisa menyimpan fungsi). Ini supaya siapa pun (termasuk non-engineer atau
tooling dokumentasi) bisa membaca kontrak modul tanpa menjalankan
TypeScript.

## Bentuk TypeScript (`core/src/manifest/types.ts`)

```ts
interface ModuleManifest {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  dependsOn: string[];
  tablePrefix: string;
  tables: string[];
  api: { basePath: string; endpoints: ModuleApiEndpoint[] };
  permissions?: PermissionDef[]; // permission lepas dari endpoint tertentu
  migrationsDir: string;
}

interface ModuleApiEndpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  permission?: PermissionDef; // gate akses endpoint ini
}

interface PermissionDef {
  action: string;
  roles: Array<"owner" | "manajer_ops" | "supervisor" | "staf">;
  locationScope?: Partial<Record<"owner" | "manajer_ops" | "supervisor" | "staf", "any" | "own">>;
}

// Yang benar-benar dipakai runtime: manifest + kode dari package modul.
interface LoadedModule {
  manifest: ModuleManifest;
  createRouter: () => Router;
  migrationsPath: string; // absolute path, sudah di-resolve modul itu sendiri
}
```

## Aturan yang dijaga registry (`core/src/manifest/registry.ts`)

1. **Nama unik** — dua modul tidak boleh pakai `name` yang sama.
2. **Dependency harus terdaftar** — `dependsOn` yang menunjuk modul yang
   tidak ada akan menghentikan startup dengan error jelas.
3. **Tidak boleh melingkar** — `A dependsOn B` dan `B dependsOn A` (langsung
   atau tidak langsung) ditolak.
4. **Satu prefix, satu modul** — dua modul tidak boleh mengklaim
   `tablePrefix` yang sama.
5. **Urutan load & migrasi mengikuti dependency** — modul prasyarat selalu
   dimuat/dimigrasikan lebih dulu (topological sort).
6. **Modul nonaktif (`enabled: false`) tidak dimount ke server**, tapi tetap
   tampil di `/health` untuk monitoring.

## Cara menambah modul baru

1. `modules/<nama>/module.json` — isi sesuai skema di atas.
2. `modules/<nama>/src/api/router.ts` — Express Router, endpoint modul ini.
3. `modules/<nama>/src/db/migrations/*.sql` — skema tabel modul ini, semua
   nama tabel diberi prefix modul (mis. `<nama>_items`), jangan sentuh tabel
   modul lain.
4. `modules/<nama>/src/index.ts` — baca `module.json` sendiri, resolve
   `migrationsPath` absolut, lalu `export default { manifest, createRouter,
   migrationsPath }` (contoh: `modules/inventory/src/index.ts`).
5. `modules/<nama>/package.json` — `name: "@samsara/<nama>"`, dependency ke
   `@samsara/core`.
6. Daftarkan di `apps/api/src/modules.ts` (import default export-nya,
   tambahkan ke array `modules`) dan `apps/api/package.json` (dependency).

Modul baru **tidak pernah** mengubah kode di `core/` atau di modul lain —
kalau butuh data dari modul lain, panggil API yang modul itu ekspos.
