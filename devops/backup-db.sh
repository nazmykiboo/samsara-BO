#!/bin/sh
# Backup harian database `samsara` (pg_dump), simpan RETENTION_DAYS hari terakhir.
# Dipasang sebagai CRON DI HOST VPS (lihat devops/README.md) -- BUKAN dijalankan
# dari container app, supaya tetap jalan walau container app sedang down/redeploy.
#
# Pakai `docker exec` ke container Postgres EXISTING (bukan pg_dump di host) --
# supaya tidak perlu install postgresql-client terpisah di host, dan versi
# pg_dump dijamin cocok dengan versi server (binary dari container itu sendiri).
#
# Wajib di-set lewat environment (atau edit langsung nilai default di bawah SETELAH
# dicocokkan ke setup VPS yang sebenarnya -- lihat catatan "BELUM DIVERIFIKASI" di
# docker-compose.prod.yml, nama container Postgres belum dikonfirmasi):
#   PG_CONTAINER (nama container Postgres existing), DB_USER, DB_PASSWORD, DB_NAME

set -eu

PG_CONTAINER="${PG_CONTAINER:-postgres}"
DB_USER="${DB_USER:-samsara}"
DB_NAME="${DB_NAME:-samsara}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
BACKUP_DIR="${BACKUP_DIR:-/root/samsara-backups}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP=$(date +%Y-%m-%d_%H%M%S)
OUT_FILE="$BACKUP_DIR/samsara_${STAMP}.sql.gz"

docker exec -e PGPASSWORD="$DB_PASSWORD" "$PG_CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$OUT_FILE"
chmod 600 "$OUT_FILE"

echo "[backup-db] tersimpan: $OUT_FILE"

# Hapus backup lebih lama dari RETENTION_DAYS hari.
find "$BACKUP_DIR" -name "samsara_*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" -delete

echo "[backup-db] selesai, retensi ${RETENTION_DAYS} hari."
