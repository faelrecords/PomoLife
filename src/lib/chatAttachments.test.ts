import { describe, expect, it } from "vitest";
import {
  formatAttachmentSize,
  isSupportedChatFile,
  MAX_ATTACHMENT_CHARACTERS,
  MAX_CHAT_ATTACHMENTS,
  readChatAttachments,
} from "./chatAttachments";

describe("chat attachments", () => {
  it("lê arquivos de texto localmente e limita o trecho persistido", async () => {
    const source = "a".repeat(MAX_ATTACHMENT_CHARACTERS + 500);
    const file = new File([source], "briefing.md", { type: "text/markdown" });
    const result = await readChatAttachments([file]);

    expect(result.errors).toEqual([]);
    expect(result.attachments[0]).toMatchObject({
      name: "briefing.md",
      mimeType: "text/markdown",
      truncated: true,
    });
    expect(result.attachments[0]?.text).toHaveLength(MAX_ATTACHMENT_CHARACTERS);
  });

  it("rejeita binários, duplicados e anexos acima do limite de quantidade", async () => {
    expect(isSupportedChatFile(new File(["x"], "foto.png", { type: "image/png" }))).toBe(false);
    const first = await readChatAttachments([new File(["texto"], "nota.txt", { type: "text/plain" })]);
    const duplicate = await readChatAttachments([new File(["texto"], "nota.txt", { type: "text/plain" })], first.attachments);
    expect(duplicate.errors.join(" ")).toMatch(/já foi anexado/i);

    const full = Array.from({ length: MAX_CHAT_ATTACHMENTS }, (_, index) => ({
      id: String(index), name: `${index}.txt`, mimeType: "text/plain", size: 1, text: "x", truncated: false,
    }));
    const overflow = await readChatAttachments([new File(["x"], "extra.txt", { type: "text/plain" })], full);
    expect(overflow.errors.join(" ")).toMatch(/no máximo/i);
  });

  it("formata tamanhos para a interface", () => {
    expect(formatAttachmentSize(90)).toBe("90 B");
    expect(formatAttachmentSize(1_600)).toBe("2 KB");
  });
});
