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
  await expect(page.getByRole("combobox", { name: "Modelo de IA" })).toHaveValue("Qwen3-0.6B-q4f16_1-MLC");
  await expect(page.getByText("Gerenciar conversas")).toHaveCount(0);
  await expect(page.getByText("IA não baixada")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Histórico" })).toHaveCount(0);
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
  await page.getByRole("button", { name: /^Organizar relatório mensal/i }).click();
  await expect(page.getByText(/qual entrega concreta/i)).toBeVisible();
});

test("anexa texto localmente e preserva o arquivo na conversa", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Selecionar arquivos de texto").setInputFiles({
    name: "briefing.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Prazo: sexta-feira\nEntrega: relatório final"),
  });
  await expect(page.getByRole("button", { name: "Visualizar arquivo briefing.md" })).toBeVisible();
  await page.getByRole("button", { name: "Enviar" }).click();
  const consent = page.getByRole("dialog", { name: "Baixar a IA local?" });
  await consent.getByRole("button", { name: "Continuar no modo básico" }).click();
  await expect(page.locator(".user-message-copy", { hasText: "Analise os arquivos anexados." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Visualizar arquivo briefing.md" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("pomolife:agent-state"))).toContain("Prazo: sexta-feira");
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
  await expect(page.getByRole("button", { name: "Configurações" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir menu" })).toHaveCount(0);
  const box = await page.locator(".chat-shell").boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(390);
  const selector = await page.getByRole("combobox", { name: "Modelo de IA" }).boundingBox();
  expect((selector?.x ?? 0) + (selector?.width ?? 0)).toBeLessThanOrEqual(390);
});

test("mantém laterais simétricas e o chat dentro das margens", async ({ page }) => {
  await page.setViewportSize({ width: 1627, height: 959 });
  await page.goto("./");
  const left = await page.locator(".chat-sidebar").boundingBox();
  const chat = await page.locator(".chat-shell").boundingBox();
  const right = await page.locator(".checklist-sidebar").boundingBox();
  const composer = await page.locator(".chat-composer").boundingBox();
  expect(Math.abs((left?.width ?? 0) - (right?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((left?.height ?? 0) - (chat?.height ?? 0))).toBeLessThanOrEqual(2);
  expect(Math.abs((right?.height ?? 0) - (chat?.height ?? 0))).toBeLessThanOrEqual(2);
  expect((composer?.x ?? 0) + (composer?.width ?? 0)).toBeLessThanOrEqual((chat?.x ?? 0) + (chat?.width ?? 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("abre o seletor de música sem recortar o modal nem sobrepor o vídeo", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Trocar música" }).click();
  const dialog = page.getByRole("dialog", { name: "Escolher trilha" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  await expect(page.locator(".youtube-popover")).not.toHaveClass(/is-open/);
});

test("não apresenta violações críticas de acessibilidade", async ({ page }) => {
  await page.goto("./");
  const home = await new AxeBuilder({ page }).analyze();
  expect(home.violations.filter(({ impact }) => impact === "critical")).toEqual([]);
  await page.getByRole("button", { name: "Configurações" }).click();
  const settings = await new AxeBuilder({ page }).include(".settings-modal").analyze();
  expect(settings.violations.filter(({ impact }) => impact === "critical")).toEqual([]);
});
