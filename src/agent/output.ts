import type { AgentStage, ChecklistItem, PomodoroPreset } from "./types";

const CHECKBOX_PATTERN = /^\s*-\s*\[([ xX])\]\s+(.+?)\s*$/;

export interface ParsedAgentOutput {
  text: string;
  stage: AgentStage;
}

function scalarToMarkdown(key: string, value: unknown): string {
  const label = key.replaceAll("_", " ");
  if (Array.isArray(value)) {
    return `### ${label}\n${value.map((item) => {
      if (!item || typeof item !== "object") return `- ${String(item)}`;
      return `- ${Object.entries(item as Record<string, unknown>)
        .map(([childKey, childValue]) => `**${childKey.replaceAll("_", " ")}:** ${Array.isArray(childValue) ? childValue.join(", ") : String(childValue)}`)
        .join("; ")}`;
    }).join("\n")}`;
  }
  if (value && typeof value === "object") {
    return `### ${label}\n${Object.entries(value as Record<string, unknown>)
      .map(([childKey, childValue]) => `- **${childKey.replaceAll("_", " ")}:** ${Array.isArray(childValue) ? childValue.join(", ") : String(childValue)}`)
      .join("\n")}`;
  }
  return `- **${label}:** ${String(value)}`;
}

function convertJsonToMarkdown(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    if (Array.isArray(parsed)) return parsed.map((item) => `- ${String(item)}`).join("\n");
    return Object.entries(parsed as Record<string, unknown>)
      .map(([key, item]) => scalarToMarkdown(key, item))
      .join("\n\n");
  } catch {
    return null;
  }
}

export function parseAgentOutput(raw: string): ParsedAgentOutput {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  let stage: AgentStage = "message";
  if (/^\[\[BRIEFING\]\]/i.test(text)) stage = "briefing";
  if (/^\[\[PLANO\]\]/i.test(text)) stage = "plan";
  text = text.replace(/^\s*\[\[(?:BRIEFING|PLANO)\]\]\s*/i, "").trim();

  if (/^(?:\{|\[)/.test(text)) {
    text = convertJsonToMarkdown(text) ?? text;
  }
  return { text, stage };
}

export function parseChecklist(messageId: string, markdown: string): ChecklistItem[] {
  let phase = "Checklist";
  const result: ChecklistItem[] = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    const heading = line.match(/^#{2,4}\s+(.+)/);
    if (heading) phase = heading[1].trim();
    const checkbox = line.match(CHECKBOX_PATTERN);
    if (!checkbox) return;
    const text = checkbox[2].trim();
    const estimate = text.match(/(?:·|\(|—)\s*(\d{1,3})\s*min/i);
    result.push({
      id: `${messageId}:${index}`,
      messageId,
      text,
      phase,
      completed: checkbox[1].toLowerCase() === "x",
      estimateMinutes: estimate ? Number(estimate[1]) : undefined,
    });
  });
  return result;
}

export function getPomodoroPreset(markdown: string): PomodoroPreset {
  const match = markdown.match(/\b(15)\s*\/\s*(5)\b|\b(25)\s*\/\s*(5)\b|\b(45)\s*\/\s*(10)\b/);
  if (!match) return { focusMinutes: 25, breakMinutes: 5 };
  const pair = match[0].replaceAll(/\s/g, "");
  if (pair === "15/5") return { focusMinutes: 15, breakMinutes: 5 };
  if (pair === "45/10") return { focusMinutes: 45, breakMinutes: 10 };
  return { focusMinutes: 25, breakMinutes: 5 };
}

export function stripChecklistSyntax(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !CHECKBOX_PATTERN.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
