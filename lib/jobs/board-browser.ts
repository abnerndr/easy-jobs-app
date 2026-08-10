import { chromium, type BrowserContext, type Page } from "playwright";
import fs from "node:fs/promises";
import type { JobBoardProvider } from "@/generated/prisma/client";
import type { NormalizedJob, SearchQuery } from "@/lib/jobs/types";
import { inferWorkMode, stripHtml } from "@/lib/jobs/types";
import {
  ensureSessionsDir,
  sessionFilePath,
} from "@/lib/jobs/session-store";

const LOGIN_URL: Record<JobBoardProvider, string> = {
  LINKEDIN: "https://www.linkedin.com/login",
  INDEED: "https://secure.indeed.com/auth?continue=https%3A%2F%2Fbr.indeed.com%2F",
};

const SUCCESS_HINT: Record<JobBoardProvider, RegExp> = {
  LINKEDIN: /linkedin\.com\/(feed|jobs|in\/|mynetwork|messaging)/i,
  INDEED: /indeed\.com\/(?!auth)/i,
};

const COOKIE_DOMAINS: Record<JobBoardProvider, { domain: string; url: string }> = {
  LINKEDIN: { domain: ".linkedin.com", url: "https://www.linkedin.com/" },
  INDEED: { domain: ".indeed.com", url: "https://br.indeed.com/" },
};

/** Headed Chrome needs a display — unavailable in Docker/Dokploy. */
export function canUseHeadedBrowser() {
  if (process.env.PLAYWRIGHT_HEADED === "true") return true;
  if (process.env.PLAYWRIGHT_HEADED === "false") return false;
  if (process.env.DISPLAY) return true;
  return process.platform === "darwin" || process.platform === "win32";
}

type StorageStateCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
};

type StorageState = {
  cookies: StorageStateCookie[];
  origins: unknown[];
};

function normalizeSameSite(
  value: unknown
): StorageStateCookie["sameSite"] {
  const raw = String(value ?? "Lax").toLowerCase();
  if (raw === "strict") return "Strict";
  if (raw === "none") return "None";
  return "Lax";
}

function cookieFromPartial(
  raw: Record<string, unknown>,
  provider: JobBoardProvider
): StorageStateCookie | null {
  const name = String(raw.name ?? "").trim();
  const value = String(raw.value ?? "").trim();
  if (!name || !value) return null;

  const defaultDomain = COOKIE_DOMAINS[provider].domain;
  let domain = String(raw.domain ?? defaultDomain).trim() || defaultDomain;
  if (!domain.startsWith(".") && domain.includes(".")) {
    // Playwright aceita com ou sem ponto; normaliza hosts sem leading dot
    domain = domain.startsWith("www.") ? `.${domain.slice(4)}` : `.${domain}`;
  }

  const expiresRaw = raw.expires ?? raw.expirationDate;
  let expires =
    typeof expiresRaw === "number"
      ? expiresRaw
      : Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  // Chrome DevTools às vezes exporta ms
  if (expires > 1e12) expires = Math.floor(expires / 1000);

  return {
    name,
    value,
    domain,
    path: String(raw.path ?? "/") || "/",
    expires,
    httpOnly: Boolean(raw.httpOnly ?? true),
    secure: Boolean(raw.secure ?? true),
    sameSite: normalizeSameSite(raw.sameSite),
  };
}

function parseCookieHeader(
  raw: string,
  provider: JobBoardProvider
): StorageStateCookie[] {
  const { domain } = COOKIE_DOMAINS[provider];
  const cookies: StorageStateCookie[] = [];

  // Aceita "a=1; b=2" ou uma cookie por linha
  const parts = raw.includes("\n")
    ? raw.split(/[\n;]+/)
    : raw.split(";");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name || !value) continue;
    // Ignora metadados colados por engano
    if (/^(path|domain|expires|max-age|secure|httponly|samesite)$/i.test(name)) {
      continue;
    }
    cookies.push({
      name,
      value,
      domain,
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
  }

  return cookies;
}

