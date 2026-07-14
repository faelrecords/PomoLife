import type { ChatAttachment } from "../agent";
import { createId } from "./ids";

export const MAX_CHAT_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 1_000_000;
// Keep the extracted text within the small local models' context and within
// localStorage even when a user keeps several long conversations.
export const MAX_ATTACHMENT_CHARACTERS = 3_000;
export const MAX_TOTAL_ATTACHMENT_CHARACTERS = 3_000;
export const CHAT_ATTACHMENT_ACCEPT = ".txt,.md,.markdown,.csv,.json,.jsonl,.log,.xml,.yaml,.yml,.js,.jsx,.ts,.tsx,.css,.html,.htm,.py,.java,.c,.h,.cpp,.cs,.go,.rs,.php,.rb,.sh,.ps1,.sql,.toml,.ini,.env,text/*,application/json";

const SUPPORTED_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "json", "jsonl", "log", "xml", "yaml", "yml",
  "js", "jsx", "ts", "tsx", "css", "html", "htm", "py", "java", "c", "h", "cpp",
  "cs", "go", "rs", "php", "rb", "sh", "ps1", "sql", "toml", "ini", "env",
]);

const SUPPORTED_APPLICATION_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/javascript",
  "application/xml",
  "application/sql",
  "application/x-yaml",
]);

export interface AttachmentReadResult {
  attachments: ChatAttachment[];
  errors: string[];
}

function extensionOf(name: string): string {
  return name.toLocaleLowerCase("pt-BR").split(".").at(-1) ?? "";
}

export function isSupportedChatFile(file: Pick<File, "name" | "type">): boolean {
  return file.type.startsWith("text/")
    || SUPPORTED_APPLICATION_TYPES.has(file.type.toLocaleLowerCase("pt-BR"))
    || SUPPORTED_EXTENSIONS.has(extensionOf(file.name));
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsText(file);
  });
}

export async function readChatAttachments(
  files: readonly File[],
  current: readonly ChatAttachment[] = [],
): Promise<AttachmentReadResult> {
  const attachments = [...current];
  const errors: string[] = [];
  let remainingCharacters = Math.max(
    0,
    MAX_TOTAL_ATTACHMENT_CHARACTERS - current.reduce((sum, attachment) => sum + attachment.text.length, 0),
  );

  for (const file of files) {
    if (attachments.length >= MAX_CHAT_ATTACHMENTS) {
      errors.push(`Envie no máximo ${MAX_CHAT_ATTACHMENTS} arquivos por mensagem.`);
      break;
    }
    if (attachments.some((attachment) => attachment.name === file.name && attachment.size === file.size)) {
      errors.push(`${file.name} já foi anexado.`);
      continue;
    }
    if (!isSupportedChatFile(file)) {
      errors.push(`${file.name} não é um arquivo de texto compatível.`);
      continue;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      errors.push(`${file.name} excede o limite de ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)}.`);
      continue;
    }
    if (remainingCharacters <= 0) {
      errors.push("Os anexos desta mensagem atingiram o limite de texto.");
      break;
    }

    try {
      const source = (await readFileText(file)).split("\u0000").join("").trim();
      if (!source) {
        errors.push(`${file.name} está vazio.`);
        continue;
      }
      const limit = Math.min(MAX_ATTACHMENT_CHARACTERS, remainingCharacters);
      const text = source.slice(0, limit);
      attachments.push({
        id: createId("attachment"),
        name: file.name.slice(0, 180),
        mimeType: file.type || "text/plain",
        size: file.size,
        text,
        truncated: source.length > text.length,
      });
      remainingCharacters -= text.length;
    } catch {
      errors.push(`Não foi possível ler ${file.name}.`);
    }
  }

  return { attachments, errors: [...new Set(errors)] };
}
