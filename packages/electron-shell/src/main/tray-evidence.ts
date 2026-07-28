import type { NodeLogging } from "@vibefield/logging";
import type { TrayEvidenceState } from "./tray-model";

type WriterSource = Pick<NodeLogging, "health" | "subscribeWriterState">;

/** Fuses live Electron writer state, local evidence subsystem availability,
 * and fieldd's audit/logging health into one conservative tray verdict. */
export class TrayEvidenceMonitor {
  private readonly stops: Array<() => void> = [];
  private localAvailable: boolean;
  private remoteHealthy: boolean | null = null;
  private state: TrayEvidenceState;

  constructor(
    private readonly options: {
      writers: readonly WriterSource[];
      localAvailable: boolean;
      onChange?: (state: TrayEvidenceState) => void;
    },
  ) {
    this.localAvailable = options.localAvailable;
    this.state = this.compute();
    for (const writer of options.writers) {
      this.stops.push(writer.subscribeWriterState(() => this.refresh()));
    }
  }

  current(): TrayEvidenceState {
    return this.state;
  }

  setLocalAvailable(available: boolean): void {
    this.localAvailable = available;
    this.refresh();
  }

  updateRemote(raw: unknown): void {
    const health =
      typeof raw === "object" && raw !== null
        ? (raw as {
            audit?: { state?: unknown };
            logging?: { writerState?: unknown } | null;
          })
        : {};
    this.remoteHealthy =
      health.audit?.state === "healthy" &&
      health.logging !== null &&
      health.logging?.writerState === "healthy";
    this.refresh();
  }

  markRemoteUnavailable(): void {
    this.remoteHealthy = false;
    this.refresh();
  }

  dispose(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  private compute(): TrayEvidenceState {
    const writersHealthy = this.options.writers.every(
      (writer) => writer.health().writerState === "healthy",
    );
    return writersHealthy && this.localAvailable && this.remoteHealthy !== false
      ? "healthy"
      : "degraded";
  }

  private refresh(): void {
    const next = this.compute();
    if (next === this.state) return;
    this.state = next;
    this.options.onChange?.(next);
  }
}
