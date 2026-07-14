import type { PlannerEngineIssue, PlannerEngineSnapshot } from "../engine";

export type AgentMode = "ai" | "basic";
export type AgentRole = "user" | "assistant";
export type AgentStage = "briefing" | "plan" | "message";

export interface ChatMessage {
  id: string;
  role: AgentRole;
  content: string;
  createdAt: string;
  mode?: AgentMode;
  stage?: AgentStage;
}

export interface ChecklistItem {
  id: string;
  messageId: string;
  text: string;
  phase: string;
  completed: boolean;
  estimateMinutes?: number;
}

export interface PomodoroPreset {
  focusMinutes: 15 | 25 | 45;
  breakMinutes: 5 | 10;
}

export interface PlanArtifact {
  firstStep: string;
  checklist: ChecklistItem[];
  pomodoro: PomodoroPreset;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  checklist: ChecklistItem[];
  activeContext: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDefinition {
  id: string;
  title: string;
  triggers: readonly string[];
  instruction: string;
}

export interface AgentRequest {
  messages: readonly ChatMessage[];
  checklist: readonly ChecklistItem[];
}

export interface AgentGenerationOptions {
  signal?: AbortSignal;
  onToken?: (delta: string, complete: string) => void;
}

export interface AgentGenerationResult {
  text: string;
  mode: AgentMode;
  cancelled: boolean;
}

export interface AgentEngine {
  readonly mode: AgentMode;
  getSnapshot(): PlannerEngineSnapshot;
  subscribe(listener: (snapshot: PlannerEngineSnapshot) => void): () => void;
  initialize(): Promise<void>;
  sendMessage(request: AgentRequest, options?: AgentGenerationOptions): Promise<AgentGenerationResult>;
  cancel(): Promise<void>;
  hasModelInCache(): Promise<boolean>;
  clearModelCache(): Promise<void>;
  dispose(): Promise<void>;
}

export type AgentIssue = PlannerEngineIssue;

