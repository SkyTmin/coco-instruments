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
ADMIN_CHAT_ID="${ADMIN_CHAT_ID:-}"
# Cloudflare API token (Zone:DNS:Edit) → Caddy renews certs via DNS-01, which
# works even when the domain is proxied through Cloudflare (orange cloud).
CF_API_TOKEN="${CF_API_TOKEN:-}"

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

echo "==> Building (zero-downtime: build aside, then swap)"
cd "$APP_DIR"
npm ci
# Vite empties the output dir at build start. Building straight into dist/
# would leave the RUNNING server with an empty folder for the whole build —
# anyone opening the app then gets Telegram's "Не удалось запустить
# приложение" (Desktop caches it until restart). So: build into dist-next,
# swap atomically, only then restart.
rm -rf dist-next
npm run build -- --outDir dist-next
rm -rf dist-old
[ -d dist ] && mv dist dist-old
mv dist-next dist
rm -rf dist-old

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
if [ -z "$ADMIN_CHAT_ID" ] && [ -f /etc/coco.env ]; then
  ADMIN_CHAT_ID="$(grep -E '^ADMIN_CHAT_ID=' /etc/coco.env 2>/dev/null | head -1 | cut -d= -f2- || true)"
fi
touch /etc/coco.env && chmod 600 /etc/coco.env
{
  echo "NODE_ENV=production"
  echo "PORT=3000"
  echo "UPLOAD_DIR=$UPLOAD_DIR"
  echo "STORE_DIR=$STORE_DIR"
  echo "MAX_UPLOAD_BYTES=3145728"
  echo "REMINDERS_FILE=$(dirname "$UPLOAD_DIR")/reminders.json"
  echo "PUBLIC_URL=https://$DOMAIN"
  [ -n "$BOT_TOKEN" ] && echo "BOT_TOKEN=$BOT_TOKEN"
  [ -n "$GH_DISPATCH_TOKEN" ] && echo "GH_DISPATCH_TOKEN=$GH_DISPATCH_TOKEN"
  [ -n "$ADMIN_CHAT_ID" ] && echo "ADMIN_CHAT_ID=$ADMIN_CHAT_ID"
} > /etc/coco.env
[ -n "$BOT_TOKEN" ] && echo "    bot token set → reminders enabled" || echo "    no bot token → reminders disabled"
[ -n "$GH_DISPATCH_TOKEN" ] && echo "    dispatch token set → instant delivery enabled" || echo "    NO dispatch token (add GH_TOKEN secret + redeploy) → delivery via slow schedule"

# Cloudflare DNS-01 for automatic cert renewal behind the Cloudflare proxy. The
# stock Caddy can't do it (no DNS plugin), so swap in a build that includes the
# cloudflare provider, then hand Caddy the token via a systemd drop-in.
# CF_READY stays empty unless the plugin is actually present — so the Caddyfile
# never references a provider Caddy doesn't have (which would break startup).
CF_DROPIN=/etc/systemd/system/caddy.service.d/cf.conf
# Preserve the token across deploys that don't pass it (read from the drop-in).
if [ -z "$CF_API_TOKEN" ] && [ -f "$CF_DROPIN" ]; then
  CF_API_TOKEN="$(sed -n 's/^Environment=CF_API_TOKEN=//p' "$CF_DROPIN" | head -1 || true)"
fi
CF_READY=""
if [ -n "$CF_API_TOKEN" ]; then
  if ! caddy list-modules 2>/dev/null | grep -q 'dns.providers.cloudflare'; then
    echo "==> Installing Caddy with the Cloudflare DNS plugin"
    ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
    # Prefer a binary delivered by CI (the GitHub runner has unrestricted
    # internet); only fall back to the download API with a SHORT timeout so this
    # can never hang the deploy if the VPS can't reach caddyserver.com.
    if [ ! -s /tmp/caddy-cf ]; then
      curl -fsSL --connect-timeout 15 --max-time 150 -o /tmp/caddy-cf \
        "https://caddyserver.com/api/download?os=linux&arch=${ARCH}&p=github.com/caddy-dns/cloudflare" \
        || echo "!! Could not fetch Caddy+cloudflare (network); keeping current Caddy."
    fi
    # Replace Caddy only if the new binary actually runs AND has the plugin —
    # so a failed download or wrong arch can never break the running Caddy.
    if [ -s /tmp/caddy-cf ] && /tmp/caddy-cf list-modules 2>/dev/null | grep -q 'dns.providers.cloudflare'; then
      install -m 0755 /tmp/caddy-cf /usr/bin/caddy
    fi
    rm -f /tmp/caddy-cf
  fi
  if caddy list-modules 2>/dev/null | grep -q 'dns.providers.cloudflare'; then
    CF_READY=1
    mkdir -p /etc/systemd/system/caddy.service.d
    printf '[Service]\nEnvironment=CF_API_TOKEN=%s\n' "$CF_API_TOKEN" > "$CF_DROPIN"
    chmod 600 "$CF_DROPIN"
    systemctl daemon-reload
    echo "    Cloudflare DNS plugin ready → automatic cert renewal via DNS-01"
  else
    echo "    Cloudflare plugin unavailable → keeping the current cert (renewal needs the CI-built Caddy)."
  fi
fi

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
echo "==> Writing daily backup timer"
cat > /etc/systemd/system/coco-backup.service <<EOF
[Unit]
Description=Coco daily backup
After=coco.service

[Service]
Type=oneshot
EnvironmentFile=/etc/coco.env
ExecStart=/usr/bin/env bash $APP_DIR/deploy/backup.sh
EOF
cat > /etc/systemd/system/coco-backup.timer <<EOF
[Unit]
Description=Coco daily backup timer

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable coco >/dev/null 2>&1 || true
systemctl enable --now coco-backup.timer >/dev/null 2>&1 || true
systemctl restart coco

echo "==> Waiting for the app to come up"
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    echo "==> App is healthy"
    break
  fi
  if [ "$i" = 15 ]; then
    echo "!! App failed to respond on /api/health after restart" >&2
    journalctl -u coco -n 30 --no-pager >&2 || true
    exit 1
  fi
  sleep 2
done

echo "==> Writing /etc/caddy/Caddyfile"
{
  # Global ACME via Cloudflare DNS-01 (only when the plugin + token are ready),
  # so certs renew automatically even behind the Cloudflare proxy.
  if [ -n "$CF_READY" ]; then
    cat <<'EOF'
{
    acme_dns cloudflare {env.CF_API_TOKEN}
}

EOF
  fi
  cat <<EOF
$DOMAIN {
    encode gzip zstd
    reverse_proxy 127.0.0.1:3000
}
EOF
  # For a real registrable domain (e.g. coco-instruments.ru) also serve www and
  # redirect it to the apex. Skipped for the nip.io fallback and sub-domains.
  case "$DOMAIN" in
    *.nip.io | *.*.*) : ;;
    *.*)
      cat <<EOF

www.$DOMAIN {
    redir https://$DOMAIN{uri} permanent
}
EOF
      ;;
  esac
} > /etc/caddy/Caddyfile

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
