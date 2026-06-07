#!/usr/bin/env bash
# Restore a Coco backup archive onto this server — e.g. after moving to a new VPS.
#
#   sudo bash deploy/restore.sh /path/to/coco-backup-YYYY-MM-DD-HH-MM-SS.tar.gz
#
# (First run deploy/setup.sh on the new server, then this. The archive contains
# store/ (all app data), uploads/ (photos), reminders.json and admin.json.)
set -euo pipefail

ARCHIVE="${1:-}"
DATA_ROOT="${DATA_ROOT:-/var/lib/coco}"

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "Usage: sudo bash deploy/restore.sh <backup.tar.gz>"
  exit 1
fi

echo "==> Restoring $ARCHIVE into $DATA_ROOT"
systemctl stop coco 2>/dev/null || true
mkdir -p "$DATA_ROOT"
tar -xzf "$ARCHIVE" -C "$DATA_ROOT"
chown -R root:root "$DATA_ROOT"
systemctl start coco 2>/dev/null || true
echo "✅ Restored. All data is back and the app is running."
