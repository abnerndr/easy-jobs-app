import { expect, test } from "@playwright/test";

test("authenticated user can open dashboard search UI", async ({ page }) => {
  const email = `e2e-jobs-${Date.now()}@example.com`;

  await page.goto("/signup");
  await page.getByLabel("Nome").fill("Jobs E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Senha").fill("abc12345");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/profile$/);

  await page.getByLabel(/Cargos desejados/).fill("Desenvolvedor Full Stack");
  await page.getByLabel(/Stack técnica/).fill("React, Node");
  await page.getByLabel("Localização").fill("Remoto, Brasil");
  await page.getByLabel(/Pretensão salarial/).fill("9000");
  await page.getByRole("checkbox", { name: "CLT" }).check();
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByText("Perfil salvo.")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buscar vagas" })).toBeVisible();
  await expect(page.getByLabel("Máximo por dia")).toBeVisible();

  await page.goto("/applications");
  await expect(page.getByRole("heading", { name: "Status das vagas" })).toBeVisible();
});
