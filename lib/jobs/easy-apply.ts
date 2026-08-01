import path from "node:path";
import { access } from "node:fs/promises";
import type { Locator, Page } from "playwright";
import {
  answerFormQuestion,
  type ApplicantContext,
} from "@/lib/ai/form-fill";
import { withSession } from "@/lib/jobs/board-browser";

export type EasyApplyResult = {
  status: "APPLIED" | "EXTERNAL_REDIRECT" | "FAILED" | "SKIPPED";
  message?: string;
};

type JobMeta = {
  title: string;
  company: string;
  url: string;
};

const MAX_STEPS = 12;

function modal(page: Page) {
  return page.locator(
    ".jobs-easy-apply-modal, .jobs-easy-apply-content, div[data-test-modal-id='easy-apply-modal']"
  ).first();
}

async function clickFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    const disabled = await loc.isDisabled().catch(() => false);
    if (disabled) continue;
    await loc.click({ timeout: 5000 }).catch(() => null);
    return true;
  }
  return false;
}

async function detectOutcome(page: Page): Promise<EasyApplyResult | null> {
  const bodyText = ((await page.locator("body").innerText().catch(() => "")) || "").toLowerCase();

  if (
    /candidatura enviada|application submitted|your application was sent|candidatura foi enviada/.test(
      bodyText
    )
  ) {
    return { status: "APPLIED", message: "Candidatura enviada." };
  }

  if (
    /já se candidatou|already applied|you applied/.test(bodyText)
  ) {
    return { status: "SKIPPED", message: "Já candidatado nesta vaga." };
  }

  return null;
}

async function labelFor(page: Page, el: Locator) {
  const aria = (await el.getAttribute("aria-label").catch(() => null))?.trim();
  if (aria) return aria;
  const placeholder = (await el.getAttribute("placeholder").catch(() => null))?.trim();
  if (placeholder) return placeholder;
  const name = (await el.getAttribute("name").catch(() => null))?.trim();
  if (name) return name;
  const id = await el.getAttribute("id").catch(() => null);
  if (id) {
    const label = page.locator(`label[for="${id}"]`).first();
    if ((await label.count()) > 0) {
      return ((await label.innerText().catch(() => "")) || "").trim();
    }
  }
  // Parent fieldset / form-component label
  const parentLabel = el.locator(
    "xpath=ancestor::*[contains(@class,'jobs-easy-apply') or contains(@class,'fb-dash')][1]//label"
  ).first();
  if ((await parentLabel.count()) > 0) {
    return ((await parentLabel.innerText().catch(() => "")) || "").trim();
  }
  return "Campo do formulário";
}

async function fillCurrentStep(
  page: Page,
  profile: ApplicantContext,
  job: JobMeta,
  resumeAbsPath: string | null
) {
  const root = modal(page);
  const scope = (await root.count()) > 0 ? root : page.locator("body");

  // Resume upload
  if (resumeAbsPath) {
    const fileInputs = scope.locator('input[type="file"]');
    const fileCount = await fileInputs.count();
    for (let i = 0; i < fileCount; i++) {
      const input = fileInputs.nth(i);
      if (!(await input.isVisible().catch(() => true))) continue;
      await input.setInputFiles(resumeAbsPath).catch(() => null);
    }
  }

  // Text inputs / textareas
  const fields = scope.locator(
    'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea'
  );
  const fieldCount = await fields.count();
  for (let i = 0; i < fieldCount; i++) {
    const field = fields.nth(i);
    if (!(await field.isVisible().catch(() => false))) continue;
    if (await field.isDisabled().catch(() => true)) continue;
    const current = ((await field.inputValue().catch(() => "")) || "").trim();
    if (current) continue;

    const question = await labelFor(page, field);
    const tag = await field.evaluate((node) => node.tagName.toLowerCase());
    const answer = await answerFormQuestion(profile, {
      question,
      fieldType: tag === "textarea" ? "textarea" : "text",
      jobTitle: job.title,
      company: job.company,
    }).catch(() => "");
    if (!answer) continue;
    await field.fill(answer).catch(() => null);
  }

  // Selects
  const selects = scope.locator("select");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i++) {
    const select = selects.nth(i);
    if (!(await select.isVisible().catch(() => false))) continue;
    const current = await select.inputValue().catch(() => "");
    if (current && current !== "Select an option" && current !== "") continue;

    const options = await select.locator("option").allTextContents();
    const cleaned = options.map((o) => o.trim()).filter((o) => o && !/^select/i.test(o));
    if (cleaned.length === 0) continue;

    const question = await labelFor(page, select);
    const answer = await answerFormQuestion(profile, {
      question,
      fieldType: "select",
      options: cleaned,
      jobTitle: job.title,
      company: job.company,
    }).catch(() => cleaned[0]);

    const match =
      cleaned.find((o) => o.toLowerCase() === answer.toLowerCase()) ||
      cleaned.find((o) => o.toLowerCase().includes(answer.toLowerCase())) ||
      cleaned[0];
    await select.selectOption({ label: match }).catch(async () => {
      await select.selectOption({ value: match }).catch(() => null);
    });
  }

  // Radio groups (pick one unanswered group via AI)
  const radios = scope.locator('input[type="radio"]');
  const radioCount = await radios.count();
  const groups = new Map<string, { value: string; label: string }[]>();
  for (let i = 0; i < radioCount; i++) {
    const radio = radios.nth(i);
    if (!(await radio.isVisible().catch(() => false))) continue;
    const name = (await radio.getAttribute("name").catch(() => null)) || `radio-${i}`;
    const value = (await radio.getAttribute("value").catch(() => null)) || "";
    const label = await labelFor(page, radio);
    const list = groups.get(name) ?? [];
    list.push({ value, label });
    groups.set(name, list);
  }

  for (const [name, options] of groups) {
    const checked = scope.locator(`input[type="radio"][name="${name}"]:checked`);
    if ((await checked.count()) > 0) continue;
    const labels = options.map((o) => o.label || o.value).filter(Boolean);
    if (labels.length === 0) continue;
    const question = labels.join(" / ");
    const answer = await answerFormQuestion(profile, {
      question,
      fieldType: "radio",
      options: labels,
      jobTitle: job.title,
      company: job.company,
    }).catch(() => labels[0]);
    const pick =
      options.find((o) => (o.label || o.value).toLowerCase() === answer.toLowerCase()) ||
      options.find((o) =>
        (o.label || o.value).toLowerCase().includes(answer.toLowerCase())
      ) ||
      options[0];
    await scope
      .locator(`input[type="radio"][name="${name}"][value="${pick.value}"]`)
      .first()
      .check({ force: true })
      .catch(async () => {
        await scope.locator(`input[type="radio"][name="${name}"]`).first().check({ force: true }).catch(() => null);
      });
  }
}

