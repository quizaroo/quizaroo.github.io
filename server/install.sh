#!/usr/bin/env bash
# Install or update the Open Flashcards server on Ubuntu / Debian (run as root, from this folder).
#
#   sudo ./install.sh home   flashcards.lan         # LAN: HTTPS from Caddy's own certificate authority
#                                              (a name, an IP, or both: flashcards.lan,<ip>)
#   sudo ./install.sh public flashcards.example.com # internet: automatic Let's Encrypt certificate
#   sudo ./install.sh proxy                   # behind a web server you already run (Apache, nginx): no Caddy
#   sudo ./install.sh update                  # after `git pull`: refresh the code, keep settings and data
#
# Everything is fetched over https. Safe to run again.

set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root (sudo)."; exit 1; }

MODE="${1:-}"; ADDRESS="${2:-}"
case "$MODE" in
  home|public) [ -n "$ADDRESS" ] || { echo "Usage: $0 $MODE <address>"; exit 1; } ;;
  update|proxy) ;;
  *) sed -n '2,9p' "$0" | sed 's/^# \?//'; exit 1 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/open-flashcards-server

# --- Node 24 (the server uses node:sqlite) ---
need_node=1
if command -v node >/dev/null; then
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] && need_node=0
fi
if [ "$need_node" = 1 ]; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs
fi

# --- the port must be free (another service on this machine may already use it) ---
PORT="$(sed -n 's/^PORT=//p' /etc/open-flashcards/open-flashcards.env 2>/dev/null | tail -1)"; PORT="${PORT:-8797}"
if ! systemctl is-active -q open-flashcards-server && ss -ltn "sport = :$PORT" | grep -q LISTEN; then
  echo "Port $PORT is already in use. Set PORT=<another> in /etc/open-flashcards/open-flashcards.env (create it if needed), then run this again."
  exit 1
fi

# --- user, code, data, settings ---
id openflashcards >/dev/null 2>&1 || useradd --system --home /var/lib/open-flashcards --shell /usr/sbin/nologin openflashcards
install -d -o openflashcards -g openflashcards -m 700 /var/lib/open-flashcards
install -d "$APP" /etc/open-flashcards
install -m 644 "$HERE"/server.js "$HERE"/admin.js "$HERE"/package.json "$APP"/
[ -f /etc/open-flashcards/open-flashcards.env ] || install -m 640 -o root -g openflashcards "$HERE"/deploy/open-flashcards.env.example /etc/open-flashcards/open-flashcards.env
install -m 644 "$HERE"/deploy/open-flashcards-server.service /etc/systemd/system/open-flashcards-server.service
# `registration` edits /etc/open-flashcards/open-flashcards.env and restarts the service, which needs root.
cat > /usr/local/bin/flashcards-admin <<'WRAP'
#!/bin/sh
if [ "$1" = registration ]; then exec env DATA_DIR=/var/lib/open-flashcards /usr/bin/node /opt/open-flashcards-server/admin.js "$@"; fi
exec runuser -u openflashcards -- env DATA_DIR=/var/lib/open-flashcards /usr/bin/node /opt/open-flashcards-server/admin.js "$@"
WRAP
chmod 755 /usr/local/bin/flashcards-admin
systemctl daemon-reload
systemctl enable --now open-flashcards-server
systemctl restart open-flashcards-server

# --- Caddy (HTTPS in front) ---
if [ "$MODE" = home ] || [ "$MODE" = public ]; then
  if ! command -v caddy >/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
  fi
  if [ "$MODE" = home ]; then
    # One or more addresses (a local name and/or an IP, comma separated): each
    # gets a certificate, and the certificate download works on each.
    HTTPS_SITES=""; HTTP_SITES=""
    for a in $(echo "$ADDRESS" | tr ',' ' '); do
      HTTPS_SITES="${HTTPS_SITES:+$HTTPS_SITES, }https://$a"
      HTTP_SITES="${HTTP_SITES:+$HTTP_SITES, }http://$a"
    done
    sed -e "s|https://__ADDRESS__|$HTTPS_SITES|" -e "s|http://__ADDRESS__|$HTTP_SITES|" "$HERE/deploy/Caddyfile.home" > /etc/caddy/Caddyfile
  else
    sed "s/__ADDRESS__/$ADDRESS/" "$HERE/deploy/Caddyfile.$MODE" > /etc/caddy/Caddyfile
  fi
  systemctl enable caddy
  systemctl restart caddy
fi

# --- Home servers: publish Caddy's root certificate at http://<address>/flashcards-ca.crt ---
# Caddy makes its certificate authority on its first start, which can take a
# moment; `install.sh update` copies it too, so running that later fixes a
# first start that was too slow.
if grep -q 'tls internal' /etc/caddy/Caddyfile 2>/dev/null; then
  ROOT=/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
  for _ in $(seq 1 30); do [ -f "$ROOT" ] && break; sleep 1; done
  if [ -f "$ROOT" ]; then
    install -m 644 "$ROOT" /etc/caddy/flashcards-ca.crt
  else
    echo "Caddy hasn't made its certificate yet. In a minute, run: sudo ./install.sh update"
  fi
fi

sleep 1
systemctl is-active open-flashcards-server >/dev/null && echo "open-flashcards-server is running."
FIRST="${ADDRESS%%,*}"
if [ "$MODE" = home ]; then
  echo "Devices must trust Caddy's certificate authority once: on a phone, open http://$FIRST/flashcards-ca.crt in Safari;"
  echo "see README.md (\"Trusting the home certificate\")."
fi
if [ "$MODE" = proxy ]; then
  echo "The server listens on 127.0.0.1:8797. Point your web server's HTTPS site at it: see README.md (\"Behind a web server you already run\")."
  echo "Check here: curl -s http://127.0.0.1:8797/api/health"
fi
[ "$MODE" = update ] || [ "$MODE" = proxy ] || echo "Check: https://$FIRST/api/health   Then in Open Flashcards: Settings -> Sync -> server https://$FIRST"
