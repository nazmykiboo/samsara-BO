import type { ApiErrorBody } from "./types";

const TOKEN_STORAGE_KEY = "samsara_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  /** Body JSON error APA ADANYA (selain `.error` yang sudah jadi `.message`) -- dipakai endpoint yang menyertakan field tambahan, mis. `penghalang` di PATCH /lokasi/:id. */
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Kunci sessionStorage untuk pesan "kenapa kamu tiba-tiba di halaman login" --
 * ditulis di sini saat sesi dibersihkan karena 401, dibaca & dihapus sekali
 * oleh LoginPage. sessionStorage (bukan localStorage) supaya pesannya ikut
 * hilang kalau tab ditutup, tidak nyangkut sampai sesi browser berikutnya.
 */
export const SESSION_NOTICE_KEY = "samsara_session_notice";

/**
 * Backend sekarang bisa membasikan token di TENGAH sesi (user dinonaktifkan,
 * kredensial di-reset, lokasinya diubah -- lihat core_users.token_version),
 * jadi 401 bisa muncul di request mana pun, bukan cuma saat login. Tanpa
 * penanganan global, halaman cuma menampilkan error mentah sementara token
 * basi tetap tersimpan di localStorage.
 *
 * Dipanggil dari `request()` dan `postCsv()` SEBELUM ApiError dilempar --
 * pemanggil tetap menerima error seperti biasa (tidak ada perubahan kontrak),
 * cuma saja halamannya langsung ditinggalkan.
 */
function handleUnauthorized(path: string, message: string): void {
  // Endpoint login SENDIRI balas 401 untuk "password/PIN salah" -- itu gagal
  // login, BUKAN sesi berakhir. Kalau tidak dikecualikan, salah password akan
  // memicu redirect ke /login terus-menerus (dan membuang pesan errornya).
  if (path.includes("/auth/login")) return;

  setToken(null);
  // Data user juga dibuang supaya AuthProvider tidak merender ulang sebagai
  // "masih login" setelah reload. Kuncinya di-hardcode (bukan import dari
  // AuthContext) supaya file non-komponen ini tidak bergantung ke modul React.
  localStorage.removeItem("samsara_user");
  sessionStorage.setItem(SESSION_NOTICE_KEY, message);

  // Router app ini `<BrowserRouter>` biasa (lihat apps/web/src/main.tsx) --
  // tidak ada instance router yang bisa di-navigate dari luar komponen, dan
  // hook `useNavigate` tidak bisa dipakai di file ini. Full reload adalah cara
  // paling sederhana yang juga memastikan seluruh state React ikut bersih.
  // Guard: jangan reload kalau sudah di halaman login (hindari loop).
  if (window.location.pathname !== "/login") window.location.href = "/login";
}

/**
 * Redirect paksa ke layar "Buat kredensial baru" (2026-10-30) -- dipicu 403
 * `code: "WAJIB_GANTI_KREDENSIAL"` dari endpoint APA PUN selain
 * `/auth/ganti-kredensial` itu sendiri (yang memang SATU-SATUNYA endpoint
 * yang tetap diizinkan selama penanda ini aktif -- lihat
 * `requireGantiKredensialDulu` di backend). BEDA dari `handleUnauthorized`:
 * token & data user TIDAK dibuang (sesi tetap sah, cuma dibatasi endpoint),
 * jadi layar barunya bisa langsung pakai token yang sama untuk memanggil
 * `gantiKredensialSendiri`.
 */
function handleWajibGantiKredensial(path: string, body: ApiErrorBody | null): void {
  if (!body || body.code !== "WAJIB_GANTI_KREDENSIAL") return;
  if (path.includes("/auth/ganti-kredensial")) return;
  if (window.location.pathname !== "/ganti-kredensial") window.location.href = "/ganti-kredensial";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const errBody = data as ApiErrorBody | null;
    const message = errBody?.error ?? `Permintaan gagal (${res.status})`;
    if (res.status === 401) handleUnauthorized(path, message);
    if (res.status === 403) handleWajibGantiKredensial(path, errBody);
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

/**
 * POST dengan body TEKS CSV MENTAH (`Content-Type: text/csv`) -- BUKAN JSON, BUKAN
 * multipart/FormData.
 *
 * `request()` di atas TIDAK bisa dipakai untuk ini: dia selalu `JSON.stringify(body)` dan
 * selalu memasang `Content-Type: application/json`. Endpoint import modul sales-sync
 * memasang `express.text({ type: "text/csv" })` khusus per-route di backend dan akan
 * menolak (400) kalau Content-Type-nya bukan `text/csv` -- lihat
 * `modules/sales-sync/module.json` § api.endpoints.
 *
 * Cara ambil token dan penanganan error-nya disamakan dengan `request()` supaya seluruh
 * app tetap menangkap `ApiError` yang sama (pesan dari field `error` response).
 */
export async function postCsv<T>(path: string, csvText: string): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "text/csv",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: csvText,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const errBody = data as ApiErrorBody | null;
    const message = errBody?.error ?? `Permintaan gagal (${res.status})`;
    if (res.status === 401) handleUnauthorized(path, message);
    if (res.status === 403) handleWajibGantiKredensial(path, errBody);
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

/**
 * PUT dengan body FILE MENTAH (Content-Type = tipe file aslinya) -- pola
 * sama seperti `postCsv` di atas, dipakai upload logo identitas bisnis.
 * Backend memasang `express.raw({ type: [...] })` khusus per-route (lihat
 * `core/src/public/router.ts`), menolak (400) Content-Type di luar
 * PNG/JPG/WebP atau ukuran di atas 500KB.
 */
export async function putFile<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const errBody = data as ApiErrorBody | null;
    const message = errBody?.error ?? `Permintaan gagal (${res.status})`;
    if (res.status === 401) handleUnauthorized(path, message);
    if (res.status === 403) handleWajibGantiKredensial(path, errBody);
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
