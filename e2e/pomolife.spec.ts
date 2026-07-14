import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const MODEL_HOST_PATTERN = /(?:huggingface\.co|mlc\.ai|raw\.githubusercontent\.com)/i;

async function preventModelDownloads(page: Page): Promise<string[]> {
  const attemptedDownloads: string[] = [];

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (MODEL_HOST_PATTERN.test(url)) {
      attemptedDownloads.push(url);
      await route.abort("blockedbyclient");
      return;
    }

    await route.continue();
  });

  return attemptedDownloads;
}

async function emulateBrowserWithoutWebGPU(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: undefined,
    });
  });
}

async function openParalysisPlanner(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Quebrando a paralisia/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Quebrando a paralisia" }),
  ).toBeVisible();
}

async function fillParalysisPlanner(page: Page): Promise<void> {
  const planner = page.getByRole("dialog", {
    name: "Quebrando a paralisia",
  });

  await planner
    .getByRole("textbox", { name: "Tarefa", exact: true })
    .fill("revisar o relatório semanal");
  await planner
    .getByRole("textbox", { name: "Onde você travou", exact: true })
    .fill("não sei qual seção abrir primeiro");
  await planner
    .getByRole("textbox", { name: "Onde a tarefa acontece", exact: true })
    .fill("no notebook da mesa");
}

test.beforeEach(async ({ page }) => {
  await emulateBrowserWithoutWebGPU(page);
});

test("é servido corretamente na raiz do domínio personalizado", async ({ page }) => {
  const attemptedDownloads = await preventModelDownloads(page);
  const response = await page.goto("./");

  expect(response?.ok()).toBe(true);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page).toHaveTitle(/PomoLife/);
  await expect(
    page.getByRole("heading", { name: "Clareza para começar. Foco para continuar." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "PomoLife, início" })).toHaveAttribute(
    "href",
    "/",
  );
  expect(attemptedDownloads).toEqual([]);
});

test("abre um card, atualiza o hash e apresenta os campos correspondentes", async ({
  page,
}) => {
  await preventModelDownloads(page);
  await page.goto("./");

  await page.getByRole("button", { name: /Transformar em jogo/ }).click();

  const planner = page.getByRole("dialog", { name: "Transformar em jogo" });
  await expect(planner).toBeVisible();
  await expect(page).toHaveURL(/#transformar-em-jogo$/);
  await expect(
    planner.getByRole("textbox", { name: "Tarefa administrativa", exact: true }),
  ).toBeVisible();
  await expect(
    planner.getByRole("textbox", { name: "Interesse do momento", exact: true }),
  ).toBeVisible();
  await expect(
    planner.getByRole("textbox", { name: "Recompensa desejada", exact: true }),
  ).toBeVisible();
  await expect(
    planner.getByRole("spinbutton", {
      name: "Tempo disponível (minutos)",
      exact: true,
    }),
  ).toHaveValue("30");

  await planner.getByRole("button", { name: "Fechar ferramenta" }).click();
  await expect(planner).toBeHidden();
  await expect(page).not.toHaveURL(/#/);
});

test("gera um plano básico quando WebGPU não está disponível e não baixa o modelo", async ({
  page,
}) => {
  const attemptedDownloads = await preventModelDownloads(page);
  await page.goto("./");

  await expect(page.locator(".engine-status")).toBeVisible();
  await expect(page.locator(".engine-status")).toContainText("Modo básico");
  await openParalysisPlanner(page);
  await fillParalysisPlanner(page);

  const planner = page.getByRole("dialog", {
    name: "Quebrando a paralisia",
  });
  await planner.getByRole("button", { name: "Gerar plano" }).click();

  await expect(planner.getByText("Plano básico", { exact: true })).toBeVisible();
  await expect(planner.locator(".markdown-result")).toContainText(
    "Primeiro passo — menos de 1 minuto",
  );
  await expect(planner.locator(".markdown-result")).toContainText(
    "revisar o relatório semanal",
  );
  await expect(planner.getByRole("button", { name: "Começar agora" })).toBeVisible();
  expect(attemptedDownloads).toEqual([]);
});

test("restaura o histórico local após recarregar a página", async ({ page }) => {
  const attemptedDownloads = await preventModelDownloads(page);
  await page.goto("./");
  await openParalysisPlanner(page);
  await fillParalysisPlanner(page);

  const planner = page.getByRole("dialog", {
    name: "Quebrando a paralisia",
  });
  await planner.getByRole("button", { name: "Gerar plano" }).click();
  await expect(planner.getByText("Plano básico", { exact: true })).toBeVisible();

  const storedState = await page.evaluate(() => localStorage.getItem("pomolife:state"));
  expect(storedState).toContain("revisar o relatório semanal");

  await page.reload();
  await expect(page).toHaveURL(/#quebrando-a-paralisia$/);
  await page
    .getByRole("dialog", { name: "Quebrando a paralisia" })
    .getByRole("button", { name: "Fechar ferramenta" })
    .click();

  await page.getByRole("button", { name: "Abrir histórico" }).click();
  const history = page.getByRole("dialog", { name: "Histórico" });
  await expect(history).toBeVisible();
  await expect(history.getByText("Quebrando a paralisia", { exact: true })).toBeVisible();
  await expect(page.locator(".button-count")).toHaveText("1");

  await history.locator(".history-open").click();
  const restoredPlanner = page.getByRole("dialog", {
    name: "Quebrando a paralisia",
  });
  await expect(restoredPlanner.locator(".markdown-result")).toContainText(
    "revisar o relatório semanal",
  );
  expect(attemptedDownloads).toEqual([]);
});

test("mantém cards e ferramenta utilizáveis em viewport mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await preventModelDownloads(page);
  await page.goto("./");

  const cards = page.locator(".tool-card");
  await expect(cards).toHaveCount(7);
  await page.evaluate(() => document.fonts.ready);
  const [firstCardBox, secondCardBox] = await cards.evaluateAll((elements) =>
    elements.slice(0, 2).map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );

  expect(Math.abs(firstCardBox.x - secondCardBox.x)).toBeLessThan(2);
  expect(secondCardBox.y).toBeGreaterThanOrEqual(
    firstCardBox.y + firstCardBox.height,
  );

  await openParalysisPlanner(page);
  const planner = page.getByRole("dialog", {
    name: "Quebrando a paralisia",
  });
  const plannerBox = await planner.boundingBox();
  const formBox = await planner.locator(".planner-form").boundingBox();
  const resultBox = await planner.locator(".result-panel").boundingBox();
  const plannerColumnCount = await planner.locator(".planner-grid").evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
  );

  expect(plannerBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(2);
  expect(plannerBox?.width ?? 0).toBeGreaterThanOrEqual(386);
  expect(plannerBox?.width ?? 0).toBeLessThanOrEqual(390);
  expect(plannerColumnCount).toBe(1);
  expect(resultBox?.y ?? 0).toBeGreaterThan((formBox?.y ?? 0) + 100);
  await expect(planner.getByRole("button", { name: "Gerar plano" })).toBeVisible();
});

test("não possui violações críticas de acessibilidade segundo o axe", async ({ page }) => {
  await preventModelDownloads(page);
  await page.goto("./");

  const homeScan = await new AxeBuilder({ page }).analyze();
  expect(homeScan.violations.filter(({ impact }) => impact === "critical")).toEqual([]);

  await openParalysisPlanner(page);
  const plannerScan = await new AxeBuilder({ page })
    .include(".planner-modal")
    .analyze();
  expect(plannerScan.violations.filter(({ impact }) => impact === "critical")).toEqual([]);
});
