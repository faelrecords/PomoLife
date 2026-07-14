import type { PlannerEngineIssue, PlannerEngineSnapshot } from "../engine";
import { getOnlineModel, type OnlineModelId } from "../lib/modelCatalog";
import { buildAgentPrompt, determineTurnMode } from "./context";
import { getAgentTokenBudget } from "./webllm-agent-engine";
import type { AgentEngine, AgentGenerationOptions, AgentGenerationResult, AgentRequest } from "./types";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const IDLE: PlannerEngineSnapshot = { status: "idle", progress: null, error: null };

interface GroqStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

function issue(message: string): PlannerEngineIssue {
  return { code: "generation-failed", message, recoverable: true };
}

export class GroqAgentEngine implements AgentEngine {
  readonly mode = "online" as const;
  private readonly apiKey: string;
  private readonly providerModelId: string;
  private snapshot = IDLE;
  private listeners = new Set<(snapshot: PlannerEngineSnapshot) => void>();
  private controller: AbortController | null = null;

  constructor(apiKey: string, modelId: OnlineModelId) {
    this.apiKey = apiKey.trim();
    this.providerModelId = getOnlineModel(modelId).providerModelId;
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: (snapshot: PlannerEngineSnapshot) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(snapshot: PlannerEngineSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener(snapshot));
  }

  async initialize() {
    if (!this.apiKey) {
      const error = issue("A chave da IA online não está configurada nesta publicação.");
      this.update({ status: "error", progress: null, error });
      throw new Error(error.message);
    }
    this.update({ status: "ready", progress: null, error: null });
  }

  async sendMessage(request: AgentRequest, options: AgentGenerationOptions = {}): Promise<AgentGenerationResult> {
    await this.initialize();
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    this.update({ status: "generating", progress: null, error: null });

    try {
      const mode = determineTurnMode(request.messages);
      const response = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.providerModelId,
          messages: [{ role: "user", content: buildAgentPrompt(request) }],
          stream: true,
          reasoning_effort: "none",
          temperature: 0.2,
          max_completion_tokens: getAgentTokenBudget(mode),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const friendly = response.status === 401
          ? "A chave da IA online foi recusada."
          : response.status === 429
            ? "O limite gratuito da IA online foi atingido. Tente novamente mais tarde."
            : `A IA online respondeu com erro ${response.status}.`;
        throw new Error(friendly);
      }
      if (!response.body) throw new Error("A IA online não iniciou a resposta.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let complete = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const payload = line.trim();
          if (!payload.startsWith("data:") || payload === "data: [DONE]") continue;
          try {
            const chunk = JSON.parse(payload.slice(5).trim()) as GroqStreamChunk;
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            if (!delta) continue;
            complete += delta;
            options.onToken?.(delta, complete);
          } catch {
            // Ignore incomplete provider metadata while preserving text chunks.
          }
        }
      }
      this.update({ status: "ready", progress: null, error: null });
      return { text: complete, mode: "online", cancelled: false };
    } catch (cause) {
      if (controller.signal.aborted) {
        this.update({ status: "ready", progress: null, error: null });
        return { text: "", mode: "online", cancelled: true };
      }
      const error = issue(cause instanceof Error ? cause.message : "A IA online não respondeu.");
      this.update({ status: "error", progress: null, error });
      throw new Error(error.message, { cause });
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (this.controller === controller) this.controller = null;
    }
  }

  async cancel() { this.controller?.abort(); }
  async hasModelInCache() { return Boolean(this.apiKey); }
  async clearModelCache() { return; }
  async dispose() { this.controller?.abort(); this.listeners.clear(); }
}

export function createGroqAgentEngine(apiKey: string, modelId: OnlineModelId) {
  return new GroqAgentEngine(apiKey, modelId);
}
