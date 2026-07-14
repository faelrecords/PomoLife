import type { AgentMode, ChatAttachment, ChatMessage, ChatSession, ChecklistItem } from "../agent";
import type { PlanRecord } from "../domain";
import { createId, createIsoNow } from "./ids";
import { isPomodoroSession, type PomodoroSession } from "./pomodoro";
import { DEFAULT_YOUTUBE_URL, LEGACY_DEFAULT_YOUTUBE_URL } from "./youtube";
import { DEFAULT_LOCAL_MODEL_ID, isLocalModelId, type LocalModelId } from "./modelCatalog";
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_CHARACTERS, MAX_CHAT_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_CHARACTERS } from "./chatAttachments";

export const AGENT_STORAGE_KEY = "pomolife:agent-state";
export const LEGACY_STORAGE_KEY = "pomolife:state";
export const AGENT_STORAGE_VERSION = 2;
export const MAX_SESSIONS = 20;
export const MAX_MESSAGES = 50;

export type PreferredMode = "ask" | AgentMode;

export interface AgentPreferences {
  preferredMode: PreferredMode;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  youtubeUrl: string;
  youtubeVolume: number;
  selectedModelId: LocalModelId;
}

export interface AgentPersistedState {
  version: typeof AGENT_STORAGE_VERSION;
  sessions: ChatSession[];
  activeSessionId: string | null;
  legacyPlans: PlanRecord[];
  preferences: AgentPreferences;
  pomodoro: PomodoroSession | null;
}

export const DEFAULT_AGENT_PREFERENCES: AgentPreferences = {
  preferredMode: "ask",
  notificationsEnabled: false,
  soundEnabled: false,
  youtubeUrl: DEFAULT_YOUTUBE_URL,
  youtubeVolume: 35,
  selectedModelId: DEFAULT_LOCAL_MODEL_ID,
};

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function legacyPlansFrom(storageValue: Storage | null): PlanRecord[] {
  if (!storageValue) return [];
  try {
    const parsed = JSON.parse(storageValue.getItem(LEGACY_STORAGE_KEY) ?? "null") as unknown;
    if (!isObject(parsed) || !Array.isArray(parsed.plans)) return [];
    return parsed.plans.filter((plan): plan is PlanRecord => isObject(plan)
      && typeof plan.id === "string"
      && typeof plan.promptId === "string"
      && typeof plan.promptTitle === "string"
      && typeof plan.result === "string"
      && (plan.mode === "ai" || plan.mode === "basic")
      && typeof plan.createdAt === "string") as PlanRecord[];
  } catch { return []; }
}

function emptyState(storageValue = storage()): AgentPersistedState {
  return {
    version: AGENT_STORAGE_VERSION,
    sessions: [],
    activeSessionId: null,
    legacyPlans: legacyPlansFrom(storageValue),
    preferences: { ...DEFAULT_AGENT_PREFERENCES },
    pomodoro: null,
  };
}

function sanitizeAttachment(value: unknown, characterLimit = MAX_ATTACHMENT_CHARACTERS): ChatAttachment | null {
  if (!isObject(value)
    || typeof value.id !== "string"
    || typeof value.name !== "string"
    || typeof value.mimeType !== "string"
    || typeof value.size !== "number"
    || typeof value.text !== "string") return null;
  const textLimit = Math.max(0, Math.min(MAX_ATTACHMENT_CHARACTERS, characterLimit));
  return {
    id: value.id,
    name: value.name.slice(0, 180),
    mimeType: value.mimeType.slice(0, 100),
    size: Math.max(0, Math.min(MAX_ATTACHMENT_BYTES, value.size)),
    text: value.text.slice(0, textLimit),
    truncated: value.truncated === true || value.text.length > textLimit,
  };
}

function sanitizeAttachments(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: ChatAttachment[] = [];
  let remainingCharacters = MAX_TOTAL_ATTACHMENT_CHARACTERS;
  for (const candidate of value.slice(0, MAX_CHAT_ATTACHMENTS)) {
    if (remainingCharacters <= 0) break;
    const attachment = sanitizeAttachment(candidate, remainingCharacters);
    if (!attachment) continue;
    result.push(attachment);
    remainingCharacters -= attachment.text.length;
  }
  return result.length ? result : undefined;
}

