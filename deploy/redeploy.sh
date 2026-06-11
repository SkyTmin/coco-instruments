#!/usr/bin/env bash
# Pull the latest code and rebuild. Run as root: sudo bash deploy/redeploy.sh
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/coco}"
BRANCH="${BRANCH:-prod}"
cd "$APP_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
npm ci
# Zero-downtime: build aside and swap, so the live server never serves a
# half-built dist (see deploy/setup.sh for details).
rm -rf dist-next
npm run build -- --outDir dist-next
rm -rf dist-old
[ -d dist ] && mv dist dist-old
mv dist-next dist
rm -rf dist-old
systemctl restart coco 2>/dev/null || true
systemctl reload caddy 2>/dev/null || systemctl restart caddy
echo "✅ Redeployed from $BRANCH."
