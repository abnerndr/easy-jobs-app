#!/usr/bin/env bash
# Instala Chromium do Playwright apenas se ainda não existir.
# Uso: ./scripts/install-playwright.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"

PLAYWRIGHT_BIN=""
if [[ -x "./node_modules/.bin/playwright" ]]; then
  PLAYWRIGHT_BIN="./node_modules/.bin/playwright"
elif command -v playwright >/dev/null 2>&1; then
  PLAYWRIGHT_BIN="$(command -v playwright)"
else
  echo "[playwright] binário não encontrado. Rode yarn install antes."
  exit 1
fi

chromium_installed() {
  # Diretórios típicos: chromium-1234, chromium_headless_shell-1234
  # Também cobre cache default do usuário (~/.cache/ms-playwright).
  local paths=(
    "${PLAYWRIGHT_BROWSERS_PATH}"
    "${HOME}/.cache/ms-playwright"
    "/root/.cache/ms-playwright"
  )
  local base
  for base in "${paths[@]}"; do
    [[ -d "$base" ]] || continue
    if compgen -G "${base}/chromium-*" > /dev/null 2>&1 \
      || compgen -G "${base}/chromium_headless_shell-*" > /dev/null 2>&1; then
      return 0
    fi
  done
  return 1
}

if chromium_installed; then
  echo "[playwright] Chromium já instalado em ${PLAYWRIGHT_BROWSERS_PATH} — pulando install"
else
  echo "[playwright] Instalando Chromium em ${PLAYWRIGHT_BROWSERS_PATH}..."
  mkdir -p "${PLAYWRIGHT_BROWSERS_PATH}"
  # --with-deps instala libs do SO (precisa root no Docker build)
  if [[ "${PLAYWRIGHT_SKIP_DEPS:-0}" == "1" ]]; then
    "${PLAYWRIGHT_BIN}" install chromium
  else
    "${PLAYWRIGHT_BIN}" install --with-deps chromium
  fi
  echo "[playwright] Chromium instalado"
fi

if command -v Xvfb >/dev/null 2>&1; then
  echo "[xvfb] já instalado — pulando"
elif [[ "${PLAYWRIGHT_SKIP_DEPS:-0}" == "1" ]]; then
  echo "[xvfb] PLAYWRIGHT_SKIP_DEPS=1 — não instalando Xvfb"
elif command -v apt-get >/dev/null 2>&1; then
  echo "[xvfb] instalando..."
  apt-get update
  apt-get install -y --no-install-recommends xvfb
  rm -rf /var/lib/apt/lists/*
  echo "[xvfb] instalado"
else
  echo "[xvfb] apt-get indisponível — instale Xvfb manualmente se for usar headed"
fi
