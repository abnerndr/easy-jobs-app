#!/usr/bin/env bash
set -euo pipefail

# Display virtual + VNC para Chromium headed (Dokploy / Docker).
export DISPLAY="${DISPLAY:-:99}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export VNC_PORT="${VNC_PORT:-5900}"
export APP_PORT="${APP_PORT:-3001}"
export GATEWAY_PORT="${PORT:-3000}"
export PLAYWRIGHT_HEADED="${PLAYWRIGHT_HEADED:-true}"

mkdir -p "${RESUME_STORAGE_DIR:-/app/data/resumes}" /app/data/sessions

start_xvfb() {
  if [[ -f "/tmp/.X${DISPLAY#:}-lock" ]]; then
    echo "[entrypoint] Xvfb já ativo em $DISPLAY"
    return
  fi
  echo "[entrypoint] iniciando Xvfb em $DISPLAY"
  Xvfb "$DISPLAY" -screen 0 1280x900x24 -ac +extension RANDR >/tmp/xvfb.log 2>&1 &
  for _ in $(seq 1 40); do
    if [[ -f "/tmp/.X${DISPLAY#:}-lock" ]]; then
      return
    fi
    sleep 0.25
  done
  echo "[entrypoint] aviso: Xvfb pode não ter subido; veja /tmp/xvfb.log" >&2
}

start_x11vnc() {
  if pgrep -x x11vnc >/dev/null 2>&1; then
    echo "[entrypoint] x11vnc já ativo"
    return
  fi
  echo "[entrypoint] iniciando x11vnc em :$VNC_PORT"
  x11vnc \
    -display "$DISPLAY" \
    -rfbport "$VNC_PORT" \
    -localhost \
    -forever \
    -shared \
    -nopw \
    -quiet \
    >/tmp/x11vnc.log 2>&1 &
  sleep 0.5
}

start_websockify() {
  if pgrep -f "websockify.*${NOVNC_PORT}" >/dev/null 2>&1; then
    echo "[entrypoint] websockify já ativo"
    return
  fi

  local web_root=""
  for candidate in /usr/share/novnc /usr/share/novnc/utils/.. /opt/novnc; do
    if [[ -f "${candidate}/vnc.html" ]] || [[ -f "${candidate}/vnc_lite.html" ]]; then
      web_root="$(cd "$candidate" && pwd)"
      break
    fi
  done

  if [[ -z "$web_root" ]]; then
    echo "[entrypoint] ERRO: noVNC não encontrado (pacote novnc)." >&2
    exit 1
  fi

  echo "[entrypoint] iniciando websockify :$NOVNC_PORT (web=$web_root → localhost:$VNC_PORT)"
  websockify \
    --web="$web_root" \
    "$NOVNC_PORT" \
    "localhost:${VNC_PORT}" \
    >/tmp/websockify.log 2>&1 &
  sleep 0.5
}

start_xvfb
start_x11vnc
start_websockify

echo "[entrypoint] DISPLAY=$DISPLAY PLAYWRIGHT_HEADED=$PLAYWRIGHT_HEADED"
echo "[entrypoint] app :$APP_PORT  gateway :$GATEWAY_PORT  novnc :$NOVNC_PORT"

if [[ -f /app/node_modules/prisma/build/index.js ]] || [[ -d /app/node_modules/prisma ]]; then
  echo "[entrypoint] prisma migrate deploy"
  (cd /app && node node_modules/prisma/build/index.js migrate deploy) \
    || (cd /app && ./node_modules/.bin/prisma migrate deploy) \
    || echo "[entrypoint] aviso: migrate falhou (seguindo mesmo assim)" >&2
fi

# Next standalone escuta em APP_PORT; gateway público em GATEWAY_PORT
export PORT="$APP_PORT"
node /app/server.js >/tmp/next.log 2>&1 &
NEXT_PID=$!

# Aguarda Next subir
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1 \
    || curl -sf "http://127.0.0.1:${APP_PORT}/login" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$NEXT_PID" 2>/dev/null; then
    echo "[entrypoint] Next.js morreu; log:" >&2
    tail -n 80 /tmp/next.log >&2 || true
    exit 1
  fi
  sleep 0.5
done

export GATEWAY_PORT
export APP_PORT
export NOVNC_PORT
exec node /app/scripts/gateway.mjs
