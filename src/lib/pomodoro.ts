import type { PomodoroPreset } from "../agent";
import { createId } from "./ids";

export type PomodoroPhase = "focus" | "break";

export interface PomodoroSession {
  id: string;
  task: string;
  focusMinutes: PomodoroPreset["focusMinutes"];
  breakMinutes: PomodoroPreset["breakMinutes"];
  phase: PomodoroPhase;
  startedAt: number;
  endsAt: number;
  checkInAt: number;
  checkInAcknowledged: boolean;
}

export const POMODORO_PRESETS: readonly PomodoroPreset[] = [
  { focusMinutes: 15, breakMinutes: 5 },
  { focusMinutes: 25, breakMinutes: 5 },
  { focusMinutes: 45, breakMinutes: 10 },
] as const;

export function createPomodoroSession(task: string, preset: PomodoroPreset, now = Date.now()): PomodoroSession {
  const duration = preset.focusMinutes * 60_000;
  return {
    id: createId("pomo"),
    task,
    ...preset,
    phase: "focus",
    startedAt: now,
    endsAt: now + duration,
    checkInAt: now + Math.round(duration / 2),
    checkInAcknowledged: false,
  };
}

export function startBreak(session: PomodoroSession, now = Date.now()): PomodoroSession {
  const duration = session.breakMinutes * 60_000;
  return {
    ...session,
    phase: "break",
    startedAt: now,
    endsAt: now + duration,
    checkInAt: now + duration,
    checkInAcknowledged: true,
  };
}

export function pomodoroRemaining(session: PomodoroSession, now = Date.now()): number {
  return Math.max(0, session.endsAt - now);
}

export function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function isPomodoroSession(value: unknown): value is PomodoroSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PomodoroSession>;
  return typeof item.id === "string"
    && typeof item.task === "string"
    && POMODORO_PRESETS.some((preset) => preset.focusMinutes === item.focusMinutes && preset.breakMinutes === item.breakMinutes)
    && (item.phase === "focus" || item.phase === "break")
    && typeof item.startedAt === "number"
    && typeof item.endsAt === "number"
    && typeof item.checkInAt === "number"
    && typeof item.checkInAcknowledged === "boolean";
}

