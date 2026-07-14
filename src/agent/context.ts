import { COORDINATOR_PROMPT } from "./skills";
import type { AgentRequest, ChatMessage } from "./types";

export const MAX_CONTEXT_CHARACTERS = 7_500;
export const MAX_RECENT_MESSAGES = 8;

function messageBlock(message: ChatMessage): string {
  const stage = message.stage === "briefing" ? " — BRIEFING JÁ REALIZADO; NÃO PERGUNTE NOVAMENTE" : "";
  const role = message.role === "user" ? "PESSOA" : `POMOLIFE${stage}`;
  return `${role}:\n${JSON.stringify(message.content)}`;
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
    ? request.checklist
      .map((item) => `- [${item.completed ? "x" : " "}] ${JSON.stringify(item.text)}`)
      .join("\n")
      .slice(-1_500)
    : "Nenhum checklist ativo.";

  return `${COORDINATOR_PROMPT}\n\nCONVERSA ATUAL\n${conversation}\n\nESTADO DO CHECKLIST\n${checklist}\n\nResponda agora à última mensagem da pessoa.`;
}
