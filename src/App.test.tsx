import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { AGENT_STORAGE_VERSION, createChatSession, loadAgentState, saveAgentState } from "./lib/chatStorage";

function renderApp() {
  return { user: userEvent.setup(), ...render(<App />) };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("PomoLife agent", () => {
  it("renderiza um único chat sem a grade dos sete cards", () => {
    renderApp();
    expect(screen.getByRole("heading", { name: "Nova conversa" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Descreva sua tarefa" })).toBeVisible();
    expect(screen.queryByText("Cardápio de dopamina")).not.toBeInTheDocument();
    expect(screen.getByText(/briefing curto/i)).toBeVisible();
  });

  it("oferece consentimento e faz briefing no modo básico", async () => {
    const { user } = renderApp();
    await user.type(screen.getByRole("textbox", { name: "Descreva sua tarefa" }), "Preciso criar 8 carrosséis");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const consent = screen.getByRole("dialog", { name: "Ativar o coordenador local?" });
    expect(consent).toBeVisible();
    await user.click(within(consent).getByRole("button", { name: "Usar modo básico" }));
    expect(await screen.findByText(/qual entrega concreta/i)).toBeVisible();
    expect(screen.getByText("Plano básico")).toBeVisible();
  });

  it("gera checklist interativo na resposta seguinte e persiste o progresso", async () => {
    const { user } = renderApp();
    const composer = screen.getByRole("textbox", { name: "Descreva sua tarefa" });
    await user.type(composer, "Preciso criar 8 carrosséis");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Usar modo básico" }));
    await screen.findByText(/qual entrega concreta/i);
    await user.type(composer, "São 8 temas, 6 páginas cada, copy pronta e prazo hoje");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const checkbox = await screen.findByRole("checkbox", { name: /reunir em um único lugar/i });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    await waitFor(() => expect(loadAgentState().sessions[0]?.checklist.some((item) => item.completed)).toBe(true));
    expect(screen.getAllByRole("button", { name: /iniciar foco em/i }).length).toBeGreaterThan(0);
  });

  it("cria e retoma várias conversas locais", async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole("button", { name: "Nova conversa" }));
    await user.click(screen.getByRole("button", { name: "Histórico" }));
    const dialog = screen.getByRole("dialog", { name: "Conversas" });
    expect(dialog.querySelectorAll(".conversation-item")).toHaveLength(2);
  });

  it("ignora HTML e não cria links clicáveis em mensagens salvas", () => {
    const session = createChatSession("2026-07-14T12:00:00.000Z");
    session.messages = [{
      id: "safe-message",
      role: "assistant",
      content: "## Plano\n<script>globalThis.__unsafe = true</script>\n[Destino](https://example.com)\n![Pixel](https://example.com/pixel.png)",
      createdAt: session.createdAt,
      mode: "ai",
    }];
    saveAgentState({
      version: AGENT_STORAGE_VERSION,
      sessions: [session],
      activeSessionId: session.id,
      legacyPlans: [],
      preferences: loadAgentState().preferences,
      pomodoro: null,
    });
    const { container } = render(<App />);
    expect(screen.getByRole("heading", { name: "Plano" })).toBeVisible();
    expect(screen.getByText("Destino")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Destino" })).not.toBeInTheDocument();
    expect(container.querySelector("script:not(#youtube-iframe-api)")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
