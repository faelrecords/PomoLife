const MINUTE_MS = 60_000;

export const FOCUS_DURATION_MINUTES = 30;
export const FOCUS_DURATION_MS = FOCUS_DURATION_MINUTES * MINUTE_MS;
export const FOCUS_CHECKPOINT_MINUTES = [10, 20, 30] as const;

export type FocusCheckpointMinute = (typeof FOCUS_CHECKPOINT_MINUTES)[number];
export type FocusTimerStatus = "pending" | "running" | "completed";

export interface FocusSession {
  id: string;
  task: string;
  desiredOutcome: string;
  distraction: string;
  startedAt: number;
  endsAt: number;
  acknowledgedCheckpoints: FocusCheckpointMinute[];
}

export interface CreateFocusSessionInput {
  task: string;
  desiredOutcome?: string;
  distraction?: string;
  id?: string;
}

export interface FocusCheckpoint {
  minute: FocusCheckpointMinute;
  dueAt: number;
}

export interface FocusTimerSnapshot {
  status: FocusTimerStatus;
  elapsedMs: number;
  remainingMs: number;
  progress: number;
  dueCheckpoints: FocusCheckpoint[];
  nextCheckpoint: FocusCheckpoint | null;
}

function createSessionId(now: number): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `focus-${now}-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function isFocusCheckpointMinute(
  value: unknown,
): value is FocusCheckpointMinute {
  return FOCUS_CHECKPOINT_MINUTES.includes(value as FocusCheckpointMinute);
}

export function isFocusSession(value: unknown): value is FocusSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Partial<FocusSession>;
  return (
    typeof session.id === "string" &&
    session.id.length > 0 &&
    typeof session.task === "string" &&
    typeof session.desiredOutcome === "string" &&
    typeof session.distraction === "string" &&
    typeof session.startedAt === "number" &&
    Number.isFinite(session.startedAt) &&
    typeof session.endsAt === "number" &&
    Number.isFinite(session.endsAt) &&
    session.endsAt > session.startedAt &&
    Array.isArray(session.acknowledgedCheckpoints) &&
    session.acknowledgedCheckpoints.every(isFocusCheckpointMinute)
  );
}

export function createFocusSession(
  input: CreateFocusSessionInput,
  now = Date.now(),
): FocusSession {
  return {
    id: input.id ?? createSessionId(now),
    task: input.task.trim(),
    desiredOutcome: input.desiredOutcome?.trim() ?? "",
    distraction: input.distraction?.trim() ?? "",
    startedAt: now,
    endsAt: now + FOCUS_DURATION_MS,
    acknowledgedCheckpoints: [],
  };
}

export function getFocusCheckpoints(session: FocusSession): FocusCheckpoint[] {
  return FOCUS_CHECKPOINT_MINUTES.map((minute) => ({
    minute,
    dueAt: session.startedAt + minute * MINUTE_MS,
  }));
}

export function getDueCheckpoints(
  session: FocusSession,
  now = Date.now(),
): FocusCheckpoint[] {
  return getFocusCheckpoints(session).filter(
    ({ minute, dueAt }) =>
      dueAt <= now && !session.acknowledgedCheckpoints.includes(minute),
  );
}

export function getNextCheckpoint(
  session: FocusSession,
): FocusCheckpoint | null {
  return (
    getFocusCheckpoints(session).find(
      ({ minute }) => !session.acknowledgedCheckpoints.includes(minute),
    ) ?? null
  );
}

export function acknowledgeCheckpoint(
  session: FocusSession,
  minute: FocusCheckpointMinute,
): FocusSession {
  if (session.acknowledgedCheckpoints.includes(minute)) {
    return session;
  }

  return {
    ...session,
    acknowledgedCheckpoints: [...session.acknowledgedCheckpoints, minute].sort(
      (left, right) => left - right,
    ),
  };
}

export function getFocusTimerSnapshot(
  session: FocusSession,
  now = Date.now(),
): FocusTimerSnapshot {
  const durationMs = session.endsAt - session.startedAt;
  const elapsedMs = clamp(now - session.startedAt, 0, durationMs);
  const remainingMs = clamp(session.endsAt - now, 0, durationMs);

  let status: FocusTimerStatus = "running";
  if (now < session.startedAt) {
    status = "pending";
  } else if (now >= session.endsAt) {
    status = "completed";
  }

  return {
    status,
    elapsedMs,
    remainingMs,
    progress: durationMs > 0 ? elapsedMs / durationMs : 1,
    dueCheckpoints: getDueCheckpoints(session, now),
    nextCheckpoint: getNextCheckpoint(session),
  };
}

/** Formats a countdown without briefly showing 00:00 before it actually ends. */
export function formatCountdown(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) {
    return "00:00";
  }

  const totalSeconds = Math.max(Math.ceil(milliseconds / 1_000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatCheckpointLabel(minute: FocusCheckpointMinute): string {
  return `${minute} min`;
}

export function formatClockTime(
  timestamp: number,
  timeZone?: string,
): string {
  if (!Number.isFinite(timestamp)) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(timestamp));
}
