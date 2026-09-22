#!/usr/bin/env bash
# Backup trigger. Asks the running server to archive all data
# (/var/lib/coco/{store,uploads,reminders.json,admin.json}) and keep a rotated
# copy under /var/lib/coco/backups. It does NOT deliver anything: the VPS can't
# reach api.telegram.org, and sending is the job of the `backup.yml` workflow,
# which is the only daily sender. Invoked by the systemd timer
# `coco-backup.timer` and by the first step of that same workflow.
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/coco.env}"
get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }

PORT="$(get PORT)"; PORT="${PORT:-3000}"
BOT_TOKEN="$(get BOT_TOKEN)"
if [ -z "$BOT_TOKEN" ]; then
  echo "no BOT_TOKEN in $ENV_FILE — skipping backup"
  exit 0
fi

SECRET="$(printf 'backup:%s' "$BOT_TOKEN" | sha256sum | cut -c1-48)"
echo "==> Triggering backup via server"
curl -fsS -X POST "http://127.0.0.1:${PORT}/api/backup/run" -H "X-Backup-Secret: ${SECRET}"
echo
echo "✅ Backup done."
