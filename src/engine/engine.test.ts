import type { AppConfig, InitProgressReport } from "@mlc-ai/web-llm";
import { describe, expect, it, vi } from "vitest";
import type { FormValues, PromptDefinition } from "../domain";
import {
  BasicPlannerEngine,
  WEBLLM_CONTEXT_WINDOW_SIZE,
  WEBLLM_MODEL_ID,
  WebLLMPlannerEngine,
  createWebLLMAppConfig,
  detectWebGPUSupport,
  splitTextByUtf8Budget,
  type WebLLMRuntime,
} from ".";

const values: FormValues = { task: "Responder o e-mail" };
const definition = {
  generation: { temperature: 0.2, maxTokens: 80 },
  buildPrompt: vi.fn(() => "PROMPT DO CARD"),
  createFallback: vi.fn(() => "Abra a caixa de entrada."),
} as unknown as PromptDefinition;

function asyncChunks(...parts: string[]): AsyncIterable<{
  choices: Array<{ delta: { content: string } }>;
}> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) {
        yield { choices: [{ delta: { content: part } }] };
      }
    },
  };
}

function mockRuntime() {
  const engine = {
    resetChat: vi.fn().mockResolvedValue(undefined),
    interruptGenerate: vi.fn(),
    unload: vi.fn().mockResolvedValue(undefined),
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(asyncChunks("Primeiro ", "passo")),
      },
    },
  };
  const runtime = {
    prebuiltAppConfig: {
      model_list: [
        {
          model_id: WEBLLM_MODEL_ID,
          model: "https://example.test/model",
          model_lib: "https://example.test/model.wasm",
          overrides: { context_window_size: 4_096 },
        },
      ],
    },
    hasModelInCache: vi.fn().mockResolvedValue(false),
    deleteModelAllInfoInCache: vi.fn().mockResolvedValue(undefined),
    CreateWebWorkerMLCEngine: vi.fn().mockResolvedValue(engine),
  };

  return { engine, runtime };
}

function brainDumpDefinition() {
  return {
    ...definition,
    id: "brain-dump",
    buildPrompt: vi.fn((input: FormValues) => `PLANO FINAL\n${input.brainDump}`),
    createFallback: vi.fn(() => "Plano básico organizado."),
  } as unknown as PromptDefinition;
}

describe("BasicPlannerEngine", () => {
  it("returns the prompt-specific deterministic fallback", async () => {
    const engine = new BasicPlannerEngine();
    const streamed = vi.fn();

    const result = await engine.generate(definition, values, { onToken: streamed });

    expect(definition.createFallback).toHaveBeenCalledWith(values);
    expect(result).toEqual({
      text: "Abra a caixa de entrada.",
      mode: "basic",
      cancelled: false,
    });
    expect(streamed).toHaveBeenCalledWith(
      "Abra a caixa de entrada.",
      "Abra a caixa de entrada.",
    );
    expect(engine.getSnapshot().status).toBe("ready");
  });
});