function parseCookiesPayload(
  raw: string,
  provider: JobBoardProvider
): StorageState {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Nenhum cookie informado.");
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("JSON de cookies inválido.");
    }

    if (Array.isArray(parsed)) {
      const cookies = parsed
        .map((item) =>
          item && typeof item === "object"
            ? cookieFromPartial(item as Record<string, unknown>, provider)
            : null
        )
        .filter((c): c is StorageStateCookie => c != null);
      return { cookies, origins: [] };
    }

    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.cookies)) {
        const cookies = obj.cookies
          .map((item) =>
            item && typeof item === "object"
              ? cookieFromPartial(item as Record<string, unknown>, provider)
              : null
          )
          .filter((c): c is StorageStateCookie => c != null);
        return {
          cookies,
          origins: Array.isArray(obj.origins) ? obj.origins : [],
        };
      }
      // Objeto único { name, value, ... }
      if (obj.name && obj.value) {
        const cookie = cookieFromPartial(obj, provider);
        if (cookie) return { cookies: [cookie], origins: [] };
      }
    }

    throw new Error(
      "JSON inválido. Use storageState do Playwright, array de cookies ou li_at=..."
    );
  }

  return { cookies: parseCookieHeader(trimmed, provider), origins: [] };
}

function assertAuthCookies(provider: JobBoardProvider, cookies: StorageStateCookie[]) {
  if (cookies.length === 0) {
    throw new Error("Nenhum cookie informado.");
  }
  const names = cookies.map((c) => c.name);
  if (provider === "LINKEDIN") {
    if (!names.some((n) => /^li_at$/i.test(n))) {
      throw new Error(
        "Cookie LinkedIn incompleto. Cole ao menos o cookie li_at (DevTools → Application → Cookies → linkedin.com). O li_at é HttpOnly e não aparece em document.cookie."
      );
    }
    return;
  }
  // Indeed usa vários nomes de cookie de sessão; exigir ao menos um conhecido.
  if (!names.some((n) => /^(PP|SESSUN|INDEED_CSRF_TOKEN|SHOE|CTK)$/i.test(n))) {
    throw new Error(
      "Cookie Indeed incompleto. Cole cookies de sessão do indeed.com (ex.: PP=...; CTK=...)."
    );
  }
}

/**
 * Persists a Playwright storageState (or cookie header string) for later
 * headless scraping. Use this in production where headed login is impossible.
 */
export async function importJobBoardSession(
  userId: string,
  provider: JobBoardProvider,
  input: { cookies?: string; storageState?: unknown }
) {
  await ensureSessionsDir(userId);
  const outPath = sessionFilePath(userId, provider);

  let state: StorageState;

  if (input.storageState != null) {
    const asText =
      typeof input.storageState === "string"
        ? input.storageState
        : JSON.stringify(input.storageState);
    state = parseCookiesPayload(asText, provider);
  } else if (input.cookies?.trim()) {
    state = parseCookiesPayload(input.cookies, provider);
  } else {
    throw new Error("Informe cookies ou storageState para importar a sessão.");
  }

  assertAuthCookies(provider, state.cookies);
  await fs.writeFile(outPath, JSON.stringify(state, null, 2), "utf8");
  return outPath;
}

