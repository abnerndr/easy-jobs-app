#!/usr/bin/env bash
# Smoke test do stack noVNC (precisa do gateway + websockify, tipicamente via Docker).
set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"

echo "==> Health app: $BASE"
curl -sf -o /dev/null -w "HTTP %{http_code}\n" "$BASE/login" || curl -sf -o /dev/null -w "HTTP %{http_code}\n" "$BASE/"

echo "==> noVNC UI"
for path in /novnc/vnc.html /novnc/vnc_lite.html /vnc.html; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$path" || true)
  echo "  $path → $code"
  if [[ "$code" == "200" ]]; then
    echo "==> OK noVNC em $path"
    exit 0
  fi
done

powered=$(curl -sI "$BASE/" | tr -d '\r' | grep -i '^x-powered-by:' || true)
if echo "$powered" | grep -qi 'Next.js'; then
  cat >&2 <<'EOF'
==> FALHA: a porta 3000 é o Next.js puro (sem gateway/websockify).

noVNC só existe quando o entrypoint Docker sobe Xvfb + x11vnc + websockify + gateway.

Neste Mac (sem Docker):
  - use o painel → "Conectar via tela remota" (abre janela local do Chromium)
  - yarn test:novnc não se aplica

Com Docker Desktop:
  docker compose up --build
  yarn test:novnc
EOF
  exit 1
fi

echo "==> FALHA: nenhuma página noVNC respondeu 200" >&2
exit 1
