import { describe, expect, it } from "vitest";

import {
  FOCUS_DURATION_MS,
  acknowledgeCheckpoint,
  createFocusSession,
  formatCheckpointLabel,
  formatClockTime,
  formatCountdown,
  getDueCheckpoints,
  getFocusTimerSnapshot,
  getNextCheckpoint,
  isFocusSession,
} from "./focusTimer";

const STARTED_AT = Date.UTC(2026, 6, 14, 10, 0, 0);
const MINUTE_MS = 60_000;

describe("focus timer", () => {
  it("creates a restorable 30-minute session from an absolute timestamp", () => {
    const session = createFocusSession(
      {
        id: "focus-1",
        task: "  Revisar proposta  ",
        desiredOutcome: "  Enviar a versão final ",
        distraction: "  Mensagens ",
      },
      STARTED_AT,
    );

    expect(session).toEqual({
      id: "focus-1",
      task: "Revisar proposta",
      desiredOutcome: "Enviar a versão final",
      distraction: "Mensagens",
      startedAt: STARTED_AT,
      endsAt: STARTED_AT + FOCUS_DURATION_MS,
      acknowledgedCheckpoints: [],
    });
    expect(isFocusSession(JSON.parse(JSON.stringify(session)))).toBe(true);
  });

  it("derives elapsed time from the clock rather than accumulated ticks", () => {
    const session = createFocusSession(
      { id: "focus-2", task: "Planejar a semana" },
      STARTED_AT,
    );

    expect(getFocusTimerSnapshot(session, STARTED_AT - MINUTE_MS)).toMatchObject({
      status: "pending",
      elapsedMs: 0,
      remainingMs: FOCUS_DURATION_MS,
      progress: 0,
    });

    expect(
      getFocusTimerSnapshot(session, STARTED_AT + 15 * MINUTE_MS),
    ).toMatchObject({
      status: "running",
      elapsedMs: 15 * MINUTE_MS,
      remainingMs: 15 * MINUTE_MS,
      progress: 0.5,
    });

    expect(
      getFocusTimerSnapshot(session, STARTED_AT + 45 * MINUTE_MS),
    ).toMatchObject({
      status: "completed",
      elapsedMs: FOCUS_DURATION_MS,
      remainingMs: 0,
      progress: 1,
    });
  });

  it("returns every missed checkpoint after a throttled or closed tab resumes", () => {
    let session = createFocusSession(
      { id: "focus-3", task: "Fechar relatório" },
      STARTED_AT,
    );

    expect(
      getDueCheckpoints(session, STARTED_AT + 21 * MINUTE_MS).map(
        ({ minute }) => minute,
      ),
    ).toEqual([10, 20]);

    session = acknowledgeCheckpoint(session, 10);
    expect(
      getDueCheckpoints(session, STARTED_AT + 21 * MINUTE_MS).map(
        ({ minute }) => minute,
      ),
    ).toEqual([20]);
    expect(getNextCheckpoint(session)?.minute).toBe(20);

    session = acknowledgeCheckpoint(session, 20);
    session = acknowledgeCheckpoint(session, 30);
    expect(getNextCheckpoint(session)).toBeNull();
  });

  it("does not duplicate an acknowledged checkpoint", () => {
    const original = createFocusSession(
      { id: "focus-4", task: "Responder mensagens" },
      STARTED_AT,
    );
    const acknowledged = acknowledgeCheckpoint(original, 10);

    expect(acknowledgeCheckpoint(acknowledged, 10)).toBe(acknowledged);
    expect(acknowledged.acknowledgedCheckpoints).toEqual([10]);
  });

  it("formats countdowns and checkpoint labels", () => {
    expect(formatCountdown(FOCUS_DURATION_MS)).toBe("30:00");
    expect(formatCountdown(1_001)).toBe("00:02");
    expect(formatCountdown(-1)).toBe("00:00");
    expect(formatCountdown(Number.NaN)).toBe("00:00");
    expect(formatCheckpointLabel(20)).toBe("20 min");
  });

  it("formats an absolute clock time in the requested timezone", () => {
    expect(formatClockTime(STARTED_AT + 5 * MINUTE_MS, "UTC")).toBe("10:05");
    expect(formatClockTime(Number.NaN)).toBe("--:--");
  });
});
