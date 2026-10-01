#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RCLONE_REMOTE:?RCLONE_REMOTE is required (e.g. offsite)}"

RCLONE_CONFIG="${RCLONE_CONFIG:-/config/rclone/rclone.conf}"
RCLONE_PATH="${RCLONE_PATH:-tablofy/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="/tmp/tablofy-${STAMP}.dump"

echo "[backup] $(date -u +%FT%TZ) dumping database"
pg_dump --no-owner --no-privileges --format=custom --file="${FILE}" "${DATABASE_URL}"

echo "[backup] uploading ${FILE} to ${RCLONE_REMOTE}:${RCLONE_PATH}"
rclone copy "${FILE}" "${RCLONE_REMOTE}:${RCLONE_PATH}" --config "${RCLONE_CONFIG}"

rm -f "${FILE}"

echo "[backup] pruning remote dumps older than ${RETENTION_DAYS} days"
rclone delete "${RCLONE_REMOTE}:${RCLONE_PATH}" \
  --min-age "${RETENTION_DAYS}d" \
  --config "${RCLONE_CONFIG}" || true

echo "[backup] done"
