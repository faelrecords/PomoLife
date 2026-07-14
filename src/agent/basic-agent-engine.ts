import type { PlannerEngineSnapshot } from "../engine";
import { determineTurnMode } from "./context";
import type { AgentEngine, AgentGenerationOptions, AgentGenerationResult, AgentRequest } from "./types";

const READY: PlannerEngineSnapshot = { status: "ready", progress: null, error: null };

function latestUserText(request: AgentRequest): string {
  return [...request.messages].reverse().find((message) => message.role === "user")?.content.trim() ?? "esta tarefa";
}

function firstUserText(request: AgentRequest): string {
  return request.messages.find((message) => message.role === "user")?.content.trim() ?? "esta tarefa";
}

function basicResponse(request: AgentRequest): string {
  const userMessages = request.messages.filter((message) => message.role === "user");
  const task = firstUserText(request).replace(/\s+/g, " ").slice(0, 240);
  const turnMode = determineTurnMode(request.messages);
  if (turnMode === "general") {
    if (/^\s*(?:oi|olá|ola|bom dia|boa tarde|boa noite)[!.?\s]*$/i.test(latestUserText(request))) {
      return "Olá! Posso conversar sobre qualquer assunto. Para respostas geradas por IA, ative um dos modelos locais; o Plano básico continua disponível para organizar tarefas sem usar um modelo.";
    }
    return "O Plano básico consegue organizar tarefas, prioridades e blocos de foco, mas não gera com segurança respostas para assuntos gerais. Ative um modelo local para usar o PomoLife como chat de IA nesta conversa.";
  }
  if (turnMode === "clarify") {
    return "Eu estava tentando identificar o resultado que você quer alcançar. Se preferir, diga apenas qual é a próxima coisa que precisa ficar pronta.";
  }
  if (turnMode === "briefing" || (turnMode === "productivity" && userMessages.length <= 1)) {
    return `[[BRIEFING]]Entendi que você quer avançar em: **${task}**. Para não montar um plano genérico:\n\n1. Qual entrega concreta precisa existir no final e em que quantidade?\n2. Quais materiais ou informações já existem e quais ainda precisam ser encontrados?\n3. Qual é o prazo e existe algum padrão ou restrição obrigatória?`;
  }
  const details = latestUserText(request).replace(/\s+/g, " ").slice(0, 300);
  return `[[PLANO]]## Entendimento\nVocê quer concluir **${task}** usando este contexto adicional: ${details}.\n\n## Primeiro movimento · menos de 1 min\nAbra o arquivo ou aplicativo principal da tarefa e deixe-o visível.\n\n## Checklist\n- [ ] Reunir em um único lugar os materiais já disponíveis · 10 min\n- [ ] Listar exatamente o que precisa ser entregue · 5 min\n- [ ] Produzir a menor parte completa da entrega · 15 min\n- [ ] Repetir o processo nas partes restantes · 15 min\n- [ ] Revisar nomes, formato, conteúdo e requisitos · 10 min\n- [ ] Salvar e enviar a versão final · 5 min\n\n## Tempo e foco\nUse **25/5**: um bloco para organizar e produzir, seguido de uma pausa curta. Ajuste a quantidade de blocos ao volume real.\n\n## Pronto quando\nTodos os itens pedidos estiverem produzidos, revisados, salvos no formato correto e entregues no canal combinado.`;
}

export class BasicAgentEngine implements AgentEngine {
  readonly mode = "basic" as const;
  private cancelled = false;
  private listeners = new Set<(snapshot: PlannerEngineSnapshot) => void>();
  private snapshot = READY;

  getSnapshot = () => this.snapshot;
  subscribe = (listener: (snapshot: PlannerEngineSnapshot) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  async initialize() { this.snapshot = READY; }
  async sendMessage(request: AgentRequest, options: AgentGenerationOptions = {}): Promise<AgentGenerationResult> {
    this.cancelled = false;
    this.snapshot = { status: "generating", progress: null, error: null };
    this.listeners.forEach((listener) => listener(this.snapshot));
    await Promise.resolve();
    const text = basicResponse(request);
    if (!this.cancelled && !options.signal?.aborted) options.onToken?.(text, text);
    this.snapshot = READY;
    this.listeners.forEach((listener) => listener(this.snapshot));
    return { text: this.cancelled ? "" : text, mode: "basic", cancelled: this.cancelled || Boolean(options.signal?.aborted) };
  }
  async cancel() { this.cancelled = true; this.snapshot = READY; }
  async hasModelInCache() { return false; }
  async clearModelCache() { return; }
  async dispose() { this.listeners.clear(); }
}

export function createBasicAgentEngine() {
  return new BasicAgentEngine();
}
