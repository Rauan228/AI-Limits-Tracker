#!/usr/bin/env bash
# Deploy / update AI Limits Tracker on the VPS.
# Run from the repo root after `npm run build`:  bash deploy/deploy.sh
set -euo pipefail

APP_DIR=/opt/ai-limits-tracker
DOMAIN="${DOMAIN:?set DOMAIN=your-domain}"

echo "==> Installing files to $APP_DIR"
sudo mkdir -p "$APP_DIR/server/dist" "$APP_DIR/web/dist" "$APP_DIR/data"
sudo cp server/dist/server.mjs "$APP_DIR/server/dist/"
sudo cp -r web/dist/. "$APP_DIR/web/dist/"

if [ ! -f "$APP_DIR/server/.env" ]; then
  echo "==> Creating server/.env (edit the password & secret!)"
  SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  sudo tee "$APP_DIR/server/.env" >/dev/null <<ENV
ADMIN_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(9).toString('base64url'))")
APP_SECRET=$SECRET
PORT=8795
POLL_INTERVAL_MIN=10
DATA_DIR=$APP_DIR/data
WEB_DIR=$APP_DIR/web/dist
ENV
  echo "    --> Generated password:"
  sudo grep ADMIN_PASSWORD "$APP_DIR/server/.env"
fi

echo "==> systemd service"
sudo cp deploy/aitracker.service /etc/systemd/system/aitracker.service
sudo systemctl daemon-reload
sudo systemctl enable --now aitracker
sudo systemctl restart aitracker

if [ ! -f /etc/nginx/sites-enabled/aitracker ]; then
  echo "==> nginx vhost for $DOMAIN"
  sudo sed "s/limits.example.com/$DOMAIN/" deploy/nginx.conf | sudo tee /etc/nginx/sites-available/aitracker >/dev/null
  sudo ln -sf /etc/nginx/sites-available/aitracker /etc/nginx/sites-enabled/aitracker
  sudo nginx -t && sudo systemctl reload nginx
  echo "==> TLS via certbot"
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@"$DOMAIN" --redirect || true
fi

echo "==> Done. https://$DOMAIN"
sudo systemctl --no-pager status aitracker | head -5
