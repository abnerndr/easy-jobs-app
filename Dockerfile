# syntax=docker/dockerfile:1

# --- deps ---
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# --- build ---
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

# --- runner (Playwright + Xvfb + noVNC) ---
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV APP_PORT=3001
ENV GATEWAY_PORT=3000
ENV NOVNC_PORT=6080
ENV VNC_PORT=5900
ENV DISPLAY=:99
ENV PLAYWRIGHT_HEADED=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV RESUME_STORAGE_DIR=/app/data/resumes

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home /app nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/playwright ./node_modules/playwright
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin ./node_modules/.bin
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder /ms-playwright /ms-playwright
COPY --from=builder /app/scripts/install-playwright.sh /app/scripts/install-playwright.sh
COPY --chown=nextjs:nodejs scripts/dokploy-entrypoint.sh /app/scripts/dokploy-entrypoint.sh
COPY --chown=nextjs:nodejs scripts/gateway.mjs /app/scripts/gateway.mjs
COPY --chown=nextjs:nodejs scripts/test-novnc.sh /app/scripts/test-novnc.sh

RUN chmod +x /app/scripts/install-playwright.sh /app/scripts/dokploy-entrypoint.sh /app/scripts/test-novnc.sh \
  && /app/scripts/install-playwright.sh \
  && mkdir -p /app/data/resumes /app/data/sessions /tmp/.X11-unix \
  && chown -R nextjs:nodejs /app/data /ms-playwright /tmp \
  && chmod 1777 /tmp/.X11-unix

USER nextjs
EXPOSE 3000

CMD ["/app/scripts/dokploy-entrypoint.sh"]