function sanitizeMessage(value: unknown): ChatMessage | null {
  if (!isObject(value) || typeof value.id !== "string" || (value.role !== "user" && value.role !== "assistant") || typeof value.content !== "string" || typeof value.createdAt !== "string") return null;
  return {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
    mode: value.mode === "ai" || value.mode === "basic" ? value.mode : undefined,
    stage: value.stage === "briefing" || value.stage === "plan" || value.stage === "message" ? value.stage : undefined,
    attachments: sanitizeAttachments(value.attachments),
  };
}

function sanitizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChecklistItem => isObject(item)
    && typeof item.id === "string"
    && typeof item.messageId === "string"
    && typeof item.text === "string"
    && typeof item.phase === "string"
    && typeof item.completed === "boolean")
    .map((item) => ({ ...item, estimateMinutes: typeof item.estimateMinutes === "number" ? item.estimateMinutes : undefined }));
}

function sanitizeSession(value: unknown): ChatSession | null {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.title !== "string" || !Array.isArray(value.messages) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;
  return {
    id: value.id,
    title: value.title.slice(0, 80),
    messages: value.messages.map(sanitizeMessage).filter((message): message is ChatMessage => Boolean(message)).slice(-MAX_MESSAGES),
    checklist: sanitizeChecklist(value.checklist),
    activeContext: typeof value.activeContext === "string" ? value.activeContext.slice(0, 2_000) : "",
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function loadAgentState(storageValue = storage()): AgentPersistedState {
  const fallback = emptyState(storageValue);
  if (!storageValue) return fallback;
  try {
    const parsed = JSON.parse(storageValue.getItem(AGENT_STORAGE_KEY) ?? "null") as unknown;
    if (!isObject(parsed) || parsed.version !== AGENT_STORAGE_VERSION) return fallback;
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(sanitizeSession).filter((session): session is ChatSession => Boolean(session)).slice(0, MAX_SESSIONS)
      : [];
    const preferences = isObject(parsed.preferences) ? parsed.preferences : {};
    return {
      version: AGENT_STORAGE_VERSION,
      sessions,
      activeSessionId: typeof parsed.activeSessionId === "string" && sessions.some((session) => session.id === parsed.activeSessionId) ? parsed.activeSessionId : sessions[0]?.id ?? null,
      legacyPlans: Array.isArray(parsed.legacyPlans) ? parsed.legacyPlans as PlanRecord[] : fallback.legacyPlans,
      preferences: {
        preferredMode: preferences.preferredMode === "ai" || preferences.preferredMode === "basic" ? preferences.preferredMode : "ask",
        notificationsEnabled: preferences.notificationsEnabled === true,
        soundEnabled: preferences.soundEnabled === true,
        youtubeUrl: typeof preferences.youtubeUrl === "string" && preferences.youtubeUrl !== LEGACY_DEFAULT_YOUTUBE_URL
          ? preferences.youtubeUrl
          : DEFAULT_YOUTUBE_URL,
        youtubeVolume: typeof preferences.youtubeVolume === "number" ? Math.max(0, Math.min(100, preferences.youtubeVolume)) : 35,
        selectedModelId: isLocalModelId(preferences.selectedModelId) ? preferences.selectedModelId : DEFAULT_LOCAL_MODEL_ID,
      },
      pomodoro: isPomodoroSession(parsed.pomodoro) ? parsed.pomodoro : null,
    };
  } catch { return fallback; }
}

export function saveAgentState(state: AgentPersistedState, storageValue = storage()): void {
  if (!storageValue) return;
  storageValue.setItem(AGENT_STORAGE_KEY, JSON.stringify({
    ...state,
    version: AGENT_STORAGE_VERSION,
    sessions: state.sessions.slice(0, MAX_SESSIONS).map((session) => ({ ...session, messages: session.messages.slice(-MAX_MESSAGES) })),
  }));
}

export function createChatSession(now = createIsoNow()): ChatSession {
  return { id: createId("chat"), title: "Nova conversa", messages: [], checklist: [], activeContext: "", createdAt: now, updatedAt: now };
}

export function sessionTitleFrom(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact || "Nova conversa";
}

export function clearAgentData(storageValue = storage()): void {
  storageValue?.removeItem(AGENT_STORAGE_KEY);
  storageValue?.removeItem(LEGACY_STORAGE_KEY);
}
