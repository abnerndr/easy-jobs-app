#!/usr/bin/env bash
# Start noVNC stack + Next + gateway (Dokploy Nixpacks).
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export VNC_PORT="${VNC_PORT:-5900}"
export APP_PORT="${APP_PORT:-3001}"
export GATEWAY_PORT="${PORT:-3000}"
export PLAYWRIGHT_HEADED="${PLAYWRIGHT_HEADED:-true}"
export RESUME_STORAGE_DIR="${RESUME_STORAGE_DIR:-/app/data/resumes}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p "$RESUME_STORAGE_DIR" "$ROOT/data/sessions" /tmp/.X11-unix
chmod 1777 /tmp/.X11-unix 2>/dev/null || true

start_xvfb() {
  if [[ -f "/tmp/.X${DISPLAY#:}-lock" ]]; then
    echo "[nixpacks-start] Xvfb já ativo em $DISPLAY"
    return
  fi
  echo "[nixpacks-start] iniciando Xvfb em $DISPLAY"
  Xvfb "$DISPLAY" -screen 0 1280x900x24 -ac +extension RANDR >/tmp/xvfb.log 2>&1 &
  for _ in $(seq 1 40); do
    [[ -f "/tmp/.X${DISPLAY#:}-lock" ]] && return
    sleep 0.25
  done
  echo "[nixpacks-start] aviso: Xvfb pode não ter subido" >&2
}

start_x11vnc() {
  if pgrep -x x11vnc >/dev/null 2>&1; then
    echo "[nixpacks-start] x11vnc já ativo"
    return
  fi
  if ! command -v x11vnc >/dev/null 2>&1; then
    echo "[nixpacks-start] ERRO: x11vnc não instalado (aptPkgs)" >&2
    exit 1
  fi
  echo "[nixpacks-start] iniciando x11vnc :$VNC_PORT"
  x11vnc \
    -display "$DISPLAY" \
    -rfbport "$VNC_PORT" \
    -localhost \
    -forever \
    -shared \
    -nopw \
    -quiet \
    >/tmp/x11vnc.log 2>&1 &
  sleep 0.6
}

start_websockify() {
  if pgrep -f "websockify.*${NOVNC_PORT}" >/dev/null 2>&1; then
    echo "[nixpacks-start] websockify já ativo"
    return
  fi
  if ! command -v websockify >/dev/null 2>&1; then
    echo "[nixpacks-start] ERRO: websockify não instalado (aptPkgs)" >&2
    exit 1
  fi

  local web_root=""
  for candidate in /usr/share/novnc /usr/share/novnc/utils/..; do
    if [[ -f "${candidate}/vnc.html" ]] || [[ -f "${candidate}/vnc_lite.html" ]]; then
      web_root="$(cd "$candidate" && pwd)"
      break
    fi
  done
  if [[ -z "$web_root" ]]; then
    echo "[nixpacks-start] ERRO: arquivos noVNC não encontrados (/usr/share/novnc)" >&2
    exit 1
  fi

  echo "[nixpacks-start] websockify :$NOVNC_PORT web=$web_root"
  websockify --web="$web_root" "$NOVNC_PORT" "localhost:${VNC_PORT}" \
    >/tmp/websockify.log 2>&1 &
  sleep 0.8
}

start_xvfb
start_x11vnc
start_websockify

echo "[nixpacks-start] prisma migrate"
yarn prisma:migrate || echo "[nixpacks-start] aviso: migrate falhou" >&2

echo "[nixpacks-start] Next em :$APP_PORT ; gateway em :$GATEWAY_PORT"
PORT="$APP_PORT" yarn start >/tmp/next.log 2>&1 &
NEXT_PID=$!

for _ in $(seq 1 90); do
  if curl -sf "http://127.0.0.1:${APP_PORT}/login" >/dev/null 2>&1 \
    || curl -sf "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$NEXT_PID" 2>/dev/null; then
    echo "[nixpacks-start] Next morreu:" >&2
    tail -n 100 /tmp/next.log >&2 || true
    exit 1
  fi
  sleep 0.5
done

# Sanity noVNC
if ! curl -sf "http://127.0.0.1:${NOVNC_PORT}/vnc.html" >/dev/null 2>&1 \
  && ! curl -sf "http://127.0.0.1:${NOVNC_PORT}/vnc_lite.html" >/dev/null 2>&1; then
  echo "[nixpacks-start] aviso: vnc.html não respondeu em :$NOVNC_PORT" >&2
  tail -n 40 /tmp/websockify.log >&2 || true
fi

export GATEWAY_PORT APP_PORT NOVNC_PORT
exec node "$ROOT/scripts/gateway.mjs"
