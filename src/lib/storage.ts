import {
  isFocusCheckpointMinute,
  isFocusSession,
  type FocusSession,
} from "./focusTimer";
import {
  PROMPT_IDS,
  type FormValues,
  type PlanMode,
  type PlanRecord,
  type PromptId,
} from "../domain/types";

export type { PlanMode, PlanRecord } from "../domain/types";

export const STORAGE_KEY = "pomolife:state";
export const STORAGE_VERSION = 1;
export const MAX_SAVED_PLANS = 20;

export type PreferredMode = "ask" | PlanMode;
export type DraftValue = string | number | boolean;
export type DraftValues = Record<string, DraftValue>;

export interface DraftRecord {
  cardId: string;
  values: DraftValues;
  updatedAt: string;
}

export type NewPlanRecord = Omit<PlanRecord, "id" | "createdAt"> &
  Partial<Pick<PlanRecord, "id" | "createdAt">>;

export interface SavePlanResult {
  record: PlanRecord;
  saved: boolean;
}

export interface UserPreferences {
  preferredMode: PreferredMode;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
}

export interface PersistedState {
  version: typeof STORAGE_VERSION;
  drafts: Record<string, DraftRecord>;
  plans: PlanRecord[];
  preferences: UserPreferences;
  focusSession: FocusSession | null;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  preferredMode: "ask",
  notificationsEnabled: false,
  soundEnabled: false,
};

function getDefaultState(): PersistedState {
  return {
    version: STORAGE_VERSION,
    drafts: {},
    plans: [],
    preferences: { ...DEFAULT_PREFERENCES },
    focusSession: null,
  };
}

function getDefaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function sanitizeDraftValues(value: unknown): DraftValues {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, DraftValue] => {
      const fieldValue = entry[1];
      return (
        typeof fieldValue === "string" ||
        typeof fieldValue === "boolean" ||
        (typeof fieldValue === "number" && Number.isFinite(fieldValue))
      );
    }),
  );
}

function sanitizeFormValues(value: unknown): FormValues {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function isPromptId(value: unknown): value is PromptId {
  return (
    typeof value === "string" &&
    PROMPT_IDS.includes(value as PromptId)
  );
}

function sanitizeDraft(value: unknown, fallbackCardId: string): DraftRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const cardId =
    typeof value.cardId === "string" && value.cardId.length > 0
      ? value.cardId
      : fallbackCardId;

  if (!cardId || !isIsoDate(value.updatedAt)) {
    return null;
  }

  return {
    cardId,
    values: sanitizeDraftValues(value.values),
    updatedAt: value.updatedAt,
  };
}

function sanitizePlan(value: unknown): PlanRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    !value.id ||
    !isPromptId(value.promptId) ||
    typeof value.promptTitle !== "string" ||
    !value.promptTitle ||
    typeof value.result !== "string" ||
    (value.mode !== "ai" && value.mode !== "basic") ||
    !isIsoDate(value.createdAt)
  ) {
    return null;
  }

  return {
    id: value.id,
    promptId: value.promptId,
    promptTitle: value.promptTitle,
    values: sanitizeFormValues(value.values),
    result: value.result,
    mode: value.mode,
    createdAt: value.createdAt,
  };
}

function sanitizePreferences(value: unknown): UserPreferences {
  if (!isRecord(value)) {
    return { ...DEFAULT_PREFERENCES };
  }

  const preferredMode =
    value.preferredMode === "ai" ||
    value.preferredMode === "basic" ||
    value.preferredMode === "ask"
      ? value.preferredMode
      : DEFAULT_PREFERENCES.preferredMode;

  return {
    preferredMode,
    notificationsEnabled:
      typeof value.notificationsEnabled === "boolean"
        ? value.notificationsEnabled
        : DEFAULT_PREFERENCES.notificationsEnabled,
    soundEnabled:
      typeof value.soundEnabled === "boolean"
        ? value.soundEnabled
        : DEFAULT_PREFERENCES.soundEnabled,
  };
}

function sanitizeFocusSession(value: unknown): FocusSession | null {
  if (!isFocusSession(value)) {
    return null;
  }

  return {
    ...value,
    acknowledgedCheckpoints: [
      ...new Set(value.acknowledgedCheckpoints.filter(isFocusCheckpointMinute)),
    ].sort((left, right) => left - right),
  };
}

function parseState(rawValue: string | null): PersistedState {
  if (!rawValue) {
    return getDefaultState();
  }

  try {
    const value: unknown = JSON.parse(rawValue);
    if (!isRecord(value) || value.version !== STORAGE_VERSION) {
      return getDefaultState();
    }

    const drafts: Record<string, DraftRecord> = {};
    if (isRecord(value.drafts)) {
      for (const [cardId, rawDraft] of Object.entries(value.drafts)) {
        const draft = sanitizeDraft(rawDraft, cardId);
        if (draft) {
          drafts[cardId] = draft;
        }
      }
    }

    const plans = Array.isArray(value.plans)
      ? value.plans
          .map(sanitizePlan)
          .filter((plan): plan is PlanRecord => plan !== null)
          .sort(
            (left, right) =>
              Date.parse(right.createdAt) - Date.parse(left.createdAt),
          )
          .slice(0, MAX_SAVED_PLANS)
      : [];

    return {
      version: STORAGE_VERSION,
      drafts,
      plans,
      preferences: sanitizePreferences(value.preferences),
      focusSession: sanitizeFocusSession(value.focusSession),
    };
  } catch {
    return getDefaultState();
  }
}

