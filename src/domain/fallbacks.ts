import { calculateRealisticMinutes, formatMinutesPtBr } from "./time";
import type { FormValues, PromptId } from "./types";

export type BasicFallback = (values: FormValues) => string;

function inlineValue(
  values: FormValues,
  name: string,
  defaultValue: string,
): string {
  const value = values[name]?.replace(/\s+/g, " ").trim() || defaultValue;
  return value.replace(/[\\`*_{}[\]()#+.!>|-]/g, "\\$&");
}

function positiveNumber(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function paralysisFallback(values: FormValues): string {
  const task = inlineValue(values, "task", "essa tarefa");
  const blocker = inlineValue(values, "blocker", "o ponto que travou");
  const place = inlineValue(values, "place", "onde você está");

  return `**Primeiro passo — menos de 1 minuto:** em **${place}**, deixe visível o arquivo, objeto ou tela que você usa para **${task}**. Pare assim que estiver aberto; você ainda não precisa resolver **${blocker}**.`;
}

function dopamineFallback(values: FormValues): string {
  const target = inlineValue(values, "target", "sua prioridade");
  const energy = inlineValue(values, "energy", "a energia atual");
  const constraints = inlineValue(values, "constraints", "o espaço disponível");
  const interests = inlineValue(values, "interests", "algo de que você gosta");

  return `## Movimento rápido · 5 min

1. **Reinício físico:** mude de posição, solte ombros e mãos por 2 min e caminhe ou se movimente no lugar por 3 min.
2. **Caça a cinco coisas:** encontre e guarde cinco objetos próximos, respeitando **${constraints}**.
3. **Uma música:** coloque uma faixa curta e mova o corpo no ritmo possível para **${energy}**.

## Trabalho concentrado · 20 min

1. **Uma janela:** deixe apenas o material de **${target}** visível e trabalhe nele até o alarme.
2. **Rascunho permitido:** produza uma versão imperfeita de **${target}** por 15 min e use 5 min para marcar o próximo passo.
3. **Sprint com placar:** faça marcas em um papel a cada 5 min em que voltar para **${target}**.

## Pausa criativa · 10 min

1. Faça um rabisco ou mini mapa inspirado em **${interests}**, sem buscar acabamento.
2. Monte uma lista de cinco curiosidades, ideias ou perguntas sobre **${interests}**.
3. Escolha uma música ligada a **${interests}**, ouça sem abrir outras telas e beba água.`;
}

function focusFallback(values: FormValues): string {
  const task = inlineValue(values, "task", "sua tarefa");
  const outcome = inlineValue(values, "outcome", "um avanço visível");
  const distraction = inlineValue(values, "distraction", "a distração mais provável");

  return `## Âncora da sessão

Por 30 minutos, o único alvo é **${task}**. Um bom encerramento será **${outcome}**.

**Agora:** deixe só o necessário à vista, anote “voltar para ${task}” e comece pela menor ação disponível.

## Check-ins

- **10 min:** O que avançou? Se **${distraction}** apareceu, reconheça e volte por apenas dois minutos.
- **20 min:** Qual é a próxima ação visível? Faça somente essa ação.
- **30 min:** Pare, registre o avanço e escolha conscientemente continuar ou encerrar.`;
}

function transitionFallback(values: FormValues): string {
  const previousTask = inlineValue(values, "previousTask", "a tarefa anterior");
  const nextTask = inlineValue(values, "nextTask", "a próxima tarefa");
  const residue = inlineValue(values, "residue", "o que ainda ficou na cabeça");

  return `## Transição de 3 minutos

- **0:00–1:00 · Fechar:** anote em uma frase onde **${previousTask}** parou e registre **${residue}** para não precisar segurá-lo na memória.
- **1:00–2:00 · Trocar:** levante, respire devagar e reorganize a tela ou a mesa para retirar os sinais da tarefa anterior.
- **2:00–3:00 · Abrir:** deixe o material de **${nextTask}** visível e execute apenas a primeira ação física, sem tentar terminar nada ainda.`;
}

function gameFallback(values: FormValues): string {
  const task = inlineValue(values, "task", "a tarefa administrativa");
  const interest = inlineValue(values, "interest", "seu interesse atual");
  const reward = inlineValue(values, "reward", "uma pausa escolhida por você");
  const availableMinutes = positiveNumber(values.availableMinutes, 30);
  const checkpointMinutes = Math.max(1, Math.floor(availableMinutes / 3));

  return `# Missão: Operação ${interest}

**Objetivo:** concluir **${task}** em uma rodada de até ${availableMinutes} min.

1. **Checkpoint 1 · Equipar (${checkpointMinutes} min):** reúna acessos, arquivos e informações necessários.
2. **Checkpoint 2 · Avançar (${checkpointMinutes} min):** execute a parte principal sem polir detalhes.
3. **Checkpoint 3 · Confirmar (${checkpointMinutes} min):** revise o essencial, envie ou registre a conclusão.

**Condição de vitória:** a tarefa está entregue ou registrada no lugar correto.

**Recompensa desbloqueada:** ${reward}.`;
}

function timeFallback(values: FormValues): string {
  const project = inlineValue(values, "project", "o projeto");
  const optimisticMinutes = positiveNumber(values.optimisticMinutes, 20);
  const typicalMinutes = positiveNumber(values.typicalMinutes, 120);
  const realisticMinutes = calculateRealisticMinutes(
    optimisticMinutes,
    typicalMinutes,
  );

  return `## O tempo escondido de ${project}

1. **Preparação:** localizar materiais, abrir ferramentas, recuperar contexto e esclarecer o que significa “pronto”.
2. **Dependências:** esperar acessos ou respostas, pesquisar dúvidas e ajustar algo que não funciona de primeira.
3. **Fechamento:** revisar, corrigir, exportar, enviar e registrar o que ficou pendente.

**Janela segura:** reserve **${formatMinutesPtBr(realisticMinutes)}** (${realisticMinutes} min).

Cálculo local: maior valor entre ${optimisticMinutes} min × 1,5 e ${typicalMinutes} min; depois, 20% de margem e arredondamento para o próximo bloco de 15 min.`;
}

interface BrainDumpItems {
  items: string[];
  duplicates: string[];
}

function parseBrainDump(rawValue: string | undefined): BrainDumpItems {
  const items: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of (rawValue ?? "").split(/\n+/)) {
    const item = rawLine
      .replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]\])\s*/, "")
      .trim();

    if (!item) {
      continue;
    }

    const comparisonKey = item.toLocaleLowerCase("pt-BR");
    if (seen.has(comparisonKey)) {
      duplicates.push(item);
    } else {
      seen.add(comparisonKey);
      items.push(item);
    }
  }

  return { items, duplicates };
}

function markdownList(items: string[], emptyMessage: string): string {
  if (items.length === 0) {
    return `- ${emptyMessage}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

const PRIORITY_STOP_WORDS = new Set([
  "para", "com", "sem", "uma", "uns", "das", "dos", "que", "ate", "prazo",
]);

function priorityText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function prioritizeForDeadline(items: string[], hardDeadline: string | undefined): string[] {
  const deadline = priorityText(hardDeadline ?? "");
  const deadlineTerms = [...new Set(deadline.match(/[\p{L}\d]{3,}/gu) ?? [])]
    .filter((term) => !PRIORITY_STOP_WORDS.has(term));
  const urgencyPattern = /\b(hoje|amanha|agora|urgente|vence|vencimento|entregar|enviar|reuniao|prazo)\b|\b\d{1,2}(?::\d{2})?h\b|\b\d{1,2}[/-]\d{1,2}\b/u;

  return items
    .map((item, index) => {
      const normalized = priorityText(item);
      const matchingTerms = deadlineTerms.filter((term) => normalized.includes(term)).length;
      const urgency = urgencyPattern.test(normalized) ? 2 : 0;
      return { item, index, score: matchingTerms * 3 + urgency };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
}

function brainDumpFallback(values: FormValues): string {
  const parsed = parseBrainDump(values.brainDump);
  const availableMinutes = positiveNumber(values.availableMinutes, 60);
  const deadline = inlineValue(values, "hardDeadline", "nenhum prazo informado");
  const maximumNow = Math.max(
    1,
    Math.min(3, Math.floor(availableMinutes / 20)),
  );
  const prioritized = prioritizeForDeadline(parsed.items, values.hardDeadline);
  const now = prioritized.slice(0, maximumNow);
  const later = prioritized.slice(maximumNow);
  const escapedNow = now.map((item) => inlineValue({ item }, "item", "item"));
  const escapedLater = later.map((item) =>
    inlineValue({ item }, "item", "item"),
  );
  const escapedDuplicates = parsed.duplicates.map((item) =>
    inlineValue({ item }, "item", "item"),
  );

  const nowWithSteps = escapedNow.map(
    (item) =>
      `- **${item}** — Próximo passo: abra um lugar para trabalhar nisso e escreva em uma linha o que significa concluí-lo.`,
  );
  const nowList =
    nowWithSteps.length > 0
      ? nowWithSteps.join("\n")
      : "- Nada foi identificado; acrescente uma pendência concreta.";

  return `> Plano básico heurístico · Tempo disponível hoje: ${availableMinutes} min · Prazo protegido: ${deadline}

## Agora

${nowList}

## Depois

${markdownList(escapedLater, "Nenhum item ficou para depois.")}

## Descartar

${markdownList(escapedDuplicates, "Nada foi descartado automaticamente no modo básico.")}`;
}

export const BASIC_FALLBACKS: Readonly<Record<PromptId, BasicFallback>> = {
  paralysis: paralysisFallback,
  dopamine: dopamineFallback,
  focus: focusFallback,
  transition: transitionFallback,
  game: gameFallback,
  time: timeFallback,
  "brain-dump": brainDumpFallback,
};

export function createBasicFallback(
  promptId: PromptId,
  values: FormValues,
): string {
  return BASIC_FALLBACKS[promptId](values);
}
