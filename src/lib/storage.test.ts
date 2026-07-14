import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PREFERENCES,
  MAX_SAVED_PLANS,
  STORAGE_KEY,
  STORAGE_VERSION,
  clearAllLocalData,
  clearDrafts,
  clearFocusSession,
  clearHistory,
  getAllDrafts,
  getDraft,
  getPlans,
  getPreferences,
  getStorageSnapshot,
  loadFocusSession,
  removeDraft,
  removePlan,
  resetPreferences,
  saveDraft,
  saveFocusSession,
  savePlan,
  savePlanWithStatus,
  updatePreferences,
} from "./storage";
import {
  acknowledgeCheckpoint,
  createFocusSession,
} from "./focusTimer";
import { PROMPT_IDS } from "../domain/types";

const NOW = new Date("2026-07-14T13:00:00.000Z");

describe("versioned local persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("starts with a versioned empty state", () => {
    expect(getStorageSnapshot()).toEqual({
      version: STORAGE_VERSION,
      drafts: {},
      plans: [],
      preferences: DEFAULT_PREFERENCES,
      focusSession: null,
    });
  });

  it("saves, replaces, removes and clears drafts independently by card", () => {
    saveDraft("paralisia", {
      tarefa: "Abrir o relatório",
      energia: 2,
      urgente: true,
    });
    saveDraft("dopamina", { foco: "Preparar reunião" });
    saveDraft("paralisia", { tarefa: "Escrever o título" });

    expect(getDraft("paralisia")).toEqual({
      cardId: "paralisia",
      values: { tarefa: "Escrever o título" },
      updatedAt: NOW.toISOString(),
    });
    expect(Object.keys(getAllDrafts())).toEqual(["paralisia", "dopamina"]);

    removeDraft("paralisia");
    expect(getDraft("paralisia")).toBeNull();
    expect(getDraft("dopamina")).not.toBeNull();

    clearDrafts();
    expect(getAllDrafts()).toEqual({});
  });

  it("keeps only the 20 newest saved plans", () => {
    for (let index = 0; index < MAX_SAVED_PLANS + 5; index += 1) {
      savePlan({
        id: `plan-${index}`,
        promptId: PROMPT_IDS[index % PROMPT_IDS.length],
        promptTitle: `Card ${index % 7}`,
        values: { tarefa: `Tarefa ${index}` },
        result: `Plano ${index}`,
        mode: index % 2 === 0 ? "ai" : "basic",
        createdAt: new Date(NOW.getTime() + index * 1_000).toISOString(),
      });
    }

    const plans = getPlans();
    expect(plans).toHaveLength(MAX_SAVED_PLANS);
    expect(plans[0].id).toBe("plan-24");
    expect(plans.at(-1)?.id).toBe("plan-5");
  });

  it("reports when the browser refuses to persist a plan", () => {
    const blockedStorage = {
      length: 0,
      clear: vi.fn(),
      getItem: vi.fn(() => null),
      key: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }),
    } as unknown as Storage;

    const result = savePlanWithStatus({
      promptId: "paralysis",
      promptTitle: "Quebrando a paralisia",
      values: { task: "Abrir o arquivo" },
      result: "Abra o arquivo.",
      mode: "basic",
    }, blockedStorage);

    expect(result.saved).toBe(false);
    expect(result.record.result).toBe("Abra o arquivo.");
  });

  it("replaces a plan with the same id and supports item/history deletion", () => {
    saveDraft("paralisia", { tarefa: "Persistir" });
    savePlan({
      id: "same-id",
      promptId: "paralysis",
      promptTitle: "Quebrando a paralisia",
      values: {},
      result: "Primeira versão",
      mode: "basic",
      createdAt: "2026-07-14T12:00:00.000Z",
    });
    savePlan({
      id: "same-id",
      promptId: "paralysis",
      promptTitle: "Quebrando a paralisia",
      values: {},
      result: "Versão atual",
      mode: "ai",
      createdAt: "2026-07-14T13:00:00.000Z",
    });

    expect(getPlans()).toHaveLength(1);
    expect(getPlans()[0].result).toBe("Versão atual");
    removePlan("same-id");
    expect(getPlans()).toEqual([]);
    expect(getDraft("paralisia")).not.toBeNull();

    savePlan({
      id: "new-plan",
      promptId: "paralysis",
      promptTitle: "Quebrando a paralisia",
      values: {},
      result: "Novo",
      mode: "basic",
    });
    clearHistory();
    expect(getPlans()).toEqual([]);
  });

  it("merges and resets user preferences", () => {
    expect(
      updatePreferences({ preferredMode: "ai", notificationsEnabled: true }),
    ).toEqual({
      preferredMode: "ai",
      notificationsEnabled: true,
      soundEnabled: false,
    });
    expect(getPreferences()).toEqual({
      preferredMode: "ai",
      notificationsEnabled: true,
      soundEnabled: false,
    });

    resetPreferences();
    expect(getPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("restores a focus session and its acknowledged checkpoints", () => {
    let session = createFocusSession(
      { id: "focus-persisted", task: "Finalizar apresentação" },
      NOW.getTime(),
    );
    session = acknowledgeCheckpoint(session, 10);

    expect(saveFocusSession(session)).toBe(true);
    expect(loadFocusSession()).toEqual(session);

    clearFocusSession();
    expect(loadFocusSession()).toBeNull();
  });

  it("ignores corrupted, unknown-version and unsafe stored data", () => {
    localStorage.setItem(STORAGE_KEY, "{broken json");
    expect(getStorageSnapshot()).toEqual({
      version: STORAGE_VERSION,
      drafts: {},
      plans: [],
      preferences: DEFAULT_PREFERENCES,
      focusSession: null,
    });

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION + 1, plans: [{ id: "old" }] }),
    );
    expect(getPlans()).toEqual([]);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        drafts: {
          safe: {
            cardId: "safe",
            values: { text: "ok", nested: { ignored: true }, invalid: null },
            updatedAt: NOW.toISOString(),
          },
        },
        plans: [{ id: 123, result: null }],
        preferences: { preferredMode: "remote", soundEnabled: true },
        focusSession: { startedAt: "yesterday" },
      }),
    );

    expect(getDraft("safe")?.values).toEqual({ text: "ok" });
    expect(getPlans()).toEqual([]);
    expect(getPreferences()).toEqual({
      preferredMode: "ask",
      notificationsEnabled: false,
      soundEnabled: true,
    });
    expect(loadFocusSession()).toBeNull();
  });

  it("clears only PomoLife data", () => {
    localStorage.setItem("another-app", "keep me");
    saveDraft("paralisia", { tarefa: "Limpar dados" });

    expect(clearAllLocalData()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem("another-app")).toBe("keep me");
  });
});