function readState(storage: Storage | null = getDefaultStorage()): PersistedState {
  if (!storage) {
    return getDefaultState();
  }

  try {
    return parseState(storage.getItem(STORAGE_KEY));
  } catch {
    return getDefaultState();
  }
}

function writeState(
  state: PersistedState,
  storage: Storage | null = getDefaultStorage(),
): boolean {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function createRecordId(now: number): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `plan-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getStorageSnapshot(
  storage: Storage | null = getDefaultStorage(),
): PersistedState {
  return readState(storage);
}

export function saveDraft(
  cardId: string,
  values: DraftValues,
  storage: Storage | null = getDefaultStorage(),
): DraftRecord {
  const state = readState(storage);
  const draft: DraftRecord = {
    cardId,
    values: sanitizeDraftValues(values),
    updatedAt: new Date().toISOString(),
  };
  state.drafts[cardId] = draft;
  writeState(state, storage);
  return draft;
}

export function getDraft(
  cardId: string,
  storage: Storage | null = getDefaultStorage(),
): DraftRecord | null {
  return readState(storage).drafts[cardId] ?? null;
}

export function getAllDrafts(
  storage: Storage | null = getDefaultStorage(),
): Record<string, DraftRecord> {
  return readState(storage).drafts;
}

export function removeDraft(
  cardId: string,
  storage: Storage | null = getDefaultStorage(),
): boolean {
  const state = readState(storage);
  delete state.drafts[cardId];
  return writeState(state, storage);
}

export function clearDrafts(
  storage: Storage | null = getDefaultStorage(),
): boolean {
  const state = readState(storage);
  state.drafts = {};
  return writeState(state, storage);
}

export function savePlanWithStatus(
  plan: NewPlanRecord,
  storage: Storage | null = getDefaultStorage(),
): SavePlanResult {
  const now = Date.now();
  const record: PlanRecord = {
    ...plan,
    id: plan.id ?? createRecordId(now),
    createdAt: plan.createdAt ?? new Date(now).toISOString(),
    values: sanitizeFormValues(plan.values),
  };
  const state = readState(storage);
  state.plans = [record, ...state.plans.filter(({ id }) => id !== record.id)]
    .sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )
    .slice(0, MAX_SAVED_PLANS);
  return { record, saved: writeState(state, storage) };
}

export function savePlan(
  plan: NewPlanRecord,
  storage: Storage | null = getDefaultStorage(),
): PlanRecord {
  return savePlanWithStatus(plan, storage).record;
}

export function getPlans(
  storage: Storage | null = getDefaultStorage(),
): PlanRecord[] {
  return readState(storage).plans;
}

export function removePlan(
  planId: string,
  storage: Storage | null = getDefaultStorage(),
): boolean {
  const state = readState(storage);
  state.plans = state.plans.filter(({ id }) => id !== planId);
  return writeState(state, storage);
}

export function clearHistory(
  storage: Storage | null = getDefaultStorage(),
): boolean {
  const state = readState(storage);
  state.plans = [];
  return writeState(state, storage);
}

export function getPreferences(
  storage: Storage | null = getDefaultStorage(),
): UserPreferences {
  return readState(storage).preferences;
}

export function updatePreferences(
  updates: Partial<UserPreferences>,
  storage: Storage | null = getDefaultStorage(),
): UserPreferences {
  const state = readState(storage);
  state.preferences = sanitizePreferences({
    ...state.preferences,
    ...updates,
  });
  writeState(state, storage);
  return state.preferences;
}

export function resetPreferences(
  storage: Storage | null = getDefaultStorage(),
): boolean {
  const state = readState(storage);
  state.preferences = { ...DEFAULT_PREFERENCES };
  return writeState(state, storage);
}

export function saveFocusSession(
  session: FocusSession,
  storage: Storage | null = getDefaultStorage(),
): boolean {
  if (!isFocusSession(session)) {
    return false;
  }

  const state = readState(storage);
  state.focusSession = sanitizeFocusSession(session);
  return writeState(state, storage);
}

export function loadFocusSession(
  storage: Storage | null = getDefaultStorage(),
): FocusSession | null {
  return readState(storage).focusSession;
}

export function clearFocusSession(
  storage: Storage | null = getDefaultStorage(),
): boolean {
  const state = readState(storage);
  state.focusSession = null;
  return writeState(state, storage);
}

export function clearAllLocalData(
  storage: Storage | null = getDefaultStorage(),
): boolean {
  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