function englishSearchTerms(query: SearchQuery) {
  const map: Record<string, string> = {
    desenvolvedor: "developer",
    engenheiro: "engineer",
    software: "software",
    backend: "backend",
    frontend: "frontend",
    fullstack: "full stack",
    "full stack": "full stack",
    dados: "data",
    mobile: "mobile",
    plen: "mid",
    senior: "senior",
    sênior: "senior",
  };

  const raw = [...query.jobTitles, ...(query.techStack ?? [])].join(" ").toLowerCase();
  const parts = new Set<string>();
  for (const [pt, en] of Object.entries(map)) {
    if (raw.includes(pt)) parts.add(en);
  }
  for (const tech of query.techStack ?? []) {
    if (/^[a-z0-9.+#]+$/i.test(tech.trim())) parts.add(tech.trim());
  }
  if (parts.size === 0) {
    parts.add(query.jobTitles[0] || "software engineer");
  }
  return [...parts].join(" ");
}

async function launchContext(
  storageState?: string,
  options?: { headless?: boolean }
): Promise<BrowserContext> {
  const headless = options?.headless ?? true;
  const browser = await chromium.launch({
    headless,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  return browser.newContext({
    storageState: storageState,
    locale: "pt-BR",
    viewport: { width: 1280, height: 900 },
  });
}

/**
 * Opens a headed browser for the user to log in (local machine with display).
 * Sem display gráfico (ex.: servidor Docker/Dokploy headless), use o
 * fallback "Avançado: importar cookies" no painel.
 */
export async function connectJobBoard(
  userId: string,
  provider: JobBoardProvider,
  options?: { timeoutMs?: number }
) {
  if (!canUseHeadedBrowser()) {
    throw new Error(
      "Sem display gráfico neste ambiente. Use \"Avançado: importar cookies\" no painel."
    );
  }

  const timeoutMs = options?.timeoutMs ?? 5 * 60_000;
  await ensureSessionsDir(userId);
  const outPath = sessionFilePath(userId, provider);

  const context = await launchContext(undefined, { headless: false });
  const page = await context.newPage();
  await page.goto(LOGIN_URL[provider], { waitUntil: "domcontentloaded" });

  const deadline = Date.now() + timeoutMs;
  let connected = false;

  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    const url = page.url();
    if (SUCCESS_HINT[provider].test(url)) {
      connected = true;
      break;
    }
    // User closed the browser
    if (context.browser() && !context.browser()!.isConnected()) {
      break;
    }
  }

  if (!connected) {
    // Still try saving if any auth cookies appeared
    const cookies = await context.cookies();
    const hasAuthCookie = cookies.some((c) =>
      provider === "LINKEDIN"
        ? /li_at|JSESSIONID/i.test(c.name)
        : /PP|SESS|indeed/i.test(c.name)
    );
    if (!hasAuthCookie) {
      await context.browser()?.close();
      throw new Error(
        `Login ${provider} não concluído a tempo. Faça login na janela do Chrome e tente de novo.`
      );
    }
  }

  await context.storageState({ path: outPath });
  await context.browser()?.close();
  return outPath;
}

export async function withSession<T>(
  userId: string,
  provider: JobBoardProvider,
  fn: (page: Page, context: BrowserContext) => Promise<T>
): Promise<T> {
  const statePath = sessionFilePath(userId, provider);
  const context = await launchContext(statePath, { headless: true });
  try {
    const page = await context.newPage();
    return await fn(page, context);
  } finally {
    await context.browser()?.close();
  }
}

async function scrollJobsList(page: Page) {
  const list = page
    .locator(
      ".jobs-search-results-list, .scaffold-layout__list, ul.jobs-search__results-list, #mosaic-jobResults, .jobsearch-ResultsList"
    )
    .first();
  if ((await list.count()) === 0) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(800);
    return;
  }
  for (let i = 0; i < 4; i++) {
    await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(700);
  }
}

async function clickNextPage(page: Page): Promise<boolean> {
  const next = page
    .locator(
      [
        "button.jobs-search-pagination__button--next",
        "button.artdeco-pagination__button--next",
        'button[aria-label="Next"]',
        'button[aria-label="Próxima"]',
        'button[aria-label="Next Page"]',
        'a[aria-label="Next"]',
        'a[aria-label="Próxima"]',
        'a[data-testid="pagination-page-next"]',
        'nav[role="navigation"] a[aria-label*="ext"]',
        'a[aria-label*="Próxima"]',
      ].join(", ")
    )
    .first();

  if ((await next.count()) === 0) return false;
  const disabled =
    (await next.getAttribute("disabled")) != null ||
    (await next.getAttribute("aria-disabled")) === "true" ||
    (await next.evaluate((el) => el.classList.contains("disabled")).catch(() => false));
  if (disabled) return false;

  try {
    await next.click({ timeout: 5_000 });
    await page.waitForTimeout(2500);
    return true;
  } catch {
    return false;
  }
}

export async function scrapeLinkedInJobs(
  userId: string,
  query: SearchQuery
): Promise<NormalizedJob[]> {
  const keywords = encodeURIComponent(englishSearchTerms(query));
  const pageSize = 25;
  const target = Math.max(1, query.limit ?? pageSize);
  // Enough pages to fill target even with partial pages.
  const maxPages = Math.min(12, Math.max(3, Math.ceil(target / 10) + 2));
  const location = encodeURIComponent(query.location || "Brazil");

  return withSession(userId, "LINKEDIN", async (page) => {
    const jobs: NormalizedJob[] = [];
    const seen = new Set<string>();

    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${keywords}&location=${location}&f_TPR=r86400&start=0`;
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);

    if (/login|authwall|checkpoint/i.test(page.url())) {
      throw new Error("Sessão LinkedIn expirada. Conecte novamente.");
    }

    for (let pageIndex = 0; pageIndex < maxPages && jobs.length < target; pageIndex++) {
      // Logged-in LinkedIn often ignores start= on full reload; prefer
      // in-page next + scroll. Fall back to start= only when next fails.
      if (pageIndex > 0) {
        const clicked = await clickNextPage(page);
        if (!clicked) {
          const start = pageIndex * pageSize;
          await page.goto(
            `https://www.linkedin.com/jobs/search/?keywords=${keywords}&location=${location}&f_TPR=r86400&start=${start}`,
            { waitUntil: "domcontentloaded", timeout: 60_000 }
          );
          await page.waitForTimeout(2500);
        }
      }

      if (/login|authwall|checkpoint/i.test(page.url())) {
        throw new Error("Sessão LinkedIn expirada. Conecte novamente.");
      }

      await scrollJobsList(page);

      const cards = page.locator(
        [
          "li.jobs-search-results__list-item",
          "li.scaffold-layout__list-item",
          "ul.jobs-search__results-list > li",
          ".jobs-search-results-list li.ember-view",
          "div.job-card-container[data-job-id]",
          "div.job-card-list",
        ].join(", ")
      );
      const count = await cards.count();
      if (count === 0) break;

      let addedThisPage = 0;
      for (let i = 0; i < count && jobs.length < target; i++) {
        const card = cards.nth(i);
        const dataJobId =
          (await card.getAttribute("data-job-id").catch(() => null)) ||
          (await card
            .locator("[data-job-id]")
            .first()
            .getAttribute("data-job-id")
            .catch(() => null)) ||
          "";

        const title =
          (
            await card
              .locator(
                "a.job-card-list__title--link, a.job-card-container__link, a.job-card-list__title, a[href*='/jobs/view/'], .base-search-card__title"
              )
              .first()
              .textContent()
              .catch(() => null)
          )?.trim() || "";
        const company =
          (
            await card
              .locator(
                ".job-card-container__primary-description, .artdeco-entity-lockup__subtitle, .job-card-container__company-name, .base-search-card__subtitle"
              )
              .first()
              .textContent()
              .catch(() => null)
          )?.trim() || "Empresa não informada";
        const jobLocation =
          (
            await card
              .locator(
                ".job-card-container__metadata-item, .job-card-container__metadata-wrapper li, .job-search-card__location"
              )
              .first()
              .textContent()
              .catch(() => null)
          )?.trim() || query.location;
        const href =
          (await card
            .locator("a[href*='/jobs/view/'], a.job-card-list__title--link, a.base-card__full-link")
            .first()
            .getAttribute("href")
            .catch(() => null)) || "";
        if (!title || (!href && !dataJobId)) continue;

        const cardText = (
          (await card.innerText().catch(() => "")) || ""
        ).toLowerCase();
        const hasEasyLabel = /easy apply|candidatura simplificada/.test(
          cardText
        );
        const easyApply =
          hasEasyLabel ||
          !/candidatura na empresa|external apply/.test(cardText);

        const url = href
          ? href.startsWith("http")
            ? href.split("?")[0]
            : `https://www.linkedin.com${href.split("?")[0]}`
          : `https://www.linkedin.com/jobs/view/${dataJobId}`;
        const idMatch = url.match(/\/jobs\/view\/(\d+)/);
        const externalId = dataJobId || idMatch?.[1] || url;
        if (seen.has(externalId)) continue;
        seen.add(externalId);

        jobs.push({
          source: "LINKEDIN",
          externalId,
          title,
          company,
          location: jobLocation,
          url,
          description: `${title} em ${company} — ${jobLocation}`,
          workMode: inferWorkMode(`${title} ${jobLocation}`),
          easyApply,
        });
        addedThisPage += 1;
      }

      if (addedThisPage === 0) break;
    }

    return jobs;
  });
}

