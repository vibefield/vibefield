import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import type { FielddHandleCoordinator } from "./fieldd-handle-coordinator";

type Stop = () => void;
type Client = FielddHandle["client"];

export type FielddObservationKind = "plugins" | "preferences" | "health";

export interface RecoveringFielddObserverCallbacks {
  onStatus(status: string): void;
  observePlugins(client: Client): Promise<Stop>;
  onPreferences(value: unknown): void;
  onHealth(value: unknown): void;
  onError(kind: FielddObservationKind, error: unknown): void;
}

/** Rebinds the complete main-process observation set whenever supervisor
 * recovery produces a new handle. Generation guards ensure a late subscription
 * from the old handle is immediately torn down and can never publish stale
 * state into the tray. */
export class RecoveringFielddObservers {
  private generation = 0;
  private disposed = false;
  private statusStop: Stop | null = null;
  private readonly activeStops = new Map<FielddObservationKind, Stop>();
  private readonly pendingKinds = new Map<FielddObservationKind, number>();
  private readonly stopHandleObservation: Stop;

  constructor(
    coordinator: FielddHandleCoordinator,
    private readonly callbacks: RecoveringFielddObserverCallbacks,
  ) {
    this.stopHandleObservation = coordinator.onHandle((handle) => this.bind(handle));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.stopHandleObservation();
    this.clearCurrent();
  }

  private bind(handle: FielddHandle): void {
    if (this.disposed) return;
    this.generation += 1;
    const generation = this.generation;
    this.clearCurrent();

    const publishStatus = () => {
      if (!this.isCurrent(generation)) return;
      const status = handle.client.status;
      this.callbacks.onStatus(status);
      // FielddClient replays established subscriptions itself. These calls
      // repair only observations whose initial subscribe failed while the
      // transport was dropping, once that same client reports ready again.
      if (status === "ready") this.attachAll(generation, handle);
    };
    this.statusStop = handle.client.onStatusChange(publishStatus);
    publishStatus();
  }

  private attachAll(generation: number, handle: FielddHandle): void {
    this.attach(generation, "plugins", () => this.callbacks.observePlugins(handle.client));
    this.attachSubscription(
      generation,
      "preferences",
      handle,
      "storage.appPreferences.subscribe",
      (value) => this.callbacks.onPreferences(value),
    );
    this.attachSubscription(generation, "health", handle, "system.health.subscribe", (value) =>
      this.callbacks.onHealth(value),
    );
  }

  private attachSubscription(
    generation: number,
    kind: "preferences" | "health",
    handle: FielddHandle,
    method: string,
    publish: (value: unknown) => void,
  ): void {
    this.attach(generation, kind, async () => {
      let eventReceived = false;
      const subscription = await handle.client.subscribe(method, {}, (payload) => {
        eventReceived = true;
        if (this.isCurrent(generation)) publish(payload);
      });
      if (!eventReceived && this.isCurrent(generation)) publish(subscription.snapshot);
      return subscription.unsubscribe;
    });
  }

  private attach(
    generation: number,
    kind: FielddObservationKind,
    operation: () => Promise<Stop>,
  ): void {
    if (!this.isCurrent(generation) || this.pendingKinds.has(kind) || this.activeStops.has(kind)) {
      return;
    }
    this.pendingKinds.set(kind, generation);
    void operation().then(
      (stop) => {
        if (this.pendingKinds.get(kind) === generation) this.pendingKinds.delete(kind);
        if (!this.isCurrent(generation)) {
          stop();
          return;
        }
        this.activeStops.set(kind, stop);
      },
      (error: unknown) => {
        if (this.pendingKinds.get(kind) === generation) this.pendingKinds.delete(kind);
        if (this.isCurrent(generation)) this.callbacks.onError(kind, error);
      },
    );
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && this.generation === generation;
  }

  private clearCurrent(): void {
    const statusStop = this.statusStop;
    this.statusStop = null;
    try {
      statusStop?.();
    } catch {
      // Observation teardown is best-effort and never blocks replacement.
    }
    for (const stop of this.activeStops.values()) {
      try {
        stop();
      } catch {
        // Observation teardown is best-effort and never blocks replacement.
      }
    }
    this.activeStops.clear();
    this.pendingKinds.clear();
  }
}
