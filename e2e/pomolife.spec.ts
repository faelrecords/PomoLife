import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function withoutWebGPU(page: Page) {
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined }));
}

async function blockExternalMedia(page: Page) {
  await page.route(/(?:youtube\.com|youtube-nocookie\.com|googlevideo\.com)/, (route) => route.abort("blockedbyclient"));
}

async function sendBasic(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Descreva sua tarefa" });
  await composer.fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
  const consent = page.getByRole("dialog", { name: "Baixar a IA local?" });
  if (await consent.isVisible().catch(() => false)) await consent.getByRole("button", { name: "Continuar no modo básico" }).click();
}

async function openMobileHeaderIfNeeded(page: Page) {
  if ((page.viewportSize()?.width ?? 1_000) <= 640) {
    await page.getByRole("button", { name: "Abrir menu" }).click();
  }
}

test.beforeEach(async ({ page }) => {
  await withoutWebGPU(page);
  await blockExternalMedia(page);
});

test("é servido na raiz como um único chat local", async ({ page }) => {
  const response = await page.goto("./");
  expect(response?.ok()).toBe(true);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page).toHaveTitle(/PomoLife/);
  await expect(page.getByRole("heading", { name: "Nova conversa" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Descreva sua tarefa" })).toBeVisible();
  await expect(page.locator(".tool-card")).toHaveCount(0);
});

test("faz briefing, cria checklist e salva o progresso", async ({ page }) => {
  await page.goto("./");
  await sendBasic(page, "Preciso criar 8 carrosséis");
  await expect(page.getByText(/qual entrega concreta/i)).toBeVisible();
  await sendBasic(page, "São 8 temas, 6 páginas, copy pronta, identidade definida e prazo hoje");
  const checklistPanel = page.getByRole("complementary", { name: /Checklist de/i });
  const checkbox = checklistPanel.getByRole("checkbox", { name: /reunir em um único lugar/i });
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  const stored = await page.evaluate(() => localStorage.getItem("pomolife:agent-state"));
  expect(stored).toContain('"completed":true');
  await expect(page.locator(".progress-heading strong")).toContainText("1/6");
});

test("restaura conversas após recarregar", async ({ page }) => {
  await page.goto("./");
  await sendBasic(page, "Organizar relatório mensal");
  await page.reload();
  await openMobileHeaderIfNeeded(page);
  await page.getByRole("button", { name: "Histórico" }).click();
  const history = page.getByRole("dialog", { name: "Conversas" });
  await expect(history.getByText("Organizar relatório mensal")).toBeVisible();
  await history.getByText("Organizar relatório mensal").click();
  await expect(page.getByText(/qual entrega concreta/i)).toBeVisible();
});

test("inicia e restaura um Pomodoro com horário absoluto", async ({ page }) => {
  await page.goto("./");
  await sendBasic(page, "Finalizar apresentação");
  await sendBasic(page, "10 slides, conteúdo pronto, entrega hoje");
  await page.getByRole("button", { name: /iniciar foco em reunir/i }).click();
  const dialog = page.getByRole("dialog", { name: "Iniciar um bloco de foco?" });
  await dialog.getByRole("button", { name: /15 min pausa de 5/i }).click();
  await dialog.getByRole("button", { name: "Começar agora" }).click();
  await expect(page.getByRole("complementary", { name: "Pomodoro em andamento" })).toContainText("15/5");
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Pomodoro em andamento" })).toContainText(/Reunir em um único lugar/i);
});

test("mantém chat e player utilizáveis em viewport mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(page.locator(".chat-shell")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Descreva sua tarefa" })).toBeVisible();
  await expect(page.locator(".header-player")).toBeVisible();
  const box = await page.locator(".chat-shell").boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(390);
});

test("não apresenta violações críticas de acessibilidade", async ({ page }) => {
  await page.goto("./");
  const home = await new AxeBuilder({ page }).analyze();
  expect(home.violations.filter(({ impact }) => impact === "critical")).toEqual([]);
  await openMobileHeaderIfNeeded(page);
  await page.getByRole("button", { name: "Configurações" }).click();
  const settings = await new AxeBuilder({ page }).include(".settings-modal").analyze();
  expect(settings.violations.filter(({ impact }) => impact === "critical")).toEqual([]);
});