async function advanceOrSubmit(page: Page): Promise<"submitted" | "advanced" | "stuck"> {
  const submitClicked = await clickFirstVisible(page, [
    'button[aria-label*="Submit application" i]',
    'button[aria-label*="Enviar candidatura" i]',
    'button:has-text("Submit application")',
    'button:has-text("Enviar candidatura")',
    'button:has-text("Enviar")',
  ]);
  if (submitClicked) {
    await page.waitForTimeout(2000);
    return "submitted";
  }

  const nextClicked = await clickFirstVisible(page, [
    'button[aria-label*="Continue to next step" i]',
    'button[aria-label*="Review your application" i]',
    'button[aria-label*="Avançar" i]',
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button:has-text("Review")',
    'button:has-text("Avançar")',
    'button:has-text("Continuar")',
    'button:has-text("Revisar")',
    'button:has-text("Próximo")',
  ]);
  if (nextClicked) {
    await page.waitForTimeout(1500);
    return "advanced";
  }

  return "stuck";
}

/**
 * Attempts LinkedIn Easy Apply for one job URL using the saved session.
 */
export async function applyLinkedInEasyApply(params: {
  userId: string;
  job: JobMeta;
  profile: ApplicantContext;
  resumeFilePath: string | null;
}): Promise<EasyApplyResult> {
  const resumeAbs = params.resumeFilePath
    ? path.isAbsolute(params.resumeFilePath)
      ? params.resumeFilePath
      : path.resolve(process.cwd(), params.resumeFilePath)
    : null;

  if (resumeAbs) {
    await access(resumeAbs).catch(() => {
      throw new Error("Arquivo de currículo não encontrado no servidor.");
    });
  }

  return withSession(params.userId, "LINKEDIN", async (page) => {
    await page.goto(params.job.url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);

    if (/login|authwall|checkpoint/i.test(page.url())) {
      return {
        status: "FAILED",
        message: "Sessão LinkedIn expirada. Conecte novamente.",
      };
    }

    const early = await detectOutcome(page);
    if (early) return early;

    const easyApplyClicked = await clickFirstVisible(page, [
      'button.jobs-apply-button',
      'button[aria-label*="Easy Apply" i]',
      'button[aria-label*="Candidatura simplificada" i]',
      'button:has-text("Easy Apply")',
      'button:has-text("Candidatura simplificada")',
    ]);

    if (!easyApplyClicked) {
      // External apply / company site
      const external = await clickFirstVisible(page, [
        'a[href*="externalApply"]',
        'button:has-text("Apply")',
        'button:has-text("Candidatar")',
        'a:has-text("Apply")',
      ]);
      if (external) {
        return {
          status: "EXTERNAL_REDIRECT",
          message: "Vaga exige candidatura externa (sem Easy Apply).",
        };
      }
      return {
        status: "SKIPPED",
        message: "Botão Easy Apply não encontrado nesta vaga.",
      };
    }

    await page.waitForTimeout(2000);

    for (let step = 0; step < MAX_STEPS; step++) {
      const done = await detectOutcome(page);
      if (done) return done;

      await fillCurrentStep(page, params.profile, params.job, resumeAbs);
      const action = await advanceOrSubmit(page);
      if (action === "submitted") {
        await page.waitForTimeout(2000);
        const after = await detectOutcome(page);
        return (
          after ?? {
            status: "APPLIED",
            message: "Candidatura enviada (confirmação parcial).",
          }
        );
      }
      if (action === "stuck") {
        // Validation errors left unanswered
        const errText =
          (
            await modal(page)
              .locator(".artdeco-inline-feedback__message, .fb-form-element__error")
              .first()
              .innerText()
              .catch(() => "")
          ) || "Não foi possível avançar no formulário Easy Apply.";
        return { status: "FAILED", message: errText.slice(0, 400) };
      }
    }

    return {
      status: "FAILED",
      message: "Limite de etapas do Easy Apply excedido.",
    };
  });
}
