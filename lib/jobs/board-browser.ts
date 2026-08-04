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

function parseCookieHeader(
  raw: string,
  provider: JobBoardProvider
): StorageStateCookie[] {
  const { domain } = COOKIE_DOMAINS[provider];
  const cookies: StorageStateCookie[] = [];

  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name || !value) continue;
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

function assertAuthCookies(provider: JobBoardProvider, cookies: StorageStateCookie[]) {
  if (cookies.length === 0) {
    throw new Error("Nenhum cookie informado.");
  }
  const names = cookies.map((c) => c.name);
  if (provider === "LINKEDIN") {
    if (!names.some((n) => /^li_at$/i.test(n))) {
      throw new Error(
        "Cookie LinkedIn incompleto. Cole ao menos o cookie li_at (DevTools → Application → Cookies → linkedin.com)."
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
    const parsed =
      typeof input.storageState === "string"
        ? (JSON.parse(input.storageState) as StorageState)
        : (input.storageState as StorageState);
    if (!parsed?.cookies || !Array.isArray(parsed.cookies)) {
      throw new Error("storageState inválido: esperado JSON com campo cookies.");
    }
    state = {
      cookies: parsed.cookies as StorageStateCookie[],
      origins: Array.isArray(parsed.origins) ? parsed.origins : [],
    };
  } else if (input.cookies?.trim()) {
    const cookies = parseCookieHeader(input.cookies, provider);
    assertAuthCookies(provider, cookies);
    state = { cookies, origins: [] };
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
 * Em produção/Dokploy use o fluxo remoto em /api/connections/[provider]/remote.
 */
export async function connectJobBoard(
  userId: string,
  provider: JobBoardProvider,
  options?: { timeoutMs?: number }
) {
  if (!canUseHeadedBrowser()) {
    throw new Error(
      "Sem display gráfico. Use o login remoto no painel (Conectar LinkedIn/Indeed)."
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

export async function scrapeLinkedInJobs(
  userId: string,
  query: SearchQuery
): Promise<NormalizedJob[]> {
  const keywords = encodeURIComponent(englishSearchTerms(query));
  const limit = query.limit ?? 15;

  return withSession(userId, "LINKEDIN", async (page) => {
    await page.goto(
      `https://www.linkedin.com/jobs/search/?keywords=${keywords}&location=${encodeURIComponent(query.location || "Brazil")}&f_TPR=r86400`,
      { waitUntil: "domcontentloaded", timeout: 60_000 }
    );
    await page.waitForTimeout(3000);

    if (/login|authwall|checkpoint/i.test(page.url())) {
      throw new Error("Sessão LinkedIn expirada. Conecte novamente.");
    }

    const cards = page.locator(
      "ul.jobs-search__results-list li, .jobs-search-results-list li, div.job-card-container"
    );
    const count = Math.min(await cards.count(), limit);
    const jobs: NormalizedJob[] = [];

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const title =
        (await card.locator("a.job-card-list__title, .job-card-list__title--link, a[href*='/jobs/view/']").first().textContent().catch(() => null))?.trim() ||
        "";
      const company =
        (await card.locator(".job-card-container__primary-description, .artdeco-entity-lockup__subtitle").first().textContent().catch(() => null))?.trim() ||
        "Empresa não informada";
      const location =
        (await card.locator(".job-card-container__metadata-item, .job-card-container__metadata-wrapper").first().textContent().catch(() => null))?.trim() ||
        query.location;
      const href =
        (await card.locator("a[href*='/jobs/view/']").first().getAttribute("href").catch(() => null)) ||
        "";
      if (!title || !href) continue;

      const url = href.startsWith("http") ? href.split("?")[0] : `https://www.linkedin.com${href.split("?")[0]}`;
      const idMatch = url.match(/\/jobs\/view\/(\d+)/);
      jobs.push({
        source: "LINKEDIN",
        externalId: idMatch?.[1] || url,
        title,
        company,
        location,
        url,
        description: `${title} em ${company} — ${location}`,
        workMode: inferWorkMode(`${title} ${location}`),
      });
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
  const limit = query.limit ?? 15;

  return withSession(userId, "INDEED", async (page) => {
    await page.goto(`https://br.indeed.com/jobs?q=${q}&l=${l}&sort=date`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(3000);

    if (/auth|login|challenge/i.test(page.url())) {
      throw new Error("Sessão Indeed expirada. Conecte novamente.");
    }

    const cards = page.locator(".job_seen_beacon, .resultContent, li.css-5lfssg");
    const count = Math.min(await cards.count(), Math.max(limit, 20));
    const jobs: NormalizedJob[] = [];

    for (let i = 0; i < count && jobs.length < limit; i++) {
      const card = cards.nth(i);
      const title =
        (await card.locator("h2.jobTitle span[title], h2 a, .jobTitle").first().getAttribute("title").catch(() => null)) ||
        (await card.locator("h2.jobTitle, .jobTitle").first().textContent().catch(() => null))?.trim() ||
        "";
      const company =
        (await card.locator("[data-testid='company-name'], .companyName").first().textContent().catch(() => null))?.trim() ||
        "Empresa não informada";
      const location =
        (await card.locator("[data-testid='text-location'], .companyLocation").first().textContent().catch(() => null))?.trim() ||
        query.location;
      const snippet =
        (await card.locator("[data-testid='job-snippet'], .job-snippet").first().textContent().catch(() => null))?.trim() ||
        title;
      const jk =
        (await card.locator("[data-jk]").first().getAttribute("data-jk").catch(() => null)) ||
        (await card.getAttribute("data-jk").catch(() => null)) ||
        "";
      const href =
        (await card.locator("a[data-jk], h2 a").first().getAttribute("href").catch(() => null)) ||
        (jk ? `/viewjob?jk=${jk}` : "");

      if (!title || (!jk && !href)) continue;
      const url = href.startsWith("http")
        ? href
        : `https://br.indeed.com${href.startsWith("/") ? href : `/${href}`}`;

      jobs.push({
        source: "INDEED",
        externalId: jk || url,
        title: stripHtml(title),
        company,
        location,
        url,
        description: stripHtml(snippet).slice(0, 2000),
        workMode: inferWorkMode(`${title} ${snippet} ${location}`),
      });
    }

    return jobs;
  });
}
