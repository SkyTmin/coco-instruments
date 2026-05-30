#!/usr/bin/env bash
# Pull the latest code and rebuild. Run as root: sudo bash deploy/redeploy.sh
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/coco}"
BRANCH="${BRANCH:-claude/intelligent-noether-bcnYS}"
cd "$APP_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
npm ci
npm run build
systemctl restart coco 2>/dev/null || true
systemctl reload caddy 2>/dev/null || systemctl restart caddy
echo "✅ Redeployed from $BRANCH."
