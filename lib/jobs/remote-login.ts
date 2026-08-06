import {
  chromium,
  type Browser,
  type BrowserContext,
  type Frame,
  type Page,
} from "playwright";
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

const LINKEDIN_USER_SELECTORS = [
  "#username",
  "input#username",
  "input[name='session_key']",
  "input[name='email']",
  "input[autocomplete='username']",
  "input[id*='username' i]",
  "input[id*='email' i]",
  "input[type='text']",
  "input[type='email']",
].join(", ");

const LINKEDIN_PASS_SELECTORS = [
  "#password",
  "input#password",
  "input[name='session_password']",
  "input[name='password']",
  "input[autocomplete='current-password']",
  "input[type='password']",
].join(", ");

const SUCCESS_HINT: Record<JobBoardProvider, RegExp> = {
  LINKEDIN: /linkedin\.com\/(feed|jobs|in\/|mynetwork|messaging|preload)/i,
  INDEED: /indeed\.com\/(?!auth)/i,
};

const CHALLENGE_HINT =
  /checkpoint|challenge|captcha|two-step|two_step|verification|challengeId|sms|pin/i;

const VIEWPORT = { width: 1280, height: 900 } as const;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export type RemoteLoginStatus =
  | "pending"
  | "connected"
  | "failed"
  | "cancelled"
  | "expired"
  | "needs_challenge";

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

const sessions = new Map<string, RemoteLoginSession>();

function launchHeadedPreferred() {
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

async function closeExisting(userId: string, provider: JobBoardProvider) {
  for (const session of sessions.values()) {
    if (session.userId === userId && session.provider === provider) {
      session.status = "cancelled";
      await destroySession(session);
    }
  }
}

function getOwnedSession(sessionId: string, userId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) return null;
  if (Date.now() > session.expiresAt && session.status !== "connected") {
    session.status = "expired";
    void destroySession(session);
    return null;
  }
  return session;
}

async function hasAuthCookie(context: BrowserContext, provider: JobBoardProvider) {
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
  if (CHALLENGE_HINT.test(url)) return false;
  if (/login|uas\/login|auth\?/i.test(url)) return false;
  return false;
}

async function diagnoseFailure(page: Page) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 280);
  const inputs = await page
    .locator("input")
    .evaluateAll((els) =>
      els.slice(0, 12).map((el) => {
        const input = el as HTMLInputElement;
        return {
          type: input.type || "",
          name: input.name || "",
          id: input.id || "",
          autocomplete: input.autocomplete || "",
          visible: !!(
            input.offsetWidth ||
            input.offsetHeight ||
            input.getClientRects().length
          ),
        };
      })
    )
    .catch(() => [] as Array<Record<string, string | boolean>>);
  const inputSummary =
    inputs.length > 0
      ? inputs
          .map(
            (i) =>
              `${i.visible ? "vis" : "hid"}:${i.type || "text"}#${i.id || "-"}[name=${i.name || "-"}]`
          )
          .join(", ")
      : "nenhum <input>";
  return { url, title, snippet, inputSummary };
}

async function dismissNoise(page: Page) {
  const candidates = [
    'button:has-text("Aceitar")',
    'button:has-text("Accept")',
    'button:has-text("Agree")',
    'button:has-text("Allow")',
    'button:has-text("OK")',
    '[aria-label="Dismiss"]',
  ];
  for (const sel of candidates) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }
}

