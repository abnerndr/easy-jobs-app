#!/usr/bin/env bash
set -euo pipefail

# Display virtual para o Chromium headed no Dokploy (sem X físico).
export DISPLAY="${DISPLAY:-:99}"

if [[ ! -f "/tmp/.X${DISPLAY#:}-lock" ]]; then
  echo "[entrypoint] iniciando Xvfb em $DISPLAY"
  Xvfb "$DISPLAY" -screen 0 1280x900x24 -ac +extension RANDR >/tmp/xvfb.log 2>&1 &
  # Aguarda o socket do X ficar pronto
  for _ in $(seq 1 20); do
    if [[ -f "/tmp/.X${DISPLAY#:}-lock" ]]; then
      break
    fi
    sleep 0.25
  done
fi

echo "[entrypoint] DISPLAY=$DISPLAY PLAYWRIGHT_HEADED=${PLAYWRIGHT_HEADED:-true}"
exec node server.js
