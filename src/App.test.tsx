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
    expect(screen.getByText(/conversar sobre qualquer assunto/i)).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Modelo de IA" })).toHaveValue("Qwen3-0.6B-q4f16_1-MLC");
    expect(screen.getByRole("option", { name: "Qwen3 1.7B — 4 GB RAM" })).toBeVisible();
    expect(screen.queryByText("IA não baixada")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Histórico" })).not.toBeInTheDocument();
    expect(screen.queryByText("Gerenciar conversas")).not.toBeInTheDocument();
  });

  it("oferece consentimento e faz briefing no modo básico", async () => {
    const { user } = renderApp();
    await user.type(screen.getByRole("textbox", { name: "Descreva sua tarefa" }), "Preciso criar 8 carrosséis");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const consent = screen.getByRole("dialog", { name: "Baixar a IA local?" });
    expect(consent).toBeVisible();
    await user.click(within(consent).getByRole("button", { name: "Continuar no modo básico" }));
    expect(await screen.findByText(/qual entrega concreta/i)).toBeVisible();
    expect(screen.getByText("Plano básico")).toBeVisible();
  });

  it("gera checklist interativo na resposta seguinte e persiste o progresso", async () => {
    const { user } = renderApp();
    const composer = screen.getByRole("textbox", { name: "Descreva sua tarefa" });
    await user.type(composer, "Preciso criar 8 carrosséis");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Continuar no modo básico" }));
    await screen.findByText(/qual entrega concreta/i);
    await user.type(composer, "São 8 temas, 6 páginas cada, copy pronta e prazo hoje");
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const checklistPanel = screen.getByRole("complementary", { name: /Checklist de/i });
    const checkbox = await within(checklistPanel).findByRole("checkbox", { name: /reunir em um único lugar/i });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    await waitFor(() => expect(loadAgentState().sessions[0]?.checklist.some((item) => item.completed)).toBe(true));
    expect(screen.getAllByRole("button", { name: /iniciar foco em/i }).length).toBeGreaterThan(0);
  });

  it("cria várias conversas somente pela barra lateral", async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole("button", { name: "Criar conversa" }));
    const sidebar = screen.getByRole("complementary", { name: "Conversas criadas" });
    expect(sidebar.querySelectorAll(".sidebar-conversation-item")).toHaveLength(2);
  });

  it("persiste o modelo escolhido no dropdown", async () => {
    const { user } = renderApp();
    await user.selectOptions(screen.getByRole("combobox", { name: "Modelo de IA" }), "Qwen3.5-0.8B-q4f16_1-MLC");
    await waitFor(() => expect(loadAgentState().preferences.selectedModelId).toBe("Qwen3.5-0.8B-q4f16_1-MLC"));
  });

  it("mantém o seletor de modelo no composer e gerencia anexos locais", async () => {
    const { user, container } = renderApp();
    const composerForm = container.querySelector(".chat-composer");
    expect(composerForm).toContainElement(screen.getByRole("combobox", { name: "Modelo de IA" }));
    expect(container.querySelector(".chat-topbar select")).not.toBeInTheDocument();

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await user.upload(input!, new File(["Prazo: sexta-feira\nEntregável: relatório"], "briefing.md", { type: "text/markdown" }));
    expect(await screen.findByText("briefing.md")).toBeVisible();
    expect(screen.getByRole("button", { name: "Enviar" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Visualizar arquivo briefing.md" }));
    expect(screen.getByRole("dialog", { name: "briefing.md" })).toHaveTextContent("Prazo: sexta-feira");
    await user.click(screen.getByRole("button", { name: "Fechar visualização" }));
    await user.click(screen.getByRole("button", { name: "Remover arquivo briefing.md" }));
    expect(screen.queryByText("briefing.md")).not.toBeInTheDocument();
  });

  it("envia e persiste uma mensagem composta apenas por anexo", async () => {
    const { user, container } = renderApp();
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    await user.upload(input!, new File(["Tarefa A\nTarefa B"], "tarefas.txt", { type: "text/plain" }));
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    const consent = screen.getByRole("dialog", { name: "Baixar a IA local?" });
    await user.click(within(consent).getByRole("button", { name: "Continuar no modo básico" }));

    expect(await screen.findByText("Analise os arquivos anexados.", { selector: ".user-message-copy" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Visualizar arquivo tarefas.txt" })).toBeVisible();
    await waitFor(() => expect(loadAgentState().sessions[0]?.messages[0]?.attachments?.[0]?.name).toBe("tarefas.txt"));
  });

  it("troca a checklist junto com a conversa de origem", async () => {
    const first = createChatSession("2026-07-14T12:00:00.000Z");
    const second = createChatSession("2026-07-14T13:00:00.000Z");
    first.title = "Projeto Alpha";
    second.title = "Projeto Beta";
    first.checklist = [{ id: "alpha-task", messageId: "alpha-plan", text: "Revisar Alpha", phase: "Execução", completed: false }];
    second.checklist = [{ id: "beta-task", messageId: "beta-plan", text: "Publicar Beta", phase: "Entrega", completed: false }];
    saveAgentState({ version: AGENT_STORAGE_VERSION, sessions: [second, first], activeSessionId: second.id, legacyPlans: [], preferences: loadAgentState().preferences, pomodoro: null });
    const { user } = renderApp();
    const sidebar = screen.getByRole("complementary", { name: "Conversas criadas" });
    const checklist = screen.getByRole("complementary", { name: /Checklist de/i });
    expect(within(checklist).getByText("Publicar Beta")).toBeVisible();
    await user.click(within(sidebar).getByRole("button", { name: /^Projeto Alpha/i }));
    expect(within(checklist).getByText("Revisar Alpha")).toBeVisible();
    expect(within(checklist).queryByText("Publicar Beta")).not.toBeInTheDocument();
  });

  it("exclui uma conversa diretamente pela barra lateral", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderApp();
    await user.click(screen.getByRole("button", { name: "Criar conversa" }));
    const sidebar = screen.getByRole("complementary", { name: "Conversas criadas" });
    expect(within(sidebar).getAllByRole("button", { name: /Excluir Nova conversa/i })).toHaveLength(2);
    await user.click(within(sidebar).getAllByRole("button", { name: /Excluir Nova conversa/i })[0]);
    expect(within(sidebar).getAllByRole("button", { name: /Excluir Nova conversa/i })).toHaveLength(1);
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