async function typeHuman(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  text: string
) {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  await locator.click({ clickCount: 3, force: true }).catch(() => undefined);
  await locator.fill("").catch(async () => {
    await locator.evaluate((el) => {
      if (el instanceof HTMLInputElement) el.value = "";
    });
  });
  try {
    await locator.pressSequentially(text, { delay: 25 });
  } catch {
    await locator.fill(text, { force: true });
  }
  // Garante valor no React/controlled inputs
  const current = await locator.inputValue().catch(() => "");
  if (current !== text) {
    await locator.evaluate((el, value) => {
      if (!(el instanceof HTMLInputElement)) return;
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, text);
  }
}

async function finalizeAndClose(session: RemoteLoginSession) {
  await ensureSessionsDir(session.userId);
  const outPath = sessionFilePath(session.userId, session.provider);
  await session.context.storageState({ path: outPath });
  session.sessionPath = outPath;
  session.status = "connected";
  if (session.monitor) {
    clearInterval(session.monitor);
    session.monitor = null;
  }
  await destroySession(session);
  return outPath;
}

async function waitForLoginResult(
  session: RemoteLoginSession,
  timeoutMs = 45_000
): Promise<"connected" | "needs_challenge" | "failed"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await session.page.waitForTimeout(1200);
    const url = session.page.url();

    if (await hasAuthCookie(session.context, session.provider)) {
      if (!/uas\/login|\/login(\?|$)/i.test(url) || SUCCESS_HINT[session.provider].test(url)) {
        return "connected";
      }
    }

    if (await pageLooksConnected(session.page, session.provider)) {
      return "connected";
    }

    if (CHALLENGE_HINT.test(url)) {
      return "needs_challenge";
    }

    // LinkedIn error boxes
    const errorText =
      (
        await session.page
          .locator(
            "#error-for-password, #error-for-username, .form__label--error, .alert, [role='alert'], .body__banner"
          )
          .first()
          .textContent()
          .catch(() => null)
      )?.trim() || "";
    if (
      errorText &&
      /senha|password|email|e-mail|incorrect|inválid|invalid|wrong|não reconhec|não encontramos|doesn't match/i.test(
        errorText
      )
    ) {
      session.error = `Login rejeitado: ${errorText}`;
      return "failed";
    }
  }

  if (await hasAuthCookie(session.context, session.provider)) {
    return "connected";
  }
  if (CHALLENGE_HINT.test(session.page.url())) {
    return "needs_challenge";
  }
  return "failed";
}

async function launchBrowser() {
  const headed = launchHeadedPreferred();
  const browser = await chromium.launch({
    headless: !headed,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1280,900",
      "--disable-blink-features=AutomationControlled",
    ],
    slowMo: 40,
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
  return { browser, context, headed };
}

type LoginRoot = Page | Frame;

async function findLinkedInUserInput(root: LoginRoot) {
  const byLabel = root
    .getByLabel(/email|e-mail|phone|telefone|usuário|username/i)
    .first();
  if ((await byLabel.count().catch(() => 0)) > 0) {
    return byLabel;
  }
  const byPlaceholder = root
    .getByPlaceholder(/email|e-mail|phone|telefone/i)
    .first();
  if ((await byPlaceholder.count().catch(() => 0)) > 0) {
    return byPlaceholder;
  }
  return root.locator(LINKEDIN_USER_SELECTORS).first();
}

async function findLinkedInPassInput(root: LoginRoot) {
  const byLabel = root.getByLabel(/password|senha/i).first();
  if ((await byLabel.count().catch(() => 0)) > 0) {
    return byLabel;
  }
  const byPlaceholder = root.getByPlaceholder(/password|senha/i).first();
  if ((await byPlaceholder.count().catch(() => 0)) > 0) {
    return byPlaceholder;
  }
  return root.locator(LINKEDIN_PASS_SELECTORS).first();
}

async function locateLoginPair(root: LoginRoot) {
  const user = await findLinkedInUserInput(root);
  const pass = await findLinkedInPassInput(root);
  const userCount = await user.count().catch(() => 0);
  const passCount = await pass.count().catch(() => 0);
  if (userCount > 0 && passCount > 0) {
    return { user, pass };
  }

  const anyPass = root.locator("input[type='password']").first();
  if ((await anyPass.count().catch(() => 0)) > 0) {
    const anyUser = root
      .locator(
        "form input[type='text'], form input[type='email'], form input:not([type]), input[type='text'], input[type='email']"
      )
      .first();
    if ((await anyUser.count().catch(() => 0)) > 0) {
      return { user: anyUser, pass: anyPass };
    }
  }
  return null;
}

async function waitForLinkedInLoginForm(page: Page) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await dismissNoise(page);

    const onPage = await locateLoginPair(page);
    if (onPage) return onPage;

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const inFrame = await locateLoginPair(frame);
        if (inFrame) return inFrame;
      } catch {
        // frame detached / cross-origin
      }
    }

    await page.waitForTimeout(500);
  }
  return null;
}

async function fillLinkedInLogin(page: Page, email: string, password: string) {
  await dismissNoise(page);
  const form = await waitForLinkedInLoginForm(page);
  if (!form) {
    const d = await diagnoseFailure(page);
    throw new Error(
      `Não achei o formulário de login. URL: ${d.url}. Título: ${d.title}. Inputs: ${d.inputSummary}. Trecho: ${d.snippet || "(vazio)"}`
    );
  }

  await form.user.waitFor({ state: "attached", timeout: 10_000 });
  await typeHuman(page, form.user, email);
  await typeHuman(page, form.pass, password);

  const submit = page
    .getByRole("button", { name: /sign in|entrar|log in|continuar/i })
    .or(
      page.locator(
        "button[type='submit'], button[data-litms-control-urn='login-submit']"
      )
    )
    .first();
  await submit.click({ force: true });
}