describe("WebLLMPlannerEngine", () => {
  it("loads lazily with Cache API and a 2048-token context", async () => {
    const { runtime } = mockRuntime();
    const terminate = vi.fn();
    const engine = new WebLLMPlannerEngine({
      detectSupport: vi.fn().mockResolvedValue(true),
      loadRuntime: vi.fn().mockResolvedValue(runtime as unknown as WebLLMRuntime),
      createWorker: () => ({ terminate } as unknown as Worker),
    });
    const states: string[] = [];
    engine.subscribe((snapshot) => states.push(snapshot.status));

    await engine.initialize();

    const config = runtime.CreateWebWorkerMLCEngine.mock.calls[0]?.[2] as {
      appConfig: AppConfig;
      initProgressCallback: (report: InitProgressReport) => void;
    };
    expect(config.appConfig.cacheBackend).toBe("cache");
    expect(config.appConfig.model_list[0]?.overrides?.context_window_size).toBe(2_048);
    expect(runtime.CreateWebWorkerMLCEngine).toHaveBeenCalledWith(
      expect.anything(),
      WEBLLM_MODEL_ID,
      expect.anything(),
      { context_window_size: WEBLLM_CONTEXT_WINDOW_SIZE },
    );
    expect(states).toEqual(expect.arrayContaining(["downloading", "ready"]));
  });

  it("streams accumulated text and keeps generations independent", async () => {
    const { engine: webEngine, runtime } = mockRuntime();
    const planner = new WebLLMPlannerEngine({
      detectSupport: vi.fn().mockResolvedValue(true),
      loadRuntime: vi.fn().mockResolvedValue(runtime as unknown as WebLLMRuntime),
      createWorker: () => ({ terminate: vi.fn() } as unknown as Worker),
    });
    const streamed = vi.fn();
    await planner.initialize();

    const result = await planner.generate(definition, values, { onToken: streamed });

    expect(result).toEqual({ text: "Primeiro passo", mode: "ai", cancelled: false });
    expect(webEngine.resetChat).toHaveBeenCalledOnce();
    expect(streamed).toHaveBeenNthCalledWith(1, "Primeiro ", "Primeiro ");
    expect(streamed).toHaveBeenNthCalledWith(2, "passo", "Primeiro passo");
  });

  it("appends the time window calculated by the application", async () => {
    const { runtime } = mockRuntime();
    const planner = new WebLLMPlannerEngine({
      detectSupport: vi.fn().mockResolvedValue(true),
      loadRuntime: vi.fn().mockResolvedValue(runtime as unknown as WebLLMRuntime),
      createWorker: () => ({ terminate: vi.fn() } as unknown as Worker),
    });
    const timeDefinition = {
      ...definition,
      id: "time",
    } as PromptDefinition;
    await planner.initialize();

    const result = await planner.generate(timeDefinition, {
      project: "Relatório",
      optimisticMinutes: "20",
      typicalMinutes: "120",
    });

    expect(result.text).toContain("Janela segura calculada pelo PomoLife");
    expect(result.text).toContain("150 min");
  });

  it("interrupts an active generation", async () => {
    let release!: () => void;
    const waitingStream = {
      async *[Symbol.asyncIterator]() {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield { choices: [] };
      },
    };
    const { engine: webEngine, runtime } = mockRuntime();
    webEngine.chat.completions.create.mockResolvedValue(waitingStream);
    const planner = new WebLLMPlannerEngine({
      detectSupport: vi.fn().mockResolvedValue(true),
      loadRuntime: vi.fn().mockResolvedValue(runtime as unknown as WebLLMRuntime),
      createWorker: () => ({ terminate: vi.fn() } as unknown as Worker),
    });
    await planner.initialize();
    const generation = planner.generate(definition, values);
    await vi.waitFor(() => expect(planner.getSnapshot().status).toBe("generating"));

    await planner.cancel();
    release?.();
    const result = await generation;

    expect(webEngine.interruptGenerate).toHaveBeenCalledOnce();
    expect(result.cancelled).toBe(true);
    expect(planner.getSnapshot().status).toBe("ready");
  });

  it("detects unsupported WebGPU without importing or creating the model", async () => {
    const loadRuntime = vi.fn();
    const planner = new WebLLMPlannerEngine({
      detectSupport: vi.fn().mockResolvedValue(false),
      loadRuntime,
      createWorker: vi.fn(),
    });

    await expect(planner.initialize()).rejects.toMatchObject({
      issue: { code: "unsupported" },
    });
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(planner.getSnapshot().status).toBe("unsupported");
  });

  it("checks and clears all cached model artifacts", async () => {
    const { runtime } = mockRuntime();
    runtime.hasModelInCache.mockResolvedValue(true);
    const planner = new WebLLMPlannerEngine({
      loadRuntime: vi.fn().mockResolvedValue(runtime as unknown as WebLLMRuntime),
    });

    await expect(planner.hasModelInCache()).resolves.toBe(true);
    await planner.clearModelCache();

    expect(runtime.deleteModelAllInfoInCache).toHaveBeenCalledWith(
      WEBLLM_MODEL_ID,
      expect.objectContaining({ cacheBackend: "cache" }),
    );
  });

  it("compacts every long brain-dump chunk before one final streamed generation", async () => {
    const rawBrainDump = "Pendência importante com prazo e responsável.\n".repeat(220);
    const chunks = splitTextByUtf8Budget(rawBrainDump);
    expect(chunks.length).toBeGreaterThan(1);

    const { engine: webEngine, runtime } = mockRuntime();
    let summaryIndex = 0;
    webEngine.chat.completions.create.mockImplementation(async (request) => {
      if (request.stream === false) {
        summaryIndex += 1;
        return {
          choices: [{ message: { content: `resumo preservado ${summaryIndex}` } }],
        };
      }
      return asyncChunks("Agora: ", "comece.");
    });
    const planner = new WebLLMPlannerEngine({
      detectSupport: vi.fn().mockResolvedValue(true),
      loadRuntime: vi.fn().mockResolvedValue(runtime as unknown as WebLLMRuntime),
      createWorker: () => ({ terminate: vi.fn() } as unknown as Worker),
    });
    const brainDefinition = brainDumpDefinition();
    const onToken = vi.fn();
    await planner.initialize();

    const result = await planner.generate(
      brainDefinition,
      { brainDump: rawBrainDump },
      { onToken },
    );

    expect(result).toEqual({ text: "Agora: comece.", mode: "ai", cancelled: false });
    expect(webEngine.chat.completions.create).toHaveBeenCalledTimes(chunks.length + 1);
    expect(webEngine.resetChat).toHaveBeenCalledTimes(chunks.length + 1);
    for (let index = 0; index < chunks.length; index += 1) {
      expect(webEngine.chat.completions.create.mock.calls[index]?.[0]).toMatchObject({
        stream: false,
        temperature: 0.1,
        max_tokens: 120,
      });
    }
    expect(webEngine.chat.completions.create.mock.calls.at(-1)?.[0]).toMatchObject({
      stream: true,
    });
    expect(brainDefinition.buildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        brainDump: expect.stringContaining("Parte 1:\nresumo preservado 1"),
      }),
    );
    expect(onToken).toHaveBeenLastCalledWith("comece.", "Agora: comece.");
  });

  it("returns a cancelled result when cancellation happens during compaction", async () => {
    const rawBrainDump = "Uma pendência longa para compactar.\n".repeat(220);
    const { engine: webEngine, runtime } = mockRuntime();
    webEngine.chat.completions.create.mockImplementation(
      () => new Promise(() => undefined),
    );
    const planner = new WebLLMPlannerEngine({
      detectSupport: vi.fn().mockResolvedValue(true),
      loadRuntime: vi.fn().mockResolvedValue(runtime as unknown as WebLLMRuntime),
      createWorker: () => ({ terminate: vi.fn() } as unknown as Worker),
    });
    const brainDefinition = brainDumpDefinition();
    await planner.initialize();

    const generation = planner.generate(brainDefinition, { brainDump: rawBrainDump });
    await vi.waitFor(() => {
      expect(webEngine.chat.completions.create).toHaveBeenCalledOnce();
    });
    await planner.cancel();

    await expect(generation).resolves.toEqual({ text: "", mode: "ai", cancelled: true });
    expect(webEngine.interruptGenerate).toHaveBeenCalledOnce();
    expect(brainDefinition.createFallback).not.toHaveBeenCalled();
    expect(planner.getSnapshot().status).toBe("ready");
  });

  it.each(["context overflow", "empty summary"])(
    "uses the basic brain-dump plan after %s",
    async (failure) => {
      const rawBrainDump = "Pendência que excede o envio direto.\n".repeat(220);
      const { engine: webEngine, runtime } = mockRuntime();
      if (failure === "context overflow") {
        const overflow = new Error("context window exceeded");
        overflow.name = "ContextWindowSizeExceededError";
        webEngine.chat.completions.create.mockRejectedValue(overflow);
      } else {
        webEngine.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: "   " } }],
        });
      }
      const planner = new WebLLMPlannerEngine({
        detectSupport: vi.fn().mockResolvedValue(true),
        loadRuntime: vi.fn().mockResolvedValue(runtime as unknown as WebLLMRuntime),
        createWorker: () => ({ terminate: vi.fn() } as unknown as Worker),
      });
      const brainDefinition = brainDumpDefinition();
      const onToken = vi.fn();
      await planner.initialize();

      const result = await planner.generate(
        brainDefinition,
        { brainDump: rawBrainDump },
        { onToken },
      );

      expect(result).toEqual({
        text: "Plano básico organizado.",
        mode: "basic",
        cancelled: false,
      });
      expect(brainDefinition.createFallback).toHaveBeenCalledOnce();
      expect(onToken).toHaveBeenCalledWith(
        "Plano básico organizado.",
        "Plano básico organizado.",
      );
      expect(planner.getSnapshot().status).toBe("ready");
    },
  );

  it("cancels an initialization whose model creation has not resolved", async () => {
    const { runtime } = mockRuntime();
    runtime.CreateWebWorkerMLCEngine.mockImplementation(
      () => new Promise(() => undefined),
    );
    const terminate = vi.fn();
    const planner = new WebLLMPlannerEngine({
      detectSupport: vi.fn().mockResolvedValue(true),
      loadRuntime: vi.fn().mockResolvedValue(runtime as unknown as WebLLMRuntime),
      createWorker: () => ({ terminate } as unknown as Worker),
    });

    const initialization = planner.initialize();
    const rejectedInitialization = expect(initialization).rejects.toMatchObject({
      issue: { code: "cancelled" },
    });
    await vi.waitFor(() => {
      expect(planner.getSnapshot().status).toMatch(/downloading|loading/);
    });

    await planner.cancel();
    await rejectedInitialization;

    expect(terminate).toHaveBeenCalledOnce();
    expect(planner.getSnapshot().status).not.toMatch(/downloading|loading/);
  });

  it("unloads the model and terminates its worker after a generation error", async () => {
    const { engine: webEngine, runtime } = mockRuntime();
    webEngine.chat.completions.create.mockRejectedValue(new Error("falha inesperada"));
    const terminate = vi.fn();
    const planner = new WebLLMPlannerEngine({
      detectSupport: vi.fn().mockResolvedValue(true),
      loadRuntime: vi.fn().mockResolvedValue(runtime as unknown as WebLLMRuntime),
      createWorker: () => ({ terminate } as unknown as Worker),
    });
    await planner.initialize();

    await expect(planner.generate(definition, values)).rejects.toMatchObject({
      issue: { code: "generation-failed" },
    });

    expect(webEngine.unload).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
    expect(planner.getSnapshot()).toMatchObject({
      status: "error",
      error: { code: "generation-failed" },
    });
  });
});

describe("splitTextByUtf8Budget", () => {
  it("preserves every character in order while respecting the UTF-8 byte budget", () => {
    const source = "ação🙂\n第二 linha\nabcá🙂fim";
    const budget = 9;

    const chunks = splitTextByUtf8Budget(source, budget);

    expect(chunks.join("")).toBe(source);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).byteLength).toBeLessThanOrEqual(budget);
    }
  });
});

describe("WebGPU and model configuration", () => {
  it("requires an adapter", async () => {
    await expect(
      detectWebGPUSupport({ requestAdapter: vi.fn().mockResolvedValue(null) }),
    ).resolves.toBe(false);
    await expect(
      detectWebGPUSupport({ requestAdapter: vi.fn().mockResolvedValue({}) }),
    ).resolves.toBe(true);
  });

  it("does not mutate the prebuilt model record", () => {
    const { runtime } = mockRuntime();
    const config = createWebLLMAppConfig(runtime as unknown as WebLLMRuntime);

    expect(config.model_list[0]?.overrides?.context_window_size).toBe(2_048);
    expect(runtime.prebuiltAppConfig.model_list[0]?.overrides?.context_window_size).toBe(4_096);
  });
});
