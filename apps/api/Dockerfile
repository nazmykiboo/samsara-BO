# Image untuk @samsara/api. Build context HARUS root monorepo (bukan apps/api/),
# karena ini workspace npm -- butuh package-lock.json root + source workspace lain
# (core, modules/*) yang di-import lewat "main": "./src/index.ts" (lihat package.json
# tiap workspace). Jalankan: `docker build -f apps/api/Dockerfile -t samsara-api .`
#
# Production TETAP jalan lewat tsx (bukan tsc + node dist/), persis pola yang sudah
# dipakai "dev" (tsx watch) -- supaya resolusi cross-workspace ("main" menunjuk ke
# src/*.ts, bukan dist/*.js) konsisten dan tidak perlu mengubah konvensi package.json
# yang sudah berjalan di seluruh repo. Kalau nanti mau pindah ke dist/ murni (image
# sedikit lebih kecil), itu perubahan konvensi lintas-modul -- tanya owner dulu.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY core/package.json core/package.json
COPY modules/hr/package.json modules/hr/package.json
COPY modules/inventory/package.json modules/inventory/package.json
COPY modules/sales-sync/package.json modules/sales-sync/package.json
COPY apps/api/package.json apps/api/package.json
# npm ci (bukan --omit=dev): tsx ada di devDependencies root, dan DIBUTUHKAN saat
# runtime (bukan cuma build time) karena pola "jalankan via tsx" di atas.
RUN npm ci

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY core core
COPY modules/hr modules/hr
COPY modules/inventory modules/inventory
COPY modules/sales-sync modules/sales-sync
COPY apps/api apps/api

EXPOSE 4000

# Migrasi idempotent (schema_migrations, lihat core/src/db/migrate.ts) -- aman
# dijalankan di setiap start container, bukan cuma deploy pertama.
CMD ["sh", "-c", "node_modules/.bin/tsx apps/api/src/migrate.ts && node_modules/.bin/tsx apps/api/src/index.ts"]
