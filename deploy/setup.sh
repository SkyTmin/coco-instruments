#!/usr/bin/env bash
# =============================================================================
# Coco — one-shot VPS deploy (Ubuntu 22.04+). Run as root:
#
#     curl -fsSL https://raw.githubusercontent.com/SkyTmin/coco-instruments/prod/deploy/setup.sh | bash
#
# or after cloning:  sudo bash deploy/setup.sh
#
# Installs Node + Caddy, builds the Mini App, and serves it over HTTPS
# (auto Let's Encrypt) on <your-ip>.nip.io. Idempotent — safe to re-run.
# Override defaults with env vars, e.g.  DOMAIN=app.example.com bash setup.sh
# =============================================================================
set -euo pipefail

REPO="${REPO:-https://github.com/SkyTmin/coco-instruments.git}"
BRANCH="${BRANCH:-prod}"
APP_DIR="${APP_DIR:-/opt/coco}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/coco/uploads}"
STORE_DIR="${STORE_DIR:-$(dirname "$UPLOAD_DIR")/store}"
BOT_TOKEN="${BOT_TOKEN:-}"
GH_DISPATCH_TOKEN="${GH_DISPATCH_TOKEN:-}"

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

echo "==> Configuring persistent uploads"
mkdir -p "$UPLOAD_DIR" "$STORE_DIR"
chown -R root:root "$UPLOAD_DIR" "$STORE_DIR"

echo "==> Writing server environment (/etc/coco.env)"
# Preserve existing tokens if this run didn't pass them (manual re-run).
if [ -z "$BOT_TOKEN" ] && [ -f /etc/coco.env ]; then
  BOT_TOKEN="$(grep -E '^BOT_TOKEN=' /etc/coco.env 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi
if [ -z "$GH_DISPATCH_TOKEN" ] && [ -f /etc/coco.env ]; then
  GH_DISPATCH_TOKEN="$(grep -E '^GH_DISPATCH_TOKEN=' /etc/coco.env 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi
touch /etc/coco.env && chmod 600 /etc/coco.env
{
  echo "NODE_ENV=production"
  echo "PORT=3000"
  echo "UPLOAD_DIR=$UPLOAD_DIR"
  echo "STORE_DIR=$STORE_DIR"
  echo "MAX_UPLOAD_BYTES=3145728"
  echo "REMINDERS_FILE=$(dirname "$UPLOAD_DIR")/reminders.json"
  [ -n "$BOT_TOKEN" ] && echo "BOT_TOKEN=$BOT_TOKEN"
  [ -n "$GH_DISPATCH_TOKEN" ] && echo "GH_DISPATCH_TOKEN=$GH_DISPATCH_TOKEN"
} > /etc/coco.env
[ -n "$BOT_TOKEN" ] && echo "    bot token set → reminders enabled" || echo "    no bot token → reminders disabled"
[ -n "$GH_DISPATCH_TOKEN" ] && echo "    dispatch token set → instant delivery enabled" || echo "    NO dispatch token (add GH_TOKEN secret + redeploy) → delivery via slow schedule"

echo "==> Writing systemd service"
cat > /etc/systemd/system/coco.service <<EOF
[Unit]
Description=Coco Mini App
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/coco.env
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable coco >/dev/null 2>&1 || true
systemctl restart coco

echo "==> Writing /etc/caddy/Caddyfile"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode gzip zstd
    reverse_proxy 127.0.0.1:3000
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
