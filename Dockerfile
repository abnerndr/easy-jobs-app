# syntax=docker/dockerfile:1

# --- deps ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# --- build (app + Playwright Chromium, se ainda não estiver) ---
FROM node:22-bookworm AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=public"
ENV DATABASE_URL=${DATABASE_URL}
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN ./node_modules/.bin/prisma generate
RUN yarn build
RUN chmod +x scripts/install-playwright.sh \
  && ./scripts/install-playwright.sh

# --- runner ---
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DISPLAY=:99
ENV PLAYWRIGHT_HEADED=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV RESUME_STORAGE_DIR=/app/data/resumes

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home /app nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/playwright ./node_modules/playwright
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=builder /ms-playwright /ms-playwright
COPY --from=builder /app/scripts/install-playwright.sh /app/scripts/install-playwright.sh
COPY --chown=nextjs:nodejs scripts/dokploy-entrypoint.sh /app/scripts/dokploy-entrypoint.sh

# Garante browsers + Xvfb no runner; se a imagem já tiver Chromium, o script pula.
RUN chmod +x /app/scripts/install-playwright.sh /app/scripts/dokploy-entrypoint.sh \
  && /app/scripts/install-playwright.sh \
  && mkdir -p /app/data/resumes /app/data/sessions \
  && chown -R nextjs:nodejs /app/data /ms-playwright

USER nextjs
EXPOSE 3000

CMD ["/app/scripts/dokploy-entrypoint.sh"]
