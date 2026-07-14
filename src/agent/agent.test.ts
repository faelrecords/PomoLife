import { describe, expect, it } from "vitest";
import { buildAgentPrompt, determineTurnMode, MAX_ATTACHMENT_CONTEXT_CHARACTERS, MAX_CONTEXT_CHARACTERS } from "./context";
import { getPomodoroPreset, normalizeAssistantVoice, parseAgentOutput, parseChecklist } from "./output";
import { isProductivityRequest, selectAgentSkills } from "./skills";
import type { ChatMessage } from "./types";

const message = (id: string, role: ChatMessage["role"], content: string): ChatMessage => ({ id, role, content, createdAt: "2026-07-14T12:00:00.000Z" });

describe("agent context and output", () => {
  it("preserva a primeira solicitação, limita o contexto e trata conteúdo como dado", () => {
    const messages = [message("first", "user", "Criar oito carrosséis"), ...Array.from({ length: 12 }, (_, index) => message(`m${index}`, index % 2 ? "assistant" : "user", `conteúdo ${index} ${"x".repeat(1500)}`))];
    const prompt = buildAgentPrompt({ messages, checklist: [] });
    expect(prompt).toContain("Criar oito carrosséis");
    expect(prompt).toContain("PESSOA");
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
    expect(prompt).toContain("MODO DESTA RESPOSTA: PLANO");
  });

  it("roteia poucos especialistas e não injeta o antigo conjunto fixo", () => {
    const messages = [message("u1", "user", "Estou enrolando para começar minhas tarefas")];
    expect(selectAgentSkills(messages).map((skill) => skill.id)).toEqual(["next-action", "discovery", "priority"]);
    const prompt = buildAgentPrompt({ messages, checklist: [] });
    expect(prompt).toContain("Próxima ação");
    expect(prompt).not.toContain("Dopamina e jogo");
    expect(prompt).not.toContain("Transição");
  });

  it("funciona como chat geral sem forçar briefing, plano ou especialistas", () => {
    const messages = [message("u1", "user", "Explique por que o céu parece azul")];
    expect(isProductivityRequest(messages)).toBe(false);
    expect(determineTurnMode(messages)).toBe("general");
    expect(selectAgentSkills(messages)).toEqual([]);

    const prompt = buildAgentPrompt({
      messages,
      checklist: [{ id: "old", messageId: "old-message", text: "Checklist antigo", phase: "Execução", completed: false }],
    });
    expect(prompt).toContain("MODO DESTA RESPOSTA: CONVERSA GERAL");
    expect(prompt).toContain("Responda diretamente como um chat de IA normal");
    expect(prompt).not.toContain("ESPECIALISTAS ROTEADOS");
    expect(prompt).not.toContain("CHECKLIST ATUAL");
    expect(prompt).not.toContain("Checklist antigo");
  });

  it("inclui anexos textuais como dados locais dentro do orçamento do modelo", () => {
    const attached = {
      ...message("u1", "user", "Resuma o arquivo anexado"),
      attachments: [{
        id: "file-1",
        name: "notas.md",
        mimeType: "text/markdown",
        size: 8_000,
        text: `Título\n${"conteúdo ".repeat(800)}`,
        truncated: true,
      }],
    };
    const prompt = buildAgentPrompt({ messages: [attached], checklist: [] });
    expect(prompt).toContain('ANEXO "notas.md"');
    expect(prompt).toContain("Título");
    expect(prompt).toContain("MODO DESTA RESPOSTA: CONVERSA GERAL");
    expect(prompt.length).toBeLessThan(MAX_CONTEXT_CHARACTERS + MAX_ATTACHMENT_CONTEXT_CHARACTERS + 8_000);
  });

  it("não confunde criação de conteúdo comum nem pergunta sobre TDAH com pedido de planejamento", () => {
    const writing = [message("u1", "user", "Escreva um e-mail curto agradecendo ao João")];
    const informational = [message("u2", "user", "Explique o que é TDAH")];
    const editing = [message("u3", "user", "Revise este texto e deixe mais claro")];
    expect(determineTurnMode(writing)).toBe("general");
    expect(determineTurnMode(informational)).toBe("general");
    expect(determineTurnMode(editing)).toBe("general");
    expect(selectAgentSkills(writing)).toEqual([]);
    expect(selectAgentSkills(informational)).toEqual([]);
  });

  it("ativa produtividade apenas quando o pedido ou contexto tornam o recurso relevante", () => {
    const directPlan = [message("u1", "user", "Divida minhas tarefas em um checklist de microtarefas")];
    const focusAdvice = [message("u2", "user", "Como posso manter o foco no meu trabalho hoje?")];
    const naturalRequest = [message("u3", "user", "Pode quebrar a limpeza da casa em passos pequenos?")];
    expect(determineTurnMode(directPlan)).toBe("plan");
    expect(selectAgentSkills(directPlan).map((skill) => skill.id)).toContain("breakdown");
    expect(determineTurnMode(focusAdvice)).toBe("productivity");
    expect(selectAgentSkills(focusAdvice).map((skill) => skill.id)).toContain("focus");
    expect(determineTurnMode(naturalRequest)).toBe("plan");
    expect(determineTurnMode([message("u4", "user", "Organizar relatório mensal")])).toBe("productivity");
    expect(determineTurnMode([message("u5", "user", "Finalizar apresentação")])).toBe("productivity");
  });

  it("mantém o briefing somente enquanto aguarda a resposta e permite mudar de assunto", () => {
    const briefingAnswer = [
      message("u1", "user", "Preciso criar 8 carrosséis"),
      { ...message("a1", "assistant", "Quantas páginas e qual o prazo?"), stage: "briefing" as const },
      message("u2", "user", "São seis páginas e o prazo é amanhã"),
    ];
    expect(determineTurnMode(briefingAnswer)).toBe("plan");

    const changedSubject = [
      ...briefingAnswer,
      { ...message("a2", "assistant", "## Checklist\n- [ ] Separar as copies"), stage: "plan" as const },
      message("u3", "user", "Agora traduza esta frase para inglês: bom dia"),
    ];
    expect(determineTurnMode(changedSubject)).toBe("general");
    expect(selectAgentSkills(changedSubject)).toEqual([]);

    const changedDuringBriefing = [
      message("u4", "user", "Preciso organizar meu projeto"),
      { ...message("a4", "assistant", "Qual é o prazo?"), stage: "briefing" as const },
      message("u5", "user", "Explique por que o céu parece azul"),
    ];
    expect(determineTurnMode(changedDuringBriefing)).toBe("general");
    expect(determineTurnMode([
      message("u6", "user", "Preciso organizar meu projeto"),
      { ...message("a6", "assistant", "Qual é o prazo?"), stage: "briefing" as const },
      message("u7", "user", "Deixa pra lá, me conte uma piada"),
    ])).toBe("general");
  });

  it("pode ativar produtividade a partir de uma lista de tarefas anexada sem tratar qualquer arquivo como tarefa", () => {
    const withTasks = {
      ...message("u1", "user", "Analise os arquivos anexados."),
      attachments: [{ id: "tasks", name: "tarefas.txt", mimeType: "text/plain", size: 50, text: "Tarefas pendentes\n- entregar relatório\n- revisar projeto", truncated: false }],
    };
    const generalFile = {
      ...message("u2", "user", "Analise os arquivos anexados."),
      attachments: [{ id: "article", name: "ceu.txt", mimeType: "text/plain", size: 40, text: "A dispersão da luz explica o azul do céu.", truncated: false }],
    };
    expect(determineTurnMode([withTasks])).toBe("productivity");
    expect(selectAgentSkills([withTasks]).length).toBeGreaterThan(0);
    expect(determineTurnMode([generalFile])).toBe("general");
  });

  it("trata 'explique' como pedido geral quando não se refere a uma resposta anterior", () => {
    expect(determineTurnMode([message("u1", "user", "Explique relatividade em termos simples")])).toBe("general");
  });

  it("trata pedidos de esclarecimento sem repetir o plano", () => {
    const messages = [message("u1", "user", "Organizar meu trabalho"), { ...message("a1", "assistant", "Qual é a entrega?"), stage: "briefing" as const }, message("u2", "user", "Não entendi o que quis dizer")];
    expect(determineTurnMode(messages)).toBe("clarify");
    expect(buildAgentPrompt({ messages, checklist: [] })).toContain("MODO DESTA RESPOSTA: ESCLARECIMENTO");
  });

  it("remove marcadores internos e pensamento", () => {
    expect(parseAgentOutput("<think>rascunho</think>[[BRIEFING]]Entendi.\n\n1. Qual o prazo?")).toEqual({ text: "Entendi.\n\n1. Qual o prazo?", stage: "briefing" });
  });

  it("mantém somente a primeira fase quando o modelo mistura briefing e plano", () => {
    expect(parseAgentOutput("[[BRIEFING]]Qual é a tarefa?\n[[PLANO]]Plano genérico")).toEqual({ text: "Qual é a tarefa?", stage: "briefing" });
  });

  it("remove caudas legadas com plano genérico da memória enviada ao agente", () => {
    const prompt = buildAgentPrompt({ messages: [message("u1", "user", "Começar tarefas"), { ...message("a1", "assistant", "Qual tarefa vem primeiro?\n[[PLANO]]Plano genérico antigo"), stage: "briefing" }, message("u2", "user", "Não entendi")], checklist: [] });
    expect(prompt).toContain("Qual tarefa vem primeiro?");
    expect(prompt).not.toContain("Plano genérico antigo");
  });

  it("mantém a voz do assistente separada da pessoa usuária", () => {
    expect(normalizeAssistantVoice("Entendo que preciso iniciar minhas tarefas.\nPergunte: O que está pendente?")).toBe("Entendi que você precisa iniciar suas tarefas.\nO que está pendente?");
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
