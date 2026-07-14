import { Play } from "lucide-react";
import { MarkdownResult } from "./MarkdownResult";
import { parseChecklist, type ChatMessage, type ChecklistItem } from "../agent";

interface InteractiveMessageProps {
  message: ChatMessage;
  checklist: readonly ChecklistItem[];
  onToggle: (id: string) => void;
  onStart: (task: string) => void;
}

type Segment = { type: "markdown"; content: string; key: string } | { type: "task"; item: ChecklistItem; key: string };

function segmentsFor(message: ChatMessage, checklist: readonly ChecklistItem[]): Segment[] {
  const parsed = parseChecklist(message.id, message.content);
  const stored = new Map(checklist.map((item) => [item.id, item]));
  const byLine = new Map(parsed.map((item) => [Number(item.id.split(":").at(-1)), stored.get(item.id) ?? item]));
  const segments: Segment[] = [];
  let markdown: string[] = [];
  const flush = (line: number) => {
    const content = markdown.join("\n").trim();
    if (content) segments.push({ type: "markdown", content, key: `md-${line}-${segments.length}` });
    markdown = [];
  };
  message.content.split(/\r?\n/).forEach((line, index) => {
    const item = byLine.get(index);
    if (item) {
      flush(index);
      segments.push({ type: "task", item, key: item.id });
    } else markdown.push(line);
  });
  flush(message.content.length);
  return segments;
}

export function InteractiveMessage({ message, checklist, onToggle, onStart }: InteractiveMessageProps) {
  if (message.role === "user") return <p className="user-message-copy">{message.content}</p>;
  return (
    <div className="assistant-message-copy">
      {segmentsFor(message, checklist).map((segment) => segment.type === "markdown" ? (
        <MarkdownResult key={segment.key}>{segment.content}</MarkdownResult>
      ) : (
        <div className={`checklist-row ${segment.item.completed ? "is-complete" : ""}`} key={segment.key}>
          <label>
            <input type="checkbox" checked={segment.item.completed} onChange={() => onToggle(segment.item.id)} />
            <span>{segment.item.text}</span>
          </label>
          <button type="button" className="task-start" aria-label={`Iniciar foco em ${segment.item.text}`} onClick={() => onStart(segment.item.text)}>
            <Play size={14} /> Focar
          </button>
        </div>
      ))}
    </div>
  );
}

