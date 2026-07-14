import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { PROMPT_DEFINITIONS } from "./domain";
import { getStorageSnapshot, savePlan } from "./lib/storage";

function renderApp() {
  return {
    user: userEvent.setup(),
    ...render(<App />),
  };
}

function toolCard(title: string) {
  return screen.getByRole("button", { name: new RegExp(title, "i") });
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("PomoLife", () => {
  it("renderiza os sete cards de planejamento", () => {
    renderApp();

    const tools = screen.getByRole("heading", {
      name: /menos fricção/i,
    }).closest("section");

    expect(tools).not.toBeNull();
    for (const definition of PROMPT_DEFINITIONS) {
      expect(
        within(tools as HTMLElement).getByRole("button", {
          name: new RegExp(definition.title, "i"),
        }),
      ).toBeVisible();
    }
  });

  it("abre e fecha uma ferramenta pelo teclado e devolve o foco ao card", async () => {
    const { user } = renderApp();
    const card = toolCard("Quebrando a paralisia");

    card.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("dialog", { name: "Quebrando a paralisia" }),
    ).toBeVisible();
    const task = screen.getByRole("textbox", { name: "Tarefa" });
    await waitFor(() => expect(task).toHaveFocus());

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(card).toHaveFocus());
  });

  it("valida os campos obrigatórios antes de gerar", async () => {
    const { user } = renderApp();

    await user.click(toolCard("Quebrando a paralisia"));
    await user.click(screen.getByRole("button", { name: "Gerar plano" }));

    expect(
      await screen.findAllByText("Preencha este campo para continuar."),
    ).toHaveLength(3);
    expect(screen.getByRole("textbox", { name: "Tarefa" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "Tarefa" })).toHaveFocus();
    expect(
      screen.queryByRole("dialog", { name: "Ativar a IA local?" }),
    ).not.toBeInTheDocument();
  });

  it("gera no modo básico, salva localmente e reabre pelo histórico", async () => {
    const { user } = renderApp();

    await user.click(toolCard("Quebrando a paralisia"));
    await user.type(
      screen.getByRole("textbox", { name: "Tarefa" }),
      "enviar a proposta",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Onde você travou" }),
      "não sei qual arquivo abrir",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Onde a tarefa acontece" }),
      "notebook na mesa",
    );
    await user.click(screen.getByRole("button", { name: "Gerar plano" }));

    expect(await screen.findByText("Plano básico")).toBeVisible();
    expect(
      screen.getByText(/primeiro passo — menos de 1 minuto/i),
    ).toBeVisible();
    expect(getStorageSnapshot().plans).toHaveLength(1);
    expect(getStorageSnapshot().plans[0]).toMatchObject({
      promptId: "paralysis",
      mode: "basic",
      values: { task: "enviar a proposta" },
    });

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Abrir histórico" }));

    const history = screen.getByRole("dialog", { name: "Histórico" });
    expect(within(history).getByText("Quebrando a paralisia")).toBeVisible();
    expect(within(history).getByText(/Básico/)).toBeVisible();

    await user.click(
      within(history).getByText("Quebrando a paralisia").closest("button")!,
    );

    expect(screen.getByRole("dialog", { name: "Quebrando a paralisia" })).toBeVisible();
    expect(screen.getByDisplayValue("enviar a proposta")).toBeVisible();
    expect(screen.getByText(/primeiro passo — menos de 1 minuto/i)).toBeVisible();
  });

  it("exibe um plano salvo sem executar HTML nem criar links clicáveis", async () => {
    savePlan({
      id: "plano-seguro",
      createdAt: "2026-07-14T12:00:00.000Z",
      promptId: "paralysis",
      promptTitle: "Quebrando a paralisia",
      values: {
        task: "revisar o relatório",
        blocker: "abrir o arquivo",
        place: "notebook",
      },
      result:
        "## Próximo passo\n<script>globalThis.__unsafe = true</script>\n[Destino externo](https://example.com)\n![Pixel remoto](https://example.com/rastreio.png)",
      mode: "basic",
    });
    const { user, container } = renderApp();

    await user.click(screen.getByRole("button", { name: "Abrir histórico" }));
    const history = screen.getByRole("dialog", { name: "Histórico" });
    await user.click(
      within(history).getByText("Quebrando a paralisia").closest("button")!,
    );

    expect(screen.getByRole("heading", { name: "Próximo passo" })).toBeVisible();
    expect(screen.getByText("Destino externo")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Destino externo" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(
      (globalThis as typeof globalThis & { __unsafe?: boolean }).__unsafe,
    ).toBeUndefined();
  });
});
