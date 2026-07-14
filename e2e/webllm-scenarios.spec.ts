import { expect, test, type Page, type Request } from "@playwright/test";

interface MockScenario {
  cached?: boolean;
  initError?: "worker" | "memory";
  initDelayMs?: number;
  tokenDelayMs?: number;
  chunks?: string[];
}

interface MockEvent {
  type: string;
  detail?: Record<string, unknown>;
}

const MODEL_HOST_PATTERN = /(?:huggingface\.co|mlc\.ai|raw\.githubusercontent\.com)/i;

async function enableMockAI(page: Page, scenario: MockScenario = {}): Promise<void> {
  await page.addInitScript((configuredScenario) => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {
        requestAdapter: async () => ({ name: "mock-webgpu-adapter" }),
      },
    });
    Object.assign(globalThis, {
      __POMOLIFE_WEBLLM_SCENARIO__: configuredScenario,
      __POMOLIFE_WEBLLM_EVENTS__: [],
    });
  }, scenario);
}

async function disableWebGPU(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: undefined,
    });
  });
}

async function blockRealModelTraffic(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (MODEL_HOST_PATTERN.test(url)) {
      blocked.push(url);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return blocked;
}

async function openAndFillParalysisPlanner(
  page: Page,
  task = "organizar o relatório semanal",
): Promise<void> {
  await page.getByRole("button", { name: /Quebrando a paralisia/ }).click();
  const planner = page.getByRole("dialog", { name: "Quebrando a paralisia" });
  await planner.getByRole("textbox", { name: "Tarefa", exact: true }).fill(task);
  await planner
    .getByRole("textbox", { name: "Onde você travou", exact: true })
    .fill("não sei qual arquivo abrir");
  await planner
    .getByRole("textbox", { name: "Onde a tarefa acontece", exact: true })
    .fill("no notebook");
}

async function activateAI(page: Page): Promise<void> {
  const planner = page.getByRole("dialog", { name: "Quebrando a paralisia" });
  await planner.getByRole("button", { name: "Gerar plano" }).click();
  const consent = page.getByRole("dialog", { name: "Ativar a IA local?" });
  await expect(consent).toBeVisible();
  await consent.getByRole("button", { name: "Ativar IA local" }).click();
}

async function mockEvents(page: Page): Promise<MockEvent[]> {
  return page.evaluate(
    () =>
      (globalThis as typeof globalThis & {
        __POMOLIFE_WEBLLM_EVENTS__?: MockEvent[];
      }).__POMOLIFE_WEBLLM_EVENTS__ ?? [],
  );
}

test("mostra consentimento e progresso, transmite tokens e permite cancelar", async ({
  page,
}) => {
  await enableMockAI(page, {
    initDelayMs: 500,
    tokenDelayMs: 800,
    chunks: ["## Primeiro trecho\n\n", "Segundo trecho", "Terceiro trecho"],
  });
  const blockedTraffic = await blockRealModelTraffic(page);
  await page.goto("./");
  await openAndFillParalysisPlanner(page);

  const planner = page.getByRole("dialog", { name: "Quebrando a paralisia" });
  await planner.getByRole("button", { name: "Gerar plano" }).click();
  const consent = page.getByRole("dialog", { name: "Ativar a IA local?" });
  await expect(consent).toContainText("≈ 290 MB");
  await expect(consent).toContainText("Seus campos não serão enviados");
  await consent.getByRole("button", { name: "Ativar IA local" }).click();

  await expect(consent.getByText("Baixando modelo", { exact: true })).toBeVisible();
  await expect(consent).toBeHidden();
  await expect(planner.getByText("Organizando o próximo passo…")).toBeVisible();
  await expect(planner.locator(".markdown-result")).toContainText("Primeiro trecho");
  await planner.getByRole("button", { name: "Cancelar" }).click();

  await expect(page.locator(".toast")).toContainText("Geração cancelada");
  await expect(planner.getByRole("button", { name: "Cancelar" })).toBeHidden();
  await expect.poll(async () => (await mockEvents(page)).map(({ type }) => type)).toContain(
    "interrupt-generation",
  );
  expect(blockedTraffic).toEqual([]);
});

test("prepara um modelo já existente no cache sem indicar novo download", async ({ page }) => {
  await enableMockAI(page, { cached: true, initDelayMs: 600, tokenDelayMs: 20 });
  const blockedTraffic = await blockRealModelTraffic(page);
  await page.goto("./");
  await openAndFillParalysisPlanner(page);
  await activateAI(page);

  const consent = page.getByRole("dialog", { name: "Ativar a IA local?" });
  await expect(consent.getByText("Preparando arquivos salvos", { exact: true })).toBeVisible();
  await expect(consent.getByText("Baixando modelo", { exact: true })).toHaveCount(0);

  const planner = page.getByRole("dialog", { name: "Quebrando a paralisia" });
  await expect(planner.getByText("IA local", { exact: true })).toBeVisible();
  const events = await mockEvents(page);
  expect(events).toContainEqual({
    type: "has-model-in-cache",
    detail: expect.objectContaining({ cached: true }),
  });
  expect(blockedTraffic).toEqual([]);
});

test("oferece o modo básico quando o worker falha ao carregar", async ({ page }) => {
  await enableMockAI(page, { initError: "worker", initDelayMs: 80 });
  const blockedTraffic = await blockRealModelTraffic(page);
  await page.goto("./");
  await openAndFillParalysisPlanner(page);
  await activateAI(page);

  const consent = page.getByRole("dialog", { name: "Ativar a IA local?" });
  await expect(consent.getByRole("alert")).toContainText(
    "processo local da IA foi interrompido",
  );
  await consent.getByRole("button", { name: "Usar modo básico" }).click();

  const planner = page.getByRole("dialog", { name: "Quebrando a paralisia" });
  await expect(planner.getByText("Plano básico", { exact: true })).toBeVisible();
  expect(blockedTraffic).toEqual([]);
});

test("explica falta de memória gráfica e mantém o fallback disponível", async ({ page }) => {
  await enableMockAI(page, { initError: "memory", initDelayMs: 80 });
  const blockedTraffic = await blockRealModelTraffic(page);
  await page.goto("./");
  await openAndFillParalysisPlanner(page);
  await activateAI(page);

  const consent = page.getByRole("dialog", { name: "Ativar a IA local?" });
  await expect(consent.getByRole("alert")).toContainText(
    "não tem memória gráfica suficiente",
  );
  await expect(consent.getByRole("button", { name: "Usar modo básico" })).toBeEnabled();
  expect(blockedTraffic).toEqual([]);
});

test("restaura uma sessão de foco ativa depois do reload", async ({ page }) => {
  await disableWebGPU(page);
  const blockedTraffic = await blockRealModelTraffic(page);
  await page.goto("./");
  await page.getByRole("button", { name: /Companhia de foco/ }).click();

  const planner = page.getByRole("dialog", { name: "Companhia de foco" });
  await planner
    .getByRole("textbox", { name: "No que você vai trabalhar", exact: true })
    .fill("responder três mensagens prioritárias");
  await planner
    .getByRole("textbox", { name: "Resultado desejado ao final", exact: true })
    .fill("três respostas enviadas");
  await planner
    .getByRole("textbox", { name: "Principal distração provável", exact: true })
    .fill("abrir outra aba");
  await planner.getByRole("button", { name: "Preparar sessão" }).click();
  await expect(planner.getByText("Plano básico", { exact: true })).toBeVisible();
  await planner.getByRole("button", { name: "Iniciar 30 min" }).click();

  const focusDock = page.getByRole("complementary", {
    name: "Sessão de foco em andamento",
  });
  await expect(focusDock).toContainText("responder três mensagens prioritárias");
  const stateBeforeReload = await page.evaluate(() => localStorage.getItem("pomolife:state"));
  expect(stateBeforeReload).toContain("focusSession");

  await page.reload();
  const restoredDock = page.getByRole("complementary", {
    name: "Sessão de foco em andamento",
  });
  await expect(restoredDock).toContainText("responder três mensagens prioritárias");
  await expect(restoredDock.locator(".focus-progress span")).toHaveText(/^29:\d{2}$/);
  expect(blockedTraffic).toEqual([]);
});

test("não inclui os campos preenchidos em nenhuma requisição de rede", async ({ page }) => {
  const privateMarker = "SEGREDO-PRIVADO-9F3C";
  await enableMockAI(page, { initDelayMs: 60, tokenDelayMs: 20 });
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  const blockedTraffic = await blockRealModelTraffic(page);

  await page.goto("./");
  await openAndFillParalysisPlanner(page, privateMarker);
  await activateAI(page);
  await expect(
    page
      .getByRole("dialog", { name: "Quebrando a paralisia" })
      .getByText("IA local", { exact: true }),
  ).toBeVisible();

  const networkPayload = requests
    .map((request) => `${request.url()}\n${request.postData() ?? ""}`)
    .join("\n");
  expect(networkPayload).not.toContain(privateMarker);
  expect(networkPayload).not.toContain(encodeURIComponent(privateMarker));
  expect(blockedTraffic).toEqual([]);
});
