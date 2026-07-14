import type { FormValues, PromptDefinition } from "../domain";
import { createWebLLMPlannerEngine, type PlannerEngine } from "../engine";
import { buildAgentPrompt, determineTurnMode, type AgentTurnMode } from "./context";
import type { LocalModelId } from "../lib/modelCatalog";
import type { AgentEngine, AgentGenerationOptions, AgentRequest } from "./types";

const TOKEN_BUDGET_BY_MODE: Record<AgentTurnMode, number> = {
  general: 220,
  productivity: 240,
  briefing: 140,
  plan: 340,
  clarify: 100,
};

export function getAgentTokenBudget(mode: AgentTurnMode): number {
  return TOKEN_BUDGET_BY_MODE[mode];
}

function coordinatorDefinition(prompt: string, mode: AgentTurnMode): PromptDefinition {
  return {
    id: "paralysis",
    number: "01",
    slug: "assistente",
    title: "Assistente PomoLife",
    description: "",
    fields: [],
    generation: { temperature: 0.1, maxTokens: getAgentTokenBudget(mode) },
    validate: () => ({}),
    buildPrompt: () => prompt,
    createFallback: () => "",
  } as PromptDefinition;
}

export class WebLLMAgentEngine implements AgentEngine {
  readonly mode = "ai" as const;
  private readonly delegate: PlannerEngine;
  readonly getSnapshot: AgentEngine["getSnapshot"];
  readonly subscribe: AgentEngine["subscribe"];
  constructor(delegate: PlannerEngine = createWebLLMPlannerEngine()) {
    this.delegate = delegate;
    this.getSnapshot = () => this.delegate.getSnapshot();
    this.subscribe = (listener) => this.delegate.subscribe(listener);
  }
  initialize() { return this.delegate.initialize(); }
  cancel() { return this.delegate.cancel(); }
  hasModelInCache() { return this.delegate.hasModelInCache(); }
  clearModelCache() { return this.delegate.clearModelCache(); }
  dispose() { return this.delegate.dispose(); }
  async sendMessage(request: AgentRequest, options: AgentGenerationOptions = {}) {
    const mode = determineTurnMode(request.messages);
    const prompt = buildAgentPrompt(request);
    return this.delegate.generate(coordinatorDefinition(prompt, mode), {} as FormValues, options);
  }
}

export function createWebLLMAgentEngine(modelId?: LocalModelId) {
  return new WebLLMAgentEngine(createWebLLMPlannerEngine({ modelId }));
}
