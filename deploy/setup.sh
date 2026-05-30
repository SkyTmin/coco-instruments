#!/usr/bin/env bash
# =============================================================================
# Coco — one-shot VPS deploy (Ubuntu 22.04+). Run as root:
#
#     curl -fsSL https://raw.githubusercontent.com/SkyTmin/coco-instruments/claude/intelligent-noether-bcnYS/deploy/setup.sh | bash
#
# or after cloning:  sudo bash deploy/setup.sh
#
# Installs Node + Caddy, builds the Mini App, and serves it over HTTPS
# (auto Let's Encrypt) on <your-ip>.nip.io. Idempotent — safe to re-run.
# Override defaults with env vars, e.g.  DOMAIN=app.example.com bash setup.sh
# =============================================================================
set -euo pipefail

REPO="${REPO:-https://github.com/SkyTmin/coco-instruments.git}"
BRANCH="${BRANCH:-claude/intelligent-noether-bcnYS}"
APP_DIR="${APP_DIR:-/opt/coco}"

echo "==> Detecting public IP / domain"
IP="$(curl -fsS https://api.ipify.org 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(hostname -I | awk '{print $1}')"
DOMAIN="${DOMAIN:-${IP}.nip.io}"
echo "    IP=$IP   DOMAIN=$DOMAIN"

echo "==> Ensuring swap (the build needs memory on small VPS)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

echo "==> Installing Node 20 (if missing)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

echo "==> Installing Caddy (if missing)"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Fetching app ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone -b "$BRANCH" "$REPO" "$APP_DIR"
fi

echo "==> Building"
cd "$APP_DIR"
npm ci
npm run build

echo "==> Writing /etc/caddy/Caddyfile"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    root * $APP_DIR/dist
    encode gzip zstd
    try_files {path} /index.html
    file_server
}
EOF

echo "==> Starting Caddy"
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

cat <<EOF

============================================================
 ✅ Done. Your Mini App is served at:

       https://$DOMAIN

 (Opening this in a normal browser shows "Открыть в Telegram" —
  that's expected; it only runs inside Telegram.)

 Next — point @coco_instruments_bot at it (one command, see
 deploy/README.md), replacing <BOT_TOKEN>:

   curl -s "https://api.telegram.org/bot<BOT_TOKEN>/setChatMenuButton" \\
     -H "Content-Type: application/json" \\
     -d '{"menu_button":{"type":"web_app","text":"Coco","web_app":{"url":"https://$DOMAIN/"}}}'
============================================================
EOF
