import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `dotenv/config` bawaan memuat `.env` relatif ke `process.cwd()` --
// tapi `npm run <script> -w apps/api` menjalankan cwd = apps/api, BUKAN
// root repo, jadi `.env` di root repo tidak pernah termuat lewat cara itu
// (selama ini "ketolong" karena default DB_* di core/src/db/pool.ts
// kebetulan sama persis dengan isi .env). Di-resolve eksplisit ke root di
// sini supaya konsisten kapan pun script ini dijalankan.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });
