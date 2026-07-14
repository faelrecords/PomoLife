import { afterEach, describe, expect, it, vi } from "vitest";
import { GroqAgentEngine } from "./groq-agent-engine";
import type { ChatMessage } from "./types";

const originalFetch = globalThis.fetch;
const message = (id: string, role: ChatMessage["role"], content: string): ChatMessage => ({ id, role, content, createdAt: "2026-07-14T12:00:00.000Z" });

function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const content of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => { globalThis.fetch = originalFetch; });

describe("GroqAgentEngine", () => {
  it("envia uma única inferência online, desativa raciocínio longo e transmite tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(["Olá", "! ", "Vamos começar."]));
    globalThis.fetch = fetchMock;
    const engine = new GroqAgentEngine("chave-de-teste", "groq:qwen/qwen3-32b");
    const streamed: string[] = [];

    const result = await engine.sendMessage({ messages: [message("u1", "user", "Olá")], checklist: [] }, {
      onToken: (_delta, complete) => streamed.push(complete),
    });

    expect(result).toEqual({ text: "Olá! Vamos começar.", mode: "online", cancelled: false });
    expect(streamed.at(-1)).toBe("Olá! Vamos começar.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "qwen/qwen3-32b", stream: true, reasoning_effort: "none" });
    expect(String((init.headers as Record<string, string>).Authorization)).toContain("chave-de-teste");
  });

  it("explica quando a franquia online foi atingida", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("limit", { status: 429 }));
    const engine = new GroqAgentEngine("chave-de-teste", "groq:qwen/qwen3-32b");
    await expect(engine.sendMessage({ messages: [message("u1", "user", "Olá")], checklist: [] })).rejects.toThrow("limite gratuito");
  });
});
