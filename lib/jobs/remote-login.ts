import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import type { JobBoardProvider } from "@/generated/prisma/client";
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

const VIEWPORT = { width: 1280, height: 900 } as const;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

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
  browser: Browser;
  context: BrowserContext;
  page: Page;
  status: RemoteLoginStatus;
  error?: string;
  sessionPath?: string;
  createdAt: number;
  expiresAt: number;
  monitor: ReturnType<typeof setInterval> | null;
};

export type RemoteInputEvent =
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { type: "dblclick"; x: number; y: number }
  | { type: "move"; x: number; y: number }
  | { type: "down"; x: number; y: number }
  | { type: "up"; x: number; y: number }
  | { type: "wheel"; deltaX?: number; deltaY?: number }
  | { type: "key"; key: string }
  | { type: "type"; text: string };

const sessions = new Map<string, RemoteLoginSession>();

function launchHeadedPreferred() {
  // Com Xvfb (DISPLAY=:99 no Dokploy) usa headed — menos bloqueio de bot.
  // Sem display, cai para headless (screenshots/input ainda funcionam).
  const hasDisplay = Boolean(process.env.DISPLAY);
  return process.env.PLAYWRIGHT_HEADED === "false"
    ? false
    : hasDisplay || process.env.PLAYWRIGHT_HEADED === "true";
}

async function destroySession(session: RemoteLoginSession) {
  if (session.monitor) {
    clearInterval(session.monitor);
    session.monitor = null;
  }
  try {
    await session.browser.close();
  } catch {
    // already closed
  }
  sessions.delete(session.id);
}

async function checkConnected(session: RemoteLoginSession) {
  if (session.status !== "pending") return;

  try {
    if (!session.browser.isConnected()) {
      session.status = "cancelled";
      await destroySession(session);
      return;
    }

    const url = session.page.url();
    if (SUCCESS_HINT[session.provider].test(url)) {
      await finalizeSession(session);
      return;
    }

    const cookies = await session.context.cookies();
    const hasAuth = cookies.some((c) =>
      session.provider === "LINKEDIN"
        ? /li_at/i.test(c.name)
        : /^(PP|SESSUN|CTK|SHOE)$/i.test(c.name)
    );
    if (hasAuth && !/login|auth|checkpoint/i.test(url)) {
      await finalizeSession(session);
    }
  } catch (error) {
    session.status = "failed";
    session.error =
      error instanceof Error ? error.message : "Falha ao monitorar login.";
    await destroySession(session);
  }
}

async function finalizeSession(session: RemoteLoginSession) {
  await ensureSessionsDir(session.userId);
  const outPath = sessionFilePath(session.userId, session.provider);
  await session.context.storageState({ path: outPath });
  session.sessionPath = outPath;
  session.status = "connected";
  if (session.monitor) {
    clearInterval(session.monitor);
    session.monitor = null;
  }
  // Keep browser briefly so last frame can still render, then close.
  setTimeout(() => {
    void destroySession(session);
  }, 2_000);
}

function getOwnedSession(sessionId: string, userId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) return null;
  if (Date.now() > session.expiresAt && session.status === "pending") {
    session.status = "expired";
    void destroySession(session);
    return null;
  }
  return session;
}

/** Encerra qualquer sessão aberta do mesmo usuário+provedor. */
async function closeExisting(userId: string, provider: JobBoardProvider) {
  for (const session of sessions.values()) {
    if (session.userId === userId && session.provider === provider) {
      session.status = "cancelled";
      await destroySession(session);
    }
  }
}

