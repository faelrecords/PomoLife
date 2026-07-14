import { describe, expect, it } from "vitest";
import { AGENT_STORAGE_KEY, AGENT_STORAGE_VERSION, LEGACY_STORAGE_KEY, MAX_MESSAGES, MAX_SESSIONS, clearAgentData, createChatSession, loadAgentState, saveAgentState } from "./chatStorage";
import { createPomodoroSession, pomodoroRemaining, startBreak } from "./pomodoro";
import { DEFAULT_YOUTUBE_URL, parseYouTubeSource, youtubeSearchUrl } from "./youtube";

describe("agent storage", () => {
  it("migra planos antigos para leitura sem alterar o estado legado", () => {
    const storage = localStorage;
    const legacy = { version: 1, plans: [{ id: "old", promptId: "paralysis", promptTitle: "Paralisia", values: {}, result: "Abra o arquivo", mode: "basic", createdAt: "2026-07-14T12:00:00.000Z" }] };
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(legacy));
    const state = loadAgentState(storage);
    expect(state.version).toBe(AGENT_STORAGE_VERSION);
    expect(state.legacyPlans).toHaveLength(1);
    expect(JSON.parse(storage.getItem(LEGACY_STORAGE_KEY)!)).toEqual(legacy);
  });

  it("limita conversas e mensagens ao salvar", () => {
    const sessions = Array.from({ length: MAX_SESSIONS + 3 }, (_, sessionIndex) => {
      const session = createChatSession(`2026-07-${String(sessionIndex + 1).padStart(2, "0")}T12:00:00.000Z`);
      session.messages = Array.from({ length: MAX_MESSAGES + 4 }, (_, index) => ({ id: `${sessionIndex}-${index}`, role: "user" as const, content: "x", createdAt: session.createdAt }));
      return session;
    });
    saveAgentState({ version: AGENT_STORAGE_VERSION, sessions, activeSessionId: sessions[0].id, legacyPlans: [], preferences: loadAgentState().preferences, pomodoro: null });
    const raw = JSON.parse(localStorage.getItem(AGENT_STORAGE_KEY)!) as { sessions: Array<{ messages: unknown[] }> };
    expect(raw.sessions).toHaveLength(MAX_SESSIONS);
    expect(raw.sessions[0]?.messages).toHaveLength(MAX_MESSAGES);
  });

  it("atualiza a antiga trilha padrão sem sobrescrever escolhas pessoais", () => {
    localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify({
      version: AGENT_STORAGE_VERSION,
      sessions: [],
      activeSessionId: null,
      legacyPlans: [],
      preferences: { ...loadAgentState().preferences, youtubeUrl: "https://youtu.be/4VXErA63_eg" },
      pomodoro: null,
    }));
    expect(loadAgentState().preferences.youtubeUrl).toBe(DEFAULT_YOUTUBE_URL);
  });

  it("valida e preserva o modelo local selecionado", () => {
    const state = loadAgentState();
    saveAgentState({ ...state, preferences: { ...state.preferences, selectedModelId: "Qwen3-1.7B-q4f16_1-MLC" } });
    expect(loadAgentState().preferences.selectedModelId).toBe("Qwen3-1.7B-q4f16_1-MLC");
  });

  it("preserva anexos textuais seguros nas mensagens", () => {
    const state = loadAgentState();
    const session = createChatSession("2026-07-14T12:00:00.000Z");
    session.messages = [{
      id: "with-file",
      role: "user",
      content: "Analise este arquivo",
      createdAt: session.createdAt,
      attachments: [{ id: "file-1", name: "brief.md", mimeType: "text/markdown", size: 18, text: "Conteúdo do briefing", truncated: false }],
    }];
    saveAgentState({ ...state, sessions: [session], activeSessionId: session.id });
    expect(loadAgentState().sessions[0]?.messages[0]?.attachments?.[0]).toMatchObject({ name: "brief.md", text: "Conteúdo do briefing" });
  });

  it("apaga o estado novo e os dados legados juntos", () => {
    localStorage.setItem(AGENT_STORAGE_KEY, "{}");
    localStorage.setItem(LEGACY_STORAGE_KEY, "{}");
    clearAgentData(localStorage);
    expect(localStorage.getItem(AGENT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});

describe("youtube and pomodoro", () => {
  it("aceita vídeos, links curtos e playlists do YouTube", () => {
    expect(parseYouTubeSource(DEFAULT_YOUTUBE_URL)).toMatchObject({ kind: "video", videoId: "5tMdvZvKWYs" });
    expect(parseYouTubeSource("https://youtube.com/playlist?list=PL123456789")).toMatchObject({ kind: "playlist", playlistId: "PL123456789" });
    expect(parseYouTubeSource("https://example.com/video")).toBeNull();
    expect(youtubeSearchUrl("lo fi foco")).toContain("lo%20fi%20foco");
  });

  it("usa horários absolutos para foco e pausa", () => {
    const session = createPomodoroSession("Revisar", { focusMinutes: 15, breakMinutes: 5 }, 1_000);
    expect(pomodoroRemaining(session, 61_000)).toBe(14 * 60_000);
    const pause = startBreak(session, 901_000);
    expect(pause.endsAt).toBe(1_201_000);
  });
});
