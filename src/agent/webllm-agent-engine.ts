import type { FormValues, PromptDefinition } from "../domain";
import { createWebLLMPlannerEngine, type PlannerEngine } from "../engine";
import { buildAgentPrompt } from "./context";
import type { LocalModelId } from "../lib/modelCatalog";
import type { AgentEngine, AgentGenerationOptions, AgentRequest } from "./types";

function coordinatorDefinition(prompt: string): PromptDefinition {
  return {
    id: "paralysis",
    number: "01",
    slug: "coordenador",
    title: "Coordenador PomoLife",
    description: "",
    fields: [],
    generation: { temperature: 0.12, maxTokens: 420 },
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
    const prompt = buildAgentPrompt(request);
    return this.delegate.generate(coordinatorDefinition(prompt), {} as FormValues, options);
  }
}

export function createWebLLMAgentEngine(modelId?: LocalModelId) {
  return new WebLLMAgentEngine(createWebLLMPlannerEngine({ modelId }));
}
