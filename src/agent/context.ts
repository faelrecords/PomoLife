import { COORDINATOR_PROMPT, selectAgentSkills } from "./skills";
import type { AgentRequest, ChatMessage } from "./types";

export const MAX_CONTEXT_CHARACTERS = 5_500;
export const MAX_RECENT_MESSAGES = 6;
export type AgentTurnMode = "briefing" | "plan" | "clarify";

function messageBlock(message: ChatMessage): string {
  const stage = message.stage === "briefing" ? " — briefing já realizado" : "";
  const role = message.role === "user" ? "PESSOA" : `POMOLIFE${stage}`;
  const withoutLegacyTail = message.role === "assistant" ? message.content.split(/\[\[(?:BRIEFING|PLANO)\]\]/i)[0] : message.content;
  const content = withoutLegacyTail.trim().slice(0, message.role === "assistant" ? 1_200 : 2_000);
  return `${role}:\n${JSON.stringify(content)}`;
}

export function determineTurnMode(messages: readonly ChatMessage[]): AgentTurnMode {
  const latest = [...messages].reverse().find((message) => message.role === "user")?.content.toLocaleLowerCase("pt-BR") ?? "";
  if (/não entendi|nao entendi|explique|o que quer dizer|como assim|confus[oa]/i.test(latest)) return "clarify";
  if (messages.some((message) => message.role === "assistant" && message.stage === "briefing")) return "plan";
  const userMessages = messages.filter((message) => message.role === "user");
  if (userMessages.length <= 1 && latest.length < 180) return "briefing";
  return "plan";
}

function modeInstruction(mode: AgentTurnMode): string {
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
  const checklist = request.checklist.length
    ? request.checklist.map((item) => `- [${item.completed ? "x" : " "}] ${JSON.stringify(item.text)}`).join("\n").slice(-1_200)
    : "Nenhum checklist ativo.";
  const specialists = selectAgentSkills(messages).map((skill) => `- ${skill.title}: ${skill.instruction}`).join("\n");

  return `${COORDINATOR_PROMPT}\n\nESPECIALISTAS ROTEADOS\n${specialists}\n\n${modeInstruction(determineTurnMode(messages))}\n\nCONVERSA ATUAL\n${conversation}\n\nCHECKLIST ATUAL\n${checklist}\n\nResponda somente à última mensagem.`;
}
