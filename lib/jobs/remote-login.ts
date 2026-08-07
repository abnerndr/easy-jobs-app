import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import type { JobBoardProvider } from "@/generated/prisma/client";
import {
  ensureSessionsDir,
  sessionFilePath,
} from "@/lib/jobs/session-store";

const LOGIN_URL: Record<JobBoardProvider, string> = {
  LINKEDIN: "https://www.linkedin.com/login",
  INDEED:
    "https://secure.indeed.com/auth?continue=https%3A%2F%2Fbr.indeed.com%2F",
};

const SUCCESS_HINT: Record<JobBoardProvider, RegExp> = {
  LINKEDIN: /linkedin\.com\/(feed|jobs|in\/|mynetwork|messaging|preload)/i,
  INDEED: /indeed\.com\/(?!auth)/i,
};

const AUTHWALL_HINT = /authwall|checkpoint\/challenge|unavailable|blocked/i;

const VIEWPORT = { width: 1280, height: 900 } as const;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 2_000;

export type RemoteLoginStatus =
  | "pending"
  | "connected"
  | "failed"
  | "cancelled"
  | "expired";

type RemoteLoginSession = {
  id: string;
  userId: string;
  provider: JobBoardProvider;
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  status: RemoteLoginStatus;
  error?: string;
  sessionPath?: string;
  createdAt: number;
  expiresAt: number;
  monitor: ReturnType<typeof setInterval> | null;
  novncPath: string;
  displayMode: RemoteDisplayMode;
};

const sessions = new Map<string, RemoteLoginSession>();

function launchHeadedPreferred() {
  if (process.env.PLAYWRIGHT_HEADED === "false") return false;
  if (process.env.PLAYWRIGHT_HEADED === "true") return true;
  if (process.env.DISPLAY) return true;
  // macOS/Windows: Chromium headed nativo (sem Xvfb/noVNC)
  return process.platform === "darwin" || process.platform === "win32";
}

/** URL pública do noVNC (via gateway /novnc). */
export function getNovncEmbedPath() {
  return (
    process.env.NOVNC_EMBED_PATH ||
    "/novnc/vnc.html?autoconnect=true&resize=scale&reconnect=true&path=websockify"
  );
}

export type RemoteDisplayMode = "novnc" | "local-window";

