#!/usr/bin/env bash
# Helper para validar o ambiente Playwright/Xvfb no Dokploy (ou localmente no container).
set -euo pipefail

echo "==> Node: $(node -v)"
echo "==> DISPLAY: ${DISPLAY:-<vazio>}"

if command -v Xvfb >/dev/null 2>&1; then
  echo "==> Xvfb: ok"
else
  echo "==> Xvfb: AUSENTE (instale xvfb no container)"
fi

if [[ -d /ms-playwright ]] || [[ -d "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
  echo "==> Browsers Playwright: ok"
else
  echo "==> Browsers: rode npx playwright install chromium --with-deps"
fi

node -e "
const { chromium } = require('playwright');
(async () => {
  const headed = Boolean(process.env.DISPLAY);
  console.log('==> launch headless=' + !headed);
  const browser = await chromium.launch({
    headless: !headed,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.goto('about:blank');
  console.log('==> Playwright OK');
  await browser.close();
})().catch((err) => {
  console.error('==> Playwright FALHOU', err);
  process.exit(1);
});
"
