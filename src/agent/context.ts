import { COORDINATOR_PROMPT, hasPendingProductivityBriefing, isProductivityRequest, selectAgentSkills } from "./skills";
import type { AgentRequest, ChatMessage } from "./types";

export const MAX_CONTEXT_CHARACTERS = 7_000;
export const MAX_RECENT_MESSAGES = 6;
export const MAX_ATTACHMENT_CONTEXT_CHARACTERS = 3_000;
export type AgentTurnMode = "general" | "productivity" | "briefing" | "plan" | "clarify";

function messageBlock(message: ChatMessage): string {
  const stage = message.stage === "briefing" ? " — briefing já realizado" : "";
  const role = message.role === "user" ? "PESSOA" : `POMOLIFE${stage}`;
  const withoutLegacyTail = message.role === "assistant" ? message.content.split(/\[\[(?:BRIEFING|PLANO)\]\]/i)[0] : message.content;
  const contentLimit = message.role === "assistant" ? 1_200 : message.attachments?.length ? 1_000 : 2_000;
  const content = withoutLegacyTail.trim().slice(0, contentLimit);
  let remainingAttachmentCharacters = MAX_ATTACHMENT_CONTEXT_CHARACTERS;
  const attachments = message.role === "user" ? (message.attachments ?? []).flatMap((attachment) => {
    if (remainingAttachmentCharacters <= 0) return [];
    const excerpt = attachment.text.slice(0, remainingAttachmentCharacters);
    remainingAttachmentCharacters -= excerpt.length;
    return [`ANEXO ${JSON.stringify(attachment.name)} (${JSON.stringify(attachment.mimeType)}):\n${JSON.stringify(excerpt)}`];
  }).join("\n\n") : "";
  return `${role}:\n${JSON.stringify(content)}${attachments ? `\n\n${attachments}` : ""}`;
}

export function determineTurnMode(messages: readonly ChatMessage[]): AgentTurnMode {
  const latest = [...messages].reverse().find((message) => message.role === "user")?.content.trim().toLocaleLowerCase("pt-BR") ?? "";
  const hasAssistantReply = messages.some((message) => message.role === "assistant");
  const asksToClarify = /(?:^|\b)(?:não entendi|nao entendi|o que (?:você )?quer dizer|como assim|explique (?:isso|melhor|de outro jeito)|confus[oa])\b/i.test(latest);
  if (hasAssistantReply && asksToClarify) return "clarify";
  if (!isProductivityRequest(messages)) return "general";
  if (hasPendingProductivityBriefing(messages)) return "plan";
  const userMessages = messages.filter((message) => message.role === "user");
  const vagueExecutionRequest = /\b(?:preciso|quero|tenho que|estou tentando)\s+(?:começar|iniciar|fazer|criar|terminar|organizar)\b|\b(?:travado|travada|enrolando|paralisado|paralisada|não consigo começar|nao consigo comecar)\b/i.test(latest);
  if (userMessages.length <= 1 && latest.length < 180 && vagueExecutionRequest) return "briefing";
  const asksForStructuredPlan = /\b(?:quebr(?:e|ar)|divid(?:a|ir)|decomponh(?:a|er)|planej(?:e|ar)|organiz(?:e|ar)|mont(?:e|ar)|cri(?:e|ar)|escrev(?:a|er)|faça|fazer|ger(?:e|ar))\b[\s\S]{0,100}\b(?:microtarefas?|checklist|plano de ação|plano de estudos?|passos)\b/i.test(latest);
  if (asksForStructuredPlan) return "plan";
  return "productivity";
}

function modeInstruction(mode: AgentTurnMode): string {
  if (mode === "general") return `MODO DESTA RESPOSTA: CONVERSA GERAL
Não use marcador interno. Responda diretamente como um chat de IA normal, no formato mais útil para o pedido. Não crie briefing, checklist, plano de ação ou Pomodoro por padrão.`;
  if (mode === "productivity") return `MODO DESTA RESPOSTA: APOIO À PRODUTIVIDADE
Use os especialistas roteados com naturalidade, sem transformar toda resposta em um método. Responda diretamente se for uma pergunta ou orientação simples. Se faltar um dado indispensável para executar o pedido, comece com [[BRIEFING]] e faça no máximo 3 perguntas. Se a pessoa pediu um plano executável e há contexto suficiente, comece com [[PLANO]] e use passos concretos. Caso contrário, não use marcador nem checklist.`;
  if (mode === "briefing") return `MODO DESTA RESPOSTA: BRIEFING
Comece com [[BRIEFING]]. Depois diga em uma frase o que entendeu e faça de 1 a 3 perguntas curtas e específicas. Termine após as perguntas. Não dê plano, checklist, exemplos ou conselho ainda.`;
  if (mode === "clarify") return `MODO DESTA RESPOSTA: ESCLARECIMENTO
Não use marcador. Explique em até 3 frases o que você quis saber ou proponha uma pergunta mais simples. Não repita checklist nem crie plano.`;
  return `MODO DESTA RESPOSTA: PLANO
Comece com [[PLANO]]. Use apenas "## Entendi", "## Comece por aqui", "## Checklist" e "## Concluído quando". O primeiro passo deve caber em menos de 1 minuto. No checklist use "- [ ] verbo + ação observável · N min", com itens de 2 a 15 minutos. Inclua no máximo uma recomendação 15/5, 25/5 ou 45/10 quando ela ajudar.`;
}

export function buildAgentPrompt(request: AgentRequest): string {
  const messages = request.messages.filter((message) => message.content.trim());
  const firstUser = messages.find((message) => message.role === "user");
  const firstBlock = firstUser ? messageBlock(firstUser) : "";
  const recent = messages.slice(-MAX_RECENT_MESSAGES).filter((message) => message.id !== firstUser?.id);
  const recentBudget = Math.max(0, MAX_CONTEXT_CHARACTERS - firstBlock.length - 2);
  const recentBlocks = recent.map(messageBlock).join("\n\n");
  const conversation = [firstBlock, recentBlocks.slice(-recentBudget)].filter(Boolean).join("\n\n");
  const mode = determineTurnMode(messages);
  const checklist = mode !== "general" && request.checklist.length
    ? request.checklist.map((item) => `- [${item.completed ? "x" : " "}] ${JSON.stringify(item.text)}`).join("\n").slice(-1_200)
    : "Nenhum checklist ativo.";
  const specialists = selectAgentSkills(messages).map((skill) => `- ${skill.title}: ${skill.instruction}`).join("\n");
  const specialistSection = specialists ? `\n\nESPECIALISTAS ROTEADOS\n${specialists}` : "";
  const checklistSection = mode === "general" ? "" : `\n\nCHECKLIST ATUAL\n${checklist}`;

  return `${COORDINATOR_PROMPT}${specialistSection}\n\n${modeInstruction(mode)}\n\nCONVERSA ATUAL\n${conversation}${checklistSection}\n\nResponda somente à última mensagem.`;
}
