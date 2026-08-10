import { expect, test } from "@playwright/test";
import path from "node:path";

test("signup, create profile, and upload résumé", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/signup");
  await page.getByLabel("Nome").fill("Ana E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha").fill("abc12345");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL(/\/profile$/);

  await page.getByLabel(/Cargos desejados/).fill("Desenvolvedor Backend Node");
  const stack = page.getByLabel(/Stack técnica/);
  await stack.fill("Node");
  await stack.press("Enter");
  await stack.fill("PostgreSQL");
  await stack.press("Enter");
  await page.getByLabel("Localização").fill("São Paulo, SP");
  await page.getByLabel(/Pretensão salarial/).fill("8000");
  await page.getByRole("checkbox", { name: "CLT" }).check();
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByText("Perfil salvo.")).toBeVisible();

  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(__dirname, "fixtures/sample-resume.pdf"));
  await expect(page.getByText("Currículo enviado.")).toBeVisible();
  await expect(page.getByText("sample-resume.pdf")).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha").fill("abc12345");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText("sample-resume.pdf")).toBeVisible();
});
