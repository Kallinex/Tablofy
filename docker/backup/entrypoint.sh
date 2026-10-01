#!/bin/sh
set -eu

if [ "${BACKUP_ENABLED:-true}" != "true" ]; then
  echo "[backup] disabled (BACKUP_ENABLED=${BACKUP_ENABLED:-})"
  exec tail -f /dev/null
fi

SCHEDULE="${BACKUP_CRON:-0 2 * * *}"

# Write the crontab, redirecting job output to PID 1's stdout so it lands in
# `docker logs`. BusyBox crond reads /etc/crontabs/root.
echo "${SCHEDULE} /usr/local/bin/run-backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "[backup] starting crond with schedule: ${SCHEDULE}"

exec crond -f -l 8
