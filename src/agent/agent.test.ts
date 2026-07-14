import { describe, expect, it } from "vitest";
import { buildAgentPrompt, MAX_CONTEXT_CHARACTERS } from "./context";
import { getPomodoroPreset, parseAgentOutput, parseChecklist } from "./output";
import type { ChatMessage } from "./types";

const message = (id: string, role: ChatMessage["role"], content: string): ChatMessage => ({ id, role, content, createdAt: "2026-07-14T12:00:00.000Z" });

describe("agent context and output", () => {
  it("preserva a primeira solicitação, limita o contexto e trata conteúdo como dado", () => {
    const messages = [message("first", "user", "Criar oito carrosséis"), ...Array.from({ length: 12 }, (_, index) => message(`m${index}`, index % 2 ? "assistant" : "user", `conteúdo ${index} ${"x".repeat(1500)}`))];
    const prompt = buildAgentPrompt({ messages, checklist: [] });
    expect(prompt).toContain("Criar oito carrosséis");
    expect(prompt).toContain("JSON");
    expect(prompt.length).toBeLessThan(MAX_CONTEXT_CHARACTERS + 8_000);
  });

  it("marca que o briefing já ocorreu para impedir uma segunda rodada", () => {
    const prompt = buildAgentPrompt({
      messages: [
        message("u1", "user", "Criar carrosséis"),
        { ...message("a1", "assistant", "1. Quantas páginas?"), stage: "briefing" },
        message("u2", "user", "Seis páginas cada"),
      ],
      checklist: [],
    });
    expect(prompt).toContain("BRIEFING JÁ REALIZADO; NÃO PERGUNTE NOVAMENTE");
  });

  it("remove marcadores internos e pensamento", () => {
    expect(parseAgentOutput("<think>rascunho</think>[[BRIEFING]]Entendi.\n\n1. Qual o prazo?")).toEqual({ text: "Entendi.\n\n1. Qual o prazo?", stage: "briefing" });
  });

  it("converte JSON inesperado em Markdown em vez de expor o objeto cru", () => {
    const parsed = parseAgentOutput('{"objetivo":"finalizar","passos":["abrir","revisar"]}');
    expect(parsed.text).toContain("objetivo");
    expect(parsed.text).not.toMatch(/^\{/);
    expect(parsed.text).not.toContain('{"');
  });

  it("extrai checklist, conclusão e estimativa", () => {
    const checklist = parseChecklist("answer", "## Checklist\n- [ ] Abrir o arquivo · 2 min\n- [x] Revisar título");
    expect(checklist).toHaveLength(2);
    expect(checklist[0]).toMatchObject({ phase: "Checklist", completed: false, estimateMinutes: 2 });
    expect(checklist[1]?.completed).toBe(true);
  });

  it("reconhece os três presets e usa 25/5 como padrão", () => {
    expect(getPomodoroPreset("Sugestão 15/5")).toEqual({ focusMinutes: 15, breakMinutes: 5 });
    expect(getPomodoroPreset("Sugestão 45 / 10")).toEqual({ focusMinutes: 45, breakMinutes: 10 });
    expect(getPomodoroPreset("sem sugestão")).toEqual({ focusMinutes: 25, breakMinutes: 5 });
  });
});