export async function startRemoteLogin(
  userId: string,
  provider: JobBoardProvider,
  options?: { timeoutMs?: number }
) {
  await closeExisting(userId, provider);

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headed = launchHeadedPreferred();

  const browser = await chromium.launch({
    headless: !headed,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,900"],
  });

  const context = await browser.newContext({
    locale: "pt-BR",
    viewport: VIEWPORT,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto(LOGIN_URL[provider], {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const session: RemoteLoginSession = {
    id: randomUUID(),
    userId,
    provider,
    browser,
    context,
    page,
    status: "pending",
    createdAt: Date.now(),
    expiresAt: Date.now() + timeoutMs,
    monitor: null,
  };

  session.monitor = setInterval(() => {
    void checkConnected(session);
  }, 1500);

  sessions.set(session.id, session);

  return {
    sessionId: session.id,
    provider,
    expiresAt: session.expiresAt,
    viewport: VIEWPORT,
    headed,
  };
}

export function getRemoteLoginStatus(sessionId: string, userId: string) {
  const session = getOwnedSession(sessionId, userId);
  if (!session) {
    return { status: "expired" as const, sessionPath: null, error: null, url: null };
  }
  return {
    status: session.status,
    sessionPath: session.sessionPath ?? null,
    error: session.error ?? null,
    url: session.page.url(),
    expiresAt: session.expiresAt,
  };
}

export async function getRemoteLoginFrame(sessionId: string, userId: string) {
  const session = getOwnedSession(sessionId, userId);
  if (!session || session.status === "failed" || session.status === "cancelled") {
    return null;
  }
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

export async function sendRemoteLoginInput(
  sessionId: string,
  userId: string,
  event: RemoteInputEvent
) {
  const session = getOwnedSession(sessionId, userId);
  if (!session || session.status !== "pending") {
    throw new Error("Sessão de login indisponível.");
  }

  const { page } = session;
  const clamp = (value: number, max: number) =>
    Math.max(0, Math.min(max, Math.round(value)));

  switch (event.type) {
    case "click": {
      await page.mouse.click(
        clamp(event.x, VIEWPORT.width),
        clamp(event.y, VIEWPORT.height),
        { button: event.button ?? "left" }
      );
      break;
    }
    case "dblclick": {
      await page.mouse.dblclick(
        clamp(event.x, VIEWPORT.width),
        clamp(event.y, VIEWPORT.height)
      );
      break;
    }
    case "move": {
      await page.mouse.move(
        clamp(event.x, VIEWPORT.width),
        clamp(event.y, VIEWPORT.height)
      );
      break;
    }
    case "down": {
      await page.mouse.move(
        clamp(event.x, VIEWPORT.width),
        clamp(event.y, VIEWPORT.height)
      );
      await page.mouse.down();
      break;
    }
    case "up": {
      await page.mouse.move(
        clamp(event.x, VIEWPORT.width),
        clamp(event.y, VIEWPORT.height)
      );
      await page.mouse.up();
      break;
    }
    case "wheel": {
      await page.mouse.wheel(event.deltaX ?? 0, event.deltaY ?? 0);
      break;
    }
    case "key": {
      await page.keyboard.press(event.key);
      break;
    }
    case "type": {
      await page.keyboard.type(event.text, { delay: 20 });
      break;
    }
    default:
      throw new Error("Evento de input inválido.");
  }

  await checkConnected(session);
  return getRemoteLoginStatus(sessionId, userId);
}

export async function cancelRemoteLogin(sessionId: string, userId: string) {
  const session = getOwnedSession(sessionId, userId);
  if (!session) return;
  session.status = "cancelled";
  await destroySession(session);
}

/**
 * Faz login automático com email/senha preenchidos pelo usuário no painel.
 * A senha NÃO é persistida — só usada nesta execução do Playwright.
 */
export async function loginWithCredentials(
  userId: string,
  provider: JobBoardProvider,
  credentials: { email: string; password: string }
) {
  const email = credentials.email.trim();
  const password = credentials.password;
  if (!email || !password) {
    throw new Error("Informe e-mail e senha.");
  }

  await closeExisting(userId, provider);

  const headed = launchHeadedPreferred();
  const browser = await chromium.launch({
    headless: !headed,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,900"],
  });

  const context = await browser.newContext({
    locale: "pt-BR",
    viewport: VIEWPORT,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });

  try {
    const page = await context.newPage();
    await page.goto(LOGIN_URL[provider], {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    if (provider === "LINKEDIN") {
      await fillLinkedInLogin(page, email, password);
    } else {
      await fillIndeedLogin(page, email, password);
    }

    // Aguarda redirecionamento / cookie de sessão (até ~90s — 2FA pode demorar)
    const deadline = Date.now() + 90_000;
    let connected = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1500);
      const url = page.url();

      if (/checkpoint|challenge|captcha|two-step|verification/i.test(url)) {
        throw new Error(
          "LinkedIn/Indeed pediu verificação extra (2FA/CAPTCHA). Desative temporariamente ou conclua no app oficial e tente de novo."
        );
      }

      if (SUCCESS_HINT[provider].test(url)) {
        connected = true;
        break;
      }

      const cookies = await context.cookies();
      const hasAuth = cookies.some((c) =>
        provider === "LINKEDIN"
          ? /li_at/i.test(c.name)
          : /^(PP|SESSUN|CTK|SHOE)$/i.test(c.name)
      );
      if (hasAuth && !/login|auth|uas\/login/i.test(url)) {
        connected = true;
        break;
      }

      // Mensagem de erro na página de login
      const errorText =
        (await page
          .locator("#error-for-password, #error-for-username, .form__label--error, [role='alert']")
          .first()
          .textContent()
          .catch(() => null))?.trim() || "";
      if (errorText && /senha|password|email|incorrect|inválid|invalid|wrong/i.test(errorText)) {
        throw new Error(`Login rejeitado: ${errorText}`);
      }
    }

    if (!connected) {
      throw new Error(
        "Login não concluído a tempo. Confira e-mail/senha ou se há verificação em duas etapas."
      );
    }

    await ensureSessionsDir(userId);
    const outPath = sessionFilePath(userId, provider);
    await context.storageState({ path: outPath });
    return outPath;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function fillLinkedInLogin(page: Page, email: string, password: string) {
  const user = page.locator("#username, input[name='session_key']").first();
  const pass = page.locator("#password, input[name='session_password']").first();
  await user.waitFor({ state: "visible", timeout: 30_000 });
  await user.fill(email);
  await pass.fill(password);
  await page
    .locator("button[type='submit'], button[data-litms-control-urn='login-submit']")
    .first()
    .click();
}

async function fillIndeedLogin(page: Page, email: string, password: string) {
  // Indeed costuma pedir e-mail primeiro, depois senha.
  const emailInput = page
    .locator(
      'input[type="email"], input[name="email"], input[name="__email"], #ifl-InputFormField-3'
    )
    .first();
  await emailInput.waitFor({ state: "visible", timeout: 30_000 });
  await emailInput.fill(email);

  const continueBtn = page
    .locator(
      'button[type="submit"], button:has-text("Continuar"), button:has-text("Continue")'
    )
    .first();
  if (await continueBtn.isVisible().catch(() => false)) {
    await continueBtn.click();
    await page.waitForTimeout(1500);
  }

  const passInput = page
    .locator('input[type="password"], input[name="password"], input[name="__password"]')
    .first();
  await passInput.waitFor({ state: "visible", timeout: 30_000 });
  await passInput.fill(password);

  await page
    .locator(
      'button[type="submit"], button:has-text("Entrar"), button:has-text("Sign in"), button:has-text("Log in")'
    )
    .first()
    .click();
}

export { LOGIN_URL, SUCCESS_HINT, VIEWPORT };