export async function scrapeIndeedJobs(
  userId: string,
  query: SearchQuery
): Promise<NormalizedJob[]> {
  const q = encodeURIComponent(englishSearchTerms(query));
  const l = encodeURIComponent(query.location || "Brasil");
  const pageSize = 15;
  const target = Math.max(1, query.limit ?? pageSize);
  const maxPages = Math.min(12, Math.max(3, Math.ceil(target / 8) + 2));

  return withSession(userId, "INDEED", async (page) => {
    const jobs: NormalizedJob[] = [];
    const seen = new Set<string>();

    await page.goto(`https://br.indeed.com/jobs?q=${q}&l=${l}&sort=date&start=0`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);

    if (/auth|login|challenge|account\/login/i.test(page.url())) {
      throw new Error("Sessão Indeed expirada. Conecte novamente.");
    }

    for (let pageIndex = 0; pageIndex < maxPages && jobs.length < target; pageIndex++) {
      if (pageIndex > 0) {
        const clicked = await clickNextPage(page);
        if (!clicked) {
          const start = pageIndex * pageSize;
          await page.goto(
            `https://br.indeed.com/jobs?q=${q}&l=${l}&sort=date&start=${start}`,
            { waitUntil: "domcontentloaded", timeout: 60_000 }
          );
          await page.waitForTimeout(2500);
        }
      }

      if (/auth|login|challenge|account\/login/i.test(page.url())) {
        throw new Error("Sessão Indeed expirada. Conecte novamente.");
      }

      await scrollJobsList(page);

      const cards = page.locator(
        [
          "div.job_seen_beacon",
          "li.css-5lfssg",
          "div.resultContent",
          "div[data-jk]",
          "td.resultContent",
          "#mosaic-provider-jobcards li",
        ].join(", ")
      );
      const count = await cards.count();
      if (count === 0) break;

      let addedThisPage = 0;
      for (let i = 0; i < count && jobs.length < target; i++) {
        const card = cards.nth(i);
        const title =
          (await card
            .locator("h2.jobTitle span[title], h2 a span, h2.jobTitle a, .jobTitle")
            .first()
            .getAttribute("title")
            .catch(() => null)) ||
          (
            await card
              .locator("h2.jobTitle, .jobTitle, h2 a")
              .first()
              .textContent()
              .catch(() => null)
          )?.trim() ||
          "";
        const company =
          (
            await card
              .locator(
                "[data-testid='company-name'], .companyName, span[data-testid='company-name']"
              )
              .first()
              .textContent()
              .catch(() => null)
          )?.trim() || "Empresa não informada";
        const jobLocation =
          (
            await card
              .locator(
                "[data-testid='text-location'], .companyLocation, div[data-testid='text-location']"
              )
              .first()
              .textContent()
              .catch(() => null)
          )?.trim() || query.location;
        const snippet =
          (
            await card
              .locator(
                "[data-testid='job-snippet'], .job-snippet, .jobCardShelfContainer"
              )
              .first()
              .textContent()
              .catch(() => null)
          )?.trim() || title;
        const jk =
          (await card.getAttribute("data-jk").catch(() => null)) ||
          (await card
            .locator("[data-jk]")
            .first()
            .getAttribute("data-jk")
            .catch(() => null)) ||
          "";
        const href =
          (await card
            .locator("a[data-jk], h2 a, a.jcs-JobTitle")
            .first()
            .getAttribute("href")
            .catch(() => null)) || (jk ? `/viewjob?jk=${jk}` : "");

        if (!title || (!jk && !href)) continue;
        const url = href.startsWith("http")
          ? href.split("&from=")[0]
          : `https://br.indeed.com${href.startsWith("/") ? href : `/${href}`}`;
        const externalId = jk || url;
        if (seen.has(externalId)) continue;
        seen.add(externalId);

        jobs.push({
          source: "INDEED",
          externalId,
          title: stripHtml(title),
          company,
          location: jobLocation,
          url,
          description: stripHtml(snippet).slice(0, 2000),
          workMode: inferWorkMode(`${title} ${snippet} ${jobLocation}`),
          easyApply: false,
        });
        addedThisPage += 1;
      }

      if (addedThisPage === 0) break;
    }

    return jobs;
  });
}
