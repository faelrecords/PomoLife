import type {
  PlannerEngineListener,
  PlannerEngineSnapshot,
} from "./types";

export class EngineStateStore {
  private snapshot: PlannerEngineSnapshot;
  private readonly listeners = new Set<PlannerEngineListener>();

  constructor(initialSnapshot: PlannerEngineSnapshot) {
    this.snapshot = initialSnapshot;
  }

  getSnapshot = (): PlannerEngineSnapshot => this.snapshot;

  subscribe = (listener: PlannerEngineListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(next: PlannerEngineSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
