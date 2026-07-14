import type { FormValues, PromptDefinition } from "../domain";
import { EngineStateStore } from "./state-store";
import {
  PlannerEngineError,
  type PlannerEngine,
  type PlannerEngineSnapshot,
  type PlannerGenerationOptions,
  type PlannerGenerationResult,
} from "./types";

const READY_SNAPSHOT: PlannerEngineSnapshot = {
  status: "ready",
  progress: null,
  error: null,
};

/** Deterministic, offline fallback that never initializes or downloads a model. */
export class BasicPlannerEngine implements PlannerEngine {
  readonly mode = "basic" as const;
  private readonly state = new EngineStateStore(READY_SNAPSHOT);
  private cancelled = false;

  getSnapshot = this.state.getSnapshot;
  subscribe = this.state.subscribe;

  initialize(): Promise<void> {
    this.state.update(READY_SNAPSHOT);
    return Promise.resolve();
  }

  generate(
    definition: PromptDefinition,
    values: FormValues,
    options: PlannerGenerationOptions = {},
  ): Promise<PlannerGenerationResult> {
    if (options.signal?.aborted) {
      return Promise.reject(
        new PlannerEngineError({
          code: "cancelled",
          message: "A geração foi cancelada.",
          recoverable: true,
        }),
      );
    }

    this.cancelled = false;
    this.state.update({ status: "generating", progress: null, error: null });

    const text = definition.createFallback(values);
    const cancelled = this.cancelled || Boolean(options.signal?.aborted);

    if (!cancelled) {
      options.onToken?.(text, text);
    }

    this.state.update(READY_SNAPSHOT);
    return Promise.resolve({ text: cancelled ? "" : text, mode: this.mode, cancelled });
  }

  cancel(): Promise<void> {
    this.cancelled = true;
    if (this.state.getSnapshot().status === "generating") {
      this.state.update(READY_SNAPSHOT);
    }
    return Promise.resolve();
  }

  hasModelInCache(): Promise<boolean> {
    return Promise.resolve(false);
  }

  clearModelCache(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    return this.cancel();
  }
}

export function createBasicPlannerEngine(): BasicPlannerEngine {
  return new BasicPlannerEngine();
}
