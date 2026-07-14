const MODEL_IDS = [
  "Qwen3-0.6B-q4f16_1-MLC",
  "Qwen3.5-0.8B-q4f16_1-MLC",
  "Qwen3-1.7B-q4f16_1-MLC",
  "Qwen3-4B-q4f16_1-MLC",
];

export interface MockWebLLMScenario {
  cached?: boolean;
  initError?: "worker" | "memory";
  initDelayMs?: number;
  tokenDelayMs?: number;
  chunks?: string[];
}

export interface MockWebLLMEvent {
  type: string;
  detail?: Record<string, unknown>;
}

declare global {
  var __POMOLIFE_WEBLLM_SCENARIO__: MockWebLLMScenario | undefined;
  var __POMOLIFE_WEBLLM_EVENTS__: MockWebLLMEvent[] | undefined;
  var __POMOLIFE_WEBLLM_MOCK_ACTIVE__: boolean | undefined;
}

globalThis.__POMOLIFE_WEBLLM_MOCK_ACTIVE__ = true;

function scenario(): MockWebLLMScenario {
  return globalThis.__POMOLIFE_WEBLLM_SCENARIO__ ?? {};
}

function record(type: string, detail?: Record<string, unknown>): void {
  const events = (globalThis.__POMOLIFE_WEBLLM_EVENTS__ ??= []);
  events.push({ type, detail });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export const prebuiltAppConfig = {
  model_list: MODEL_IDS.map((modelId) => ({
      model: `https://huggingface.co/mlc-ai/${modelId}`,
      model_id: modelId,
      model_lib: "mock://qwen-model-lib.wasm",
      overrides: { context_window_size: 4_096 },
    })),
};

export async function hasModelInCache(modelId: string): Promise<boolean> {
  const cached = Boolean(scenario().cached);
  record("has-model-in-cache", { modelId, cached });
  return cached;
}

export async function deleteModelAllInfoInCache(modelId: string): Promise<void> {
  record("delete-model-cache", { modelId });
  globalThis.__POMOLIFE_WEBLLM_SCENARIO__ = {
    ...scenario(),
    cached: false,
  };
}

interface MockProgressOptions {
  initProgressCallback?: (report: {
    progress: number;
    text: string;
    timeElapsed: number;
  }) => void;
}

interface MockCompletionChunk {
  choices: Array<{ delta: { content: string } }>;
}

class MockEngine {
  private interrupted = false;

  readonly chat = {
    completions: {
      create: async (request: { messages?: unknown[]; stream?: boolean }) => {
        this.interrupted = false;
        record("generate", {
          messageCount: request.messages?.length ?? 0,
          stream: request.stream !== false,
        });

        if (request.stream === false) {
          const current = scenario();
          await delay(current.tokenDelayMs ?? 40);
          const content = (current.chunks ?? [
            "[[PLANO]]## Entendimento\n\nTarefa compreendida.\n",
            "## Primeiro movimento · menos de 1 min\nAbra o arquivo principal.\n",
            "## Checklist\n- [ ] Abrir o material · 2 min\n",
            "## Tempo e foco\nUse **25/5**.\n\n## Pronto quando\nA entrega estiver revisada.",
          ]).join("");
          record("completion", { content });
          return {
            choices: [{ finish_reason: "stop", message: { content, role: "assistant" } }],
            usage: { completion_tokens: 32, prompt_tokens: 64, total_tokens: 96 },
          };
        }

        return this.streamChunks();
      },
    },
  };

  async resetChat(): Promise<void> {
    record("reset-chat");
  }

  interruptGenerate(): void {
    this.interrupted = true;
    record("interrupt-generation");
  }

  async unload(): Promise<void> {
    record("unload");
  }

  private async *streamChunks(): AsyncGenerator<MockCompletionChunk> {
    const current = scenario();
    const chunks = current.chunks ?? [
      "[[PLANO]]## Entendimento\n\nTarefa compreendida.\n",
      "## Primeiro movimento · menos de 1 min\nAbra o arquivo principal.\n",
      "## Checklist\n- [ ] Abrir o material · 2 min\n",
      "## Tempo e foco\nUse **25/5**.\n\n## Pronto quando\nA entrega estiver revisada.",
    ];
    const tokenDelayMs = current.tokenDelayMs ?? 40;

    for (const content of chunks) {
      await delay(tokenDelayMs);
      if (this.interrupted) return;
      record("token", { content });
      yield { choices: [{ delta: { content } }] };
    }
  }
}

export async function CreateWebWorkerMLCEngine(
  worker: Worker,
  modelId: string,
  options: MockProgressOptions = {},
): Promise<MockEngine> {
  const current = scenario();
  const cached = Boolean(current.cached);
  const initDelayMs = current.initDelayMs ?? 120;
  record("create-engine", { modelId, cached });

  options.initProgressCallback?.({
    progress: cached ? 0.25 : 0.08,
    text: cached ? "Loading model from cache" : "Downloading model weights",
    timeElapsed: 0.05,
  });
  await delay(Math.max(1, Math.floor(initDelayMs / 2)));

  if (current.initError === "worker") {
    worker.terminate();
    record("init-error", { kind: "worker" });
    throw new Error("Worker became unavailable during initialization");
  }
  if (current.initError === "memory") {
    worker.terminate();
    record("init-error", { kind: "memory" });
    throw new Error("Out of memory while allocating GPU buffer");
  }

  options.initProgressCallback?.({
    progress: 0.7,
    text: cached ? "Loading model from cache" : "Downloading model weights",
    timeElapsed: initDelayMs / 2_000,
  });
  await delay(Math.max(1, Math.ceil(initDelayMs / 2)));
  options.initProgressCallback?.({
    progress: 1,
    text: "Initializing GPU shaders",
    timeElapsed: initDelayMs / 1_000,
  });
  record("engine-ready", { modelId });

  return new MockEngine();
}

export class WebWorkerMLCEngineHandler {
  onmessage(event: MessageEvent): void {
    void event;
    // The main-thread mock owns the fake lifecycle; the worker only needs this API shape.
  }
}
