# Image untuk @samsara/web. Build context HARUS root monorepo (package-lock.json
# ada di root). apps/web TIDAK bergantung ke core/modules/* (cek package.json --
# cuma react/react-router/dsb), jadi build context di sini lebih ringan dari
# apps/api/Dockerfile. Jalankan: `docker build -f apps/web/Dockerfile -t samsara-web .`

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
# Halaman Panduan (PanduanPage.tsx) import docs/panduan-ops.md via `?raw` dari luar
# root Vite (lihat vite.config.ts fs.allow) -- perlu ikut di-copy ke context build.
COPY docs/panduan-ops.md docs/panduan-ops.md
RUN npm run build -w apps/web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