async function detectDisplayMode(): Promise<RemoteDisplayMode> {
  if (process.env.REMOTE_LOGIN_MODE === "local-window") return "local-window";
  if (process.env.REMOTE_LOGIN_MODE === "novnc") return "novnc";

  const port = Number(process.env.NOVNC_PORT || 6080);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/vnc.html`, {
      signal: AbortSignal.timeout(1200),
    });
    if (res.ok) return "novnc";
  } catch {
    // websockify ausente
  }

  // Sem stack noVNC: em desktop local abre janela; no servidor Linux exige Docker/noVNC
  if (process.platform === "darwin" || process.platform === "win32") {
    return "local-window";
  }
  return "novnc";
}

async function closeBrowser(session: RemoteLoginSession) {
  if (session.monitor) {
    clearInterval(session.monitor);
    session.monitor = null;
  }
  try {
    await session.browser?.close();
  } catch {
    // already closed
  }
  session.browser = null;
  session.context = null;
  session.page = null;
}

async function destroySession(session: RemoteLoginSession) {
  await closeBrowser(session);
  sessions.delete(session.id);
}

async function closeExisting(userId: string, provider: JobBoardProvider) {
  for (const session of sessions.values()) {
    if (session.userId === userId && session.provider === provider) {
      session.status = "cancelled";
      await destroySession(session);
    }
  }
}

async function hasAuthCookie(
  context: BrowserContext,
  provider: JobBoardProvider
) {
  const cookies = await context.cookies();
  return cookies.some((c) =>
    provider === "LINKEDIN"
      ? /li_at/i.test(c.name)
      : /^(PP|SESSUN|CTK|SHOE)$/i.test(c.name)
  );
}

async function pageLooksConnected(page: Page, provider: JobBoardProvider) {
  const url = page.url();
  if (SUCCESS_HINT[provider].test(url)) return true;
  if (/login|uas\/login|auth\?/i.test(url)) return false;
  return false;
}

async function finalizeAndClose(session: RemoteLoginSession) {
  if (!session.context) {
    throw new Error("Contexto do browser já encerrado.");
  }
  await ensureSessionsDir(session.userId);
  const outPath = sessionFilePath(session.userId, session.provider);
  await session.context.storageState({ path: outPath });
  session.sessionPath = outPath;
  session.status = "connected";
  await closeBrowser(session);
  return outPath;
}

function startMonitor(session: RemoteLoginSession) {
  session.monitor = setInterval(() => {
    void (async () => {
      if (session.status !== "pending") return;
      if (Date.now() > session.expiresAt) {
        session.status = "expired";
        session.error = "Tempo esgotado. Tente conectar de novo.";
        await destroySession(session);
        return;
      }

      const page = session.page;
      const context = session.context;
      if (!page || !context) return;

      try {
        const url = page.url();
        if (AUTHWALL_HINT.test(url)) {
          session.status = "failed";
          session.error =
            "LinkedIn/Indeed bloqueou o acesso neste IP (authwall). Use importar cookies do seu Chrome.";
          await destroySession(session);
          return;
        }

        const cookieOk = await hasAuthCookie(context, session.provider);
        const urlOk = await pageLooksConnected(page, session.provider);

        if (cookieOk && (urlOk || !/\/login(\?|$)/i.test(url))) {
          await finalizeAndClose(session);
        }
      } catch (error) {
        session.status = "failed";
        session.error =
          error instanceof Error ? error.message : "Sessão remota interrompida.";
        await destroySession(session);
      }
    })();
  }, POLL_MS);
}

async function launchBrowser() {
  const headed = launchHeadedPreferred();
  if (!headed) {
    throw new Error(
      "Sem display para Chromium headed. No Dokploy use a imagem Docker (Xvfb+noVNC). No Mac, remova PLAYWRIGHT_HEADED=false."
    );
  }

  const browser = await chromium.launch({
    headless: false,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1280,900",
      "--disable-blink-features=AutomationControlled",
      "--start-maximized",
    ],
  });

  const context = await browser.newContext({
    locale: "pt-BR",
    viewport: VIEWPORT,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  return { browser, context };
}

/**
 * Abre Chromium headed: noVNC (Docker) ou janela local (macOS/Windows).
 */
export async function startRemoteLogin(
  userId: string,
  provider: JobBoardProvider
) {
  const displayMode = await detectDisplayMode();
  await closeExisting(userId, provider);
  const { browser, context } = await launchBrowser();
  const page = await context.newPage();

  const session: RemoteLoginSession = {
    id: randomUUID(),
    userId,
    provider,
    browser,
    context,
    page,
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + DEFAULT_TIMEOUT_MS,
    monitor: null,
    novncPath: getNovncEmbedPath(),
    displayMode,
  };
  sessions.set(session.id, session);

  try {
    await page.goto(LOGIN_URL[provider], {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  } catch (error) {
    await destroySession(session);
    throw new Error(
      error instanceof Error
        ? `Não abriu a página de login: ${error.message}`
        : "Não abriu a página de login."
    );
  }

  startMonitor(session);

  const message =
    displayMode === "local-window"
      ? "Uma janela do Chromium abriu neste computador. Faça login lá (CAPTCHA/2FA). A sessão será salva automaticamente."
      : "Faça login na tela remota (CAPTCHA/2FA inclusive). A sessão será salva automaticamente.";

  return {
    sessionId: session.id,
    status: session.status,
    displayMode,
    novncUrl: displayMode === "novnc" ? session.novncPath : null,
    expiresAt: session.expiresAt,
    message,
  };
}

export function getRemoteLoginStatus(sessionId: string, userId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    return {
      status: "expired" as const,
      sessionPath: null,
      error: "Sessão expirada ou inexistente.",
      url: null,
      novncUrl: getNovncEmbedPath(),
    };
  }

  if (Date.now() > session.expiresAt && session.status !== "connected") {
    session.status = "expired";
    void destroySession(session);
    return {
      status: "expired" as const,
      sessionPath: null,
      error: "Sessão expirada.",
      url: null,
      novncUrl: getNovncEmbedPath(),
    };
  }

  let url: string | null = null;
  try {
    url = session.page?.url() ?? null;
  } catch {
    url = null;
  }

  return {
    status: session.status,
    sessionPath: session.sessionPath ?? null,
    error: session.error ?? null,
    url,
    expiresAt: session.expiresAt,
    novncUrl: session.displayMode === "novnc" ? session.novncPath : null,
    displayMode: session.displayMode,
  };
}

export async function getRemoteLoginFrame(sessionId: string, userId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId || !session.page) return null;
  try {
    return await session.page.screenshot({
      type: "jpeg",
      quality: 55,
      animations: "disabled",
    });
  } catch {
    return null;
  }
}

export async function cancelRemoteLogin(sessionId: string, userId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) return;
  session.status = "cancelled";
  await destroySession(session);
}

export { LOGIN_URL, SUCCESS_HINT, VIEWPORT };
