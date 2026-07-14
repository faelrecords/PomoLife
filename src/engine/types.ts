import type { FormValues, PromptDefinition } from "../domain";

export type PlannerEngineMode = "ai" | "basic";

export type PlannerEngineStatus =
  | "unsupported"
  | "idle"
  | "downloading"
  | "loading"
  | "ready"
  | "generating"
  | "error";

export type PlannerEngineErrorCode =
  | "unsupported"
  | "worker-unavailable"
  | "insufficient-memory"
  | "configuration"
  | "load-failed"
  | "generation-failed"
  | "cache-failed"
  | "cancelled"
  | "not-ready"
  | "busy";

export interface PlannerEngineIssue {
  code: PlannerEngineErrorCode;
  message: string;
  recoverable: boolean;
  details?: string;
}

export interface PlannerEngineProgress {
  /** Normalized value between 0 and 1. */
  value: number;
  message: string;
  elapsedSeconds: number;
  fromCache: boolean;
}

export interface PlannerEngineSnapshot {
  status: PlannerEngineStatus;
  progress: PlannerEngineProgress | null;
  error: PlannerEngineIssue | null;
}

export interface PlannerGenerationOptions {
  /** Called for every new piece of text and receives the complete text so far. */
  onToken?: (delta: string, accumulated: string) => void;
  signal?: AbortSignal;
}

export interface PlannerGenerationResult {
  text: string;
  mode: PlannerEngineMode;
  cancelled: boolean;
}

export type PlannerEngineListener = (snapshot: PlannerEngineSnapshot) => void;

export interface PlannerEngine {
  readonly mode: PlannerEngineMode;

  getSnapshot(): PlannerEngineSnapshot;
  subscribe(listener: PlannerEngineListener): () => void;
  initialize(): Promise<void>;
  generate(
    definition: PromptDefinition,
    values: FormValues,
    options?: PlannerGenerationOptions,
  ): Promise<PlannerGenerationResult>;
  cancel(): Promise<void>;
  hasModelInCache(): Promise<boolean>;
  clearModelCache(): Promise<void>;
  dispose(): Promise<void>;
}

export class PlannerEngineError extends Error {
  readonly issue: PlannerEngineIssue;

  constructor(issue: PlannerEngineIssue, options?: ErrorOptions) {
    super(issue.message, options);
    this.name = "PlannerEngineError";
    this.issue = issue;
  }
}
