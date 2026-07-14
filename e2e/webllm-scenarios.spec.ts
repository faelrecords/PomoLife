import { expect, test, type Page, type Request } from "@playwright/test";

interface MockScenario { cached?: boolean; initError?: "worker" | "memory"; initDelayMs?: number; tokenDelayMs?: number; chunks?: string[]; }
interface MockEvent { type: string; detail?: Record<string, unknown>; }

async function enableMockAI(page: Page, scenario: MockScenario = {}) {
  await page.addInitScript((configured) => {
    Object.defineProperty(navigator, "gpu", { configurable: true, value: { requestAdapter: async () => ({ name: "mock-webgpu" }) } });
    Object.assign(globalThis, { __POMOLIFE_WEBLLM_SCENARIO__: configured, __POMOLIFE_WEBLLM_EVENTS__: [] });
  }, scenario);
}

async function blockExternal(page: Page) {
  const blocked: string[] = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (/(?:huggingface\.co|mlc\.ai|raw\.githubusercontent\.com)/i.test(url)) blocked.push(url);
    if (/(?:huggingface\.co|mlc\.ai|raw\.githubusercontent\.com|youtube\.com|youtube-nocookie\.com|googlevideo\.com)/i.test(url)) return route.abort("blockedbyclient");
    await route.continue();
  });
  return blocked;
}

async function submit(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Descreva sua tarefa" }).fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
}

async function activate(page: Page) {
  const consent = page.getByRole("dialog", { name: "Baixar a IA local?" });
  await expect(consent).toBeVisible();
  await consent.getByRole("button", { name: "Baixar e ativar IA" }).click();
}

async function events(page: Page): Promise<MockEvent[]> {
  return page.evaluate(() => (globalThis as typeof globalThis & { __POMOLIFE_WEBLLM_EVENTS__?: MockEvent[] }).__POMOLIFE_WEBLLM_EVENTS__ ?? []);
}

test("mostra consentimento Qwen3, progresso, streaming e cancelamento", async ({ page }) => {
  await enableMockAI(page, { initDelayMs: 300, tokenDelayMs: 700, chunks: ["[[PLANO]]## Entendimento\n", "Texto em streaming\n", "## Checklist\n- [ ] Abrir arquivo · 2 min"] });
  const blocked = await blockExternal(page);
  await page.goto("./");
  await submit(page, "Planejar uma tarefa com detalhes suficientes");
  const consent = page.getByRole("dialog", { name: "Baixar a IA local?" });
  await expect(consent).toContainText("≈ 352 MB");
  await expect(consent).toContainText("Qwen3 · 0.6B");
  await activate(page);
  await expect(page.getByText("Texto em streaming")).toBeVisible();
  await page.getByRole("button", { name: "Parar" }).click();
  await expect.poll(async () => (await events(page)).map((event) => event.type)).toContain("interrupt-generation");
  expect(blocked).toEqual([]);
});
test("prepara modelo em cache e conclui resposta local", async ({ page }) => {
  await enableMockAI(page, { cached: true, initDelayMs: 250, tokenDelayMs: 10, chunks: ["[[BRIEFING]]Entendi.\n\n1. Qual é o prazo?"] });
  const blocked = await blockExternal(page);
  await page.goto("./");
  await expect(page.getByText("O modelo local já está disponível neste dispositivo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Baixar modelo" })).toHaveCount(0);
  await submit(page, "Criar uma campanha");
  await activate(page);
  await expect(page.getByText("Qual é o prazo?")).toBeVisible();
  await expect(page.getByText("IA local")).toBeVisible();
  expect(await events(page)).toContainEqual({ type: "has-model-in-cache", detail: expect.objectContaining({ cached: true }) });
  expect(blocked).toEqual([]);
});

test("oferece modo básico quando o worker falha", async ({ page }) => {
  await enableMockAI(page, { initError: "worker", initDelayMs: 30 });
  await blockExternal(page);
  await page.goto("./");
  await submit(page, "Organizar projeto");
  await activate(page);
  const consent = page.getByRole("dialog", { name: "Baixar a IA local?" });
  await expect(consent.getByRole("alert")).toContainText("processo local da IA foi interrompido");
  await consent.getByRole("button", { name: "Continuar no modo básico" }).click();
  await expect(page.getByText(/qual entrega concreta/i)).toBeVisible();
});

test("explica falta de memória e mantém fallback", async ({ page }) => {
  await enableMockAI(page, { initError: "memory", initDelayMs: 30 });
  await blockExternal(page);
  await page.goto("./");
  await submit(page, "Organizar projeto");
  await activate(page);
  const consent = page.getByRole("dialog", { name: "Baixar a IA local?" });
  await expect(consent.getByRole("alert")).toContainText("memória gráfica suficiente");
  await expect(consent.getByRole("button", { name: "Continuar no modo básico" })).toBeEnabled();
});

test("não inclui texto do chat em nenhuma requisição", async ({ page }) => {
  const marker = "SEGREDO-PRIVADO-9F3C";
  await enableMockAI(page, { initDelayMs: 20, tokenDelayMs: 10, chunks: ["[[BRIEFING]]Entendi.\n1. Qual o prazo?"] });
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  const blocked = await blockExternal(page);
  await page.goto("./");
  await submit(page, marker);
  await activate(page);
  await expect(page.getByText("Qual o prazo?")).toBeVisible();
  const payload = requests.map((request) => `${request.url()}\n${request.postData() ?? ""}`).join("\n");
  expect(payload).not.toContain(marker);
  expect(payload).not.toContain(encodeURIComponent(marker));
  expect(blocked).toEqual([]);
});