async function fillIndeedLogin(page: Page, email: string, password: string) {
  await dismissNoise(page);
  const emailInput = page
    .locator(
      'input[type="email"], input[name="email"], input[name="__email"], input[id*="email" i]'
    )
    .first();
  await emailInput.waitFor({ state: "visible", timeout: 45_000 });
  await typeHuman(page, emailInput, email);

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
  await passInput.waitFor({ state: "visible", timeout: 45_000 });
  await typeHuman(page, passInput, password);

  await page
    .locator(
      'button[type="submit"], button:has-text("Entrar"), button:has-text("Sign in"), button:has-text("Log in")'
    )
    .first()
    .click();
}

/**
 * Login com e-mail/senha do painel. Se pedir 2FA, mantém a sessão aberta
 * e devolve sessionId para o usuário enviar o código.
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
  };
  sessions.set(session.id, session);

  try {
    await page.goto(LOGIN_URL[provider], {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(1200);

    if (provider === "LINKEDIN") {
      await fillLinkedInLogin(page, email, password);
    } else {
      // Authwall / página sem formulário (Indeed)
      const hasForm = await page
        .locator(
          "input[type='email'], input[type='password'], input[name='email'], input[name='__email']"
        )
        .first()
        .isVisible()
        .catch(() => false);
      if (!hasForm) {
        const d = await diagnoseFailure(page);
        throw new Error(
          `Não achei o formulário de login. URL: ${d.url}. Título: ${d.title}. Trecho: ${d.snippet || "(vazio)"}`
        );
      }
      await fillIndeedLogin(page, email, password);
    }

    const result = await waitForLoginResult(session, 50_000);

    if (result === "connected") {
      const sessionPath = await finalizeAndClose(session);
      return {
        status: "connected" as const,
        sessionPath,
        sessionId: null,
      };
    }

    if (result === "needs_challenge") {
      session.status = "needs_challenge";
      return {
        status: "needs_challenge" as const,
        sessionId: session.id,
        sessionPath: null,
        message:
          "O LinkedIn/Indeed pediu verificação. Digite o código que chegou no celular/e-mail.",
      };
    }

    const d = await diagnoseFailure(page);
    const message =
      session.error ||
      `Login não concluído. URL: ${d.url}. ${d.snippet || d.title || "Sem detalhe na página."}`;
    await destroySession(session);
    throw new Error(message);
  } catch (error) {
    if (sessions.has(session.id) && session.status !== "needs_challenge") {
      await destroySession(session);
    }
    throw error;
  }
}

/** Envia código 2FA/PIN na sessão aberta. */
export async function submitChallengeCode(
  sessionId: string,
  userId: string,
  code: string
) {
  const session = getOwnedSession(sessionId, userId);
  if (!session) {
    throw new Error("Sessão de verificação expirada. Faça login de novo.");
  }
  const pin = code.trim();
  if (!pin) throw new Error("Informe o código de verificação.");

  const page = session.page;
  await dismissNoise(page);

  const input = page
    .locator(
      'input[name="pin"], input[name="verification_pin"], input#input__email_verification_pin, input[id*="pin" i], input[autocomplete="one-time-code"], input[inputmode="numeric"]'
    )
    .first();
  await input.waitFor({ state: "visible", timeout: 20_000 });
  await typeHuman(page, input, pin);

  const submit = page
    .locator(
      'button[type="submit"], button:has-text("Enviar"), button:has-text("Submit"), button:has-text("Verify"), button:has-text("Confirmar"), button:has-text("Continuar")'
    )
    .first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  } else {
    await input.press("Enter");
  }

  const result = await waitForLoginResult(session, 60_000);
  if (result === "connected") {
    const sessionPath = await finalizeAndClose(session);
    return { status: "connected" as const, sessionPath };
  }
  if (result === "needs_challenge") {
    throw new Error("Código não aceito ou ainda falta outra verificação.");
  }
  const d = await diagnoseFailure(page);
  await destroySession(session);
  throw new Error(
    session.error ||
      `Verificação falhou. URL: ${d.url}. ${d.snippet || d.title || ""}`
  );
}

export function getRemoteLoginStatus(sessionId: string, userId: string) {
  const session = getOwnedSession(sessionId, userId);
  if (!session) {
    return {
      status: "expired" as const,
      sessionPath: null,
      error: null,
      url: null,
    };
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
  if (!session) return null;
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
  const session = getOwnedSession(sessionId, userId);
  if (!session) return;
  session.status = "cancelled";
  await destroySession(session);
}

export { LOGIN_URL, SUCCESS_HINT, VIEWPORT };
